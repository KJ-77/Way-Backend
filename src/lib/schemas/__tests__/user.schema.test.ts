// ============================================================================
// user.schema.test.ts — Tests for Zod validation schemas
//
// WHAT'S BEING TESTED:
// CreateUserSchema and UpdateUserSchema — the Zod schemas that validate
// incoming request bodies before they touch the database.
//
// WHY THESE?
// Validation is your first line of defense against bad data. If someone sends
// { full_name: "" } or { referral_source: "Twitter" }, Zod should reject it
// before it ever hits the database. Tests here prove that your validation
// rules actually work — both accepting good data and rejecting bad data.
//
// NEW CONCEPT: Testing validation
// With Zod, we use .safeParse() instead of .parse(). The difference:
//   .parse()     — throws an error on invalid input
//   .safeParse() — returns { success: true, data } or { success: false, error }
// .safeParse() is nicer for testing because we can check success/failure
// without try/catch blocks.
// ============================================================================

import { describe, it, expect } from "vitest"
import { CreateUserSchema, UpdateUserSchema } from "../user.schema"

// ── CreateUserSchema ────────────────────────────────────────────────────────

describe("CreateUserSchema", () => {
  it("accepts valid input with only required fields", () => {
    // Arrange: minimum viable user — just the 3 required fields
    const input = {
      full_name: "Tarek Ramadan",
      phone: "+961 71 123 456",
      referral_source: "Walk-In",
    }
    // Act: safeParse returns a result object instead of throwing
    const result = CreateUserSchema.safeParse(input)
    // Assert: should succeed
    expect(result.success).toBe(true)
  })

  it("accepts valid input with all optional fields filled in", () => {
    const input = {
      full_name: "Khalil Al Jamil",
      phone: "+961 70 779 950",
      referral_source: "Referral",
      email: "khalil@test.com",
      gender: "Male",
      dob: "2004-01-15",
      level: "Mid",
      preferred_tutor: 1,
      loyalty: "High",
      first_visit: "2024-03-15",
      notes: "VIP client",
    }
    const result = CreateUserSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it("rejects when full_name is missing", () => {
    const input = {
      // full_name is missing
      phone: "+961 71 123 456",
      referral_source: "Walk-In",
    }
    const result = CreateUserSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it("rejects when phone is missing", () => {
    const input = {
      full_name: "Tarek",
      // phone is missing
      referral_source: "Walk-In",
    }
    const result = CreateUserSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it("rejects when referral_source is missing", () => {
    const input = {
      full_name: "Tarek",
      phone: "+961 71 123 456",
      // referral_source is missing
    }
    const result = CreateUserSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it("rejects an invalid referral_source value", () => {
    const input = {
      full_name: "Tarek",
      phone: "+961 71 123 456",
      referral_source: "Instagram",  // not one of: Referral, SCM, Walk-In
    }
    const result = CreateUserSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it("rejects an invalid email format", () => {
    const input = {
      full_name: "Tarek",
      phone: "+961 71 123 456",
      referral_source: "Walk-In",
      email: "not-an-email",
    }
    const result = CreateUserSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it("rejects an invalid gender value", () => {
    const input = {
      full_name: "Tarek",
      phone: "+961 71 123 456",
      referral_source: "Walk-In",
      gender: "Other",  // only Male or Female are valid
    }
    const result = CreateUserSchema.safeParse(input)
    expect(result.success).toBe(false)
  })
})

// ── UpdateUserSchema ────────────────────────────────────────────────────────

describe("UpdateUserSchema", () => {
  it("accepts a partial update with just one field", () => {
    // UpdateUserSchema is CreateUserSchema.partial() — every field is optional
    const input = { full_name: "New Name" }
    const result = UpdateUserSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it("accepts an empty object (no-op update)", () => {
    // An empty body means "change nothing" — the handler returns the row as-is
    const result = UpdateUserSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it("still validates field values even though they're optional", () => {
    // Even on partial updates, if you DO send a field, it must be valid
    const input = { level: "Expert" }  // only Beginner, Mid, Advanced are valid
    const result = UpdateUserSchema.safeParse(input)
    expect(result.success).toBe(false)
  })
})
