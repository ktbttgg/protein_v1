"use client"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

interface HomeScreenProps {
  currentProtein: number
  goalProtein: number
  onLogMeal: () => void
}

export function HomeScreen({ currentProtein, goalProtein, onLogMeal }: HomeScreenProps) {
  const percentage = (currentProtein / goalProtein) * 100

  return (
    <div className="flex min-h-screen flex-col p-6">
      <header className="mb-8 pt-8">
        <h1 className="text-2xl font-semibold text-foreground">Today</h1>
        <p className="text-sm text-muted-foreground">Track your daily protein intake</p>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-8">
        <Card className="w-full p-8">
          <div className="flex flex-col items-center gap-6">
            {/* Progress Ring */}
            <div className="relative h-48 w-48">
              <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 100 100">
                {/* Background circle */}
                <circle
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="8"
                  className="text-muted/30"
                />
                {/* Progress circle */}
                <circle
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="8"
                  strokeDasharray={`${percentage * 2.513}, 251.3`}
                  strokeLinecap="round"
                  className="text-primary transition-all duration-500"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-4xl font-bold text-foreground">{currentProtein}g</span>
                <span className="text-sm text-muted-foreground">of {goalProtein}g</span>
              </div>
            </div>

            <div className="w-full space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Daily Goal</span>
                <span className="font-medium text-foreground">{Math.round(percentage)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted/30">
                <div
                  className="h-full bg-primary transition-all duration-500"
                  style={{ width: `${Math.min(percentage, 100)}%` }}
                />
              </div>
            </div>
          </div>
        </Card>

        <Button size="lg" className="w-full max-w-xs" onClick={onLogMeal}>
          Log a meal
        </Button>
      </main>
    </div>
  )
}
