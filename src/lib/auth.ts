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
