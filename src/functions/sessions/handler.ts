import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { createResponse, parseBody, getPathParam, getQueryParam, handleError } from "../../lib/response"
import { getAuthContext, requireRole } from "../../lib/auth"
import { CreateSessionSchema, UpdateSessionSchema } from "../../lib/schemas/session.schema"
import * as sessionService from "../../services/sessionService"

// Service throws errors with statusCode + code attached (see businessError() in
// sessionService.ts). This maps them to an API response that carries both the
// HTTP status and the machine-readable code so the frontend can translate via
// friendlyError(). Falls through to handleError() for unrecognised errors.
function respondToServiceError(err: unknown): APIGatewayProxyResultV2 | null {
  const error = err as Error & { statusCode?: number; code?: string }
  if (!error.statusCode) return null
  // Numeric Postgres codes (e.g. "23505") shouldn't slip through — they belong
  // to handleError. Only forward our own SCREAMING_SNAKE_CASE codes.
  const isOurCode = error.code && /^[A-Z_]+$/.test(error.code)
  return createResponse(error.statusCode, {
    error: error.message,
    ...(isOurCode ? { code: error.code, message: error.message } : {}),
  })
}

// Admin/studio-manager can create + update sessions; admin alone can delete.
// Clients can READ their own sessions only — never mutate.
const SESSION_WRITE_ROLES = ["admin", "studio-manager"]
const SESSION_DELETE_ROLES = ["admin"]

export const getSessions = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuthContext(event)
    if (!auth) return createResponse(401, { error: "Unauthorized" })

    // Clients can only see their own sessions — force the filter to auth.sub
    // regardless of any user_id query param. Admin/studio-manager honors the
    // query param (or lists all when omitted).
    const userId = auth.source_pool === "client"
      ? auth.sub
      : getQueryParam(event, "user_id")

    const sessions = userId
      ? await sessionService.getSessionsByUserId(userId)
      : await sessionService.getAllSessions()
    return createResponse(200, sessions)
  } catch (err) {
    return handleError(err)
  }
}

export const getSession = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuthContext(event)
    if (!auth) return createResponse(401, { error: "Unauthorized" })

    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid session ID" })

    const session = await sessionService.getSessionById(id)
    if (!session) return createResponse(404, { error: "Session not found" })

    // Ownership enforcement — clients can only view their own sessions
    if (auth.source_pool === "client" && session.user_id !== auth.sub) {
      return createResponse(403, { error: "Forbidden" })
    }

    return createResponse(200, session)
  } catch (err) {
    return handleError(err)
  }
}

export const createSession = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requireRole(getAuthContext(event), ...SESSION_WRITE_ROLES)
    if (denied) return denied

    const raw = parseBody(event.body)
    const result = CreateSessionSchema.safeParse(raw)
    if (!result.success) {
      return createResponse(400, { error: "Validation failed", issues: result.error.issues })
    }

    const session = await sessionService.createSession(result.data)
    return createResponse(201, session)
  } catch (err) {
    const mapped = respondToServiceError(err)
    if (mapped) return mapped
    return handleError(err)
  }
}

export const updateSession = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requireRole(getAuthContext(event), ...SESSION_WRITE_ROLES)
    if (denied) return denied

    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid session ID" })

    const raw = parseBody(event.body)
    const result = UpdateSessionSchema.safeParse(raw)
    if (!result.success) {
      return createResponse(400, { error: "Validation failed", issues: result.error.issues })
    }

    const session = await sessionService.updateSession(id, result.data)
    if (!session) return createResponse(404, { error: "Session not found" })
    return createResponse(200, session)
  } catch (err) {
    const mapped = respondToServiceError(err)
    if (mapped) return mapped
    return handleError(err)
  }
}

export const deleteSession = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requireRole(getAuthContext(event), ...SESSION_DELETE_ROLES)
    if (denied) return denied

    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid session ID" })

    const deleted = await sessionService.deleteSession(id)
    if (!deleted) return createResponse(404, { error: "Session not found" })
    return createResponse(200, { message: "Session deleted" })
  } catch (err) {
    return handleError(err)
  }
}
