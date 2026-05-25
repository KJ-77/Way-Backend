import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { createResponse, parseBody, getPathParam, getQueryParam, handleError } from "../../lib/response"
import { getAuthContext, requireRole } from "../../lib/auth"
import { CreateItemSchema, UpdateItemSchema } from "../../lib/schemas/item.schema"
import * as itemService from "../../services/itemService"

// Admin/studio-manager can create + update items; admin alone can delete.
// Stage rewinds (moving the stage backward, which can trigger weight refunds)
// are also admin-only. Clients can READ their own items only — never mutate.
const ITEM_WRITE_ROLES = ["admin", "studio-manager"]
const ITEM_DELETE_ROLES = ["admin"]
const ITEM_REWIND_ROLES = ["admin"]

export const getItems = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuthContext(event)
    if (!auth) return createResponse(401, { error: "Unauthorized" })

    // Clients can only see their own items — force the filter to auth.sub
    // regardless of any user_id query param. Admin/studio-manager honors the
    // query param (or lists all when omitted).
    const userId = auth.source_pool === "client"
      ? auth.sub
      : getQueryParam(event, "user_id") || undefined

    const items = await itemService.getAllItems(userId)
    return createResponse(200, items)
  } catch (err) {
    return handleError(err)
  }
}

export const getItem = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuthContext(event)
    if (!auth) return createResponse(401, { error: "Unauthorized" })

    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid item ID" })

    const item = await itemService.getItemById(id)
    if (!item) return createResponse(404, { error: "Item not found" })

    // Ownership enforcement — clients can only view their own items
    if (auth.source_pool === "client" && item.user_id !== auth.sub) {
      return createResponse(403, { error: "Forbidden" })
    }

    return createResponse(200, item)
  } catch (err) {
    return handleError(err)
  }
}

export const createItem = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requireRole(getAuthContext(event), ...ITEM_WRITE_ROLES)
    if (denied) return denied

    const raw = parseBody(event.body)
    const result = CreateItemSchema.safeParse(raw)
    if (!result.success) return createResponse(400, { error: "Validation failed", issues: result.error.issues })

    const item = await itemService.createItem(result.data)
    return createResponse(201, item)
  } catch (err) {
    return handleError(err)
  }
}

export const updateItem = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuthContext(event)
    const denied = requireRole(auth, ...ITEM_WRITE_ROLES)
    if (denied) return denied

    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid item ID" })

    const raw = parseBody(event.body)
    const result = UpdateItemSchema.safeParse(raw)
    if (!result.success) return createResponse(400, { error: "Validation failed", issues: result.error.issues })

    // Gate stage rewinds to admins. We pre-fetch the current item to compare stages
    // without duplicating the comparison logic inside the service.
    if (result.data.stage) {
      const current = await itemService.getItemById(id)
      if (!current) return createResponse(404, { error: "Item not found" })
      if (itemService.isStageBackward(current.stage, result.data.stage)) {
        const rewindDenied = requireRole(auth, ...ITEM_REWIND_ROLES)
        if (rewindDenied) return rewindDenied
      }
    }

    const item = await itemService.updateItem(id, result.data)
    if (!item) return createResponse(404, { error: "Item not found" })
    return createResponse(200, item)
  } catch (err) {
    // Service throws with a custom statusCode for business logic errors (weight validation, etc.)
    const error = err as Error & { statusCode?: number }
    if (error.statusCode) {
      return createResponse(error.statusCode, { error: error.message })
    }
    return handleError(err)
  }
}

export const deleteItem = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requireRole(getAuthContext(event), ...ITEM_DELETE_ROLES)
    if (denied) return denied

    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid item ID" })

    const deleted = await itemService.deleteItem(id)
    if (!deleted) return createResponse(404, { error: "Item not found" })
    return createResponse(200, { message: "Item deleted" })
  } catch (err) {
    return handleError(err)
  }
}
