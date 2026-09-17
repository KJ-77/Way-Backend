import { describe, it, expect, vi, beforeEach } from "vitest"
import type { APIGatewayProxyEventV2 } from "aws-lambda"
import type { UserPackageJoined } from "../../lib/types"

// Mock the service module before importing the handler — the handler will pick up these mocks
vi.mock("../../services/userPackageService", () => ({
  getAllUserPackages: vi.fn(),
  getUserPackagesByUserId: vi.fn(),
  getUserPackageById: vi.fn(),
  createUserPackage: vi.fn(),
  updateUserPackage: vi.fn(),
  deleteUserPackage: vi.fn(),
}))

import * as userPackageService from "../../services/userPackageService"
import {
  computeStatus,
  getUserPackages,
  getUserPackage,
  createUserPackage,
  updateUserPackage,
  deleteUserPackage,
  purchaseDateProblem,
} from "./handler"

// ── helpers ─────────────────────────────────────────────────────────────────

// A "base" subscription that's clearly active — tweak individual fields per test
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
    ...overrides,
  }
}

// Build a fake API Gateway event with Lambda authorizer context + optional query/path params
function fakeEvent(opts: {
  sub: string
  source_pool: "admin" | "client"
  groups?: string
  query?: Record<string, string>
  path?: Record<string, string>
  body?: unknown
}): APIGatewayProxyEventV2 {
  return {
    requestContext: {
      authorizer: {
        lambda: {
          sub: opts.sub,
          email: "test@example.com",
          groups: opts.groups ?? "",
          source_pool: opts.source_pool,
        },
      },
    },
    queryStringParameters: opts.query,
    pathParameters: opts.path,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  } as unknown as APIGatewayProxyEventV2
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── computeStatus ───────────────────────────────────────────────────────────

describe("computeStatus", () => {
  it("returns 'active' when sessions/weight remain and not expired", () => {
    expect(computeStatus(fakeSubscription())).toBe("active")
  })

  it("returns 'depleted' when remaining sessions are 0", () => {
    expect(computeStatus(fakeSubscription({ remaining_sessions: 0 }))).toBe("depleted")
  })

  it("stays 'active' even when remaining_weight is 0 or negative — weight is no longer a gating factor", () => {
    expect(computeStatus(fakeSubscription({ remaining_weight: 0 }))).toBe("active")
    expect(computeStatus(fakeSubscription({ remaining_weight: -500 }))).toBe("active")
  })

  it("returns 'expired' when the expiry date is in the past", () => {
    expect(computeStatus(fakeSubscription({ expiry_date: "2000-01-01" }))).toBe("expired")
  })
})

// ── getUserPackages (list) ──────────────────────────────────────────────────

describe("getUserPackages — ownership scoping", () => {
  it("client tokens are force-scoped to their own sub — even if a different user_id is passed", async () => {
    vi.mocked(userPackageService.getUserPackagesByUserId).mockResolvedValue([fakeSubscription({ user_id: "client-1" })])

    // Client tries to peek at another user's subscriptions via the query param
    const event = fakeEvent({
      sub: "client-1",
      source_pool: "client",
      query: { user_id: "some-other-user" },
    })
    const res = await getUserPackages(event)

    // Service should be called with the AUTH sub, NOT the spoofed query param
    expect(userPackageService.getUserPackagesByUserId).toHaveBeenCalledWith("client-1")
    expect(userPackageService.getAllUserPackages).not.toHaveBeenCalled()
    expect((res as any).statusCode).toBe(200)
  })

  it("admin tokens honor the user_id query param", async () => {
    vi.mocked(userPackageService.getUserPackagesByUserId).mockResolvedValue([])

    const event = fakeEvent({
      sub: "admin-1",
      source_pool: "admin",
      query: { user_id: "target-user" },
    })
    await getUserPackages(event)

    expect(userPackageService.getUserPackagesByUserId).toHaveBeenCalledWith("target-user")
  })

  it("admin tokens with no user_id query param list ALL subscriptions", async () => {
    vi.mocked(userPackageService.getAllUserPackages).mockResolvedValue([])

    const event = fakeEvent({ sub: "admin-1", source_pool: "admin" })
    await getUserPackages(event)

    expect(userPackageService.getAllUserPackages).toHaveBeenCalled()
    expect(userPackageService.getUserPackagesByUserId).not.toHaveBeenCalled()
  })

  it("unauthenticated requests get 401", async () => {
    const event = { requestContext: {} } as APIGatewayProxyEventV2
    const res = await getUserPackages(event)
    expect((res as any).statusCode).toBe(401)
  })
})

// ── getUserPackage (single) ─────────────────────────────────────────────────

describe("getUserPackage — ownership enforcement", () => {
  it("returns 200 when a client views their OWN subscription", async () => {
    vi.mocked(userPackageService.getUserPackageById).mockResolvedValue(
      fakeSubscription({ id: 42, user_id: "client-1" })
    )

    const event = fakeEvent({
      sub: "client-1",
      source_pool: "client",
      path: { id: "42" },
    })
    const res = await getUserPackage(event)

    expect((res as any).statusCode).toBe(200)
  })

  it("returns 403 when a client tries to view someone ELSE's subscription", async () => {
    vi.mocked(userPackageService.getUserPackageById).mockResolvedValue(
      fakeSubscription({ id: 42, user_id: "different-client" })
    )

    const event = fakeEvent({
      sub: "client-1",
      source_pool: "client",
      path: { id: "42" },
    })
    const res = await getUserPackage(event)

    expect((res as any).statusCode).toBe(403)
  })

  it("admin can view any subscription regardless of owner", async () => {
    vi.mocked(userPackageService.getUserPackageById).mockResolvedValue(
      fakeSubscription({ id: 42, user_id: "some-client" })
    )

    const event = fakeEvent({
      sub: "admin-1",
      source_pool: "admin",
      groups: "admin",
      path: { id: "42" },
    })
    const res = await getUserPackage(event)

    expect((res as any).statusCode).toBe(200)
  })

  it("returns 404 when subscription does not exist", async () => {
    vi.mocked(userPackageService.getUserPackageById).mockResolvedValue(null)

    const event = fakeEvent({
      sub: "client-1",
      source_pool: "client",
      path: { id: "999" },
    })
    const res = await getUserPackage(event)

    expect((res as any).statusCode).toBe(404)
  })
})

// ── Write handlers — role gates ────────────────────────────────────────────

describe("write handlers reject clients", () => {
  it("createUserPackage returns 403 for client tokens", async () => {
    const event = fakeEvent({
      sub: "client-1",
      source_pool: "client",
      body: { user_id: "client-1", package_id: 1 },
    })
    const res = await createUserPackage(event)
    expect((res as any).statusCode).toBe(403)
    expect(userPackageService.createUserPackage).not.toHaveBeenCalled()
  })

  it("updateUserPackage returns 403 for client tokens", async () => {
    const event = fakeEvent({
      sub: "client-1",
      source_pool: "client",
      path: { id: "1" },
      body: { notes: "hacked" },
    })
    const res = await updateUserPackage(event)
    expect((res as any).statusCode).toBe(403)
    expect(userPackageService.updateUserPackage).not.toHaveBeenCalled()
  })

  it("deleteUserPackage returns 403 for studio-manager tokens (delete = admin only)", async () => {
    const event = fakeEvent({
      sub: "sm-1",
      source_pool: "admin",
      groups: "studio-manager",
      path: { id: "1" },
    })
    const res = await deleteUserPackage(event)
    expect((res as any).statusCode).toBe(403)
    expect(userPackageService.deleteUserPackage).not.toHaveBeenCalled()
  })

  it("deleteUserPackage returns 200 for admin tokens", async () => {
    vi.mocked(userPackageService.deleteUserPackage).mockResolvedValue(true)

    const event = fakeEvent({
      sub: "admin-1",
      source_pool: "admin",
      groups: "admin",
      path: { id: "1" },
    })
    const res = await deleteUserPackage(event)
    expect((res as any).statusCode).toBe(200)
  })

  it("createUserPackage 201s for studio-manager", async () => {
    vi.mocked(userPackageService.createUserPackage).mockResolvedValue(fakeSubscription())

    const event = fakeEvent({
      sub: "sm-1",
      source_pool: "admin",
      groups: "studio-manager",
      body: { user_id: "client-1", package_id: 1 },
    })
    const res = await createUserPackage(event)
    expect((res as any).statusCode).toBe(201)
  })
})

// ── Purchase date ───────────────────────────────────────────────────────────
// Staff record subscriptions after the fact, so the purchase date can be in the
// past. It drives the expiry date, so a bad value corrupts the subscription.

describe("purchaseDateProblem", () => {
  it("accepts today and past dates", () => {
    expect(purchaseDateProblem("2025-01-01")).toBeNull()
  })

  it("rejects anything that isn't YYYY-MM-DD", () => {
    expect(purchaseDateProblem("01/02/2025")).not.toBeNull()
    expect(purchaseDateProblem("2025-1-1")).not.toBeNull()
    expect(purchaseDateProblem(20250101)).not.toBeNull()
    expect(purchaseDateProblem("")).not.toBeNull()
  })

  it("rejects impossible dates the format regex would let through", () => {
    expect(purchaseDateProblem("2026-02-31")).toMatch(/real date/)
    expect(purchaseDateProblem("2025-13-01")).toMatch(/real date/)
  })

  it("rejects future dates", () => {
    expect(purchaseDateProblem("2999-01-01")).toMatch(/future/)
  })

  it("judges 'the future' by Beirut's calendar, not the server's UTC one", () => {
    // 22:30 UTC on Jan 1 is already 00:30 on Jan 2 in Beirut (UTC+2 in winter).
    // A subscription bought on the studio's Jan 2 must be accepted, even though
    // the Lambda's own clock still says Jan 1.
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T22:30:00Z"))
    try {
      expect(purchaseDateProblem("2026-01-02")).toBeNull()
      expect(purchaseDateProblem("2026-01-03")).toMatch(/future/)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("createUserPackage — purchase date", () => {
  const staffEvent = (body: Record<string, unknown>) =>
    fakeEvent({ sub: "sm-1", source_pool: "admin", groups: "studio-manager", body })

  beforeEach(() => {
    vi.mocked(userPackageService.createUserPackage).mockResolvedValue(fakeSubscription())
  })

  it("passes a valid purchase date through to the service", async () => {
    const res = await createUserPackage(
      staffEvent({ user_id: "client-1", package_id: 1, purchase_date: "2025-03-10" }),
    )
    expect((res as any).statusCode).toBe(201)
    expect(userPackageService.createUserPackage).toHaveBeenCalledWith(
      expect.objectContaining({ purchase_date: "2025-03-10" }),
    )
  })

  it("400s on an invalid purchase date without touching the database", async () => {
    vi.mocked(userPackageService.createUserPackage).mockClear()
    const res = await createUserPackage(
      staffEvent({ user_id: "client-1", package_id: 1, purchase_date: "2999-01-01" }),
    )
    expect((res as any).statusCode).toBe(400)
    expect(JSON.parse((res as any).body).code).toBe("INVALID_PURCHASE_DATE")
    expect(userPackageService.createUserPackage).not.toHaveBeenCalled()
  })

  it("still works without a purchase date (the service defaults it)", async () => {
    const res = await createUserPackage(staffEvent({ user_id: "client-1", package_id: 1 }))
    expect((res as any).statusCode).toBe(201)
  })
})
