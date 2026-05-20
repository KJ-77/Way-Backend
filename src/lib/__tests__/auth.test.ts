// ============================================================================
// auth.test.ts — Tests for authentication & authorization helpers
//
// WHAT'S BEING TESTED:
// getAuthContext — extracts user identity from the Lambda authorizer context
// requireRole   — checks if the user has the required Cognito group
//
// WHY THESE?
// Auth logic is critical — a bug here means unauthorized access or locked-out
// users. These are still pure functions (object in, value out), but they deal
// with messy real-world input: context can be missing, groups can be empty
// strings, source_pool can be either admin or client, etc.
//
// CONTEXT SHAPE
// We migrated from API Gateway's built-in JWT authorizer (which exposed
// `event.requestContext.authorizer.jwt.claims`) to a custom Lambda authorizer
// with `enableSimpleResponses: true`, which exposes context at
// `event.requestContext.authorizer.lambda`. The authorizer always serializes
// `groups` as a comma-joined string because simpleResponse context values
// must be strings.
// ============================================================================

import { describe, it, expect } from "vitest"
import { getAuthContext, requireRole } from "../auth"
import type { APIGatewayProxyEventV2 } from "aws-lambda"

// Helper to build a fake API Gateway event with Lambda authorizer context.
// Mirrors what `src/functions/authorizer/handler.ts` returns in `context`.
function fakeEvent(
  ctx: { sub?: string; email?: string; groups?: string; source_pool?: string } | null
): APIGatewayProxyEventV2 {
  return {
    requestContext: {
      authorizer: ctx ? { lambda: ctx } : undefined,
    },
  } as unknown as APIGatewayProxyEventV2
}

// ── getAuthContext ──────────────────────────────────────────────────────────

describe("getAuthContext", () => {
  it("extracts sub, email, groups, and source_pool from valid context", () => {
    const event = fakeEvent({
      sub: "abc-123",
      email: "khalil@test.com",
      groups: "admin",
      source_pool: "admin",
    })
    const auth = getAuthContext(event)

    expect(auth).not.toBeNull()
    expect(auth!.sub).toBe("abc-123")
    expect(auth!.email).toBe("khalil@test.com")
    expect(auth!.groups).toEqual(["admin"])
    expect(auth!.source_pool).toBe("admin")
  })

  it("returns null when there is no authorizer context (unauthenticated request)", () => {
    const event = fakeEvent(null)
    const auth = getAuthContext(event)
    expect(auth).toBeNull()
  })

  it("splits comma-joined groups string into an array", () => {
    // Authorizer joins multiple groups with commas
    const event = fakeEvent({
      sub: "abc-123",
      email: "khalil@test.com",
      groups: "admin,studio-manager",
      source_pool: "admin",
    })
    const auth = getAuthContext(event)

    expect(auth!.groups).toEqual(["admin", "studio-manager"])
  })

  it("handles empty groups string (user with no Cognito groups)", () => {
    const event = fakeEvent({
      sub: "abc-123",
      email: "khalil@test.com",
      groups: "",
      source_pool: "client",
    })
    const auth = getAuthContext(event)

    expect(auth!.groups).toEqual([])
  })

  it("falls back to empty string when email is missing", () => {
    // If neither email nor cognito:username were present on the token, the
    // authorizer sets email to "" — getAuthContext should preserve that.
    const event = fakeEvent({
      sub: "abc-123",
      email: "",
      groups: "",
      source_pool: "client",
    })
    const auth = getAuthContext(event)
    expect(auth!.email).toBe("")
  })

  it("exposes source_pool=client for client-pool tokens", () => {
    const event = fakeEvent({
      sub: "client-user-1",
      email: "buyer@example.com",
      groups: "",
      source_pool: "client",
    })
    const auth = getAuthContext(event)
    expect(auth!.source_pool).toBe("client")
  })
})

// ── requireRole ─────────────────────────────────────────────────────────────

describe("requireRole", () => {
  it("returns null (= authorized) when user has a matching role", () => {
    const auth = { sub: "abc-123", email: "k@test.com", groups: ["admin"], source_pool: "admin" }
    // requireRole returns null to mean "all good, proceed"
    const result = requireRole(auth, "admin", "studio-manager")
    expect(result).toBeNull()
  })

  it("returns 401 when auth context is null (no token)", () => {
    const result = requireRole(null, "admin")
    expect(result!.statusCode).toBe(401)
  })

  it("returns 403 when user lacks the required role", () => {
    const auth = { sub: "abc-123", email: "k@test.com", groups: ["studio-manager"], source_pool: "admin" }
    // This user is a studio-manager but the endpoint requires admin
    const result = requireRole(auth, "admin")
    expect(result!.statusCode).toBe(403)
  })

  it("allows access when user has any one of multiple allowed roles", () => {
    const auth = { sub: "abc-123", email: "k@test.com", groups: ["studio-manager"], source_pool: "admin" }
    // Endpoint allows both admin OR studio-manager
    const result = requireRole(auth, "admin", "studio-manager")
    expect(result).toBeNull()
  })
})
