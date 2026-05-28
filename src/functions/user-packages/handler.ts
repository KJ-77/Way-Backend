import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { createResponse, parseBody, getPathParam, getQueryParam, handleError } from "../../lib/response"
import { getAuthContext, requireRole } from "../../lib/auth"
import type { CreateUserPackageDto, UpdateUserPackageDto, PackageStatus, UserPackageJoined } from "../../lib/types"
import * as userPackageService from "../../services/userPackageService"

// Admin/studio-manager can create, update, and (admin-only) delete subscriptions.
// Clients can READ their own subscriptions only — never mutate.
const SUBSCRIPTION_WRITE_ROLES = ["admin", "studio-manager"]
const SUBSCRIPTION_DELETE_ROLES = ["admin"]

// Derive status from row data instead of storing it in the DB.
// Status depends ONLY on sessions remaining + expiry date. Weight is allowed to go
// negative — it's a signal to staff that the client has used more clay than their
// subscription covered (and should be charged for the overage), not a depletion gate.
export function computeStatus(row: UserPackageJoined): PackageStatus {
  if (row.remaining_sessions <= 0) return "depleted"
  if (new Date(row.expiry_date) < new Date()) return "expired"
  return "active"
}

export const getUserPackages = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuthContext(event)
    if (!auth) return createResponse(401, { error: "Unauthorized" })

    // Clients can only see their own subscriptions — force the filter to auth.sub
    // regardless of any user_id query param they passed. Admin/studio-manager honors
    // the query param (or lists all when omitted).
    const userId = auth.source_pool === "client"
      ? auth.sub
      : getQueryParam(event, "user_id")

    const rows = userId
      ? await userPackageService.getUserPackagesByUserId(userId)
      : await userPackageService.getAllUserPackages()
    const result = rows.map((row) => ({ ...row, status: computeStatus(row) }))
    return createResponse(200, result)
  } catch (err) {
    return handleError(err)
  }
}

export const getUserPackage = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuthContext(event)
    if (!auth) return createResponse(401, { error: "Unauthorized" })

    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid subscription ID" })

    const row = await userPackageService.getUserPackageById(id)
    if (!row) return createResponse(404, { error: "Subscription not found" })

    // Ownership enforcement — clients can only view their own subscriptions
    if (auth.source_pool === "client" && row.user_id !== auth.sub) {
      return createResponse(403, { error: "Forbidden" })
    }

    return createResponse(200, { ...row, status: computeStatus(row) })
  } catch (err) {
    return handleError(err)
  }
}

export const createUserPackage = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requireRole(getAuthContext(event), ...SUBSCRIPTION_WRITE_ROLES)
    if (denied) return denied

    const data = parseBody<CreateUserPackageDto>(event.body)
    if (!data.user_id || !data.package_id) {
      return createResponse(400, { error: "user_id and package_id are required" })
    }

    const row = await userPackageService.createUserPackage(data)
    if (!row) return createResponse(404, { error: "Package not found" })
    return createResponse(201, { ...row, status: computeStatus(row) })
  } catch (err) {
    return handleError(err)
  }
}

export const updateUserPackage = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requireRole(getAuthContext(event), ...SUBSCRIPTION_WRITE_ROLES)
    if (denied) return denied

    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid subscription ID" })

    const data = parseBody<UpdateUserPackageDto>(event.body)
    const row = await userPackageService.updateUserPackage(id, data)
    if (!row) return createResponse(404, { error: "Subscription not found" })
    return createResponse(200, { ...row, status: computeStatus(row) })
  } catch (err) {
    return handleError(err)
  }
}

export const deleteUserPackage = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requireRole(getAuthContext(event), ...SUBSCRIPTION_DELETE_ROLES)
    if (denied) return denied

    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid subscription ID" })

    const deleted = await userPackageService.deleteUserPackage(id)
    if (!deleted) return createResponse(404, { error: "Subscription not found" })
    return createResponse(200, { message: "Subscription deleted" })
  } catch (err) {
    return handleError(err)
  }
}
