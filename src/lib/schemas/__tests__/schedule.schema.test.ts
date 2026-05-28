// ============================================================================
// schedule.schema.test.ts — Zod validation tests for the schedule API
//
// WHAT'S TESTED:
//   - CreateScheduleSlotSchema, UpdateScheduleSlotSchema (the recurring template)
//   - UpsertScheduleOverrideSchema (per-week exceptions)
//   - WeekStartSchema (the ?week=YYYY-MM-DD query param shape)
//
// These run pre-DB — they don't catch business rules like "must be a Monday"
// (that's a handler-level isMonday check + a DB CHECK constraint). They only
// catch shape/format errors that should fail fast with a 400.
// ============================================================================

import { describe, it, expect } from "vitest"
import {
  CreateScheduleSlotSchema,
  UpdateScheduleSlotSchema,
  UpsertScheduleOverrideSchema,
  WeekStartSchema,
} from "../schedule.schema"

// ── CreateScheduleSlotSchema ────────────────────────────────────────────────

describe("CreateScheduleSlotSchema", () => {
  // Minimum viable slot — three required fields, optional tutor/package
  const validInput = {
    day_of_week: 0,
    start_time: "10:00",
    end_time: "12:00",
  }

  it("accepts a slot with only required fields", () => {
    const result = CreateScheduleSlotSchema.safeParse(validInput)
    expect(result.success).toBe(true)
  })

  it("accepts HH:MM:SS time format", () => {
    const result = CreateScheduleSlotSchema.safeParse({
      ...validInput,
      start_time: "10:00:00",
      end_time: "12:30:00",
    })
    expect(result.success).toBe(true)
  })

  it("accepts optional tutor_id and package", () => {
    const result = CreateScheduleSlotSchema.safeParse({
      ...validInput,
      tutor_id: 5,
      package: "wheel throwing explorer",
    })
    expect(result.success).toBe(true)
  })

  it("accepts null tutor_id and null package", () => {
    const result = CreateScheduleSlotSchema.safeParse({
      ...validInput,
      tutor_id: null,
      package: null,
    })
    expect(result.success).toBe(true)
  })

  it("rejects day_of_week below 0", () => {
    const result = CreateScheduleSlotSchema.safeParse({ ...validInput, day_of_week: -1 })
    expect(result.success).toBe(false)
  })

  it("rejects day_of_week above 6", () => {
    const result = CreateScheduleSlotSchema.safeParse({ ...validInput, day_of_week: 7 })
    expect(result.success).toBe(false)
  })

  it("rejects non-integer day_of_week", () => {
    const result = CreateScheduleSlotSchema.safeParse({ ...validInput, day_of_week: 3.5 })
    expect(result.success).toBe(false)
  })

  it("rejects malformed start_time", () => {
    const result = CreateScheduleSlotSchema.safeParse({ ...validInput, start_time: "10am" })
    expect(result.success).toBe(false)
  })

  it("rejects empty package string", () => {
    const result = CreateScheduleSlotSchema.safeParse({ ...validInput, package: "" })
    expect(result.success).toBe(false)
  })

  it("rejects negative tutor_id", () => {
    const result = CreateScheduleSlotSchema.safeParse({ ...validInput, tutor_id: -1 })
    expect(result.success).toBe(false)
  })

  // Regression: is_fully_booked was removed from the template — any consumer
  // still sending it should be ignored, not validated. Zod object schemas
  // strip unknown keys by default, so this should still succeed.
  it("ignores legacy is_fully_booked field on the template", () => {
    const result = CreateScheduleSlotSchema.safeParse({ ...validInput, is_fully_booked: true })
    expect(result.success).toBe(true)
    if (result.success) {
      expect("is_fully_booked" in result.data).toBe(false)
    }
  })
})

// ── UpdateScheduleSlotSchema ────────────────────────────────────────────────

describe("UpdateScheduleSlotSchema", () => {
  it("accepts an empty object (no-op update)", () => {
    const result = UpdateScheduleSlotSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it("accepts partial fields", () => {
    const result = UpdateScheduleSlotSchema.safeParse({ tutor_id: 3 })
    expect(result.success).toBe(true)
  })

  it("still validates field shapes when present", () => {
    const result = UpdateScheduleSlotSchema.safeParse({ day_of_week: 99 })
    expect(result.success).toBe(false)
  })
})

// ── UpsertScheduleOverrideSchema ────────────────────────────────────────────

describe("UpsertScheduleOverrideSchema", () => {
  it("accepts a minimal cancellation payload", () => {
    const result = UpsertScheduleOverrideSchema.safeParse({
      week_start: "2026-05-25",
      is_cancelled: true,
    })
    expect(result.success).toBe(true)
  })

  it("accepts a fully-booked override with reason", () => {
    const result = UpsertScheduleOverrideSchema.safeParse({
      week_start: "2026-05-25",
      is_fully_booked: true,
      cancel_reason: "Tutor sick",
    })
    expect(result.success).toBe(true)
  })

  it("accepts null cancel_reason (explicit clear)", () => {
    const result = UpsertScheduleOverrideSchema.safeParse({
      week_start: "2026-05-25",
      is_cancelled: true,
      cancel_reason: null,
    })
    expect(result.success).toBe(true)
  })

  it("rejects missing week_start", () => {
    const result = UpsertScheduleOverrideSchema.safeParse({ is_cancelled: true })
    expect(result.success).toBe(false)
  })

  it("rejects malformed week_start", () => {
    const result = UpsertScheduleOverrideSchema.safeParse({
      week_start: "25/05/2026",
      is_cancelled: true,
    })
    expect(result.success).toBe(false)
  })

  it("rejects non-boolean is_cancelled", () => {
    const result = UpsertScheduleOverrideSchema.safeParse({
      week_start: "2026-05-25",
      is_cancelled: "yes",
    })
    expect(result.success).toBe(false)
  })

  // Note: the "at least one flag must be true" check is NOT enforced at the
  // Zod layer — the service merges with existing row state and decides whether
  // to delete or write. Validation here is purely structural.
  it("accepts an all-false payload structurally (semantics enforced in service)", () => {
    const result = UpsertScheduleOverrideSchema.safeParse({
      week_start: "2026-05-25",
      is_fully_booked: false,
      is_cancelled: false,
    })
    expect(result.success).toBe(true)
  })
})

// ── WeekStartSchema ─────────────────────────────────────────────────────────

describe("WeekStartSchema", () => {
  it("accepts a valid YYYY-MM-DD", () => {
    expect(WeekStartSchema.safeParse("2026-05-25").success).toBe(true)
  })

  it("rejects DD-MM-YYYY", () => {
    expect(WeekStartSchema.safeParse("25-05-2026").success).toBe(false)
  })

  it("rejects an empty string", () => {
    expect(WeekStartSchema.safeParse("").success).toBe(false)
  })

  it("rejects a numeric value", () => {
    expect(WeekStartSchema.safeParse(20260525).success).toBe(false)
  })
})
