"use client"
/**
 * NOTE:
 * This screen uses date-string based "day" logic (daily_totals.date).
 * Do NOT use getStartOfToday() or created_at filters here.
 * Always use getTodayDateString() for "today".
 */

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { HomeScreen } from "@/components/home-screen"
import { LogMealScreen } from "@/components/log-meal-screen"
import { ResultsScreen } from "@/components/results-screen"
import { getOrCreateSessionId, getTodayDateString, APP_TIMEZONE } from "@/lib/utils"

export type Screen = "home" | "log" | "results"
export type MealType = "breakfast" | "lunch" | "dinner" | "snack"

export type WatchoutId =
  | "high_fat_extras"
  | "large_refined_carbs"
  | "fried"
  | "processed_meat"
  | "high_added_sugar"

export type Watchout = {
  id: WatchoutId
  label: string
  reason: string
}

export type MealResult = {
  protein: number
  confidence: "low" | "medium" | "high"
  explanation: string
  mealDescription: string
  mealType: MealType
  photoPath?: string
  photoUrl?: string
  coaching?: Coaching
  watchouts?: Watchout[]
}

export type CoachingFocus = "protein" | "balance" | "snack" | "portion" | "reinforce"

export type CoachingScenario =
  | "UNKNOWN_MEAL"
  | "LOW_PROTEIN_BREAKFAST"
  | "LOW_PROTEIN_LUNCH"
  | "LOW_PROTEIN_DINNER"
  | "LOW_PROTEIN_SNACK"
  | "MEDIUM_PROTEIN"
  | "HIGH_PROTEIN"
  | "GOOD_START"

export type Coaching = {
  scenario_id: CoachingScenario
  focus: CoachingFocus
  five_min_fix: string
  next_time_tweak: string
  reason: string
}

const WATCHOUT_LABELS: Record<WatchoutId, string> = {
  high_fat_extras: "High-fat extras",
  large_refined_carbs: "Large refined carbs",
  fried: "Fried or crumbed",
  processed_meat: "Processed meat",
  high_added_sugar: "High added sugar",
}

function normaliseText(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim()
}

function hasAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word))
}

function addWatchout(output: Watchout[], id: WatchoutId, reason: string) {
  if (output.some((w) => w.id === id)) return
  if (output.length >= 2) return

  output.push({
    id,
    label: WATCHOUT_LABELS[id],
    reason,
  })
}

function deriveWatchoutsFromText(textInput: string): Watchout[] {
  const text = normaliseText(textInput)
  const output: Watchout[] = []

  const isSushi = hasAny(text, ["sushi", "nigiri"])
  const isWholegrain = hasAny(text, ["wholegrain", "whole grain", "seeded", "whole wheat", "wholemeal"])
  const isBalancedRiceMeal =
    hasAny(text, ["chicken"]) &&
    hasAny(text, ["vegetables", "broccoli", "carrots", "bell pepper", "capsicum"]) &&
    hasAny(text, ["rice"]) &&
    !hasAny(text, ["naan", "pizza", "pasta", "noodles", "chips", "fries"])

  if (hasAny(text, ["chocolate cereal", "chocolate puffed cereal", "sugary cereal"])) {
    addWatchout(
      output,
      "high_added_sugar",
      "Chocolate or sugary cereal can be easy to overdo while still being low in protein."
    )
  }

  if (hasAny(text, ["pepperoni", "salami", "sausage", "sausages", "bacon", "deli ham", "deli-style ham"]) || hasAny(text, [" ham "])) {
    addWatchout(
      output,
      "processed_meat",
      "Processed meats like ham, sausage, salami or pepperoni can quietly add up."
    )
  }

  if (hasAny(text, ["battered", "crumbed", "deep fried", "fried fish", "fried chicken", "schnitzel"])) {
    addWatchout(
      output,
      "fried",
      "Battered, crumbed or fried foods can add extra heaviness around the protein."
    )
  }

  const hasRefinedCarb =
    !isSushi &&
    !isWholegrain &&
    !isBalancedRiceMeal &&
    hasAny(text, [
      "white toast",
      "white bread",
      "toasted white bread",
      "white flour wrap",
      "white wrap",
      "flour tortilla",
      "white flour tortilla",
      "pizza",
      "pizza base",
      "pizza crust",
      "pasta",
      "spaghetti",
      "penne",
      "instant noodles",
      "cup noodles",
      "chips",
      "fries",
      "naan",
    ])

  if (hasRefinedCarb) {
    addWatchout(
      output,
      "large_refined_carbs",
      hasAny(text, ["pizza"])
        ? "Pizza base is the dominant refined carbohydrate."
        : hasAny(text, ["pasta", "spaghetti", "penne"])
          ? "Pasta is the main refined carbohydrate in this meal."
          : hasAny(text, ["instant noodles", "cup noodles"])
            ? "Instant noodles are the main refined carbohydrate in this meal."
            : hasAny(text, ["chips", "fries"])
              ? "Chips or fries are the main refined carbohydrate here."
              : hasAny(text, ["naan"])
                ? "Naan can make the refined carbs stack up quickly."
                : "White bread or wraps are the main refined carbohydrate here."
    )
  }

  if (
    hasAny(text, [
      "creamy pasta",
      "creamy sauce",
      "cream sauce",
      "cream",
      "butter",
      "margarine",
      "peanut butter",
      "nut butter",
      "cheese pizza",
      "melted cheese",
      "aioli",
      "mayo",
      "mayonnaise",
    ])
  ) {
    addWatchout(
      output,
      "high_fat_extras",
      hasAny(text, ["creamy pasta", "creamy sauce", "cream sauce"])
        ? "Creamy sauce is a major part of this meal."
        : hasAny(text, ["peanut butter", "nut butter"])
          ? "Nut butter is useful, but it is more energy-dense than protein-dense."
          : hasAny(text, ["butter", "margarine"])
            ? "Butter or margarine can quietly add up on toast."
            : "Cheese, creamy sauces or rich extras can quietly add up."
    )
  }

  return output.slice(0, 2)
}

function mergeWatchouts(primary: Watchout[], secondary: Watchout[]) {
  const output: Watchout[] = []

  for (const item of [...primary, ...secondary]) {
    if (!item?.id) continue
    if (output.some((w) => w.id === item.id)) continue
    output.push(item)
    if (output.length >= 2) break
  }

  return output
}

export default function Page() {
  const sessionId = getOrCreateSessionId()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const todayMel = getTodayDateString(APP_TIMEZONE)
  const nowMel = new Date().toLocaleString("en-AU", { timeZone: APP_TIMEZONE })
  const nowUtc = new Date().toISOString()

  const [currentScreen, setCurrentScreen] = useState<Screen>("home")
  const [dailyProtein, setDailyProtein] = useState<number>(0)
  const [mealResult, setMealResult] = useState<MealResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const dailyGoal = 120

  const isFileLike = (x: unknown): x is File => {
    if (!x || typeof x !== "object") return false
    const anyX = x as any
    return (
      typeof anyX.name === "string" &&
      typeof anyX.type === "string" &&
      typeof anyX.size === "number" &&
      typeof anyX.arrayBuffer === "function"
    )
  }

  const loadTodayProtein = async () => {
    const today = getTodayDateString(APP_TIMEZONE)

    const { data, error } = await supabase
      .from("daily_totals")
      .select("protein_total")
      .eq("session_id", sessionId)
      .eq("date", today)
      .maybeSingle()

    if (error) {
      console.error("Error loading daily total:", error)
      return
    }

    setDailyProtein(Number(data?.protein_total ?? 0))
  }

  useEffect(() => {
    loadTodayProtein()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const uploadMealPhoto = async (file: File) => {
    const filename = file.name?.trim() ? file.name.trim() : "photo.jpg"
    const ext = filename.includes(".")
      ? (filename.split(".").pop() || "jpg").toLowerCase()
      : "jpg"

    const path = `${sessionId}/${crypto.randomUUID()}.${ext}`

    const { error } = await supabase.storage.from("meal_photos").upload(path, file, {
      contentType: file.type || "image/jpeg",
      upsert: false,
    })

    if (error) throw error

    const { data: pub } = supabase.storage.from("meal_photos").getPublicUrl(path)
    return { path, publicUrl: pub.publicUrl }
  }

  const handleLogMeal = async (mealText: string, mealType: MealType, photo?: File) => {
    setCurrentScreen("results")
    setIsLoading(true)
    setMealResult(null)

    try {
      const date = getTodayDateString(APP_TIMEZONE)

      if (!photo) {
        throw new Error("Please add a photo (image is required for image-first analysis).")
      }

      const uploaded = await uploadMealPhoto(photo)

      const { data, error } = await supabase.functions.invoke(
        "analyze_meal_protein_and_update_day_v2",
        {
          body: {
            session_id: sessionId,
            date,
            meal_text: mealText || "",
            meal_type: mealType,
            photo_path: uploaded.path,
          },
        }
      )

      console.log("FUNCTION RESULT", { data, error })

      if (error) throw error
      if (!data?.success) throw new Error(data?.error ?? "Function returned success=false")

      const explanation = String(data.estimate?.notes ?? "")
      const serverWatchouts = Array.isArray(data.watchouts)
        ? data.watchouts
        : Array.isArray(data.estimate?.watchouts)
          ? data.estimate.watchouts
          : []

      const derivedWatchouts = deriveWatchoutsFromText(
        `${explanation} ${data.meal_summary ?? ""} ${mealText ?? ""}`
      )

      setMealResult({
        protein: Number(data.estimate?.protein_grams ?? 0),
        confidence: (data.estimate?.confidence ?? "medium") as "low" | "medium" | "high",
        explanation,
        mealDescription: mealText || "(no description)",
        mealType,
        photoPath: uploaded.path,
        photoUrl: uploaded.publicUrl,
        coaching: data.coaching ?? undefined,
        watchouts: mergeWatchouts(derivedWatchouts, serverWatchouts),
      })

      setDailyProtein(Number(data.daily?.protein_total ?? dailyProtein))
    } catch (e: any) {
      console.error("handleLogMeal failed:", e)
      setMealResult({
        protein: 0,
        confidence: "low",
        explanation: `Failed: ${String(e?.message ?? e)}`,
        mealDescription: mealText || "(no description)",
        mealType,
        watchouts: [],
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleAddToday = async () => {
    setMealResult(null)
    setCurrentScreen("home")
  }

  const handleEditMeal = () => setCurrentScreen("log")

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-md">
        {mounted && (
          <div className="p-2 text-xs text-muted-foreground break-all space-y-1">
            <div>session_id: {sessionId}</div>
            <div>todayMel (YYYY-MM-DD): {todayMel}</div>
            <div>nowMel: {nowMel}</div>
            <div>nowUtc: {nowUtc}</div>
          </div>
        )}

        {currentScreen === "home" && (
          <HomeScreen
            currentProtein={dailyProtein}
            goalProtein={dailyGoal}
            onLogMeal={() => setCurrentScreen("log")}
          />
        )}

        {currentScreen === "log" && (
          <LogMealScreen
            onSubmit={(mealText: string, arg2?: any, arg3?: any) => {
              const defaultType: MealType = "dinner"

              if (isFileLike(arg2)) {
                return handleLogMeal(mealText, defaultType, arg2)
              }

              if (typeof arg2 === "string") {
                const mt = (arg2 as MealType) || defaultType
                const file = isFileLike(arg3) ? (arg3 as File) : undefined
                return handleLogMeal(mealText, mt, file)
              }

              return handleLogMeal(mealText, defaultType, undefined)
            }}
            onBack={() => setCurrentScreen("home")}
          />
        )}

        {currentScreen === "results" && (
          <div className="space-y-4 p-4">
            {mealResult?.photoUrl && (
              <img src={mealResult.photoUrl} alt="Uploaded meal" className="w-full rounded-lg" />
            )}

            <ResultsScreen
              result={mealResult}
              dailyGoal={dailyGoal}
              onAddToday={handleAddToday}
              onEditMeal={handleEditMeal}
              isLoading={isLoading}
            />
          </div>
        )}
      </div>
    </div>
  )
}