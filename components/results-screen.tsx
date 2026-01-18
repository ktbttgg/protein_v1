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

export function ResultsScreen({
  result,
  dailyGoal,
  onAddToday,
  onEditMeal,
  isLoading,
}: ResultsScreenProps) {
  // Loading state
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

  // --- Derived values ---
  const mealType: MealType = result.mealType
  const protein = Number(result.protein || 0)

  const roundToNearest5 = (n: number) => Math.round(n / 5) * 5

  const getMealTarget = (goal: number, mt: MealType) => {
    const ratios: Record<MealType, number> = {
      breakfast: 0.3,
      lunch: 0.3,
      dinner: 0.25,
      snack: 0.075, // per snack, assuming ~2 snacks/day
    }
    return Math.max(10, roundToNearest5(goal * ratios[mt]))
  }

  const mealTarget = getMealTarget(dailyGoal, mealType)
  const delta = mealTarget - protein

  const deltaLabel =
    delta > 0 ? `${delta}g short` : delta === 0 ? "Hit goal" : `${Math.abs(delta)}g over`

  const deltaTone =
    delta > 0 ? "text-orange-600 bg-orange-50" : "text-green-600 bg-green-50"

  const mealTypeLabel = mealType.charAt(0).toUpperCase() + mealType.slice(1)

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

  // --- UI ---
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

        {/* Meal goal */}
        <Card className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-medium text-foreground">
                {mealTypeLabel} goal
              </h2>

              <p className="mt-1 text-sm text-muted-foreground">
                Aim for{" "}
                <span className="font-medium text-foreground">{mealTarget}g</span>{" "}
                this meal
              </p>

              <p className="mt-1 text-xs text-muted-foreground">
                Based on {dailyGoal}g/day
              </p>

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

        {/* Analysis */}
        <Card className="p-6">
          <h2 className="mb-2 text-sm font-medium text-foreground">Analysis</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {result.explanation}
          </p>
        </Card>

        {/* Coaching */}
        {result.coaching && (
          <Card className="p-6">
            <h2 className="mb-2 text-sm font-medium text-foreground">Coaching</h2>

            <div className="space-y-4">
              <div>
                <div className="text-xs font-medium text-muted-foreground">5-minute fix</div>
                <p className="text-sm leading-relaxed text-foreground">
                  {result.coaching.five_min_fix}
                </p>
              </div>

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
          <p className="text-sm leading-relaxed text-foreground">
            {result.mealDescription}
          </p>
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
