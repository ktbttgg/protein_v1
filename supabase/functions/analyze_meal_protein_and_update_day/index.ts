import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RequestBody = {
  session_id: string;
  date: string; // "YYYY-MM-DD"
  meal_text?: string; // optional (we prefer image)
  meal_type?: "breakfast" | "lunch" | "dinner" | "snack";
  photo_path: string; // REQUIRED (path inside bucket)
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

const DAILY_GOAL_GRAMS = 120;

const BUCKET = "meal_photos";
const MEALS_TABLE = "meals";
const MEAL_ANALYSIS_TABLE = "meal_analysis";
const DAILY_TOTALS_TABLE = "daily_totals";

function json(resBody: unknown, status = 200) {
  return new Response(JSON.stringify(resBody), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type EstimateOpts = {
  signedImageUrl: string;
  mealText?: string;
  mealType?: string;
};

async function estimateProteinFromImage(
  opts: EstimateOpts,
): Promise<{ grams: number; confidence: "low" | "medium" | "high"; notes: string }> {
  const { signedImageUrl, mealText, mealType } = opts;

  const instruction = `
You are estimating protein grams for a meal.

CRITICAL:
- Use the IMAGE as the primary source of truth.
- Use the text only as a minor hint if it helps (text may be wrong).
- If the image is unclear, say so and lower confidence.

Return STRICT JSON ONLY (no markdown, no extra text) in this exact shape:
{"protein_grams": number, "confidence": "low"|"medium"|"high", "notes": string}

Notes should briefly explain what you saw (portion size assumptions etc).
`.trim();

  const hint = `
Optional hints:
- meal_type: ${mealType ?? "unknown"}
- text: ${mealText?.trim() ? mealText.trim() : "none"}
`.trim();

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      temperature: 0.2,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: instruction },
            { type: "input_text", text: hint },
            { type: "input_image", image_url: signedImageUrl },
          ],
        },
      ],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI error ${resp.status}: ${text}`);
  }

  const data = await resp.json();

  const outputText =
    data?.output?.[0]?.content?.find((c: any) => c?.type === "output_text")?.text ??
      "";

  let parsed: any;
  try {
    parsed = JSON.parse(String(outputText).trim());
  } catch {
    throw new Error(`Model did not return valid JSON: "${outputText}"`);
  }

  const grams = Number(parsed?.protein_grams);
  const confidence = String(parsed?.confidence ?? "medium") as
    | "low"
    | "medium"
    | "high";
  const notes = String(parsed?.notes ?? "");

  if (!Number.isFinite(grams) || grams < 0 || grams > 500) {
    throw new Error(`Bad protein_grams from model: "${outputText}"`);
  }

  const confOk = confidence === "low" || confidence === "medium" || confidence === "high";

  return {
    grams: Math.round(grams),
    confidence: confOk ? confidence : "medium",
    notes: notes.slice(0, 300),
  };
}

/* ------------------------------------------------------------------
   Phase 2: Coaching taxonomy + rules + deterministic fallback
------------------------------------------------------------------- */

type CoachingFocus = "protein" | "balance" | "snack" | "portion";

type CoachingScenario =
  | "UNKNOWN_MEAL"
  | "LOW_PROTEIN_BREAKFAST"
  | "LOW_PROTEIN_LUNCH"
  | "LOW_PROTEIN_DINNER"
  | "LOW_PROTEIN_SNACK"
  | "MEDIUM_PROTEIN"
  | "HIGH_PROTEIN";

type Coaching = {
  scenario_id: CoachingScenario;
  focus: CoachingFocus;
  five_min_fix: string;
  next_time_tweak: string;
  reason: string;
};

function clampText(text: string, max = 220) {
  const t = (text ?? "").trim().replace(/\s+/g, " ");
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

function deriveCoachingScenario(opts: {
  proteinGrams: number;
  confidence: "low" | "medium" | "high";
  mealType?: "breakfast" | "lunch" | "dinner" | "snack";
}): { scenario_id: CoachingScenario; focus: CoachingFocus } {
  const { proteinGrams, confidence, mealType } = opts;

  if (confidence === "low" || !Number.isFinite(proteinGrams)) {
    return { scenario_id: "UNKNOWN_MEAL", focus: "protein" };
  }

  const LOW = 20;
  const HIGH = 35;

  if (proteinGrams >= HIGH) return { scenario_id: "HIGH_PROTEIN", focus: "protein" };
  if (proteinGrams >= LOW) return { scenario_id: "MEDIUM_PROTEIN", focus: "protein" };

  if (mealType === "breakfast") return { scenario_id: "LOW_PROTEIN_BREAKFAST", focus: "protein" };
  if (mealType === "lunch") return { scenario_id: "LOW_PROTEIN_LUNCH", focus: "protein" };
  if (mealType === "dinner") return { scenario_id: "LOW_PROTEIN_DINNER", focus: "protein" };
  if (mealType === "snack") return { scenario_id: "LOW_PROTEIN_SNACK", focus: "snack" };

  return { scenario_id: "UNKNOWN_MEAL", focus: "protein" };
}

function fallbackCoaching(
  scenario_id: CoachingScenario,
  proteinGrams: number,
): Omit<Coaching, "scenario_id" | "focus"> {
  switch (scenario_id) {
    case "LOW_PROTEIN_BREAKFAST":
      return {
        five_min_fix:
          "Add a quick protein side like Greek yoghurt, eggs, or a protein milk/latte.",
        next_time_tweak:
          "Next time, start breakfast with a protein base (eggs, yoghurt bowl, or a shake) then add carbs.",
        reason: "Breakfast looks low on protein, so a simple add-on helps immediately.",
      };

    case "LOW_PROTEIN_LUNCH":
      return {
        five_min_fix:
          "Top it up with an easy protein add-on: tinned tuna/salmon, leftover chicken, or a tub of Greek yoghurt.",
        next_time_tweak:
          "Next time, build lunch around the protein (chicken, tuna, eggs, tofu) then add salad/rice/bread.",
        reason: "Lunch looks low on protein; a fast add-on is the quickest win.",
      };

    case "LOW_PROTEIN_DINNER":
      return {
        five_min_fix:
          "Add a protein anchor now: extra meat/fish, eggs, tofu, or a quick yoghurt-based side.",
        next_time_tweak:
          "Next time, serve the protein first, then fill out the plate with veg and carbs.",
        reason: "Dinner looks low on protein; anchoring the meal makes it simple.",
      };

    case "LOW_PROTEIN_SNACK":
      return {
        five_min_fix:
          "Swap or add a protein snack: yoghurt, cheese, boiled eggs, jerky, or a shake.",
        next_time_tweak:
          "Next time, keep two grab-and-go protein snacks stocked so it’s effortless.",
        reason: "Snack looks low on protein; a quick swap improves satiety fast.",
      };

    case "HIGH_PROTEIN":
      return {
        five_min_fix:
          "Nice — this is already protein-forward. If you’re still hungry, add fruit or veg on the side.",
        next_time_tweak:
          "Next time, repeat this structure: protein first, then add carbs/veg to suit your day.",
        reason: `Protein is already strong (~${Math.round(proteinGrams)}g), so the win is consistency.`,
      };

    case "MEDIUM_PROTEIN":
      return {
        five_min_fix:
          "Top it up with a small add-on: a yoghurt, a slice of cheese, an egg, or some tinned fish.",
        next_time_tweak:
          "Next time, add one deliberate protein item so you don’t have to ‘fix it’ later.",
        reason: "Protein is mid-range; one small add-on usually gets it over the line.",
      };

    default:
      return {
        five_min_fix:
          "If you can, add something protein-y now: yoghurt, eggs, tinned fish, leftover meat, or a shake.",
        next_time_tweak:
          "Next time, choose the protein first, then build the meal around it.",
        reason: "The meal is unclear, so the safest coaching is a simple protein add-on.",
      };
  }
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Only POST allowed" }, 405);

  try {
    const body: RequestBody = await req.json();

    const session_id = body.session_id?.trim();
    const date = body.date?.trim();
    const meal_text = body.meal_text?.trim() || "";
    const meal_type = body.meal_type;
    const photo_path = body.photo_path?.trim();

    if (!session_id || !date || !photo_path) {
      return json({ error: "Missing session_id, date, or photo_path" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Create a short-lived signed URL so OpenAI can fetch the image
    const { data: signed, error: signedErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(photo_path, 60 * 10); // 10 minutes

    if (signedErr || !signed?.signedUrl) {
      throw new Error(`createSignedUrl failed: ${signedErr?.message ?? "no signedUrl"}`);
    }

    // 1) Insert into meals
    const { data: mealRow, error: mealInsertErr } = await supabase
      .from(MEALS_TABLE)
      .insert({
        session_id,
        date,
        meal_text: meal_text || null,
        meal_type: meal_type ?? null,
        // NOTE: storing signed URL is OK for now; later you may prefer storing photo_path
        photo_url: signed.signedUrl,
      })
      .select("id")
      .single();

    if (mealInsertErr) throw new Error(`meals insert failed: ${mealInsertErr.message}`);
    const meal_id = mealRow.id as string;

    // 2) OpenAI image-first estimate
    const estimate = await estimateProteinFromImage({
      signedImageUrl: signed.signedUrl,
      mealText: meal_text || undefined,
      mealType: meal_type,
    });

    // Phase 2: deterministic coaching (rules + fallback)
    const { scenario_id, focus } = deriveCoachingScenario({
      proteinGrams: estimate.grams,
      confidence: estimate.confidence,
      mealType: meal_type,
    });

    const coachingText = fallbackCoaching(scenario_id, estimate.grams);

    const coaching: Coaching = {
      scenario_id,
      focus,
      five_min_fix: clampText(coachingText.five_min_fix),
      next_time_tweak: clampText(coachingText.next_time_tweak),
      reason: clampText(coachingText.reason),
    };

    // 3) Insert analysis
    const { error: analysisErr } = await supabase.from(MEAL_ANALYSIS_TABLE).insert({
      meal_id,
      protein_grams: estimate.grams,
      confidence: estimate.confidence,
      notes: estimate.notes,
    });

    if (analysisErr) throw new Error(`meal_analysis insert failed: ${analysisErr.message}`);

    // 4) Update daily_totals
    const { data: dailyExisting, error: dailyGetErr } = await supabase
      .from(DAILY_TOTALS_TABLE)
      .select("id, protein_total, protein_goal")
      .eq("session_id", session_id)
      .eq("date", date)
      .maybeSingle();

    if (dailyGetErr) throw new Error(`daily_totals select failed: ${dailyGetErr.message}`);

    const currentTotal = Number(dailyExisting?.protein_total ?? 0);
    const newTotal = currentTotal + estimate.grams;
    const goal = Number(dailyExisting?.protein_goal ?? DAILY_GOAL_GRAMS);

    const { error: dailyUpsertErr } = await supabase
      .from(DAILY_TOTALS_TABLE)
      .upsert(
        {
          id: dailyExisting?.id,
          session_id,
          date,
          protein_total: newTotal,
          protein_goal: goal,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "session_id,date" },
      );

    if (dailyUpsertErr) throw new Error(`daily_totals upsert failed: ${dailyUpsertErr.message}`);

    return json({
      success: true,
      meal_id,
      estimate: {
        protein_grams: estimate.grams,
        confidence: estimate.confidence,
        notes: estimate.notes,
      },
      coaching,
      daily: {
        date,
        protein_total: newTotal,
        protein_goal: goal,
        remaining: goal - newTotal,
      },
    });
  } catch (err) {
    console.error("Function error:", err);
    return json({ error: String((err as any)?.message ?? err) }, 500);
  }
});
