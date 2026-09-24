import { describe, it, expect } from "vitest"
import { CreateTutorSchema, UpdateTutorSchema } from "../tutor.schema"

// What the admin's tutor form sends (tutors-grid.tsx handleSave) — note the empty
// email/phone strings for fields left blank.
const adminFormBody = {
  full_name: "Maya Haddad",
  email: "",
  phone: "",
  hourly_rate: null,
  specialty: null,
  notes: null,
}

describe("CreateTutorSchema", () => {
  it("accepts the admin form's payload, blanks included", () => {
    expect(CreateTutorSchema.safeParse(adminFormBody).success).toBe(true)
  })

  it("requires a non-blank full_name", () => {
    expect(CreateTutorSchema.safeParse({ ...adminFormBody, full_name: "   " }).success).toBe(false)
  })

  it("rejects a negative hourly rate", () => {
    expect(CreateTutorSchema.safeParse({ ...adminFormBody, hourly_rate: -5 }).success).toBe(false)
  })
})

describe("UpdateTutorSchema", () => {
  // The vulnerability this schema closes: updateTutor builds `SET <key> = $n` from
  // the body's keys, and RETURNING * echoed the result back. A key like this one read
  // any table in the database. Unknown keys must never survive parsing.
  it("strips unknown keys — including SQL smuggled in as a key", () => {
    const result = UpdateTutorSchema.safeParse({
      "notes = (SELECT string_agg(phone, ',') FROM users), full_name": "x",
      notes: "legit",
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toEqual({ notes: "legit" })
  })

  it("allows a partial update", () => {
    const result = UpdateTutorSchema.safeParse({ hourly_rate: 25 })
    expect(result.success && result.data).toEqual({ hourly_rate: 25 })
  })
})
