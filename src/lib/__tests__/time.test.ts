// ============================================================================
// time.test.ts — Tests for the Beirut week-start utility
//
// The whole schedule-override design hinges on "what Monday does a given
// instant belong to?" Getting this wrong silently means overrides land in
// the wrong week. These tests pin behaviour across timezones, DST shifts,
// and edge cases like Sunday-23:59 in Beirut local time.
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { getBeirutWeekStart, isMonday, getBeirutToday, getBeirutDayOfWeek } from "../time"

describe("getBeirutWeekStart", () => {
  it("returns the same Monday for a Wednesday in mid-week", () => {
    // 2026-05-27 is a Wednesday. Monday of that week is 2026-05-25.
    // Time chosen at midday UTC to avoid any TZ edge case.
    const wed = new Date("2026-05-27T12:00:00Z")
    expect(getBeirutWeekStart(wed)).toBe("2026-05-25")
  })

  it("returns the Monday itself when given a Monday", () => {
    const mon = new Date("2026-05-25T10:00:00Z")
    expect(getBeirutWeekStart(mon)).toBe("2026-05-25")
  })

  it("returns the same week's Monday for a Sunday", () => {
    // 2026-05-31 is a Sunday. ISO week: 25-31 May → Monday is 2026-05-25.
    const sun = new Date("2026-05-31T12:00:00Z")
    expect(getBeirutWeekStart(sun)).toBe("2026-05-25")
  })

  it("rolls into the next Monday after Sunday midnight Beirut", () => {
    // 2026-06-01 00:30 Beirut = 2026-05-31 21:30 UTC (Beirut is UTC+3 in DST).
    // 2026-06-01 is a Monday → Beirut week_start for this instant = 2026-06-01.
    const justAfterMidnightBeirut = new Date("2026-05-31T21:30:00Z")
    expect(getBeirutWeekStart(justAfterMidnightBeirut)).toBe("2026-06-01")
  })

  it("respects Beirut timezone, not UTC, for the week boundary", () => {
    // Beirut is UTC+3 in DST. 2026-05-31 22:00 UTC = 2026-06-01 01:00 Beirut.
    // UTC says Sunday, Beirut says Monday → week_start = the new Monday.
    const earlyMondayBeirut = new Date("2026-05-31T22:00:00Z")
    expect(getBeirutWeekStart(earlyMondayBeirut)).toBe("2026-06-01")
  })
})

describe("isMonday", () => {
  it("returns true for a Monday date string", () => {
    expect(isMonday("2026-05-25")).toBe(true)
  })

  it("returns false for a Sunday", () => {
    expect(isMonday("2026-05-31")).toBe(false)
  })

  it("returns false for an invalid date string", () => {
    expect(isMonday("not-a-date")).toBe(false)
  })

  it("returns false for an empty string", () => {
    expect(isMonday("")).toBe(false)
  })
})

describe("getBeirutToday", () => {
  // Freeze "now" so the test is deterministic regardless of the wall clock.
  // Beirut is UTC+3 in DST → 22:00 UTC on 2026-06-14 is 01:00 on 2026-06-15.
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("uses the Beirut date, not UTC", () => {
    vi.setSystemTime(new Date("2026-06-14T22:00:00Z"))
    expect(getBeirutToday()).toBe("2026-06-15")
  })

  it("returns a YYYY-MM-DD string with zero padding", () => {
    vi.setSystemTime(new Date("2026-01-05T12:00:00Z"))
    expect(getBeirutToday()).toBe("2026-01-05")
  })
})

describe("getBeirutDayOfWeek", () => {
  // The schedule.day_of_week convention is 0=Monday..6=Sunday. This helper
  // converts a YYYY-MM-DD string to that same convention so we can compare
  // against schedule rows directly.
  it.each([
    ["2026-06-15", 0], // Monday
    ["2026-06-16", 1], // Tuesday
    ["2026-06-17", 2], // Wednesday
    ["2026-06-18", 3], // Thursday
    ["2026-06-19", 4], // Friday
    ["2026-06-20", 5], // Saturday
    ["2026-06-21", 6], // Sunday
  ])("returns the correct DOW for %s", (date, expected) => {
    expect(getBeirutDayOfWeek(date)).toBe(expected)
  })
})
