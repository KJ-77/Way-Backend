import { describe, it, expect } from "vitest"
import { toE164, isE164, isLebaneseMobile, formatLebaneseForDisplay } from "../phone"

describe("toE164", () => {
  // The four ways a Lebanese number actually turns up in the users table, all of
  // which are the same person.
  it("normalises every common Lebanese input format to one canonical value", () => {
    const expected = "+96170123456"
    expect(toE164("+96170123456")).toBe(expected)
    expect(toE164("+961 70 123 456")).toBe(expected)
    expect(toE164("0096170123456")).toBe(expected)
    expect(toE164("961 70123456")).toBe(expected)
    expect(toE164("070123456")).toBe(expected)
    expect(toE164("70123456")).toBe(expected)
    expect(toE164("70 123 456")).toBe(expected)
    expect(toE164("70-123-456")).toBe(expected)
  })

  it("handles the legacy single-digit 03 prefix", () => {
    // "03" numbers carry only 6 subscriber digits, not 8.
    expect(toE164("03123456")).toBe("+9613123456")
    expect(toE164("03/123456")).toBe("+9613123456")
    expect(toE164("+961 3 123 456")).toBe("+9613123456")
  })

  it("is idempotent — re-normalising an E.164 value is a no-op", () => {
    // Matters because the backfill script is designed to be safely re-runnable.
    const once = toE164("70 123 456")!
    expect(toE164(once)).toBe(once)
  })

  it("rejects input that isn't a phone number", () => {
    expect(toE164("")).toBeNull()
    expect(toE164(null)).toBeNull()
    expect(toE164(undefined)).toBeNull()
    expect(toE164("not a phone")).toBeNull()
    expect(toE164("123")).toBeNull() // too short to be anything
    expect(toE164("0")).toBeNull()
  })

  it("rejects malformed plus placement", () => {
    // A plus is only meaningful in first position; anything else is junk data.
    expect(toE164("70+123456")).toBeNull()
    expect(toE164("++96170123456")).toBeNull()
  })

  it("rejects a leading zero after the plus", () => {
    // E.164 country codes never start with 0.
    expect(toE164("+0123456789")).toBeNull()
  })

  it("preserves foreign numbers already in international form", () => {
    // Tourists and expats are real clients and their numbers are perfectly
    // sendable — normalisation must not mangle them into Lebanese ones.
    expect(toE164("+33612345678")).toBe("+33612345678")
    expect(toE164("+1 415 555 0132")).toBe("+14155550132")
  })
})

describe("isLebaneseMobile", () => {
  it("accepts every allocated mobile prefix", () => {
    // Alfa: 3, 70, 71, 76 — touch: 3, 78, 79, 81. Each takes exactly 6 subscriber
    // digits, so the "3" numbers are one digit shorter overall.
    for (const prefix of ["3", "70", "71", "76", "78", "79", "81"]) {
      expect(isLebaneseMobile(`+961${prefix}123456`)).toBe(true)
    }
  })

  it("rejects Lebanese landlines", () => {
    // 01 is Beirut. SMS to a landline cannot be delivered, so flagging it early
    // saves staff wondering why a message never arrived.
    expect(isLebaneseMobile("+9611123456")).toBe(false)
  })

  it("rejects foreign numbers", () => {
    // Not an error — just "we can't assert this is a Lebanese mobile".
    expect(isLebaneseMobile("+33612345678")).toBe(false)
  })

  it("rejects a Lebanese mobile with the wrong number of digits", () => {
    expect(isLebaneseMobile("+9617012345")).toBe(false) // one short
    expect(isLebaneseMobile("+961701234567")).toBe(false) // one long
  })
})

describe("isE164", () => {
  it("accepts well-formed international numbers", () => {
    expect(isE164("+96170123456")).toBe(true)
    expect(isE164("+14155550132")).toBe(true)
  })

  it("rejects anything without a plus or with stray characters", () => {
    expect(isE164("96170123456")).toBe(false)
    expect(isE164("+961 70 123 456")).toBe(false)
    expect(isE164("+0123456")).toBe(false)
  })
})

describe("formatLebaneseForDisplay", () => {
  it("groups 2-digit-prefix mobiles as +961 XX XXX XXX", () => {
    expect(formatLebaneseForDisplay("+96170123456")).toBe("+961 70 123 456")
  })

  it("groups legacy 03 mobiles as +961 X XXX XXX", () => {
    expect(formatLebaneseForDisplay("+9613123456")).toBe("+961 3 123 456")
  })

  it("passes non-Lebanese numbers through untouched", () => {
    expect(formatLebaneseForDisplay("+33612345678")).toBe("+33612345678")
  })
})
