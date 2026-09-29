import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { createResponse, parseBody, getPathParam, getQueryParam, handleError } from "../../lib/response"
import { getAuthContext, requirePermission } from "../../lib/auth"
import type { CreateUserPackageDto, PackageStatus, UserPackageJoined } from "../../lib/types"
import { UpdateUserPackageSchema } from "../../lib/schemas/userPackage.schema"
import * as userPackageService from "../../services/userPackageService"
import { getBeirutToday } from "../../lib/time"

/**
 * Returns why a purchase date is unacceptable, or null if it's fine.
 *
 * "Not in the future" is judged against BEIRUT's today, not the server's. Lambda
 * runs in UTC, which is 2–3 hours behind Beirut — so between midnight and ~3am in
 * the studio, UTC is still on yesterday. Comparing against UTC would reject a
 * subscription bought "today" as being in the future.
 */
export const purchaseDateProblem = (value: unknown): string | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "purchase_date must be a date in YYYY-MM-DD format"
  }
  // Round-trip through Date to reject impossible dates like 2026-02-31, which the
  // regex alone lets through.
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return `${value} isn't a real date`
  }
  // Plain string comparison is safe: both sides are zero-padded YYYY-MM-DD.
  if (value > getBeirutToday()) {
    return "purchase_date can't be in the future"
  }
  return null
}

// Staff need subscriptions:create / update / delete (lib/permissions.ts) — admins
// and studio managers create and update, only admins delete, agents only view.
// Clients can READ their own subscriptions only — never mutate.

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
    const denied = requirePermission(getAuthContext(event), "subscriptions:create")
    if (denied) return denied

    const data = parseBody<CreateUserPackageDto>(event.body)
    if (!data.user_id || !data.package_id) {
      return createResponse(400, { error: "user_id and package_id are required" })
    }

    // Validate the purchase date if one was sent. Checked here rather than left to
    // Postgres so the failure is a clear 400, not an opaque cast error.
    if (data.purchase_date !== undefined) {
      const problem = purchaseDateProblem(data.purchase_date)
      if (problem) {
        return createResponse(400, {
          error: problem,
          code: "INVALID_PURCHASE_DATE",
          message: problem,
        })
      }
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
    const denied = requirePermission(getAuthContext(event), "subscriptions:update")
    if (denied) return denied

    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid subscription ID" })

    // The schema is also the column whitelist — the service turns the object's keys
    // into the SET clause, so only keys that survive parsing may reach it.
    const result = UpdateUserPackageSchema.safeParse(parseBody(event.body))
    if (!result.success) {
      return createResponse(400, {
        error: "Validation failed",
        code: "VALIDATION_FAILED",
        issues: result.error.issues,
      })
    }

    const row = await userPackageService.updateUserPackage(id, result.data)
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
    const denied = requirePermission(getAuthContext(event), "subscriptions:delete")
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
