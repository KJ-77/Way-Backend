import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { createResponse, parseBody, getPathParam, handleError } from "../../lib/response"
import { getAuthContext, requireRole } from "../../lib/auth"
import { CreateAccountSchema, UpdateAccountSchema } from "../../lib/schemas/account.schema"
import { invokeLambda } from "../../lib/lambda"
import * as cognito from "../../lib/cognito"
import type { Account } from "../../lib/types"

// DB Lambda function name — set via environment variable in serverless.yml
const DB_FUNCTION = process.env.ACCOUNT_DB_FUNCTION!

// ── GET /accounts and GET /accounts/:id — lives INSIDE VPC (DB only) ──
export const getAccounts = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  // This import is dynamic so it only loads DB deps when this handler runs (inside VPC)
  const { executeQuery } = await import("../../lib/db")

  try {
    const auth = getAuthContext(event)
    const denied = requireRole(auth, "admin")
    if (denied) return denied

    const id = getPathParam(event, "id")
    if (id) {
      const rows = await executeQuery<Account>("SELECT * FROM accounts WHERE id = $1", [id])
      if (rows.length === 0) return createResponse(404, { message: "Account not found" })
      return createResponse(200, rows[0])
    }
    const accounts = await executeQuery<Account>("SELECT * FROM accounts ORDER BY created_at DESC")
    return createResponse(200, accounts)
  } catch (err) {
    return handleError(err)
  }
}

// ── POST /accounts — lives OUTSIDE VPC (Cognito + invokes DB Lambda) ──
export const createAccount = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuthContext(event)
    const denied = requireRole(auth, "admin")
    if (denied) return denied

    const raw = parseBody(event.body)
    const result = CreateAccountSchema.safeParse(raw)
    if (!result.success) return createResponse(400, { error: "Validation failed", issues: result.error.issues })

    const data = result.data

    // Step 1: Create user in Cognito
    const cognitoSub = await cognito.createCognitoUser(data.email, data.full_name, data.phone)

    // Step 2: Add to Cognito group
    await cognito.addUserToGroup(data.email, data.role)

    // Step 3: Sync to DB via the VPC-bound DB Lambda
    try {
      const account = await invokeLambda<Account>(DB_FUNCTION, {
        action: "insert",
        data: { id: cognitoSub, email: data.email, full_name: data.full_name, phone: data.phone, role: data.role },
      })
      return createResponse(201, account)
    } catch (dbErr) {
      // Cognito succeeded but DB failed — return partial success with account info for retry
      return createResponse(207, {
        error: "db_sync_failed",
        message: "Account created in Cognito but failed to sync to database. Use 'Sync to DB' to retry.",
        account: {
          id: cognitoSub,
          email: data.email,
          full_name: data.full_name,
          phone: data.phone || null,
          role: data.role,
        },
      })
    }
  } catch (err) {
    return handleError(err)
  }
}

// ── PUT /accounts/:id — lives OUTSIDE VPC (Cognito + invokes DB Lambda) ──
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

    // Get current account from DB Lambda
    const existing = await invokeLambda<Account | null>(DB_FUNCTION, {
      action: "getById",
      data: { id },
    })
    if (!existing) return createResponse(404, { error: "Account not found" })

    // If role changed, update Cognito groups
    if (result.data.role && result.data.role !== existing.role) {
      await cognito.removeUserFromGroup(existing.email, existing.role)
      await cognito.addUserToGroup(existing.email, result.data.role)
    }

    // Update DB via Lambda
    const updated = await invokeLambda<Account | null>(DB_FUNCTION, {
      action: "update",
      data: { id, ...result.data },
    })

    return createResponse(200, updated)
  } catch (err) {
    return handleError(err)
  }
}

// ── DELETE /accounts/:id — lives OUTSIDE VPC (Cognito + invokes DB Lambda) ──
export const deleteAccount = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuthContext(event)
    const denied = requireRole(auth, "admin")
    if (denied) return denied

    const id = getPathParam(event, "id")
    if (!id) return createResponse(400, { error: "Invalid account ID" })

    // Get current account from DB Lambda (need email for Cognito)
    const existing = await invokeLambda<Account | null>(DB_FUNCTION, {
      action: "getById",
      data: { id },
    })
    if (!existing) return createResponse(404, { error: "Account not found" })

    // Delete from Cognito
    await cognito.deleteCognitoUser(existing.email)

    // Delete from DB
    await invokeLambda(DB_FUNCTION, {
      action: "delete",
      data: { id },
    })

    return createResponse(200, { message: "Account deleted" })
  } catch (err) {
    return handleError(err)
  }
}
