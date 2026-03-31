import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { createResponse, parseBody, getPathParam, getQueryParam, handleError } from "../../lib/response"
import type { CreateSessionDto, UpdateSessionDto } from "../../lib/types"
import * as sessionService from "../../services/sessionService"

export const getSessions = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const userId = getQueryParam(event, "user_id")

    if (userId) {
      const sessions = await sessionService.getSessionsByUserId(userId)
      return createResponse(200, sessions)
    }

    const sessions = await sessionService.getAllSessions()
    return createResponse(200, sessions)
  } catch (err) {
    return handleError(err)
  }
}

export const getSession = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid session ID" })

    const session = await sessionService.getSessionById(id)
    if (!session) return createResponse(404, { error: "Session not found" })
    return createResponse(200, session)
  } catch (err) {
    return handleError(err)
  }
}

export const createSession = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
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
    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid session ID" })

    const deleted = await sessionService.deleteSession(id)
    if (!deleted) return createResponse(404, { error: "Session not found" })
    return createResponse(200, { message: "Session deleted" })
  } catch (err) {
    return handleError(err)
  }
}
