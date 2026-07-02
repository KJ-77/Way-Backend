import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { createResponse } from "./response"

export interface AuthContext {
  sub: string
  email: string
  groups: string[]
  source_pool: string // "admin" | "client" — which Cognito pool issued the token
}

// HTTP API v2 Lambda authorizers with `enableSimpleResponses: true` expose their
// returned context object at event.requestContext.authorizer.lambda — not the
// `jwt.claims` path used by the built-in JWT authorizer.
export const getAuthContext = (event: APIGatewayProxyEventV2): AuthContext | null => {
  const ctx = (event.requestContext as any)?.authorizer?.lambda
  if (!ctx) return null

  // groups arrives as a comma-joined string from the authorizer (simpleResponse
  // context values must be strings). Split back into an array here.
  const groups = ctx.groups ? String(ctx.groups).split(",").filter(Boolean) : []

  return {
    sub: ctx.sub,
    email: ctx.email || "",
    groups,
    source_pool: ctx.source_pool,
  }
}

export const requireRole = (
  auth: AuthContext | null,
  ...allowedRoles: string[]
): APIGatewayProxyResultV2 | null => {
  if (!auth) {
    return createResponse(401, { error: "Unauthorized" })
  }
  const hasRole = auth.groups.some((g) => allowedRoles.includes(g))
  if (!hasRole) {
    return createResponse(403, { error: "Forbidden", message: "Insufficient permissions" })
  }
  return null // authorized
}

// Any-logged-in-user gate. Returns a 401 response object when the caller
// isn't authenticated, or null when they are. Mirror of requireRole's shape:
// caller checks the return, early-returns if non-null, otherwise proceeds.
//
// Use this on handlers where "just needs to be logged in" is the WHOLE check
// and the auth context isn't needed afterward (e.g. gated read endpoints that
// don't scope results per-user). For handlers that DO need auth after the
// check (auth.sub / auth.source_pool for ownership filtering), keep the
// inline `if (!auth) return 401` — TS won't narrow the local `auth` variable
// through this helper's return value.
export const requireAuth = (
  auth: AuthContext | null,
): APIGatewayProxyResultV2 | null => {
  if (!auth) {
    return createResponse(401, { error: "Unauthorized" })
  }
  return null // authenticated
}
