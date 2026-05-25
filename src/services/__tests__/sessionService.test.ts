// ============================================================================
// sessionService.test.ts — Pure unit tests for the attendance/refund helpers
//
// These are the *decision* functions behind the new "cancelled - no charge"
// refund logic. They're pure (no DB), so they're cheap to test exhaustively
// and they document the business rule:
//
//   "cancelled - no charge" is the only attendance value that does NOT
//   consume a session on the user's subscription. Transitioning into it
//   refunds (+1), transitioning out of it re-deducts (-1).
//
// The DB-touching part of the service (createSession, updateSession) is
// integration-test territory and isn't covered here.
// ============================================================================

import { describe, it, expect } from "vitest"
import { isCountedAttendance, attendanceRefundDelta } from "../sessionService"
import type { Attendance } from "../../lib/types"

// ── isCountedAttendance ────────────────────────────────────────────────────
// Every attendance value that should consume a session = "counted".

describe("isCountedAttendance", () => {
  it.each<Attendance>(["attended", "booked", "cancelled"])(
    "treats %s as counted (consumes a session)",
    (status) => {
      expect(isCountedAttendance(status)).toBe(true)
    },
  )

  it("treats 'cancelled - no charge' as NOT counted (refund applies)", () => {
    expect(isCountedAttendance("cancelled - no charge")).toBe(false)
  })
})

// ── attendanceRefundDelta ──────────────────────────────────────────────────
// The transition table is the single source of truth for refund vs. deduct.

describe("attendanceRefundDelta", () => {
  // No-op transitions (same status or counted ↔ counted)
  it("returns 0 when prev and next match", () => {
    expect(attendanceRefundDelta("booked", "booked")).toBe(0)
    expect(attendanceRefundDelta("cancelled - no charge", "cancelled - no charge")).toBe(0)
  })

  it.each<[Attendance, Attendance]>([
    ["booked", "attended"],
    ["booked", "cancelled"],
    ["attended", "cancelled"],
    ["cancelled", "attended"],
  ])("returns 0 for counted→counted transition %s → %s", (prev, next) => {
    expect(attendanceRefundDelta(prev, next)).toBe(0)
  })

  // Refund cases — going from counted to no-charge gives a session back
  it.each<Attendance>(["attended", "booked", "cancelled"])(
    "returns +1 (refund) when transitioning %s → cancelled - no charge",
    (prev) => {
      expect(attendanceRefundDelta(prev, "cancelled - no charge")).toBe(1)
    },
  )

  // Re-deduct cases — reversing a refund takes the session back
  it.each<Attendance>(["attended", "booked", "cancelled"])(
    "returns -1 (re-deduct) when transitioning cancelled - no charge → %s",
    (next) => {
      expect(attendanceRefundDelta("cancelled - no charge", next)).toBe(-1)
    },
  )
})
