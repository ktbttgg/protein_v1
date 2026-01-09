"use client"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { CheckCircle2, AlertCircle, HelpCircle, ArrowLeft } from "lucide-react"
import type { MealResult } from "@/app/page"

interface ResultsScreenProps {
  result: MealResult | null
  onAddToday: () => void
  onEditMeal: () => void
  isLoading: boolean
}

export function ResultsScreen({ result, onAddToday, onEditMeal, isLoading }: ResultsScreenProps) {
  console.log("[ResultsScreen] render", {
  hasResult: !!result,
  hasCoaching: !!(result as any)?.coaching,
  coachingKeys: (result as any)?.coaching ? Object.keys((result as any).coaching) : null,
})
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
        <Card className="p-8">
          <div className="flex flex-col items-center gap-6">
            <div className="flex flex-col items-center gap-2">
              <span className="text-6xl font-bold text-primary">{result.protein}g</span>
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

        <Card className="p-6">
          <h2 className="mb-2 text-sm font-medium text-foreground">Analysis</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{result.explanation}</p>
        </Card>

        {result.coaching && (
          <Card className="p-6">
            <h2 className="mb-2 text-sm font-medium text-foreground">Coaching</h2>

            <div className="space-y-4">
              <div>
                <div className="text-xs font-medium text-muted-foreground">5-minute fix</div>
                <p className="text-sm leading-relaxed text-foreground">{result.coaching.five_min_fix}</p>
              </div>

              <div>
                <div className="text-xs font-medium text-muted-foreground">Next time</div>
                <p className="text-sm leading-relaxed text-foreground">{result.coaching.next_time_tweak}</p>
              </div>

              <div>
                <div className="text-xs font-medium text-muted-foreground">Why</div>
                <p className="text-sm leading-relaxed text-muted-foreground">{result.coaching.reason}</p>
              </div>
            </div>
          </Card>
        )}

        <Card className="p-6">
          <h2 className="mb-2 text-sm font-medium text-foreground">Meal</h2>
          <p className="text-sm leading-relaxed text-foreground">{result.mealDescription}</p>
        </Card>

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
