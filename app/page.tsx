"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { HomeScreen } from "@/components/home-screen"
import { LogMealScreen, type MealType } from "@/components/log-meal-screen"
import { ResultsScreen } from "@/components/results-screen"
import { getOrCreateSessionId } from "@/lib/utils"

export type Screen = "home" | "log" | "results"

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
  const [currentScreen, setCurrentScreen] = useState<Screen>("home")
  const [dailyProtein, setDailyProtein] = useState<number>(0)
  const [mealResult, setMealResult] = useState<MealResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const dailyGoal = 120

  const getTodayDateString = () => new Date().toISOString().slice(0, 10)

  const loadTodayProtein = async () => {
    const sessionId = getOrCreateSessionId()
    const today = getTodayDateString()

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

    const total = data?.protein_total ?? 0
    setDailyProtein(Number(total))
  }

  useEffect(() => {
    loadTodayProtein()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const uploadMealPhoto = async (file: File) => {
    if (!file) throw new Error("No file provided")

    const sessionId = getOrCreateSessionId()

    const filename = (file.name && file.name.trim()) ? file.name.trim() : "photo.jpg"
    const ext = filename.includes(".") ? (filename.split(".").pop() || "jpg").toLowerCase() : "jpg"
    const path = `${sessionId}/${crypto.randomUUID()}.${ext}`

    const { data, error } = await supabase.storage
      .from("meal_photos")
      .upload(path, file, {
        contentType: file.type || "image/jpeg",
        upsert: false,
      })

    if (error) throw error

    // For UI preview only (this may not be publicly viewable; that’s OK)
    const { data: pub } = supabase.storage.from("meal_photos").getPublicUrl(path)

    return { path, publicUrl: pub.publicUrl, uploadData: data }
  }

  const handleLogMeal = async (mealText: string, mealType: MealType, photo?: File) => {
    setCurrentScreen("results")
    setIsLoading(true)
    setMealResult(null)

    try {
      const sessionId = getOrCreateSessionId()
      const date = getTodayDateString()

      if (!photo) {
        throw new Error("Please add a photo (image is required for image-first analysis).")
      }

      const uploaded = await uploadMealPhoto(photo)

      const { data, error } = await supabase.functions.invoke(
        "analyze_meal_protein_and_update_day",
        {
          body: {
            session_id: sessionId,
            date,
            meal_text: mealText || "",
            meal_type: mealType,
            photo_path: uploaded.path, // IMPORTANT: send path, not URL
          },
        }
      )

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
    // DB is already updated by the function
    setMealResult(null)
    setCurrentScreen("home")
  }

  const handleEditMeal = () => setCurrentScreen("log")

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-md">
        {currentScreen === "home" && (
          <HomeScreen
            currentProtein={dailyProtein}
            goalProtein={dailyGoal}
            onLogMeal={() => setCurrentScreen("log")}
          />
        )}

        {currentScreen === "log" && (
          <LogMealScreen
            onSubmit={handleLogMeal}
            onBack={() => setCurrentScreen("home")}
          />
        )}

        {currentScreen === "results" && (
          <div className="p-4 space-y-4">
            {mealResult?.photoUrl && (
              <img
                src={mealResult.photoUrl}
                alt="Uploaded meal"
                className="w-full rounded-lg"
              />
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
