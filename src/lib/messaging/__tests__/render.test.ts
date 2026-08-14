import { describe, it, expect } from "vitest"
import {
  renderTemplate,
  extractPlaceholders,
  variablesToArray,
  isServiceWindowOpen,
} from "../render"
import { MessagingError } from "../provider"

describe("extractPlaceholders", () => {
  it("returns the distinct indexes in ascending order", () => {
    expect(extractPlaceholders("Hi {{1}}, your {{2}} is ready")).toEqual([1, 2])
  })

  it("deduplicates a placeholder used twice", () => {
    expect(extractPlaceholders("{{1}} and {{1}} again")).toEqual([1])
  })

  it("tolerates surrounding whitespace", () => {
    expect(extractPlaceholders("Hi {{ 1 }}")).toEqual([1])
  })

  it("returns empty for a body with no placeholders", () => {
    expect(extractPlaceholders("No variables here")).toEqual([])
  })

  it("sorts numerically, not lexicographically", () => {
    expect(extractPlaceholders("{{10}} {{2}} {{1}}")).toEqual([1, 2, 10])
  })
})

describe("renderTemplate", () => {
  it("substitutes positional variables (1-indexed placeholders)", () => {
    expect(renderTemplate("Hi {{1}}, your {{2}} is ready", ["Sara", "mug"]))
      .toBe("Hi Sara, your mug is ready")
  })

  it("substitutes a repeated placeholder everywhere", () => {
    expect(renderTemplate("{{1}}, hello {{1}}", ["Sara"])).toBe("Sara, hello Sara")
  })

  it("leaves a body with no placeholders untouched", () => {
    expect(renderTemplate("Plain text", [])).toBe("Plain text")
  })

  it("throws rather than leaving a literal placeholder in a client-facing message", () => {
    expect(() => renderTemplate("Hi {{1}}, your {{2}} is ready", ["Sara"]))
      .toThrow(MessagingError)
  })

  it("treats an empty string as a missing value", () => {
    expect(() => renderTemplate("Hi {{1}}", [""])).toThrow(MessagingError)
  })

  it("reports the offending placeholder index", () => {
    expect(() => renderTemplate("Hi {{1}} {{2}}", ["Sara"])).toThrow(/\{\{2\}\}/)
  })
})

describe("variablesToArray", () => {
  it("converts the stored object shape to a positional array", () => {
    expect(variablesToArray({ "1": "Sara", "2": "mug" })).toEqual(["Sara", "mug"])
  })

  it("returns an empty array for null/undefined", () => {
    expect(variablesToArray(null)).toEqual([])
    expect(variablesToArray(undefined)).toEqual([])
  })

  it("fills gaps with empty strings so positions never shift", () => {
    // {{2}} missing — index 1 must stay empty rather than sliding "third" into it
    expect(variablesToArray({ "1": "a", "3": "third" })).toEqual(["a", "", "third"])
  })

  it("ignores non-numeric keys", () => {
    expect(variablesToArray({ "1": "a", foo: "bar" })).toEqual(["a"])
  })
})

describe("isServiceWindowOpen", () => {
  const now = new Date("2026-07-28T12:00:00.000Z")

  it("is closed when the client has never messaged us", () => {
    expect(isServiceWindowOpen(null, now)).toBe(false)
  })

  it("is open just inside 24 hours", () => {
    expect(isServiceWindowOpen("2026-07-27T12:00:01.000Z", now)).toBe(true)
  })

  it("is closed exactly at 24 hours", () => {
    expect(isServiceWindowOpen("2026-07-27T12:00:00.000Z", now)).toBe(false)
  })

  it("is closed well past 24 hours", () => {
    expect(isServiceWindowOpen("2026-07-01T12:00:00.000Z", now)).toBe(false)
  })

  it("accepts a Date as well as an ISO string", () => {
    expect(isServiceWindowOpen(new Date("2026-07-28T11:00:00.000Z"), now)).toBe(true)
  })

  it("is closed for an unparseable timestamp", () => {
    expect(isServiceWindowOpen("not-a-date", now)).toBe(false)
  })

  it("is closed for a future timestamp (clock skew guard)", () => {
    expect(isServiceWindowOpen("2026-07-29T12:00:00.000Z", now)).toBe(false)
  })
})
