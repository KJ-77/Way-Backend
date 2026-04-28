import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { createResponse, parseBody, getPathParam, getQueryParam, handleError } from "../../lib/response"
import type { CreateUserPackageDto, UpdateUserPackageDto, PackageStatus, UserPackageJoined } from "../../lib/types"
import * as userPackageService from "../../services/userPackageService"

// Derive status from row data instead of storing it in the DB.
// Checks depleted first (sessions or weight exhausted), then expiry.
export function computeStatus(row: UserPackageJoined): PackageStatus {
  if (row.remaining_sessions <= 0) return "depleted"
  if (row.weight_included > 0 && row.remaining_weight <= 0) return "depleted"
  if (new Date(row.expiry_date) < new Date()) return "expired"
  return "active"
}

export const getUserPackages = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  try {
    const userId = getQueryParam(event, "user_id")
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
    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid subscription ID" })

    const row = await userPackageService.getUserPackageById(id)
    if (!row) return createResponse(404, { error: "Subscription not found" })
    return createResponse(200, { ...row, status: computeStatus(row) })
  } catch (err) {
    return handleError(err)
  }
}

export const createUserPackage = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  try {
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
    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid subscription ID" })

    const deleted = await userPackageService.deleteUserPackage(id)
    if (!deleted) return createResponse(404, { error: "Subscription not found" })
    return createResponse(200, { message: "Subscription deleted" })
  } catch (err) {
    return handleError(err)
  }
}
