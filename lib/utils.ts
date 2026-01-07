import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

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
