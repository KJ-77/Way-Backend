import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { createResponse, parseBody, getPathParam, handleError } from "../../lib/response"
import { getAuthContext, requireAuth, requireRole } from "../../lib/auth"
import { CreatePackageSchema, UpdatePackageSchema } from "../../lib/schemas/package.schema"
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

    // Also fills validity_days with the default (60) when it isn't sent.
    const result = CreatePackageSchema.safeParse(parseBody(event.body))
    if (!result.success) {
      return createResponse(400, {
        error: "Validation failed",
        code: "VALIDATION_FAILED",
        issues: result.error.issues,
      })
    }

    const pkg = await packageService.createPackage(result.data)
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

    // The schema is also the column whitelist — the service turns the object's keys
    // into the SET clause, so only keys that survive parsing may reach it.
    const result = UpdatePackageSchema.safeParse(parseBody(event.body))
    if (!result.success) {
      return createResponse(400, {
        error: "Validation failed",
        code: "VALIDATION_FAILED",
        issues: result.error.issues,
      })
    }

    const pkg = await packageService.updatePackage(id, result.data)
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
