import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/* ----------------------------------------
   Styling utility
---------------------------------------- */

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/* ----------------------------------------
   Session ID utility
---------------------------------------- */

const SESSION_ID_KEY = "protein_session_id"

/**
 * Always returns a valid string session id.
 * Never returns null.
 */
export function getOrCreateSessionId(): string {
  // Safety: if this somehow runs on the server
  if (typeof window === "undefined") {
    return "server-session"
  }

  try {
    const existing = window.localStorage.getItem(SESSION_ID_KEY)
    if (existing && existing.length > 0) {
      return existing
    }

    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `sess_${Math.random().toString(16).slice(2)}_${Date.now()}`

    window.localStorage.setItem(SESSION_ID_KEY, id)
    return id
  } catch {
    // Fallback if localStorage is blocked
    return `sess_${Math.random().toString(16).slice(2)}_${Date.now()}`
  }
}

/* ----------------------------------------
   Timezone utilities
---------------------------------------- */

// Canonical app timezone (v1)
export const APP_TIMEZONE = "Australia/Melbourne"

/**
 * Returns the start of "today" in the given timezone,
 * expressed as a UTC ISO string for safe Supabase queries.
 */
export function getStartOfToday(
  timezone: string = APP_TIMEZONE
): string {
  const now = new Date()

  // Convert current time to the target timezone
  const localNow = new Date(
    now.toLocaleString("en-US", { timeZone: timezone })
  )

  // Snap to midnight in that timezone
  localNow.setHours(0, 0, 0, 0)

  // Return UTC ISO string
  return localNow.toISOString()
}

/**
 * Formats a timestamp for display in the given timezone.
 */
export function formatInTimeZone(
  date: string | Date,
  timezone: string = APP_TIMEZONE,
  options: Intl.DateTimeFormatOptions = {}
): string {
  return new Date(date).toLocaleString("en-AU", {
    timeZone: timezone,
    ...options,
  })
}
