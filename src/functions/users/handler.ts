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

    // Step 1: Pre-check duplicates BEFORE touching Cognito. Both phone (required) and
    // email (optional) have UNIQUE constraints; rejecting here avoids the create-then-
    // rollback dance for the common duplicate case. Races still fall through to the
    // existing 23505 catch in handleError() as a safety net.
    const dupe = await invokeLambda<{ phone: boolean; email: boolean }>(DB_FUNCTION, {
      action: "checkUnique",
      data: { phone: data.phone, email: data.email },
    })
    if (dupe.phone) {
      return createResponse(409, {
        error: "Duplicate phone",
        code: "PHONE_TAKEN",
        message: "This phone number is already registered to another client.",
      })
    }
    if (dupe.email) {
      return createResponse(409, {
        error: "Duplicate email",
        code: "EMAIL_TAKEN",
        message: "This email is already in use by another client.",
      })
    }

    // Step 2: Create client in Cognito — returns sub + optional temp password
    const { sub, tempPassword } = await cognito.createClientCognitoUser(
      data.phone,
      data.full_name,
      data.email,
    )

    // Step 3: Insert into DB via VPC-bound Lambda
    try {
      const user = await invokeLambda<User>(DB_FUNCTION, {
        action: "insert",
        data: { id: sub, ...data },
      })
      return createResponse(201, { user, tempPassword })
    } catch (dbErr) {
      // DB failed — rollback Cognito user to avoid orphan. This path is now rare
      // (concurrent dupe-create race or transient DB error) but still essential.
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
          code: "ROLLBACK_FAILED",
          message: `Cognito user created but DB insert AND rollback failed. Manually delete Cognito user for phone: ${data.phone} or email: ${data.email}`,
        })
      }
      return createResponse(500, {
        error: "db_insert_failed",
        code: "DB_INSERT_FAILED",
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
// Flips is_active=false in the DB, disables the Cognito user so they can't log in,
// and revokes all refresh tokens so existing sessions can't keep refreshing.
// History (sessions, items, subscriptions) is preserved. Reversible via POST /users/:id/restore.
//
// Note on session revocation: this kills new logins + refresh tokens. Access tokens
// already issued remain valid until their natural expiry (~60 min). For tighter
// revocation we'd need an is_active check in the lambda authorizer (deferred — see CLAUDE.md).
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

    // Disable the Cognito login. Tolerant of "user already gone" (returns false),
    // but real failures (IAM, network, etc.) MUST surface — silently swallowing them
    // is how we ended up with "deactivated" users who could still log in.
    let disabled: boolean
    try {
      disabled = await cognito.disableClientCognitoUser(existing.phone, existing.email)
    } catch (cognitoErr) {
      const msg = cognitoErr instanceof Error ? cognitoErr.message : String(cognitoErr)
      console.error(`AdminDisableUser failed for user ${id} (phone=${existing.phone}): ${msg}`)
      return createResponse(500, {
        error: "cognito_disable_failed",
        code: "COGNITO_DISABLE_FAILED",
        message: `Couldn't disable Cognito login for this user. The user is NOT deactivated. Reason: ${msg}`,
      })
    }
    if (!disabled) {
      console.warn(`Cognito user not found while disabling: phone=${existing.phone}, email=${existing.email}`)
    }

    // Revoke refresh tokens so existing sessions can't extend themselves.
    // Best-effort: if this fails we still proceed with the soft-delete because
    // disable already blocks new logins. We just log the failure so it's visible.
    try {
      const signedOut = await cognito.globalSignOutClientCognitoUser(existing.phone, existing.email)
      if (!signedOut) {
        console.warn(`Cognito user not found during global sign-out: phone=${existing.phone}, email=${existing.email}`)
      }
    } catch (signOutErr) {
      const msg = signOutErr instanceof Error ? signOutErr.message : String(signOutErr)
      console.error(`AdminUserGlobalSignOut failed for user ${id} (phone=${existing.phone}): ${msg}`)
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

// ── POST /users/:id/reset-password — admin-initiated client password reset ──
// Generates a temporary password, sets it on the client's Cognito user with
// Permanent=false (forces FORCE_CHANGE_PASSWORD on next login), and revokes refresh
// tokens. Returns the temp password so the admin can read it out to the client.
// Allowed for admin + studio-manager — same auth surface as createUser/deleteUser.
export const resetUserPassword = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuthContext(event)
    const denied = requireRole(auth, "admin", "studio-manager")
    if (denied) return denied

    const id = getPathParam(event, "id")
    if (!id) return createResponse(400, { error: "Invalid user ID" })

    // Lookup the user — need the phone (Cognito username for admin-created users) and
    // optional email (fallback for self-signup users).
    const existing = await invokeLambda<User | null>(DB_FUNCTION, {
      action: "getById",
      data: { id },
    })
    if (!existing) return createResponse(404, { error: "User not found" })

    // Refuse to reset passwords on soft-deleted users — their Cognito login is disabled.
    // The admin should restore them first, otherwise the temp password is dead on arrival.
    if (!existing.is_active) {
      return createResponse(409, {
        error: "user_inactive",
        code: "USER_INACTIVE",
        message: "This client is deleted. Restore them before resetting their password.",
      })
    }

    let tempPassword: string
    try {
      tempPassword = await cognito.resetClientCognitoUserPassword(existing.phone, existing.email)
    } catch (cognitoErr) {
      const msg = cognitoErr instanceof Error ? cognitoErr.message : String(cognitoErr)
      console.error(`Password reset failed for user ${id} (phone=${existing.phone}): ${msg}`)
      return createResponse(500, {
        error: "cognito_reset_failed",
        code: "COGNITO_RESET_FAILED",
        message: `Couldn't reset the client's password. Reason: ${msg}`,
      })
    }

    return createResponse(200, {
      message: "Password has been reset. Share the temporary password with the client.",
      tempPassword,
    })
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
