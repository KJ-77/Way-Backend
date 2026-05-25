import { describe, it, expect } from "vitest"
import { isStageBackward } from "../itemService"

describe("isStageBackward", () => {
  it("returns false for identical stages", () => {
    expect(isStageBackward("drying", "drying")).toBe(false)
  })

  // ── forward transitions through the studio progression ──

  it("returns false for forward stage transitions", () => {
    expect(isStageBackward("drying", "bisque fired")).toBe(false)
    expect(isStageBackward("bisque fired", "waiting glaze")).toBe(false)
    expect(isStageBackward("waiting glaze", "glaze fired")).toBe(false)
    expect(isStageBackward("glaze fired", "ready")).toBe(false)
    expect(isStageBackward("ready", "picked up")).toBe(false)
  })

  // ── backward transitions ──

  it("returns true for backward stage transitions", () => {
    expect(isStageBackward("bisque fired", "drying")).toBe(true)
    expect(isStageBackward("waiting glaze", "bisque fired")).toBe(true)
    expect(isStageBackward("ready", "waiting glaze")).toBe(true)
    expect(isStageBackward("picked up", "drying")).toBe(true)
  })

  // ── discarded edge cases ──

  it("treats discarded as terminal — moving into discarded is not backward", () => {
    expect(isStageBackward("drying", "discarded")).toBe(false)
    expect(isStageBackward("ready", "discarded")).toBe(false)
  })

  it("treats moving out of discarded as backward (admin gate)", () => {
    expect(isStageBackward("discarded", "drying")).toBe(true)
    expect(isStageBackward("discarded", "ready")).toBe(true)
  })
})
