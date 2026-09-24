import { describe, it, expect } from "vitest"
import { UpdateUserPackageSchema } from "../userPackage.schema"

describe("UpdateUserPackageSchema", () => {
  it("accepts what the admin's edit dialog sends", () => {
    const result = UpdateUserPackageSchema.safeParse({ expiry_date: "2026-11-30", notes: null })
    expect(result.success).toBe(true)
  })

  it("accepts a past expiry date — that's how staff retire a subscription", () => {
    expect(UpdateUserPackageSchema.safeParse({ expiry_date: "2020-01-01" }).success).toBe(true)
  })

  it("accepts negative remaining weight (clay overage the client owes)", () => {
    expect(UpdateUserPackageSchema.safeParse({ remaining_weight: -1.25 }).success).toBe(true)
  })

  it("rejects malformed and impossible dates", () => {
    expect(UpdateUserPackageSchema.safeParse({ expiry_date: "30/11/2026" }).success).toBe(false)
    expect(UpdateUserPackageSchema.safeParse({ expiry_date: "2026-02-31" }).success).toBe(false)
  })

  it("rejects fractional sessions", () => {
    expect(UpdateUserPackageSchema.safeParse({ remaining_sessions: 1.5 }).success).toBe(false)
  })

  it("strips columns that must never change after purchase, and SQL smuggled in as a key", () => {
    const result = UpdateUserPackageSchema.safeParse({
      user_id: "someone-else",
      package_id: 9,
      purchase_date: "2020-01-01",
      "remaining_sessions = 999, notes": "x",
      notes: "kept",
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toEqual({ notes: "kept" })
  })
})
