import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { createResponse, parseBody, getPathParam, handleError } from "../../lib/response"
import { getAuthContext, requireAuth, requireRole } from "../../lib/auth"
import type { CreatePackageDto, UpdatePackageDto } from "../../lib/types"
import * as packageService from "../../services/packageService"

// All endpoints require a logged-in user (any role). Anonymous catalog browse
// is not offered — clients must sign in first. Mutations additionally require
// admin/studio-manager via requireRole.
const PACKAGE_WRITE_ROLES = ["admin", "studio-manager"] as const

export const getPackages = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requireAuth(getAuthContext(event))
    if (denied) return denied

    const packages = await packageService.getAllPackages()
    return createResponse(200, packages)
  } catch (err) {
    return handleError(err)
  }
}

export const getPackage = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requireAuth(getAuthContext(event))
    if (denied) return denied

    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid package ID" })

    const pkg = await packageService.getPackageById(id)
    if (!pkg) return createResponse(404, { error: "Package not found" })
    return createResponse(200, pkg)
  } catch (err) {
    return handleError(err)
  }
}

export const createPackage = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requireRole(getAuthContext(event), ...PACKAGE_WRITE_ROLES)
    if (denied) return denied

    const data = parseBody<CreatePackageDto>(event.body)
    if (!data.package_type) {
      return createResponse(400, { error: "package_type is required" })
    }
    if (!data.class_type_id || typeof data.class_type_id !== "number") {
      return createResponse(400, { error: "class_type_id is required" })
    }

    const pkg = await packageService.createPackage(data)
    return createResponse(201, pkg)
  } catch (err) {
    return handleError(err)
  }
}

export const updatePackage = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requireRole(getAuthContext(event), ...PACKAGE_WRITE_ROLES)
    if (denied) return denied

    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid package ID" })

    const data = parseBody<UpdatePackageDto>(event.body)
    const pkg = await packageService.updatePackage(id, data)
    if (!pkg) return createResponse(404, { error: "Package not found" })
    return createResponse(200, pkg)
  } catch (err) {
    return handleError(err)
  }
}

export const deletePackage = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requireRole(getAuthContext(event), ...PACKAGE_WRITE_ROLES)
    if (denied) return denied

    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid package ID" })

    const deleted = await packageService.deletePackage(id)
    if (!deleted) return createResponse(404, { error: "Package not found" })
    return createResponse(200, { message: "Package deleted" })
  } catch (err) {
    return handleError(err)
  }
}
