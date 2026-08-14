// ── Time / Calendar utilities ────────────────────────────────────────────────
// Centralised so every consumer agrees on what "this week" means.
// All week-scoped logic anchors on Asia/Beirut Monday 00:00.

const STUDIO_TZ = "Asia/Beirut"

// Map English short weekday → days since Monday. Intl.DateTimeFormat is the
// only TZ-aware date helper in stdlib, so we use it to extract the weekday in
// Beirut local time.
const DAYS_FROM_MONDAY: Record<string, number> = {
  Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
}

/**
 * Returns the Monday of the week (Asia/Beirut) containing `date`, formatted
 * YYYY-MM-DD. Defaults to "right now."
 *
 * Implementation note: we extract the Beirut-local Y/M/D + weekday via Intl,
 * then subtract the offset using UTC arithmetic on a date-only value. Because
 * the output is date-only (no time component), the arithmetic timezone doesn't
 * matter — we just need correct day math.
 */
export const getBeirutWeekStart = (date: Date = new Date()): string => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: STUDIO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date)

  const y = parts.find(p => p.type === "year")!.value
  const m = parts.find(p => p.type === "month")!.value
  const d = parts.find(p => p.type === "day")!.value
  const weekday = parts.find(p => p.type === "weekday")!.value

  const offset = DAYS_FROM_MONDAY[weekday]
  // Build a UTC date at midnight then subtract `offset` days to land on Monday.
  const local = new Date(`${y}-${m}-${d}T00:00:00Z`)
  local.setUTCDate(local.getUTCDate() - offset)

  return local.toISOString().slice(0, 10) // YYYY-MM-DD
}

/**
 * Validates an input YYYY-MM-DD string is actually a Monday. Mirrors the
 * Postgres CHECK constraint so the API can reject bad input with a 400 before
 * the DB ever sees it.
 */
export const isMonday = (yyyyMmDd: string): boolean => {
  // Treat the date string as UTC — getUTCDay returns 0=Sun..6=Sat, so Monday=1.
  const dt = new Date(`${yyyyMmDd}T00:00:00Z`)
  return !isNaN(dt.getTime()) && dt.getUTCDay() === 1
}

/**
 * Today's date in Asia/Beirut, formatted YYYY-MM-DD. Used to compare against
 * class_date for "is this booking in the past?" checks. String comparison
 * works because both sides are zero-padded ISO date strings.
 */
export const getBeirutToday = (): string => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: STUDIO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())
  const y = parts.find(p => p.type === "year")!.value
  const m = parts.find(p => p.type === "month")!.value
  const d = parts.find(p => p.type === "day")!.value
  return `${y}-${m}-${d}`
}

/**
 * The calendar date a recurring slot lands on in a given week — the inverse of
 * getBeirutDayOfWeek. `weekStart` is the Beirut Monday, `dayOfWeek` is the
 * project convention (0 = Monday … 6 = Sunday), so the date is a plain offset.
 *
 * Mirrors the `week_start + day_of_week` arithmetic in scheduleService's
 * getSlotsForWeek query — keep the two in step. Pure UTC math on a date-only
 * value, so no DST/timezone drift is possible.
 */
export const classDateForWeek = (weekStart: string, dayOfWeek: number): string => {
  const d = new Date(`${weekStart}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dayOfWeek)
  return d.toISOString().slice(0, 10)
}

/**
 * Day-of-week for a YYYY-MM-DD date as interpreted in Beirut, mapped to the
 * project's convention (0 = Monday, 6 = Sunday — matches schedule.day_of_week).
 * Used to validate that a session's class_date actually lands on the day-of-week
 * the slot is configured for.
 */
export const getBeirutDayOfWeek = (yyyyMmDd: string): number => {
  const dt = new Date(`${yyyyMmDd}T00:00:00Z`)
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: STUDIO_TZ,
    weekday: "short",
  }).formatToParts(dt)
  const weekday = parts.find(p => p.type === "weekday")!.value
  return DAYS_FROM_MONDAY[weekday]
}
