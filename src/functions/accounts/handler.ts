import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { createResponse, parseBody, getPathParam, handleError } from "../../lib/response"
import { getAuthContext, requireRole } from "../../lib/auth"
import { CreateAccountSchema, UpdateAccountSchema } from "../../lib/schemas/account.schema"
import * as accountService from "../../services/accountService"

export const getAccounts = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuthContext(event)
    const denied = requireRole(auth, "admin")
    if (denied) return denied

    const id = getPathParam(event, "id")
    if (id) {
      const account = await accountService.getAccountById(id)
      if (!account) return createResponse(404, { message: "Account not found" })
      return createResponse(200, account)
    }
    const accounts = await accountService.getAllAccounts()
    return createResponse(200, accounts)
  } catch (err) {
    return handleError(err)
  }
}

export const createAccount = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuthContext(event)
    const denied = requireRole(auth, "admin")
    if (denied) return denied

    const raw = parseBody(event.body)
    const result = CreateAccountSchema.safeParse(raw)
    if (!result.success) return createResponse(400, { error: "Validation failed", issues: result.error.issues })

    const account = await accountService.createAccount(result.data)
    return createResponse(201, account)
  } catch (err) {
    return handleError(err)
  }
}

export const updateAccount = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuthContext(event)
    const denied = requireRole(auth, "admin")
    if (denied) return denied

    const id = getPathParam(event, "id")
    if (!id) return createResponse(400, { error: "Invalid account ID" })

    const raw = parseBody(event.body)
    const result = UpdateAccountSchema.safeParse(raw)
    if (!result.success) return createResponse(400, { error: "Validation failed", issues: result.error.issues })

    const account = await accountService.updateAccount(id, result.data)
    if (!account) return createResponse(404, { error: "Account not found" })
    return createResponse(200, account)
  } catch (err) {
    return handleError(err)
  }
}

export const deleteAccount = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuthContext(event)
    const denied = requireRole(auth, "admin")
    if (denied) return denied

    const id = getPathParam(event, "id")
    if (!id) return createResponse(400, { error: "Invalid account ID" })

    const deleted = await accountService.deleteAccount(id)
    if (!deleted) return createResponse(404, { error: "Account not found" })
    return createResponse(200, { message: "Account deleted" })
  } catch (err) {
    return handleError(err)
  }
}
