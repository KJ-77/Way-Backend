import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { createResponse, parseBody, getPathParam, getQueryParam, handleError } from "../../lib/response"
import { getAuthContext, requireRole } from "../../lib/auth"
import type { CreateSessionDto, UpdateSessionDto } from "../../lib/types"
import * as sessionService from "../../services/sessionService"

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

    const data = parseBody<CreateSessionDto>(event.body)
    if (!data.user_id || !data.package_id) {
      return createResponse(400, { error: "user_id and package_id are required" })
    }

    const session = await sessionService.createSession(data)
    return createResponse(201, session)
  } catch (err) {
    // Service throws with a custom statusCode for business logic errors
    const error = err as Error & { statusCode?: number }
    if (error.statusCode) {
      return createResponse(error.statusCode, { error: error.message })
    }
    return handleError(err)
  }
}

export const updateSession = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requireRole(getAuthContext(event), ...SESSION_WRITE_ROLES)
    if (denied) return denied

    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid session ID" })

    const data = parseBody<UpdateSessionDto>(event.body)
    const session = await sessionService.updateSession(id, data)
    if (!session) return createResponse(404, { error: "Session not found" })
    return createResponse(200, session)
  } catch (err) {
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
