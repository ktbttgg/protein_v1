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
  date: string;
  meal_text?: string;
  meal_type?: "breakfast" | "lunch" | "dinner" | "snack";
  photo_path: string;
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

type WatchoutId =
  | "high_fat_extras"
  | "large_refined_carbs"
  | "fried"
  | "processed_meat"
  | "high_added_sugar";

type Watchout = {
  id: WatchoutId;
  label: string;
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
  watchouts: Watchout[];
};

function clampText(text: string, max = 220) {
  const t = (text ?? "").trim().replace(/\s+/g, " ");
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

const WATCHOUT_LABELS: Record<WatchoutId, string> = {
  high_fat_extras: "High-fat extras",
  large_refined_carbs: "Large refined carbs",
  fried: "Fried or crumbed",
  processed_meat: "Processed meat",
  high_added_sugar: "High added sugar",
};

const VALID_WATCHOUT_IDS = new Set(Object.keys(WATCHOUT_LABELS));

function validateWatchouts(input: unknown): Watchout[] {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  const output: Watchout[] = [];

  for (const item of input) {
    if (!item || typeof item !== "object") continue;

    const raw = item as Record<string, unknown>;
    const id = raw.id;

    if (typeof id !== "string") continue;
    if (!VALID_WATCHOUT_IDS.has(id)) continue;
    if (seen.has(id)) continue;

    seen.add(id);

    output.push({
      id: id as WatchoutId,
      label: WATCHOUT_LABELS[id as WatchoutId],
      reason: typeof raw.reason === "string" ? clampText(raw.reason, 120) : "",
    });

    if (output.length >= 2) break;
  }

  return output;
}

function normaliseText(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function hasAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

function addWatchout(
  output: Watchout[],
  id: WatchoutId,
  reason: string,
) {
  if (output.some((w) => w.id === id)) return;
  if (output.length >= 2) return;

  output.push({
    id,
    label: WATCHOUT_LABELS[id],
    reason: clampText(reason, 120),
  });
}

/**
 * Deterministic safety net.
 *
 * The benchmark showed GPT recognises foods well, but does not reliably emit structured watchouts.
 * So GPT still analyses the meal, then this function converts its own recognised text into watchouts.
 */
function deriveWatchoutsFromText(opts: {
  mealSummary: string;
  notes: string;
  mealText?: string;
}): Watchout[] {
  const text = normaliseText(
    `${opts.mealSummary ?? ""} ${opts.notes ?? ""} ${opts.mealText ?? ""}`,
  );

  const output: Watchout[] = [];

  const isBalancedRiceMeal =
    hasAny(text, ["chicken"]) &&
    hasAny(text, ["vegetable", "vegetables", "broccoli", "carrot", "capsicum", "bell pepper"]) &&
    hasAny(text, ["rice"]) &&
    !hasAny(text, ["naan", "pizza", "pasta", "noodle", "chips", "fries"]);

  const isSushi =
    hasAny(text, ["sushi", "nigiri", "seaweed"]) &&
    hasAny(text, ["salmon", "tuna", "avocado"]);

  const isWholegrain =
    hasAny(text, ["whole grain", "wholegrain", "seeded", "whole wheat", "wholemeal"]);

  const hasChocolateCereal =
    hasAny(text, ["chocolate cereal", "chocolate puffed cereal", "choc cereal"]);

  const hasSugaryCereal =
    hasAny(text, ["sugary cereal", "sweet cereal"]);

  const hasCreamyPasta =
    hasAny(text, ["creamy pasta", "creamy chicken pasta", "cream sauce", "creamy sauce", "alfredo", "carbonara"]);

  const hasPasta =
    hasAny(text, ["pasta", "spaghetti", "penne", "fettuccine", "linguine", "macaroni"]);

  const hasPizza =
    hasAny(text, ["pizza", "pizza base", "pizza crust"]);

  const hasWhiteToastOrBread =
    hasAny(text, ["white toast", "white bread", "toasted white bread"]);

  const hasWhiteWrap =
    hasAny(text, ["white flour wrap", "white wrap", "flour tortilla", "white flour tortilla", "wrap cut in half"]);

  const hasInstantNoodles =
    hasAny(text, ["instant noodles", "cup noodles", "instant noodle", "ramen noodles"]);

  const hasFriesOrChips =
    hasAny(text, ["fries", "chips", "potato chips", "fried potato chips", "thick-cut fried potato"]);

  const hasRiceAndNaan =
    hasAny(text, ["rice"]) && hasAny(text, ["naan"]);

  const hasProcessedMeat =
    hasAny(text, ["pepperoni", "salami", "sausage", "sausages", "bacon", "deli ham", "deli-style ham"]) ||
    (hasAny(text, ["ham"]) && !hasAny(text, ["roast beef", "roast chicken"]));

  const hasFried =
    hasAny(text, ["battered", "crumbed", "deep fried", "fried fish", "fried chicken", "schnitzel"]);

  const hasHighFatExtras =
    hasCreamyPasta ||
    hasAny(text, ["butter", "margarine", "aioli", "mayo", "mayonnaise", "buttery sauce"]) ||
    hasAny(text, ["peanut butter", "nut butter"]) ||
    hasAny(text, ["cheese pizza", "melted cheese"]) ||
    hasAny(text, ["large avocado", "large amount of avocado", "large portion of avocado"]);

  if (hasChocolateCereal || hasSugaryCereal) {
    addWatchout(
      output,
      "high_added_sugar",
      "Chocolate or sugary cereal can be easy to overdo while still being low in protein.",
    );
  }

  if (hasProcessedMeat) {
    addWatchout(
      output,
      "processed_meat",
      "Processed meats like ham, sausage, salami or pepperoni can quietly add up.",
    );
  }

  if (hasFried) {
    addWatchout(
      output,
      "fried",
      "Battered, crumbed or fried foods can add extra heaviness around the protein.",
    );
  }

  if (
    !isSushi &&
    !isBalancedRiceMeal &&
    !isWholegrain &&
    (
      hasPasta ||
      hasPizza ||
      hasWhiteToastOrBread ||
      hasWhiteWrap ||
      hasInstantNoodles ||
      hasFriesOrChips ||
      hasRiceAndNaan
    )
  ) {
    addWatchout(
      output,
      "large_refined_carbs",
      hasPizza
        ? "Pizza base is the dominant refined carbohydrate."
        : hasPasta
          ? "Pasta is the main refined carbohydrate in this meal."
          : hasInstantNoodles
            ? "Instant noodles are the main refined carbohydrate in this meal."
            : hasFriesOrChips
              ? "Chips or fries are the main refined carbohydrate here."
              : hasRiceAndNaan
                ? "Rice and naan together can make the refined carbs stack up."
                : "White bread or wraps are the main refined carbohydrate here.",
    );
  }

  if (hasHighFatExtras) {
    addWatchout(
      output,
      "high_fat_extras",
      hasCreamyPasta
        ? "Creamy sauce is a major part of this meal."
        : hasAny(text, ["peanut butter", "nut butter"])
          ? "Nut butter is useful, but it is more energy-dense than protein-dense."
          : hasAny(text, ["butter", "margarine"])
            ? "Butter or margarine can quietly add up on toast."
            : "Cheese, creamy sauces or rich extras can quietly add up.",
    );
  }

  return output.slice(0, 2);
}

function mergeWatchouts(primary: Watchout[], secondary: Watchout[]): Watchout[] {
  const output: Watchout[] = [];

  for (const item of [...primary, ...secondary]) {
    if (output.some((w) => w.id === item.id)) continue;
    output.push(item);
    if (output.length >= 2) break;
  }

  return output;
}

const MEAL_COACH_PROMPT = `
You are a meal coach for busy female parents.
They are time-poor, practical, and want fat loss without tracking, restriction, guilt, or diet culture.

Your job is to analyse ONE meal from an IMAGE and produce:
1) A directionally useful protein estimate
2) Meal flags for the UI
3) Coaching that helps the user make one better food decision next time

PRIMARY INPUT RULES
- The IMAGE is the primary source of truth.
- Text is optional and may be wrong.
- If the image is unclear, lower confidence.
- Describe what you can see before guessing what it is.
- Do NOT confidently name a specific branded or exact food if it is only visually similar.
- Prefer "wheat biscuit cereal" over guessing "bran cereal" or "Weet-Bix" unless packaging/text clearly confirms it.
- If milk, sauce, dressing, oil, butter, or spread is uncertain, say "possible" or "not clearly visible" in notes. Do not build coaching around an uncertain absence.

BEHAVIOUR CHANGE PRINCIPLE
Before giving advice, decide whether the meal is:
- already strong
- decent but could be improved
- clearly low protein

If the meal is already a good protein choice, reinforce the good choice first.
Do not make every meal feel like a problem.
A good coach sometimes says: "This is already a solid choice."

CORE INTENT
- The main lever is protein showing up clearly.
- If protein is low or not clearly present, coaching should prioritise protein.
- If protein is already clearly present, coaching should reinforce that and suggest only a small optional improvement.
- Do NOT suggest nuts/seeds/nut butter as the main protein fix unless no better option fits. They are mostly useful for crunch, fats, and small top-ups, not meaningful protein correction.

COACHING OUTPUT STRUCTURE
Return three coaching fields:
A) five_min_fix
B) next_time_tweak
C) reason

FIVE-MINUTE FIX RULES
- Must be doable now in 5 minutes or less.
- Household/fridge/pantry only.
- One action only.
- Must start with: Add / Swap / Reduce / Skip / Keep
- If the meal is already strong, it may start with "Keep".
- If recommending an add-on, name a specific food.
- Avoid generic phrases like "add protein" or "add a protein side" unless examples are included.
- If protein is low, prefer high-impact options: eggs, Greek yoghurt, cottage cheese, tuna/salmon, chicken, tofu, protein milk, protein shake.
- Do not recommend "add milk" to cereal unless milk is clearly absent. If milk is uncertain, use: "If there isn't milk already..."

NEXT TIME TWEAK RULES
- Must start with: "Next time,"
- One action only.
- Must reference the actual meal.
- Should be the most natural improvement for that meal:
  - toast: eggs, cheese, cottage cheese, smoked salmon
  - cereal: Greek yoghurt, protein milk, high-protein yoghurt
  - yoghurt bowl: increase yoghurt portion, add protein powder, use high-protein yoghurt
  - pasta: increase the meat-to-pasta ratio, add chicken, tuna, mince, tofu, or lentils if not already present
  - pizza: add a protein side or choose a protein-heavy topping
  - salad: add chicken, tuna, eggs, tofu, chickpeas

REASON RULES
- 1–2 short sentences.
- Must reference THIS meal.
- Explain fullness/satisfaction/repeatability.
- No calories.
- No moralising.
- If the meal is already good, say so.
- Optionality is allowed, but avoid repeating the same options every time.

MEAL SUMMARY
- Short and concrete.
- Describe visible food rather than guessing.
- Include visible protein source if present.

NOTES
- Say what you saw and the assumption used for protein.
- Mention uncertainty clearly.
- Mention hidden extras only if visible or genuinely likely.
- Do not say oil/butter/cheese/nuts are present unless visible or strongly implied.

FLAGS
fat_risk:
- high only if fried food, creamy sauce, lots of cheese, visible oil/butter, fatty cuts, nut-heavy meals.
- medium if some spread, avocado, nuts, cheese, or possible oil.
- low if lean/simple.

fibre_risk:
- high if mostly refined carbs with little fruit/veg/legumes/wholegrains.
- medium if some plant foods.
- low if clear fruit/veg/legumes/wholegrains.

carb_type:
- refined_heavy if white bread, sugary cereal, pizza, chips, pastries, white pasta/rice dominate.
- mixed if there is a balance.
- low if carbs are not dominant.

WATCHOUTS
Return a field called "watchouts".

watchouts must be an array with 0, 1, or 2 items.

Allowed ids:
- high_fat_extras
- large_refined_carbs
- fried
- processed_meat
- high_added_sugar

Return watchouts when obvious, but do not invent concerns.
The server will also validate and derive watchouts from your analysis text.

OUTPUT RULES
- Return STRICT JSON ONLY.
- No markdown.
- No extra text.
- Do NOT ask the user to track calories/macros.
- Do NOT mention numbers other than protein grams.

RETURN JSON IN EXACTLY THIS SHAPE
{
  "protein_grams": number,
  "confidence": "low"|"medium"|"high",
  "notes": string,
  "fat_risk": "low"|"medium"|"high",
  "fibre_risk": "low"|"medium"|"high",
  "carb_type": "low"|"mixed"|"refined_heavy",
  "meal_summary": string,
  "watchouts": [
    {
      "id": "high_fat_extras"|"large_refined_carbs"|"fried"|"processed_meat"|"high_added_sugar",
      "reason": string
    }
  ],
  "coaching": {
    "five_min_fix": string,
    "next_time_tweak": string,
    "reason": string
  }
}
`.trim();

async function fetchImageAsDataUrl(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to fetch image for base64: ${r.status}`);
  const contentType = r.headers.get("content-type") ?? "image/jpeg";
  const bytes = new Uint8Array(await r.arrayBuffer());

  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);

  return `data:${contentType};base64,${base64}`;
}

function stripJsonFences(text: string) {
  return String(text)
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

async function analyzeMealFromImage(opts: EstimateOpts): Promise<MealLLMOutput> {
  const { signedImageUrl, mealText, mealType } = opts;

  const hint = `
Optional hints:
- meal_type: ${mealType ?? "unknown"}
- text: ${mealText?.trim() ? mealText.trim() : "none"}
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
      temperature: 0.25,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: MEAL_COACH_PROMPT },
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
    data?.output?.[0]?.content?.find((c: any) => c?.type === "output_text")?.text ??
    "";

  let parsed: any;
  try {
    parsed = JSON.parse(stripJsonFences(outputText));
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

  const meal_summary = clampText(String(parsed?.meal_summary ?? ""), 160);

  const c = parsed?.coaching ?? {};
  const coaching: CoachingOut = {
    five_min_fix: clampText(String(c?.five_min_fix ?? ""), 240),
    next_time_tweak: clampText(String(c?.next_time_tweak ?? ""), 240),
    reason: clampText(String(c?.reason ?? ""), 280),
  };

  const modelWatchouts = validateWatchouts(parsed?.watchouts);
  const derivedWatchouts = deriveWatchoutsFromText({
    mealSummary: meal_summary,
    notes,
    mealText,
  });

  const watchouts = mergeWatchouts(derivedWatchouts, modelWatchouts);

  return {
    protein_grams: Math.round(protein),
    confidence: confOk ? confidence : "medium",
    notes: clampText(notes, 360),
    fat_risk: fatOk ? fat_risk : "medium",
    fibre_risk: fibreOk ? fibre_risk : "medium",
    carb_type: carbOk ? carb_type : "mixed",
    meal_summary,
    coaching,
    watchouts,
  };
}

type CoachingFocus = "protein" | "balance" | "snack" | "reinforce";

type CoachingScenario =
  | "UNKNOWN_MEAL"
  | "LOW_PROTEIN_BREAKFAST"
  | "LOW_PROTEIN_LUNCH"
  | "LOW_PROTEIN_DINNER"
  | "LOW_PROTEIN_SNACK"
  | "MEDIUM_PROTEIN"
  | "HIGH_PROTEIN"
  | "GOOD_START";

type Coaching = {
  scenario_id: CoachingScenario;
  focus: CoachingFocus;
  five_min_fix: string;
  next_time_tweak: string;
  reason: string;
};

function getMealProteinTarget(mealType?: string) {
  switch (mealType) {
    case "breakfast":
      return 30;
    case "lunch":
      return 35;
    case "dinner":
      return 35;
    case "snack":
      return 20;
    default:
      return 30;
  }
}

function textIncludesAny(text: string, words: string[]) {
  const t = (text || "").toLowerCase();
  return words.some((w) => t.includes(w));
}

function hasStrongProteinCue(text: string) {
  return textIncludesAny(text, [
    "egg",
    "eggs",
    "chicken",
    "tuna",
    "salmon",
    "fish",
    "beef",
    "steak",
    "mince",
    "turkey",
    "ham",
    "yoghurt",
    "yogurt",
    "greek",
    "cottage",
    "ricotta",
    "tofu",
    "tempeh",
    "lentil",
    "lentils",
    "bean",
    "beans",
    "chickpea",
    "chickpeas",
    "protein shake",
    "protein milk",
    "protein powder",
  ]);
}

function hasWeakProteinOnlyFix(text: string) {
  const t = (text || "").toLowerCase();
  const weak = ["nuts", "seeds", "peanut butter", "nut butter", "hummus"];
  const strong = [
    "egg",
    "eggs",
    "chicken",
    "tuna",
    "salmon",
    "greek yoghurt",
    "greek yogurt",
    "cottage",
    "tofu",
    "protein shake",
    "protein milk",
    "protein powder",
    "cheese",
  ];
  return weak.some((w) => t.includes(w)) && !strong.some((s) => t.includes(s));
}

function deriveCoachingScenario(opts: {
  proteinGrams: number;
  confidence: "low" | "medium" | "high";
  mealType?: "breakfast" | "lunch" | "dinner" | "snack";
  mealSummary?: string;
  notes?: string;
}): { scenario_id: CoachingScenario; focus: CoachingFocus } {
  const { proteinGrams, confidence, mealType, mealSummary = "", notes = "" } = opts;

  if (confidence === "low" || !Number.isFinite(proteinGrams)) {
    return { scenario_id: "UNKNOWN_MEAL", focus: "protein" };
  }

  const combined = `${mealSummary} ${notes}`;
  const target = getMealProteinTarget(mealType);

  if (proteinGrams >= target) {
    return { scenario_id: "HIGH_PROTEIN", focus: "reinforce" };
  }

  if (proteinGrams >= target - 10 && hasStrongProteinCue(combined)) {
    return { scenario_id: "GOOD_START", focus: "reinforce" };
  }

  if (proteinGrams >= 18) {
    return { scenario_id: "MEDIUM_PROTEIN", focus: "protein" };
  }

  if (hasStrongProteinCue(combined) && proteinGrams >= 10) {
    return { scenario_id: "GOOD_START", focus: "reinforce" };
  }

  if (mealType === "breakfast") {
    return { scenario_id: "LOW_PROTEIN_BREAKFAST", focus: "protein" };
  }
  if (mealType === "lunch") {
    return { scenario_id: "LOW_PROTEIN_LUNCH", focus: "protein" };
  }
  if (mealType === "dinner") {
    return { scenario_id: "LOW_PROTEIN_DINNER", focus: "protein" };
  }
  if (mealType === "snack") {
    return { scenario_id: "LOW_PROTEIN_SNACK", focus: "snack" };
  }

  return { scenario_id: "UNKNOWN_MEAL", focus: "protein" };
}

function mealSpecificTopUp(opts: {
  mealType?: string;
  mealSummary?: string;
  notes?: string;
}) {
  const text = `${opts.mealSummary ?? ""} ${opts.notes ?? ""}`.toLowerCase();

  if (text.includes("yoghurt") || text.includes("yogurt") || text.includes("berries")) {
    return {
      five_min_fix:
        "Add a little more Greek yoghurt or stir in protein powder if you have it, then eat the berries and yoghurt.",
      next_time_tweak:
        "Next time, use a larger serve of Greek yoghurt or a higher-protein yoghurt as the base.",
      reason:
        "This is already a strong breakfast pattern. Increasing the yoghurt portion is the easiest way to make it more filling without changing the meal.",
    };
  }

  if (text.includes("egg") || text.includes("avocado")) {
    return {
      five_min_fix:
        "Keep the eggs as the anchor; if you are still hungry, add one extra egg or a spoon of cottage cheese.",
      next_time_tweak:
        "Next time, add one more egg or a cottage cheese layer to the avocado toast.",
      reason:
        "This is already a solid choice because the eggs are doing the heavy lifting. A small protein top-up only matters if you want it to hold you longer.",
    };
  }

  if (text.includes("cereal")) {
    return {
      five_min_fix:
        "Add Greek yoghurt or protein milk if you have it; if there is no milk already, add milk first.",
      next_time_tweak:
        "Next time, pair this cereal with Greek yoghurt or protein milk so it keeps you fuller.",
      reason:
        "Cereal is usually easy to eat quickly, so pairing it with a stronger protein base makes the same breakfast more satisfying.",
    };
  }

  if (text.includes("toast") || text.includes("bread") || text.includes("sourdough")) {
    return {
      five_min_fix:
        "Add an egg, cheese, or cottage cheese to the toast first, then eat the rest.",
      next_time_tweak:
        "Next time, make the toast start with a clear protein topping like eggs, cheese, cottage cheese, or smoked salmon.",
      reason:
        "Toast is easy and repeatable; adding a clear protein topping makes it more filling without changing the whole meal.",
    };
  }

  if (text.includes("pasta") || text.includes("noodle")) {
    return {
      five_min_fix:
        "Add tuna, chicken, tofu, or leftover meat if you have it, then eat the pasta.",
      next_time_tweak:
        "Next time, add a planned protein like chicken, tuna, mince, tofu, or lentils into the pasta.",
      reason:
        "Pasta is more satisfying when the protein is built into the bowl rather than left as an afterthought.",
    };
  }

  return {
    five_min_fix:
      "Add a simple protein top-up now if you have one: an egg, Greek yoghurt, cottage cheese, tuna, chicken, tofu, or a protein shake.",
    next_time_tweak:
      "Next time, add one clear protein anchor to this meal so it keeps you fuller.",
    reason:
      "A clear protein anchor makes the meal more satisfying and easier to repeat without tracking.",
  };
}

function fallbackCoaching(
  scenario_id: CoachingScenario,
  proteinGrams: number,
  mealSummary?: string,
  notes?: string,
  mealType?: string,
): Omit<Coaching, "scenario_id" | "focus"> {
  const specific = mealSpecificTopUp({ mealType, mealSummary, notes });

  switch (scenario_id) {
    case "GOOD_START":
      return {
        five_min_fix:
          "Keep the protein anchor you already have; only add a small top-up if you are still hungry.",
        next_time_tweak: specific.next_time_tweak,
        reason:
          "This meal already has a useful protein base. The win is repeating this pattern, not fixing everything.",
      };

    case "HIGH_PROTEIN":
      return {
        five_min_fix:
          "Keep this as-is if it feels satisfying; add fruit or veg only if you want more volume.",
        next_time_tweak:
          "Next time, repeat this protein base and add a fruit or veg side you actually like.",
        reason:
          `Protein looks strong at around ${Math.round(proteinGrams)}g, so this is more about repeatability than correction.`,
      };

    case "MEDIUM_PROTEIN":
      return specific;

    case "LOW_PROTEIN_BREAKFAST":
    case "LOW_PROTEIN_LUNCH":
    case "LOW_PROTEIN_DINNER":
    case "LOW_PROTEIN_SNACK":
    case "UNKNOWN_MEAL":
    default:
      return specific;
  }
}

function startsWithAllowedAction(text: string) {
  const t = (text || "").trim().toLowerCase();
  return (
    t.startsWith("add ") ||
    t.startsWith("swap ") ||
    t.startsWith("reduce ") ||
    t.startsWith("skip ") ||
    t.startsWith("keep ")
  );
}

function fixActionStart(text: string) {
  if (startsWithAllowedAction(text)) return text;
  return `Add ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

function normaliseCoaching(opts: {
  analysis: MealLLMOutput;
  scenario_id: CoachingScenario;
  estimateGrams: number;
  mealType?: string;
}) {
  const { analysis, scenario_id, estimateGrams, mealType } = opts;
  const fallback = fallbackCoaching(
    scenario_id,
    estimateGrams,
    analysis.meal_summary,
    analysis.notes,
    mealType,
  );

  const llmCoachingOk =
    analysis.confidence !== "low" &&
    analysis.coaching?.five_min_fix &&
    analysis.coaching?.next_time_tweak &&
    analysis.coaching?.reason &&
    String(analysis.coaching.next_time_tweak).toLowerCase().startsWith("next time,");

  let coachingText = llmCoachingOk ? analysis.coaching : fallback;

  const target = getMealProteinTarget(mealType);
  const shortfall = target - estimateGrams;
  const combined = `${analysis.meal_summary} ${analysis.notes}`;
  const hasProteinAlready = hasStrongProteinCue(combined);

  if (
    scenario_id === "GOOD_START" ||
    scenario_id === "HIGH_PROTEIN" ||
    (hasProteinAlready && estimateGrams >= 10)
  ) {
    if (
      hasWeakProteinOnlyFix(coachingText.five_min_fix) ||
      !String(coachingText.reason).toLowerCase().includes("already")
    ) {
      coachingText = fallback;
    }
  } else if (
    analysis.confidence !== "low" &&
    shortfall > 3 &&
    (hasWeakProteinOnlyFix(coachingText.five_min_fix) ||
      !hasStrongProteinCue(coachingText.five_min_fix))
  ) {
    coachingText = mealSpecificTopUp({
      mealType,
      mealSummary: analysis.meal_summary,
      notes: analysis.notes,
    });
  }

  return {
    five_min_fix: clampText(fixActionStart(coachingText.five_min_fix), 240),
    next_time_tweak: clampText(coachingText.next_time_tweak, 240),
    reason: clampText(coachingText.reason, 280),
  };
}

Deno.serve(async (req: Request) => {
  console.log("v2 function hit:", req.method, new Date().toISOString());

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

    const { data: signed, error: signedErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(photo_path, 60 * 10);

    if (signedErr || !signed?.signedUrl) {
      throw new Error(`createSignedUrl failed: ${signedErr?.message ?? "no signedUrl"}`);
    }

    const { data: mealRow, error: mealInsertErr } = await supabase
      .from(MEALS_TABLE)
      .insert({
        session_id,
        date,
        meal_text: meal_text || null,
        meal_type: meal_type ?? null,
        photo_url: signed.signedUrl,
      })
      .select("id")
      .single();

    if (mealInsertErr) throw new Error(`meals insert failed: ${mealInsertErr.message}`);
    const meal_id = mealRow.id as string;

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
      mealSummary: analysis.meal_summary,
      notes: analysis.notes,
    });

    const coachingText = normaliseCoaching({
      analysis,
      scenario_id,
      estimateGrams: estimate.grams,
      mealType: meal_type,
    });

    const coaching: Coaching = {
      scenario_id,
      focus,
      five_min_fix: coachingText.five_min_fix,
      next_time_tweak: coachingText.next_time_tweak,
      reason: coachingText.reason,
    };

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

    const mealTarget = getMealProteinTarget(meal_type);

    return json({
      success: true,
      meal_id,
      estimate: {
        protein_grams: estimate.grams,
        confidence: estimate.confidence,
        notes: estimate.notes,
      },
      meal_summary: analysis.meal_summary,
      coaching,
      watchouts: analysis.watchouts,
      daily: {
        date,
        protein_total: newTotal,
        protein_goal: goal,
        remaining: goal - newTotal,
      },
      meal_target: {
        meal_type: meal_type ?? null,
        protein_target: mealTarget,
        shortfall: mealTarget - estimate.grams,
      },
    });
  } catch (err) {
    console.error("Function error:", err);
    return json({ error: String((err as any)?.message ?? err) }, 500);
  }
});