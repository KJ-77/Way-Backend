import { describe, it, expect } from "vitest"
import {
  isStageBackward,
  discardRefundAmount,
  undiscardRedeductAmount,
  requiresFreshWeightOnUndiscard,
} from "../itemService"

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

// ── discardRefundAmount ────────────────────────────────────────────────────
// Pure decision function for "how much do we credit back when going to discarded".
// Mirrors the same semantics as the forward-cross-ready deduction.

describe("discardRefundAmount", () => {
  it("returns 0 for PC items regardless of weight", () => {
    expect(discardRefundAmount("ready", "PC", 1.5)).toBe(0)
    expect(discardRefundAmount("picked up", "PC", 2.0)).toBe(0)
  })

  it("returns 0 when no weight was recorded (nothing was deducted)", () => {
    expect(discardRefundAmount("ready", "Studio", null)).toBe(0)
    expect(discardRefundAmount("picked up", "Studio", null)).toBe(0)
  })

  it("returns 0 when discarding from a pre-ready stage (no deduction had occurred)", () => {
    expect(discardRefundAmount("drying", "Studio", null)).toBe(0)
    expect(discardRefundAmount("bisque fired", "Studio", null)).toBe(0)
    expect(discardRefundAmount("waiting glaze", "Studio", null)).toBe(0)
    expect(discardRefundAmount("glaze fired", "Studio", null)).toBe(0)
  })

  it("returns 0 when already discarded (no-op)", () => {
    expect(discardRefundAmount("discarded", "Studio", 1.5)).toBe(0)
  })

  it("refunds the recorded final_weight when discarding from 'ready'", () => {
    expect(discardRefundAmount("ready", "Studio", 1.5)).toBe(1.5)
  })

  it("refunds the recorded final_weight when discarding from 'picked up'", () => {
    expect(discardRefundAmount("picked up", "Studio", 2.25)).toBe(2.25)
  })
})

// ── undiscardRedeductAmount ────────────────────────────────────────────────
// Pure decision function for "how much do we re-deduct when leaving discarded".
// Only fires when the destination stage is at/past 'ready' and weight was preserved.

describe("undiscardRedeductAmount", () => {
  it("returns 0 for PC items regardless of weight", () => {
    expect(undiscardRedeductAmount("ready", "PC", 1.5)).toBe(0)
  })

  it("returns 0 when no preserved weight (item never crossed ready before discarding)", () => {
    expect(undiscardRedeductAmount("ready", "Studio", null)).toBe(0)
    expect(undiscardRedeductAmount("picked up", "Studio", null)).toBe(0)
  })

  it("returns 0 when staying in 'discarded' (no-op)", () => {
    expect(undiscardRedeductAmount("discarded", "Studio", 1.5)).toBe(0)
  })

  it("returns 0 when un-discarding to a pre-ready stage (caller will clear column)", () => {
    expect(undiscardRedeductAmount("drying", "Studio", 1.5)).toBe(0)
    expect(undiscardRedeductAmount("bisque fired", "Studio", 1.5)).toBe(0)
    expect(undiscardRedeductAmount("waiting glaze", "Studio", 1.5)).toBe(0)
    expect(undiscardRedeductAmount("glaze fired", "Studio", 1.5)).toBe(0)
  })

  it("re-deducts the preserved weight when un-discarding back to 'ready'", () => {
    expect(undiscardRedeductAmount("ready", "Studio", 1.5)).toBe(1.5)
  })

  it("re-deducts the preserved weight when un-discarding back to 'picked up'", () => {
    expect(undiscardRedeductAmount("picked up", "Studio", 2.25)).toBe(2.25)
  })
})

// ── requiresFreshWeightOnUndiscard ─────────────────────────────────────────
// Edge case: item is discarded BEFORE it ever crossed "ready" (final_weight
// stays null). When un-discarded to a weighed stage, the caller must supply
// a fresh weight — there's nothing to replay.

describe("requiresFreshWeightOnUndiscard", () => {
  it("returns false for PC items (no weight tracking)", () => {
    expect(requiresFreshWeightOnUndiscard("ready", "PC", null)).toBe(false)
    expect(requiresFreshWeightOnUndiscard("picked up", "PC", null)).toBe(false)
  })

  it("returns false when item already has a preserved weight", () => {
    expect(requiresFreshWeightOnUndiscard("ready", "Studio", 1.5)).toBe(false)
    expect(requiresFreshWeightOnUndiscard("picked up", "Studio", 2.0)).toBe(false)
  })

  it("returns false when target stage is still 'discarded' (no-op)", () => {
    expect(requiresFreshWeightOnUndiscard("discarded", "Studio", null)).toBe(false)
  })

  it("returns false when un-discarding to a pre-weighed stage", () => {
    expect(requiresFreshWeightOnUndiscard("drying", "Studio", null)).toBe(false)
    expect(requiresFreshWeightOnUndiscard("bisque fired", "Studio", null)).toBe(false)
    expect(requiresFreshWeightOnUndiscard("waiting glaze", "Studio", null)).toBe(false)
    expect(requiresFreshWeightOnUndiscard("glaze fired", "Studio", null)).toBe(false)
  })

  it("returns true when un-discarding to 'ready' with no preserved weight", () => {
    expect(requiresFreshWeightOnUndiscard("ready", "Studio", null)).toBe(true)
  })

  it("returns true when un-discarding to 'picked up' with no preserved weight", () => {
    expect(requiresFreshWeightOnUndiscard("picked up", "Studio", null)).toBe(true)
  })
})

// ── discard / undiscard round-trip ─────────────────────────────────────────
// The whole point of preserving final_weight on the item is symmetry — the
// amount refunded on discard must equal the amount re-deducted on un-discard
// when the round-trip lands back on the same weighed stage.

describe("discard ↔ undiscard symmetry", () => {
  it("refund and re-deduct cancel out for ready → discarded → ready", () => {
    const weight = 1.7
    const refund = discardRefundAmount("ready", "Studio", weight)
    const rededuct = undiscardRedeductAmount("ready", "Studio", weight)
    expect(refund).toBe(weight)
    expect(rededuct).toBe(weight)
    expect(refund - rededuct).toBe(0)
  })

  it("refund and re-deduct cancel out for picked up → discarded → picked up", () => {
    const weight = 3.0
    const refund = discardRefundAmount("picked up", "Studio", weight)
    const rededuct = undiscardRedeductAmount("picked up", "Studio", weight)
    expect(refund - rededuct).toBe(0)
  })
})
