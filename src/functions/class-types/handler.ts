import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { createResponse, parseBody, getPathParam, handleError } from "../../lib/response"
import { getAuthContext, requireAuth, requireRole } from "../../lib/auth"
import {
  CreateClassTypeSchema,
  UpdateClassTypeSchema,
} from "../../lib/schemas/classType.schema"
import * as classTypeService from "../../services/classTypeService"

// Reads: any logged-in user. The Way-Client booking flow reads class_types to
// resolve display names + eligibility, and the Way-Admin package/slot forms
// need the list for their <Select> pickers (studio managers included).
// Writes: admin ONLY. Class types are load-bearing business config — every
// package and every schedule slot FKs into this table. A rename or a wrongly
// added row cascades everywhere, so mutation is kept off studio managers' hands.
const CLASS_TYPE_WRITE_ROLES = ["admin"] as const

// Bridge for service-layer businessError() throws (statusCode + code
// attached). Same pattern used in sessions/handler.ts.
function respondToServiceError(err: unknown): APIGatewayProxyResultV2 | null {
  const error = err as Error & { statusCode?: number; code?: string }
  if (!error.statusCode) return null
  const isOurCode = error.code && /^[A-Z_]+$/.test(error.code)
  return createResponse(error.statusCode, {
    error: error.message,
    ...(isOurCode ? { code: error.code, message: error.message } : {}),
  })
}

export const getClassTypes = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requireAuth(getAuthContext(event))
    if (denied) return denied

    const rows = await classTypeService.getAllClassTypes()
    return createResponse(200, rows)
  } catch (err) {
    return handleError(err)
  }
}

export const getClassType = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requireAuth(getAuthContext(event))
    if (denied) return denied

    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid class type ID" })

    const row = await classTypeService.getClassTypeById(id)
    if (!row) return createResponse(404, { error: "Class type not found" })
    return createResponse(200, row)
  } catch (err) {
    return handleError(err)
  }
}

export const createClassType = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requireRole(getAuthContext(event), ...CLASS_TYPE_WRITE_ROLES)
    if (denied) return denied

    const raw = parseBody(event.body)
    const result = CreateClassTypeSchema.safeParse(raw)
    if (!result.success) {
      return createResponse(400, { error: "Validation failed", issues: result.error.issues })
    }

    const created = await classTypeService.createClassType(result.data)
    return createResponse(201, created)
  } catch (err) {
    const mapped = respondToServiceError(err)
    if (mapped) return mapped
    return handleError(err)
  }
}

export const updateClassType = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requireRole(getAuthContext(event), ...CLASS_TYPE_WRITE_ROLES)
    if (denied) return denied

    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid class type ID" })

    const raw = parseBody(event.body)
    const result = UpdateClassTypeSchema.safeParse(raw)
    if (!result.success) {
      return createResponse(400, { error: "Validation failed", issues: result.error.issues })
    }

    const updated = await classTypeService.updateClassType(id, result.data)
    if (!updated) return createResponse(404, { error: "Class type not found" })
    return createResponse(200, updated)
  } catch (err) {
    const mapped = respondToServiceError(err)
    if (mapped) return mapped
    return handleError(err)
  }
}

export const deleteClassType = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requireRole(getAuthContext(event), ...CLASS_TYPE_WRITE_ROLES)
    if (denied) return denied

    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid class type ID" })

    const deleted = await classTypeService.deleteClassType(id)
    if (!deleted) return createResponse(404, { error: "Class type not found" })
    return createResponse(200, { message: "Class type deleted" })
  } catch (err) {
    const mapped = respondToServiceError(err)
    if (mapped) return mapped
    return handleError(err)
  }
}
