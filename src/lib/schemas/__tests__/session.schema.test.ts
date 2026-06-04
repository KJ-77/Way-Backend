// ============================================================================
// session.schema.test.ts — Zod validation tests for the sessions API
//
// WHAT'S TESTED:
//   - CreateSessionSchema (requires class link: schedule_slot_id + class_date)
//   - UpdateSessionSchema (class link is immutable — fields are absent)
//
// Business rules like "class_date DOW matches slot day_of_week" or "is the
// week cancelled?" are tested in sessionService.test.ts because they need DB
// access. Here we only catch shape/format errors that should 400 fast.
// ============================================================================

import { describe, it, expect } from "vitest"
import { CreateSessionSchema, UpdateSessionSchema } from "../session.schema"

// Helper that returns a valid input. Use `overrides` to flip one field at a time
// for negative cases without re-typing the whole object every test.
const validCreate = (overrides: Record<string, unknown> = {}) => ({
  user_package_id: 12,
  schedule_slot_id: 3,
  class_date: "2026-06-15",
  attendance: "booked",
  notes: "first class",
  ...overrides,
})

describe("CreateSessionSchema", () => {
  it("accepts a valid create payload", () => {
    const result = CreateSessionSchema.safeParse(validCreate())
    expect(result.success).toBe(true)
  })

  it("accepts a payload without notes (optional)", () => {
    const { notes: _notes, ...rest } = validCreate()
    const result = CreateSessionSchema.safeParse(rest)
    expect(result.success).toBe(true)
  })

  it("rejects when schedule_slot_id is missing", () => {
    const { schedule_slot_id: _slot, ...rest } = validCreate()
    const result = CreateSessionSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it("rejects when class_date is missing", () => {
    const { class_date: _date, ...rest } = validCreate()
    const result = CreateSessionSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it("rejects when user_package_id is missing", () => {
    const { user_package_id: _up, ...rest } = validCreate()
    const result = CreateSessionSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it.each(["", "2026-6-15", "06-15-2026", "2026/06/15", "not-a-date"])(
    "rejects malformed class_date %s",
    (badDate) => {
      const result = CreateSessionSchema.safeParse(validCreate({ class_date: badDate }))
      expect(result.success).toBe(false)
    },
  )

  it("rejects non-positive schedule_slot_id", () => {
    expect(CreateSessionSchema.safeParse(validCreate({ schedule_slot_id: 0 })).success).toBe(false)
    expect(CreateSessionSchema.safeParse(validCreate({ schedule_slot_id: -1 })).success).toBe(false)
  })

  it("rejects unknown attendance value", () => {
    const result = CreateSessionSchema.safeParse(validCreate({ attendance: "maybe" }))
    expect(result.success).toBe(false)
  })

  it.each(["attended", "booked", "cancelled", "cancelled - no charge"] as const)(
    "accepts attendance value %s",
    (att) => {
      const result = CreateSessionSchema.safeParse(validCreate({ attendance: att }))
      expect(result.success).toBe(true)
    },
  )
})

describe("UpdateSessionSchema", () => {
  it("accepts an empty body (no-op update)", () => {
    const result = UpdateSessionSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it("accepts partial updates", () => {
    expect(UpdateSessionSchema.safeParse({ attendance: "attended" }).success).toBe(true)
    expect(UpdateSessionSchema.safeParse({ notes: "ran late" }).success).toBe(true)
    expect(UpdateSessionSchema.safeParse({ notes: null }).success).toBe(true)
    expect(UpdateSessionSchema.safeParse({ session_nb: 4 }).success).toBe(true)
  })

  it("strips class link fields silently (immutable on update)", () => {
    // Zod's default behaviour is to strip unknown fields. We rely on that to
    // enforce that schedule_slot_id and class_date can't be patched after
    // creation — even if the frontend mistakenly sends them.
    const result = UpdateSessionSchema.safeParse({
      attendance: "attended",
      schedule_slot_id: 99,
      class_date: "2030-01-01",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).not.toHaveProperty("schedule_slot_id")
      expect(result.data).not.toHaveProperty("class_date")
    }
  })

  it("rejects non-positive session_nb", () => {
    expect(UpdateSessionSchema.safeParse({ session_nb: 0 }).success).toBe(false)
    expect(UpdateSessionSchema.safeParse({ session_nb: -1 }).success).toBe(false)
  })
})
