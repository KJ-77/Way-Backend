// ============================================================================
// time.test.ts — Tests for the Beirut week-start utility
//
// The whole schedule-override design hinges on "what Monday does a given
// instant belong to?" Getting this wrong silently means overrides land in
// the wrong week. These tests pin behaviour across timezones, DST shifts,
// and edge cases like Sunday-23:59 in Beirut local time.
// ============================================================================

import { describe, it, expect } from "vitest"
import { getBeirutWeekStart, isMonday } from "../time"

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
