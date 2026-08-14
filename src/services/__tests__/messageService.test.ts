import { describe, it, expect } from "vitest"
import { isOptOutKeyword } from "../messageService"

describe("isOptOutKeyword", () => {
  it("matches the common English opt-out words", () => {
    expect(isOptOutKeyword("stop")).toBe(true)
    expect(isOptOutKeyword("unsubscribe")).toBe(true)
    expect(isOptOutKeyword("cancel")).toBe(true)
  })

  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(isOptOutKeyword("  STOP  ")).toBe(true)
    expect(isOptOutKeyword("Unsubscribe")).toBe(true)
  })

  it("matches Arabic opt-out words", () => {
    expect(isOptOutKeyword("توقف")).toBe(true)
    expect(isOptOutKeyword("الغاء")).toBe(true)
  })

  it("does NOT opt someone out for a sentence merely containing the word", () => {
    // The whole point of whole-message matching — "please don't stop firing my
    // piece" must not silently unsubscribe a client from all marketing.
    expect(isOptOutKeyword("please don't stop firing my piece")).toBe(false)
    expect(isOptOutKeyword("can I cancel my session on Tuesday?")).toBe(false)
  })

  it("ignores unrelated messages", () => {
    expect(isOptOutKeyword("is my mug ready?")).toBe(false)
    expect(isOptOutKeyword("")).toBe(false)
  })
})
