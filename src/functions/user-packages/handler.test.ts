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
