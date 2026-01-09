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
 * Canonical "today" for the app, in APP_TIMEZONE, as YYYY-MM-DD.
 *
 * IMPORTANT:
 * Do NOT use new Date().toISOString().slice(0, 10) for "today" — that is UTC
 * and will be "yesterday" in the morning in Melbourne.
 *
 * This implementation uses Intl.formatToParts which is reliable on mobile.
 */
export function getTodayDateString(timezone: string = APP_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())

  const y = parts.find((p) => p.type === "year")?.value
  const m = parts.find((p) => p.type === "month")?.value
  const d = parts.find((p) => p.type === "day")?.value

  if (!y || !m || !d) throw new Error("Failed to compute local YYYY-MM-DD date string")

  return `${y}-${m}-${d}`
}

/**
 * Start of "today" in the given timezone, expressed as a UTC ISO string.
 *
 * Use this for created_at filtering flows (future), NOT for date-string flows.
 *
 * NOTE:
 * This uses the canonical YYYY-MM-DD and computes the UTC instant that corresponds
 * to midnight in the target timezone.
 */
export function getStartOfToday(timezone: string = APP_TIMEZONE): string {
  const ymd = getTodayDateString(timezone) // YYYY-MM-DD in target tz
  // Construct a timestamp that represents midnight *in that timezone* by using
  // an Intl formatter to derive the offset indirectly.
  //
  // Practical approach:
  // - take "now" in that timezone
  // - replace its date parts with ymd at 00:00:00
  // - then return ISO (UTC)
  const [y, m, d] = ymd.split("-").map((v) => Number(v))

  // Build a Date for "midnight" in the target timezone by formatting parts.
  // We do this by:
  // 1) starting from UTC midnight
  // 2) then shifting until its formatted parts match the target date at 00:00
  //
  // This avoids unreliable parsing of locale strings.
  let candidate = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0))

  const fmt = new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })

  const partsToObj = (dt: Date) => {
    const p = fmt.formatToParts(dt)
    const get = (t: string) => p.find((x) => x.type === t)?.value
    return {
      year: get("year"),
      month: get("month"),
      day: get("day"),
      hour: get("hour"),
      minute: get("minute"),
      second: get("second"),
    }
  }

  // Adjust candidate within a safe window (±36h) to find the UTC instant
  // that formats to 00:00:00 on the target date in the target timezone.
  for (let i = 0; i < 72; i++) {
    const o = partsToObj(candidate)
    if (
      o.year === String(y) &&
      o.month === String(m).padStart(2, "0") &&
      o.day === String(d).padStart(2, "0") &&
      o.hour === "00" &&
      o.minute === "00" &&
      o.second === "00"
    ) {
      return candidate.toISOString()
    }
    // move forward 30 minutes
    candidate = new Date(candidate.getTime() + 30 * 60 * 1000)
  }

  // Fallback: return UTC midnight if we didn't match (should be rare)
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0)).toISOString()
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
