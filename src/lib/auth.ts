import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { createResponse } from "./response"

export interface AuthContext {
  sub: string
  email: string
  groups: string[]
}

export const getAuthContext = (event: APIGatewayProxyEventV2): AuthContext | null => {
  const claims = (event.requestContext as any)?.authorizer?.jwt?.claims
  if (!claims) return null

  // cognito:groups can be a string, an array, or absent
  let groups: string[] = []
  const rawGroups = claims["cognito:groups"]
  if (rawGroups) {
    if (Array.isArray(rawGroups)) {
      groups = rawGroups
    } else if (typeof rawGroups === "string") {
      // Could be a single group or a stringified array like "[admin studio-manager]"
      const cleaned = rawGroups.replace(/[\[\]]/g, "").trim()
      groups = cleaned ? cleaned.split(/[\s,]+/) : []
    }
  }

  return {
    sub: claims.sub,
    email: claims.email || claims.username || "",
    groups,
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
