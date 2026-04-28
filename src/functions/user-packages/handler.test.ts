import { describe, it, expect } from "vitest"
import {computeStatus} from "./handler"
import type {UserPackageJoined} from "../../lib/types"


// A "base" subscription that's clearly active — tweak individual fields per test
// This is one way of doing it since UserPackageJoined is small, we could create an 
// entire const every time we want to test it. For larger objects, a helper function 
// that takes overrides is more maintainable and readable.
//   const activeSubscription: UserPackageJoined = {
//     id: 1,
//     user_id: "abc-123",
//     package_id: 1,
//     purchase_date: "2025-01-01",
//     remaining_sessions: 5,
//     remaining_weight: 2000,
//     expiry_date: "2099-12-31",  // far future = not expired
//     notes: null,
//     user_name: "Test User",
//     package_name: "Hand Building Explorer",
//     sessions_included: 8,
//     weight_included: 3000,
//     price: 50,
//   }

// The function takes a Partial<UserPackageJoined> — meaning every field is optional.
  // It spreads sensible defaults, then your overrides go on top.
  function fakeSubscription(overrides: Partial<UserPackageJoined> = {}): UserPackageJoined {
    return {
      id: 1,
      user_id: "abc-123",
      package_id: 1,
      purchase_date: "2025-01-01",
      remaining_sessions: 5,
      remaining_weight: 2000,
      expiry_date: "2099-12-31",
      notes: null,
      user_name: "Test User",
      package_name: "Hand Building Explorer",
      sessions_included: 8,
      weight_included: 3000,
      price: 50,
      ...overrides,  // anything you pass in replaces the defaults above
    }
  }

describe("computeStatus", () => {
    it("returns 'active' when the subscription still has remaining weight and sessions, and is not expired", () => {
        const subscription = fakeSubscription();
        const result = computeStatus(subscription);
        expect(result).toBe('active');
    });

    it("returns 'depleted' when remaining sessions are 0", () => {
        const subscription = fakeSubscription({ remaining_sessions: 0 });
        const result = computeStatus(subscription);
        expect(result).toBe('depleted');
    });

    it("returns 'depleted' when remaining weight is 0", () => {
        const subscription = fakeSubscription({ remaining_weight: 0 });
        const result = computeStatus(subscription);
        expect(result).toBe('depleted');
    });

    it("returns 'expired' when the expiry date is in the past", () => {
        const subscription = fakeSubscription({ expiry_date: "2000-01-01" });
        const result = computeStatus(subscription);
        expect(result).toBe('expired');
    });
});