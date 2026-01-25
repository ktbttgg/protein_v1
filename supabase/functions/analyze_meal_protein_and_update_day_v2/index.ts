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
  meal_text?: string;
  meal_type?: "breakfast" | "lunch" | "dinner" | "snack";
  photo_path: string; // path inside bucket
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

type MacroRisk = "low" | "medium" | "high";
type CarbType = "low" | "mixed" | "refined_heavy";

type CoachingOut = {
  five_min_fix: string;
  next_time_tweak: string;
  reason: string;
};

type MealLLMOutput = {
  protein_grams: number;
  confidence: "low" | "medium" | "high";
  notes: string;

  fat_risk: MacroRisk;
  fibre_risk: MacroRisk;
  carb_type: CarbType;

  meal_summary: string;
  coaching: CoachingOut;
};

function clampText(text: string, max = 220) {
  const t = (text ?? "").trim().replace(/\s+/g, " ");
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

/**
 * Local dev fix:
 * OpenAI can't fetch your localhost/kong signed URL.
 * So we fetch the signed URL server-side (Supabase can),
 * then send the image to OpenAI as a data URL (base64).
 */
async function fetchImageAsDataUrl(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to fetch image for base64: ${r.status}`);
  const contentType = r.headers.get("content-type") ?? "image/jpeg";
  const bytes = new Uint8Array(await r.arrayBuffer());

  // Convert bytes -> base64 (avoid stack issues with large arrays)
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);

  return `data:${contentType};base64,${base64}`;
}

/**
 * v2: Analyze meal from IMAGE (primary truth) and produce:
 * - protein estimate + confidence + notes
 * - silent steering flags (fat/fibre/carbs)
 * - coaching (five_min_fix, next_time_tweak, reason)
 */
async function analyzeMealFromImage(opts: EstimateOpts): Promise<MealLLMOutput> {
  const { signedImageUrl, mealText, mealType } = opts;

  const instruction = `
You are a meal coach for busy female parents (time-poor, practical, not interested in tracking).

Your job is to analyze ONE meal from an IMAGE and produce:
1) A protein estimate
2) Silent steering flags (fat, fibre, carbs)
3) Practical coaching that feels specific to THIS meal

PRIMARY INPUT RULES
- The IMAGE is the primary source of truth.
- Text is optional and may be wrong.
- If the image is unclear, lower confidence.

OUTPUT RULES
- Return STRICT JSON ONLY.
- No markdown, no extra text outside JSON.
- Do NOT ask the user to track calories, macros, fat, fibre, or carbs.
- Do NOT mention grams of fat, fibre, or carbs.
- Keep language simple, friendly, and non-preachy.

MEAL SUMMARY + PORTION ASSUMPTIONS
meal_summary:
- Short, concrete description of what the meal likely is.
- Include a brief protein portion descriptor when possible (e.g., "salmon (~120g)", "2 eggs", "chicken (~palm-sized)").
notes:
- Briefly state what you saw + the assumptions used for protein grams.

COACHING FIELD DEFINITIONS (DO NOT BLUR THESE)
five_min_fix:
- TRIAGE for right now.
- doable RIGHT NOW in 5 minutes or less
- household items only
- no shopping, no prep, no “next time”
- one action only
- may add/swap/reduce/skip
- MUST start with: Add / Swap / Reduce / Skip

next_time_tweak:
- RECIPE UPGRADE for next time you make THIS SAME meal
- must NOT be doable immediately
- may involve shopping/prep/cooking/stocking
- must mention at least ONE item seen in the meal (e.g., crackers, cheese, seeds, salmon, mince, noodles)
- one action only
- MUST start with: "Next time,"

HARD DISTINCTION TEST
- If you can do it right now in under 5 minutes, it belongs in five_min_fix, NOT next_time_tweak.

NEXT TIME FORMAT (choose ONE)
- "Next time, add ONE planned ingredient to upgrade this meal: ____."
- "Next time, change ONE prep or cooking step to upgrade this meal: ____."
- "Next time, keep ONE item stocked so this meal is better: ____."

AVOID GENERIC PHRASES
Avoid: "protein first", "build around protein", "repeat this structure", "balance your plate", "focus on consistency"
Veg guidance is allowed but MUST be specific (name the veg/plant item).

SILENT STEERING FLAGS (internal only)
fat_risk: high if fried/creamy/lots of cheese/oil/fatty cuts/pastries/large seed-nut portions
fibre_risk: high if low plants/whole grains/legumes
carb_type: refined_heavy if white bread/pasta/chips/pastry/sugary items dominate

RETURN JSON IN EXACTLY THIS SHAPE
{
  "protein_grams": number,
  "confidence": "low"|"medium"|"high",
  "notes": string,
  "fat_risk": "low"|"medium"|"high",
  "fibre_risk": "low"|"medium"|"high",
  "carb_type": "low"|"mixed"|"refined_heavy",
  "meal_summary": string,
  "coaching": {
    "five_min_fix": string,
    "next_time_tweak": string,
    "reason": string
  }
}
`.trim();

  const hint = `
Optional hints:
- meal_type:${mealType ?? "unknown"}
- text:${mealText?.trim() ? mealText.trim() : "none"}
`.trim();

  const dataUrl = await fetchImageAsDataUrl(signedImageUrl);

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      temperature: 0.3,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: instruction },
            { type: "input_text", text: hint },
            { type: "input_image", image_url: dataUrl },
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
    data?.output?.[0]?.content?.find((c: any) => c?.type === "output_text")
      ?.text ?? "";

  let parsed: any;
  try {
    parsed = JSON.parse(String(outputText).trim());
  } catch {
    throw new Error(`Model did not return valid JSON: "${outputText}"`);
  }

  const protein = Number(parsed?.protein_grams);
  const confidence = String(parsed?.confidence ?? "medium") as
    | "low"
    | "medium"
    | "high";
  const notes = String(parsed?.notes ?? "");

  if (!Number.isFinite(protein) || protein < 0 || protein > 500) {
    throw new Error(`Bad protein_grams from model: "${outputText}"`);
  }

  const confOk =
    confidence === "low" || confidence === "medium" || confidence === "high";

  const fat_risk = String(parsed?.fat_risk ?? "medium") as MacroRisk;
  const fibre_risk = String(parsed?.fibre_risk ?? "medium") as MacroRisk;
  const carb_type = String(parsed?.carb_type ?? "mixed") as CarbType;

  const fatOk = fat_risk === "low" || fat_risk === "medium" || fat_risk === "high";
  const fibreOk =
    fibre_risk === "low" || fibre_risk === "medium" || fibre_risk === "high";
  const carbOk =
    carb_type === "low" || carb_type === "mixed" || carb_type === "refined_heavy";

  const meal_summary = clampText(String(parsed?.meal_summary ?? ""), 140);

  const c = parsed?.coaching ?? {};
  const coaching: CoachingOut = {
    five_min_fix: clampText(String(c?.five_min_fix ?? ""), 220),
    next_time_tweak: clampText(String(c?.next_time_tweak ?? ""), 220),
    reason: clampText(String(c?.reason ?? ""), 220),
  };

  return {
    protein_grams: Math.round(protein),
    confidence: confOk ? confidence : "medium",
    notes: notes.slice(0, 300),
    fat_risk: fatOk ? fat_risk : "medium",
    fibre_risk: fibreOk ? fibre_risk : "medium",
    carb_type: carbOk ? carb_type : "mixed",
    meal_summary,
    coaching,
  };
}

/* ------------------------------------------------------------------
   Coaching taxonomy + deterministic fallback
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
          "Add a quick protein side like tinned tuna/salmon, leftover chicken, or a tub of Greek yoghurt.",
        next_time_tweak:
          "Next time, add one planned protein item to this lunch (chicken, tuna, eggs, or tofu).",
        reason: "Lunch looks low on protein; a fast add-on is the quickest win.",
      };

    case "LOW_PROTEIN_DINNER":
      return {
        five_min_fix:
          "Add a protein anchor now: extra meat/fish, eggs, tofu, or a quick yoghurt-based side.",
        next_time_tweak:
          "Next time, add one planned protein portion to this dinner so it lands stronger.",
        reason: "Dinner looks low on protein; anchoring the meal makes it simple.",
      };

    case "LOW_PROTEIN_SNACK":
      return {
        five_min_fix:
          "Swap or add a protein snack: yoghurt, cheese, boiled eggs, jerky, or a shake.",
        next_time_tweak:
          "Next time, keep one grab-and-go protein snack stocked so it’s effortless.",
        reason: "Snack looks low on protein; a quick swap improves satiety fast.",
      };

    case "HIGH_PROTEIN":
      return {
        five_min_fix:
          "Nice — this is already protein-forward. If you’re still hungry, add fruit or veg on the side.",
        next_time_tweak:
          "Next time, keep the same protein portion and add one veg/plant side you enjoy.",
        reason: `Protein is already strong (~${Math.round(proteinGrams)}g), so the win is consistency.`,
      };

    case "MEDIUM_PROTEIN":
      return {
        five_min_fix:
          "Add a small protein top-up now: yoghurt, a slice of cheese, an egg, or tinned fish.",
        next_time_tweak:
          "Next time, add one planned protein item so you don’t have to ‘fix it’ later.",
        reason: "Protein is mid-range; one small add-on usually gets it over the line.",
      };

    default:
      return {
        five_min_fix:
          "Add something protein-y now if you can: yoghurt, eggs, tinned fish, leftover meat, or a shake.",
        next_time_tweak:
          "Next time, add one planned protein item to this meal so it’s more filling.",
        reason: "The meal is unclear, so the safest coaching is a simple protein add-on.",
      };
  }
}

Deno.serve(async (req: Request) => {
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

    // Signed URL that Supabase can fetch (even if it's docker-internal).
    const { data: signed, error: signedErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(photo_path, 60 * 10);

    if (signedErr || !signed?.signedUrl) {
      throw new Error(`createSignedUrl failed: ${signedErr?.message ?? "no signedUrl"}`);
    }

    // 1) Insert meal
    const { data: mealRow, error: mealInsertErr } = await supabase
      .from(MEALS_TABLE)
      .insert({
        session_id,
        date,
        meal_text: meal_text || null,
        meal_type: meal_type ?? null,
        photo_url: signed.signedUrl, // fine locally
      })
      .select("id")
      .single();

    if (mealInsertErr) throw new Error(`meals insert failed: ${mealInsertErr.message}`);
    const meal_id = mealRow.id as string;

    // 2) LLM analysis + coaching
    const analysis = await analyzeMealFromImage({
      signedImageUrl: signed.signedUrl,
      mealText: meal_text || undefined,
      mealType: meal_type,
    });

    const estimate = {
      grams: analysis.protein_grams,
      confidence: analysis.confidence,
      notes: analysis.notes,
    };

    const { scenario_id, focus } = deriveCoachingScenario({
      proteinGrams: estimate.grams,
      confidence: estimate.confidence,
      mealType: meal_type,
    });

    let coachingText: { five_min_fix: string; next_time_tweak: string; reason: string };

    const llmCoachingOk =
      estimate.confidence !== "low" &&
      analysis.coaching?.five_min_fix &&
      analysis.coaching?.next_time_tweak &&
      analysis.coaching?.reason &&
      String(analysis.coaching.next_time_tweak).toLowerCase().startsWith("next time,");

    if (llmCoachingOk) {
      coachingText = analysis.coaching;
    } else {
      coachingText = fallbackCoaching(scenario_id, estimate.grams);
    }

    const coaching: Coaching = {
      scenario_id,
      focus,
      five_min_fix: clampText(coachingText.five_min_fix),
      next_time_tweak: clampText(coachingText.next_time_tweak),
      reason: clampText(coachingText.reason),
    };

    // 3) Insert analysis (Option B fields)
    const { error: analysisErr } = await supabase.from(MEAL_ANALYSIS_TABLE).insert({
      meal_id,
      protein_grams: estimate.grams,
      confidence: estimate.confidence,
      notes: estimate.notes,

      meal_summary: analysis.meal_summary,
      fat_risk: analysis.fat_risk,
      fibre_risk: analysis.fibre_risk,
      carb_type: analysis.carb_type,

      five_min_fix: coaching.five_min_fix,
      next_time_tweak: coaching.next_time_tweak,
      coaching_reason: coaching.reason,
    });

    if (analysisErr) throw new Error(`meal_analysis insert failed: ${analysisErr.message}`);

    // 4) Update daily totals
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
