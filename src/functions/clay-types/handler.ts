import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { z } from "zod"
import { createResponse, parseBody, getPathParam, handleError } from "../../lib/response"
import { getAuthContext, requireRole } from "../../lib/auth"
import * as clayTypeService from "../../services/clayTypeService"

// Reads are open to any authenticated user — the items create/edit dialog needs the list.
// Mutations are admin-only (clay-types schema affects every item; studio managers can't change it).
const CLAY_TYPE_WRITE_ROLES = ["admin"]

const ClayTypeNameSchema = z.object({
  name: z.string().min(1, "name is required").max(255, "name must be <= 255 chars"),
})

const RenameClayTypeSchema = z.object({
  name: z.string().min(1).max(255), // new name
})

export const getClayTypes = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuthContext(event)
    if (!auth) return createResponse(401, { error: "Unauthorized" })
    const types = await clayTypeService.getAllClayTypes()
    return createResponse(200, types)
  } catch (err) {
    return handleError(err)
  }
}

export const createClayType = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requireRole(getAuthContext(event), ...CLAY_TYPE_WRITE_ROLES)
    if (denied) return denied

    const raw = parseBody(event.body)
    const result = ClayTypeNameSchema.safeParse(raw)
    if (!result.success) return createResponse(400, { error: "Validation failed", issues: result.error.issues })

    const created = await clayTypeService.createClayType(result.data.name)
    if (!created) return createResponse(409, { error: "Clay type already exists" })
    return createResponse(201, created)
  } catch (err) {
    return handleError(err)
  }
}

// Rename: path param is the existing name, body has the new name.
// We re-point items.clay_type rows along the way so historical data stays accurate.
export const renameClayType = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requireRole(getAuthContext(event), ...CLAY_TYPE_WRITE_ROLES)
    if (denied) return denied

    const oldName = getPathParam(event, "name")
    if (!oldName) return createResponse(400, { error: "Clay type name is required in path" })
    const decodedOld = decodeURIComponent(oldName)

    const raw = parseBody(event.body)
    const result = RenameClayTypeSchema.safeParse(raw)
    if (!result.success) return createResponse(400, { error: "Validation failed", issues: result.error.issues })

    if (decodedOld === result.data.name) {
      return createResponse(400, { error: "New name must differ from existing name" })
    }

    const renamed = await clayTypeService.renameClayType(decodedOld, result.data.name)
    if (!renamed) return createResponse(404, { error: "Clay type not found" })
    return createResponse(200, renamed)
  } catch (err) {
    return handleError(err)
  }
}

export const deleteClayType = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requireRole(getAuthContext(event), ...CLAY_TYPE_WRITE_ROLES)
    if (denied) return denied

    const name = getPathParam(event, "name")
    if (!name) return createResponse(400, { error: "Clay type name is required in path" })

    const deleted = await clayTypeService.deleteClayType(decodeURIComponent(name))
    if (!deleted) return createResponse(404, { error: "Clay type not found" })
    return createResponse(200, { message: "Clay type deleted" })
  } catch (err) {
    return handleError(err)
  }
}
