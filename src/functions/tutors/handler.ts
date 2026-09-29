import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { createResponse, parseBody, getPathParam, handleError } from "../../lib/response"
import { getAuthContext, requirePermission } from "../../lib/auth"
import { CreateTutorSchema, UpdateTutorSchema } from "../../lib/schemas/tutor.schema"
import * as tutorService from "../../services/tutorService"

// Staff-only — reads included ("tutors:read", every staff role; writes per
// lib/permissions.ts). The authorizer accepts tokens from BOTH Cognito pools, and
// anyone can mint a client token through the public POST /auth/signup, so "has a
// valid token" is not "is staff". These routes used to check nothing: any client
// could create, edit and delete tutors, and read their phone numbers, emails and
// hourly rates. Way-Client never calls /tutors, so nothing loses access.

export const getTutors = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requirePermission(getAuthContext(event), "tutors:read")
    if (denied) return denied

    const tutors = await tutorService.getAllTutors()
    return createResponse(200, tutors)
  } catch (err) {
    return handleError(err)
  }
}

export const getTutor = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requirePermission(getAuthContext(event), "tutors:read")
    if (denied) return denied

    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid tutor ID" })

    const tutor = await tutorService.getTutorById(id)
    if (!tutor) return createResponse(404, { error: "Tutor not found" })
    return createResponse(200, tutor)
  } catch (err) {
    return handleError(err)
  }
}

export const createTutor = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requirePermission(getAuthContext(event), "tutors:create")
    if (denied) return denied

    const result = CreateTutorSchema.safeParse(parseBody(event.body))
    if (!result.success) {
      return createResponse(400, {
        error: "Validation failed",
        code: "VALIDATION_FAILED",
        issues: result.error.issues,
      })
    }

    const tutor = await tutorService.createTutor(result.data)
    return createResponse(201, tutor)
  } catch (err) {
    return handleError(err)
  }
}

export const updateTutor = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requirePermission(getAuthContext(event), "tutors:update")
    if (denied) return denied

    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid tutor ID" })

    // The schema is also the column whitelist — the service turns the object's keys
    // into the SET clause, so only keys that survive parsing may reach it.
    const result = UpdateTutorSchema.safeParse(parseBody(event.body))
    if (!result.success) {
      return createResponse(400, {
        error: "Validation failed",
        code: "VALIDATION_FAILED",
        issues: result.error.issues,
      })
    }

    const tutor = await tutorService.updateTutor(id, result.data)
    if (!tutor) return createResponse(404, { error: "Tutor not found" })
    return createResponse(200, tutor)
  } catch (err) {
    return handleError(err)
  }
}

export const deleteTutor = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requirePermission(getAuthContext(event), "tutors:delete")
    if (denied) return denied

    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid tutor ID" })

    const deleted = await tutorService.deleteTutor(id)
    if (!deleted) return createResponse(404, { error: "Tutor not found" })
    return createResponse(200, { message: "Tutor deleted" })
  } catch (err) {
    return handleError(err)
  }
}
