"use client"

import type React from "react"
import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card } from "@/components/ui/card"
import { Camera, ArrowLeft, Upload } from "lucide-react"

interface LogMealScreenProps {
  onSubmit: (meal: string, photo?: File) => void
  onBack: () => void
}

export function LogMealScreen({ onSubmit, onBack }: LogMealScreenProps) {
  const [mealDescription, setMealDescription] = useState("")
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)

  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)

  const setFile = (file?: File) => {
    if (!file) return
    setPhoto(file)

    const reader = new FileReader()
    reader.onloadend = () => setPhotoPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const handleCameraChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    setFile(file)
    e.target.value = ""
  }

  const handleGalleryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    setFile(file)
    e.target.value = ""
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (mealDescription.trim() || photo) {
      onSubmit(mealDescription, photo || undefined)
    }
  }

  return (
    <div className="flex min-h-screen flex-col p-6">
      <header className="mb-8 flex items-center gap-4 pt-8">
        <button
          onClick={onBack}
          className="rounded-full p-2 hover:bg-muted/50 transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft className="h-5 w-5 text-foreground" />
        </button>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Log Meal</h1>
          <p className="text-sm text-muted-foreground">Take a photo or upload from your library</p>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-6">
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-6">
          <Card className="p-6">
            <label className="mb-4 block text-sm font-medium text-foreground">Photo</label>

            {/* Camera-only input */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleCameraChange}
              className="hidden"
            />

            {/* Gallery picker input */}
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              onChange={handleGalleryChange}
              className="hidden"
            />

            {photoPreview ? (
              <div className="space-y-4">
                <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
                  <img
                    src={photoPreview}
                    alt="Meal preview"
                    className="h-full w-full object-cover"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPhoto(null)
                    setPhotoPreview(null)
                  }}
                  className="w-full"
                >
                  Remove photo
                </Button>
              </div>
            ) : (
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex-1"
                >
                  <Camera className="mr-2 h-4 w-4" />
                  Take photo
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => galleryInputRef.current?.click()}
                  className="flex-1"
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Upload
                </Button>
              </div>
            )}
          </Card>

          <Card className="p-6">
            <label htmlFor="meal-description" className="mb-2 block text-sm font-medium text-foreground">
              Meal description (optional)
            </label>
            <Textarea
              id="meal-description"
              placeholder="e.g., 2 eggs and toast"
              value={mealDescription}
              onChange={(e) => setMealDescription(e.target.value)}
              className="min-h-32 resize-none"
            />
          </Card>

          <Button type="submit" size="lg" disabled={!mealDescription.trim() && !photo} className="mt-auto">
            Analyze protein
          </Button>
        </form>
      </main>
    </div>
  )
}


