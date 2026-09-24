import { describe, it, expect } from "vitest"
import { CreatePackageSchema, UpdatePackageSchema, DEFAULT_VALIDITY_DAYS, MAX_VALIDITY_DAYS } from "../package.schema"

// What the admin's package form sends (packages-table.tsx handleSave).
const adminFormBody = {
  package_type: "Open Studio Membership",
  class_type_id: 3,
  sessions_included: 8,
  weight_included: 5,
  price: 120,
  notes: null,
}

// ── CreatePackageSchema ─────────────────────────────────────────────────────

describe("CreatePackageSchema", () => {
  it("accepts the admin form's payload and defaults validity to 60 days", () => {
    const result = CreatePackageSchema.safeParse(adminFormBody)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.validity_days).toBe(DEFAULT_VALIDITY_DAYS)
    expect(DEFAULT_VALIDITY_DAYS).toBe(60)
  })

  it("keeps an explicit validity (the 30-day membership)", () => {
    const result = CreatePackageSchema.safeParse({ ...adminFormBody, validity_days: 30 })
    expect(result.success && result.data.validity_days).toBe(30)
  })

  it("accepts blank numeric fields as null, like the form sends them", () => {
    const result = CreatePackageSchema.safeParse({
      ...adminFormBody, sessions_included: null, weight_included: null, price: null,
    })
    expect(result.success).toBe(true)
  })

  it("requires package_type and class_type_id", () => {
    expect(CreatePackageSchema.safeParse({ ...adminFormBody, package_type: "  " }).success).toBe(false)
    const { class_type_id: _, ...noClass } = adminFormBody
    expect(CreatePackageSchema.safeParse(noClass).success).toBe(false)
  })

  it("rejects validity outside 1–730 whole days (mirrors the DB CHECK)", () => {
    for (const bad of [0, MAX_VALIDITY_DAYS + 1, 1.5, -1]) {
      expect(CreatePackageSchema.safeParse({ ...adminFormBody, validity_days: bad }).success).toBe(false)
    }
  })
})

// ── UpdatePackageSchema ─────────────────────────────────────────────────────

describe("UpdatePackageSchema", () => {
  // Zod 4 applies .default() even inside .partial(). If this schema were a partial
  // of the CREATE schema, every edit that didn't mention validity_days would
  // silently reset it to 60 — undoing the membership's 30 days on the next price edit.
  it("does NOT inject a default validity into a partial update", () => {
    const result = UpdatePackageSchema.safeParse({ price: 150 })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toEqual({ price: 150 })
  })

  it("strips unknown keys — the service turns keys into SQL", () => {
    const result = UpdatePackageSchema.safeParse({
      "price = 0, package_type": "injected",
      notes: "fine",
    })
    expect(result.success).toBe(true)
    if (result.success) expect(Object.keys(result.data)).toEqual(["notes"])
  })

  it("validates validity_days on update too", () => {
    expect(UpdatePackageSchema.safeParse({ validity_days: 30 }).success).toBe(true)
    expect(UpdatePackageSchema.safeParse({ validity_days: 0 }).success).toBe(false)
    expect(UpdatePackageSchema.safeParse({ validity_days: null }).success).toBe(false)
  })
})
