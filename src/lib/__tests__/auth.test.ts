// ============================================================================
// auth.test.ts — Tests for authentication & authorization helpers
//
// WHAT'S BEING TESTED:
// getAuthContext — extracts user identity from API Gateway JWT claims
// requireRole   — checks if the user has the required Cognito group
//
// WHY THESE?
// Auth logic is critical — a bug here means unauthorized access or locked-out
// users. These are still pure functions (object in, value out), but they deal
// with messy real-world input: claims can be missing, groups can be strings or
// arrays, etc. Testing edge cases like these is where tests really shine.
//
// NEW CONCEPT: Testing edge cases
// The happy path is obvious — it's the weird inputs (null, empty, wrong types)
// that cause production bugs. Good tests cover both.
// ============================================================================

import { describe, it, expect } from "vitest"
import { getAuthContext, requireRole } from "../auth"
import type { APIGatewayProxyEventV2 } from "aws-lambda"

// Helper to build a fake API Gateway event with JWT claims.
// We only fill in what our function actually reads — no need to mock
// the entire 50-field event object.
function fakeEvent(claims: Record<string, unknown> | null): APIGatewayProxyEventV2 {
  return {
    requestContext: {
      authorizer: claims ? { jwt: { claims } } : undefined,
    },
  } as unknown as APIGatewayProxyEventV2
}

// ── getAuthContext ──────────────────────────────────────────────────────────

describe("getAuthContext", () => {
  it("extracts sub, email, and groups from valid JWT claims", () => {
    const event = fakeEvent({
      sub: "abc-123",
      email: "khalil@test.com",
      "cognito:groups": ["admin"],
    })
    const auth = getAuthContext(event)

    expect(auth).not.toBeNull()
    expect(auth!.sub).toBe("abc-123")
    expect(auth!.email).toBe("khalil@test.com")
    expect(auth!.groups).toEqual(["admin"])
  })

  it("returns null when there are no claims (unauthenticated request)", () => {
    const event = fakeEvent(null)
    const auth = getAuthContext(event)
    expect(auth).toBeNull()
  })

  it("parses groups when Cognito sends them as a string", () => {
    // Cognito sometimes serializes groups as "[admin studio-manager]" instead of an array
    const event = fakeEvent({
      sub: "abc-123",
      email: "khalil@test.com",
      "cognito:groups": "[admin studio-manager]",
    })
    const auth = getAuthContext(event)

    expect(auth!.groups).toEqual(["admin", "studio-manager"])
  })

  it("handles missing groups gracefully (user with no Cognito groups)", () => {
    const event = fakeEvent({
      sub: "abc-123",
      email: "khalil@test.com",
      // no cognito:groups key at all
    })
    const auth = getAuthContext(event)

    expect(auth!.groups).toEqual([])
  })

  it("falls back to username when email is missing", () => {
    const event = fakeEvent({
      sub: "abc-123",
      username: "khalil",
      "cognito:groups": [],
    })
    const auth = getAuthContext(event)
    expect(auth!.email).toBe("khalil")
  })
})

// ── requireRole ─────────────────────────────────────────────────────────────

describe("requireRole", () => {
  it("returns null (= authorized) when user has a matching role", () => {
    const auth = { sub: "abc-123", email: "k@test.com", groups: ["admin"] }
    // requireRole returns null to mean "all good, proceed"
    const result = requireRole(auth, "admin", "studio-manager")
    expect(result).toBeNull()
  })

  it("returns 401 when auth context is null (no token)", () => {
    const result = requireRole(null, "admin")
    expect(result!.statusCode).toBe(401)
  })

  it("returns 403 when user lacks the required role", () => {
    const auth = { sub: "abc-123", email: "k@test.com", groups: ["studio-manager"] }
    // This user is a studio-manager but the endpoint requires admin
    const result = requireRole(auth, "admin")
    expect(result!.statusCode).toBe(403)
  })

  it("allows access when user has any one of multiple allowed roles", () => {
    const auth = { sub: "abc-123", email: "k@test.com", groups: ["studio-manager"] }
    // Endpoint allows both admin OR studio-manager
    const result = requireRole(auth, "admin", "studio-manager")
    expect(result).toBeNull()
  })
})
