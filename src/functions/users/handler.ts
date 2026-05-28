import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { createResponse, parseBody, getPathParam, getQueryParam, handleError } from "../../lib/response"
import { getAuthContext, requireRole } from "../../lib/auth"
import { CreateUserSchema, UpdateUserSchema } from "../../lib/schemas/user.schema"
import { invokeLambda } from "../../lib/lambda"
import * as cognito from "../../lib/cognito"
import type { User } from "../../lib/types"

// DB Lambda function name — set via environment variable in serverless.yml
const DB_FUNCTION = process.env.USER_DB_FUNCTION!

// ── GET /users and GET /users/:id — lives INSIDE VPC (DB only) ──
// List filters out soft-deleted users by default. Pass ?include_deleted=true to see them all
// (used by the admin UI's "Show deleted" toggle). Single-user GET always returns the row
// regardless of is_active so the user-detail page can render a "Deleted" banner.
export const getUsers = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  // Dynamic import so DB deps only load when this VPC handler runs
  const userService = await import("../../services/userService")

  try {
    const id = getPathParam(event, "id")
    if (id) {
      const user = await userService.getUserById(id)
      if (!user) return createResponse(404, { message: "User not found" })
      return createResponse(200, user)
    }
    const includeDeleted = getQueryParam(event, "include_deleted") === "true"
    const users = await userService.getAllUsers({ includeDeleted })
    return createResponse(200, users)
  } catch (err) {
    return handleError(err)
  }
}

// ── POST /users — lives OUTSIDE VPC (Cognito + invokes DB Lambda) ──
export const createUser = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuthContext(event)
    const denied = requireRole(auth, "admin", "studio-manager")
    if (denied) return denied

    const raw = parseBody(event.body)
    const result = CreateUserSchema.safeParse(raw)
    if (!result.success) return createResponse(400, { error: "Validation failed", issues: result.error.issues })

    const data = result.data

    // Step 1: Create client in Cognito — returns sub + optional temp password
    const { sub, tempPassword } = await cognito.createClientCognitoUser(
      data.phone,
      data.full_name,
      data.email,
    )

    // Step 2: Insert into DB via VPC-bound Lambda
    try {
      const user = await invokeLambda<User>(DB_FUNCTION, {
        action: "insert",
        data: { id: sub, ...data },
      })
      return createResponse(201, { user, tempPassword })
    } catch (dbErr) {
      // DB failed — rollback Cognito user to avoid orphan
      try {
        const deleted = await cognito.deleteClientCognitoUser(data.phone, data.email)
        if (!deleted) {
          // User not found in Cognito — this shouldn't happen since we just created it, but log it
          console.warn(`Cognito user not found during rollback: phone=${data.phone}, email=${data.email}`)
        }
      } catch (rollbackErr) {
        // Rollback also failed — return explicit error so admin knows what to clean up
        return createResponse(500, {
          error: "critical_rollback_failed",
          message: `Cognito user created but DB insert AND rollback failed. Manually delete Cognito user for phone: ${data.phone} or email: ${data.email}`,
        })
      }
      return createResponse(500, {
        error: "db_insert_failed",
        message: "Failed to save user to database. Cognito user was rolled back. Please try again.",
      })
    }
  } catch (err) {
    return handleError(err)
  }
}

// ── PUT /users/:id — lives OUTSIDE VPC (Cognito + invokes DB Lambda) ──
export const updateUser = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuthContext(event)
    const denied = requireRole(auth, "admin", "studio-manager")
    if (denied) return denied

    const id = getPathParam(event, "id")
    if (!id) return createResponse(400, { error: "Invalid user ID" })

    const raw = parseBody(event.body)
    const result = UpdateUserSchema.safeParse(raw)
    if (!result.success) return createResponse(400, { error: "Validation failed", issues: result.error.issues })

    // Get existing user from DB Lambda (need phone for Cognito username)
    const existing = await invokeLambda<User | null>(DB_FUNCTION, {
      action: "getById",
      data: { id },
    })
    if (!existing) return createResponse(404, { error: "User not found" })

    // Sync changed attributes to Cognito (username = phone)
    const cognitoAttrs: { fullName?: string; phone?: string; email?: string } = {}
    if (result.data.full_name && result.data.full_name !== existing.full_name) cognitoAttrs.fullName = result.data.full_name
    if (result.data.phone && result.data.phone !== existing.phone) cognitoAttrs.phone = result.data.phone
    if (result.data.email && result.data.email !== existing.email) cognitoAttrs.email = result.data.email

    if (Object.keys(cognitoAttrs).length > 0) {
      await cognito.updateClientCognitoUserAttributes(existing.phone, existing.email, cognitoAttrs)
    }

    // Update DB via Lambda
    const updated = await invokeLambda<User | null>(DB_FUNCTION, {
      action: "update",
      data: { id, ...result.data },
    })

    return createResponse(200, updated)
  } catch (err) {
    return handleError(err)
  }
}

// ── DELETE /users/:id — soft-delete ──
// Flips is_active=false in the DB and disables the Cognito user so they can't log in.
// History (sessions, items, subscriptions) is preserved. Reversible via POST /users/:id/restore.
export const deleteUser = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuthContext(event)
    const denied = requireRole(auth, "admin", "studio-manager")
    if (denied) return denied

    const id = getPathParam(event, "id")
    if (!id) return createResponse(400, { error: "Invalid user ID" })

    // Get existing user (need phone for Cognito username)
    const existing = await invokeLambda<User | null>(DB_FUNCTION, {
      action: "getById",
      data: { id },
    })
    if (!existing) return createResponse(404, { error: "User not found" })

    // Disable the Cognito login. Tolerant of missing user (e.g. signup never completed)
    // so we still mark the DB row inactive even if the Cognito side is already gone.
    try {
      const disabled = await cognito.disableClientCognitoUser(existing.phone, existing.email)
      if (!disabled) {
        console.warn(`Cognito user not found while disabling: phone=${existing.phone}, email=${existing.email}`)
      }
    } catch (cognitoErr) {
      console.error(`Failed to disable Cognito user: ${cognitoErr instanceof Error ? cognitoErr.message : String(cognitoErr)}`)
    }

    // Flip is_active to false in the DB
    await invokeLambda(DB_FUNCTION, {
      action: "setActive",
      data: { id, is_active: false },
    })

    return createResponse(200, { message: "User soft-deleted" })
  } catch (err) {
    return handleError(err)
  }
}

// ── POST /users/:id/restore — undoes soft-delete ──
export const restoreUser = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuthContext(event)
    const denied = requireRole(auth, "admin", "studio-manager")
    if (denied) return denied

    const id = getPathParam(event, "id")
    if (!id) return createResponse(400, { error: "Invalid user ID" })

    const existing = await invokeLambda<User | null>(DB_FUNCTION, {
      action: "getById",
      data: { id },
    })
    if (!existing) return createResponse(404, { error: "User not found" })

    // Re-enable Cognito (tolerant — they may have been hard-deleted at some point)
    try {
      const enabled = await cognito.enableClientCognitoUser(existing.phone, existing.email)
      if (!enabled) {
        console.warn(`Cognito user not found while enabling: phone=${existing.phone}, email=${existing.email}`)
      }
    } catch (cognitoErr) {
      console.error(`Failed to enable Cognito user: ${cognitoErr instanceof Error ? cognitoErr.message : String(cognitoErr)}`)
    }

    const restored = await invokeLambda<User>(DB_FUNCTION, {
      action: "setActive",
      data: { id, is_active: true },
    })

    return createResponse(200, restored)
  } catch (err) {
    return handleError(err)
  }
}
