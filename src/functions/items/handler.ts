import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { createResponse, parseBody, getPathParam, getQueryParam, handleError } from "../../lib/response"
import { CreateItemSchema, UpdateItemSchema } from "../../lib/schemas/item.schema"
import * as itemService from "../../services/itemService"

export const getItems = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    // Optional filter: GET /items?user_id=xxx
    const userId = getQueryParam(event, "user_id")
    const items = await itemService.getAllItems(userId || undefined)
    return createResponse(200, items)
  } catch (err) {
    return handleError(err)
  }
}

export const getItem = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid item ID" })

    const item = await itemService.getItemById(id)
    if (!item) return createResponse(404, { error: "Item not found" })
    return createResponse(200, item)
  } catch (err) {
    return handleError(err)
  }
}

export const createItem = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
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
    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid item ID" })

    const raw = parseBody(event.body)
    const result = UpdateItemSchema.safeParse(raw)
    if (!result.success) return createResponse(400, { error: "Validation failed", issues: result.error.issues })

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
    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid item ID" })

    const deleted = await itemService.deleteItem(id)
    if (!deleted) return createResponse(404, { error: "Item not found" })
    return createResponse(200, { message: "Item deleted" })
  } catch (err) {
    return handleError(err)
  }
}
