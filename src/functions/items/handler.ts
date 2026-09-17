import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { createResponse, parseBody, getPathParam, getQueryParam, handleError } from "../../lib/response"
import { getAuthContext, requireRole } from "../../lib/auth"
import { CreateItemSchema, UpdateItemSchema } from "../../lib/schemas/item.schema"
import * as itemService from "../../services/itemService"
import { onItemStageChanged } from "../../services/messageTriggers"

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
    //
    // `previousStage` / `isBackward` are hoisted out of the block because the
    // messaging trigger below needs them too — updateItem() has several return
    // paths (weight deduction, refund, un-discard…), so comparing here rather than
    // inside the service means one hook instead of five.
    let previousStage: string | null = null
    let isBackward = false

    if (result.data.stage) {
      const current = await itemService.getItemById(id)
      if (!current) return createResponse(404, { error: "Item not found" })
      previousStage = current.stage
      isBackward = itemService.isStageBackward(current.stage, result.data.stage)
      if (isBackward) {
        const rewindDenied = requireRole(auth, ...ITEM_REWIND_ROLES)
        if (rewindDenied) return rewindDenied
      }
    }

    const item = await itemService.updateItem(id, result.data)
    if (!item) return createResponse(404, { error: "Item not found" })

    // Draft a progress message if this stage has a template wired to it. Awaited so
    // Lambda doesn't freeze mid-query, but it cannot throw — a messaging failure
    // must never turn a successful stage update into an error response.
    if (previousStage && result.data.stage) {
      await onItemStageChanged({
        itemId: id,
        userId: item.user_id,
        userName: item.user_name,
        description: item.description ?? null,
        clayType: item.clay_type ?? null,
        previousStage,
        newStage: result.data.stage,
        isBackward,
      })
    }

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
