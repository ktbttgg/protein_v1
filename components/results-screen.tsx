"use client"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { CheckCircle2, AlertCircle, HelpCircle, ArrowLeft } from "lucide-react"
import type { MealResult } from "@/app/page"

interface ResultsScreenProps {
  result: MealResult | null
  dailyGoal: number
  onAddToday: () => void
  onEditMeal: () => void
  isLoading: boolean
}

type MealType = "breakfast" | "lunch" | "dinner" | "snack"
type ChipTone = "neutral" | "good" | "warn"

function Chip({ label, tone = "neutral" }: { label: string; tone?: ChipTone }) {
  const cls =
    tone === "good"
      ? "bg-green-50 text-green-700 border-green-100"
      : tone === "warn"
        ? "bg-orange-50 text-orange-700 border-orange-100"
        : "bg-muted/60 text-foreground border-border"

  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${cls}`}>
      {label}
    </span>
  )
}

function titleCase(s: string) {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function roundToNearest5(n: number) {
  return Math.round(n / 5) * 5
}

function getMealTarget(goal: number, mt: MealType) {
  const ratios: Record<MealType, number> = {
    breakfast: 0.3,
    lunch: 0.3,
    dinner: 0.25,
    snack: 0.075,
  }
  return Math.max(10, roundToNearest5(goal * ratios[mt]))
}

/**
 * Heuristics: "Hidden extras" only (max 3)
 * using existing fields (no new model output needed).
 */
function buildHiddenExtras(result: MealResult) {
  const text = [
    result.explanation ?? "",
    result.mealDescription ?? "",
    result.coaching?.five_min_fix ?? "",
    result.coaching?.next_time_tweak ?? "",
    result.coaching?.reason ?? "",
  ]
    .join(" ")
    .toLowerCase()

  const hasAny = (...needles: string[]) => needles.some((n) => text.includes(n))

  const extras: { label: string; tone?: ChipTone; when: boolean }[] = [
    { label: "Breadcrumb / crumbed coating", tone: "warn", when: hasAny("crumb", "breaded", "breadcrumbs", "schnitzel") },
    { label: "Creamy / cheesy add-ons", tone: "warn", when: hasAny("cheese", "creamy", "alfredo", "mayo", "aioli") },
    { label: "Oil / buttery extras", tone: "warn", when: hasAny("oil", "oily", "butter", "drizzle") },
    { label: "Nuts / seeds can stack fast", tone: "warn", when: hasAny("nuts", "almond", "cashew", "walnut", "seeds", "tahini") },
    { label: "Sauce / dressing heavy", tone: "warn", when: hasAny("sauce", "dressing", "glaze") },
    { label: "Refined carbs present", tone: "warn", when: hasAny("pasta", "white bread", "chips", "fries", "pastry", "wrap") },
  ]

  return extras.filter((e) => e.when).slice(0, 3)
}

export function ResultsScreen({
  result,
  dailyGoal,
  onAddToday,
  onEditMeal,
  isLoading,
}: ResultsScreenProps) {
  if (isLoading || !result) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-muted border-t-primary" />
          <p className="text-sm text-muted-foreground">Analyzing your meal...</p>
        </div>
      </div>
    )
  }

  const mealType: MealType = result.mealType
  const protein = Number(result.protein || 0)

  const mealTarget = getMealTarget(dailyGoal, mealType)
  const delta = mealTarget - protein

  const deltaLabel =
    delta > 0 ? `${delta}g short` : delta === 0 ? "Hit goal" : `${Math.abs(delta)}g over`

  const deltaTone =
    delta > 0 ? "text-orange-600 bg-orange-50" : "text-green-600 bg-green-50"

  const mealTypeLabel = titleCase(mealType)

  const confidenceIcon = {
    low: <AlertCircle className="h-5 w-5 text-orange-500" />,
    medium: <HelpCircle className="h-5 w-5 text-blue-500" />,
    high: <CheckCircle2 className="h-5 w-5 text-green-500" />,
  }[result.confidence]

  const confidenceColor = {
    low: "text-orange-500",
    medium: "text-blue-500",
    high: "text-green-500",
  }[result.confidence]

  const hiddenExtras = buildHiddenExtras(result)

  // Hero tweak uses coaching if present; otherwise a safe fallback
  const heroTweak =
    result.coaching?.five_min_fix?.trim() ||
    (protein >= mealTarget
      ? "Keep this meal as-is. If you still want more volume, add extra veg on the side."
      : "Add a quick protein top-up (Greek yoghurt, eggs, tinned fish, or leftover meat).")

  return (
    <div className="flex min-h-screen flex-col p-6">
      <header className="mb-8 pt-8">
        <Button variant="ghost" size="icon" onClick={onEditMeal} className="mb-6 -ml-2">
          <ArrowLeft className="h-6 w-6" />
        </Button>
        <h1 className="text-2xl font-semibold text-foreground">Results</h1>
        <p className="text-sm text-muted-foreground">Protein analysis complete</p>
      </header>

      <main className="flex flex-1 flex-col gap-6">
        {/* Protein summary */}
        <Card className="p-8">
          <div className="flex flex-col items-center gap-6">
            <div className="flex flex-col items-center gap-2">
              <span className="text-6xl font-bold text-primary">{protein}g</span>
              <span className="text-sm text-muted-foreground">Estimated protein</span>
            </div>

            <div className="flex items-center gap-2 rounded-full bg-muted/50 px-4 py-2">
              {confidenceIcon}
              <span className={`text-sm font-medium capitalize ${confidenceColor}`}>
                {result.confidence} confidence
              </span>
            </div>
          </div>
        </Card>

        {/* MOVE UP: Analysis directly under protein box */}
        <Card className="p-6">
          <h2 className="mb-2 text-sm font-medium text-foreground">Analysis</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{result.explanation}</p>
        </Card>

        {/* Meal goal */}
        <Card className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-medium text-foreground">{mealTypeLabel} goal</h2>

              <p className="mt-1 text-sm text-muted-foreground">
                Aim for <span className="font-medium text-foreground">{mealTarget}g</span> this meal
              </p>

              <p className="mt-1 text-xs text-muted-foreground">Based on {dailyGoal}g/day</p>

              {mealType === "snack" && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Assumes ~2 snacks/day (aim ~{mealTarget}g each)
                </p>
              )}
            </div>

            <div className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${deltaTone}`}>
              {deltaLabel}
            </div>
          </div>
        </Card>

        {/* Rename + simplify: 5-minute tweak (no Priority/Secondary label) */}
        <Card className="p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-foreground">5-minute tweak</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                The one thing to do right now (no tracking, no drama).
              </p>
            </div>
            <Chip label="Do this now" tone="good" />
          </div>

          <div className="mt-4 rounded-lg border bg-muted/30 p-4">
            <p className="text-sm leading-relaxed text-foreground">{heroTweak}</p>
          </div>
        </Card>

        {/* Keep: Hidden extras spotted */}
        <Card className="p-6">
          <h2 className="mb-2 text-sm font-medium text-foreground">Hidden extras spotted</h2>
          <p className="text-xs text-muted-foreground">
            Not “bad” — just the stuff that quietly adds up.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {hiddenExtras.length === 0 ? (
              <Chip label="No obvious extras from this photo" tone="good" />
            ) : (
              hiddenExtras.map((x) => <Chip key={x.label} label={x.label} tone={x.tone ?? "warn"} />)
            )}
          </div>
        </Card>

        {/* Coaching (keep it, but now it’s supporting detail) */}
        {result.coaching && (
          <Card className="p-6">
            <h2 className="mb-2 text-sm font-medium text-foreground">Coaching</h2>

            <div className="space-y-4">
              <div>
                <div className="text-xs font-medium text-muted-foreground">Next time</div>
                <p className="text-sm leading-relaxed text-foreground">
                  {result.coaching.next_time_tweak}
                </p>
              </div>

              <div>
                <div className="text-xs font-medium text-muted-foreground">Why</div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {result.coaching.reason}
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* Meal description */}
        <Card className="p-6">
          <h2 className="mb-2 text-sm font-medium text-foreground">Meal</h2>
          <p className="text-sm leading-relaxed text-foreground">{result.mealDescription}</p>
        </Card>

        {/* Actions */}
        <div className="mt-auto flex flex-col gap-3">
          <Button size="lg" onClick={onAddToday}>
            Add to today
          </Button>
          <Button size="lg" variant="outline" onClick={onEditMeal}>
            Edit meal
          </Button>
        </div>
      </main>
    </div>
  )
}
