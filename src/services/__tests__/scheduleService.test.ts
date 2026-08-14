// ============================================================================
// scheduleService.test.ts — Tests for the cancellation-transition rule
//
// When a class is cancelled, every client booked into it gets their session
// refunded; un-cancelling gives it back. The gate deciding whether either of
// those fires is `cancelTransition`, and it carries the idempotency guarantee:
// only a genuine false→true / true→false flip moves anyone's balance.
//
// That matters because upsertOverride is a merge-then-write. Staff editing a
// cancel reason, toggling fully-booked, or double-clicking save all re-write an
// override row whose is_cancelled never changed. If any of those counted as a
// transition, clients would be credited a second, third, fourth session for one
// cancelled class — silent, compounding, and invisible until someone audits
// balances. Hence testing it in isolation rather than only through the
// transactional path.
// ============================================================================

import { describe, it, expect } from "vitest"
import { cancelTransition } from "../scheduleService"

describe("cancelTransition", () => {
  // ── The two real transitions ──────────────────────────────────────────────

  it("returns 'cancelled' when a live class is cancelled (false → true)", () => {
    expect(cancelTransition(false, true)).toBe("cancelled")
  })

  it("returns 'uncancelled' when a cancelled class is reinstated (true → false)", () => {
    expect(cancelTransition(true, false)).toBe("uncancelled")
  })

  // ── The idempotency guarantee ─────────────────────────────────────────────
  // These two cases are the whole point. Re-saving an override without touching
  // is_cancelled must be a no-op for client balances.

  it("returns 'none' when re-saving an already-cancelled week (true → true)", () => {
    expect(cancelTransition(true, true)).toBe("none")
  })

  it("returns 'none' when saving a non-cancelled week (false → false)", () => {
    expect(cancelTransition(false, false)).toBe("none")
  })

  it("never reports a transition when the flag is unchanged", () => {
    for (const state of [true, false]) {
      expect(cancelTransition(state, state)).toBe("none")
    }
  })

  // ── Repeated writes ───────────────────────────────────────────────────────
  // Simulates staff saving the same cancelled override several times in a row
  // (edit the reason, re-save, double-click). Exactly one refund should fire.

  it("fires exactly one refund across a cancel followed by repeated re-saves", () => {
    const writes = [
      cancelTransition(false, true), // initial cancel
      cancelTransition(true, true),  // edit cancel_reason
      cancelTransition(true, true),  // toggle fully-booked
      cancelTransition(true, true),  // double-clicked save
    ]
    expect(writes.filter((t) => t === "cancelled")).toHaveLength(1)
    expect(writes.filter((t) => t === "uncancelled")).toHaveLength(0)
  })

  // ── Round trip ────────────────────────────────────────────────────────────
  // A cancel/un-cancel cycle must balance out: one refund, one restore. If these
  // ever diverge, clients drift a session up or down per cycle.

  it("balances refunds against restores over a cancel/un-cancel cycle", () => {
    const cycle = [
      cancelTransition(false, true), // cancel
      cancelTransition(true, false), // un-cancel
      cancelTransition(false, true), // cancel again
      cancelTransition(true, false), // un-cancel again
    ]
    const refunds = cycle.filter((t) => t === "cancelled").length
    const restores = cycle.filter((t) => t === "uncancelled").length
    expect(refunds).toBe(restores)
    expect(refunds).toBe(2)
  })
})
