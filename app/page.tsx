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

// Keep this here so you’re not dependent on component exports
export type MealType = "breakfast" | "lunch" | "dinner"

export type MealResult = {
  protein: number
  confidence: "low" | "medium" | "high"
  explanation: string
  mealDescription: string
  mealType?: MealType
  photoPath?: string
  photoUrl?: string
}

export default function Page() {
  // TEMP DEBUG — REMOVE AFTER SESSION ISSUE IS CONFIRMED
  // Shows which session_id this device is using (important for mobile debugging)
  const sessionId = getOrCreateSessionId()
  // TEMP DEBUG — REMOVE AFTER CONFIRMED
  const todayMel = getTodayDateString(APP_TIMEZONE)
  const nowMel = new Date().toLocaleString("en-AU", { timeZone: APP_TIMEZONE })
  const nowUtc = new Date().toISOString()

  const [currentScreen, setCurrentScreen] = useState<Screen>("home")
  const [dailyProtein, setDailyProtein] = useState<number>(0)
  const [mealResult, setMealResult] = useState<MealResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const dailyGoal = 120

  const isFileLike = (x: unknown): x is File => {
    // Mobile Safari / some Android webviews can be weird with instanceof File
    // This checks shape instead.
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

      console.log("handleLogMeal args:", {
        mealType,
        hasPhoto: !!photo,
        photoName: (photo as any)?.name,
        photoType: (photo as any)?.type,
        photoSize: (photo as any)?.size,
        mealTextLen: mealText?.length ?? 0,
        date,
        timezone: APP_TIMEZONE,
        sessionId,
      })

      if (!photo) {
        throw new Error("Please add a photo (image is required for image-first analysis).")
      }

      const uploaded = await uploadMealPhoto(photo)

      const { data, error } = await supabase.functions.invoke("analyze_meal_protein_and_update_day", {
        body: {
          session_id: sessionId,
          date, // Melbourne-safe, canonical
          meal_text: mealText || "",
          meal_type: mealType,
          photo_path: uploaded.path,
        },
      })

      console.log("FUNCTION RESULT", { data, error })

      if (error) throw error
      if (!data?.success) throw new Error(data?.error ?? "Function returned success=false")

      setMealResult({
        protein: Number(data.estimate?.protein_grams ?? 0),
        confidence: (data.estimate?.confidence ?? "medium") as "low" | "medium" | "high",
        explanation: String(data.estimate?.notes ?? ""),
        mealDescription: mealText || "(no description)",
        mealType,
        photoPath: uploaded.path,
        photoUrl: uploaded.publicUrl,
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
                {/* TEMP DEBUG — REMOVE AFTER CONFIRMED */}
        <div className="p-2 text-xs text-muted-foreground break-all space-y-1">
          <div>session_id: {sessionId}</div>
          <div>todayMel (YYYY-MM-DD): {todayMel}</div>
          <div>nowMel: {nowMel}</div>
          <div>nowUtc: {nowUtc}</div>
        </div>


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

              // Pattern A: onSubmit(mealText, photo)
              if (isFileLike(arg2)) {
                return handleLogMeal(mealText, defaultType, arg2)
              }

              // Pattern B: onSubmit(mealText, mealType, photo)
              if (typeof arg2 === "string") {
                const mt = (arg2 as MealType) || defaultType
                const file = isFileLike(arg3) ? (arg3 as File) : undefined
                return handleLogMeal(mealText, mt, file)
              }

              // No photo passed
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
