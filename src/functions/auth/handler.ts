import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { createResponse, parseBody, handleError } from "../../lib/response"
import { ClientSignUpSchema } from "../../lib/schemas/user.schema"
import { invokeLambda } from "../../lib/lambda"
import * as cognito from "../../lib/cognito"
import type { User } from "../../lib/types"

// Internal Lambda that performs DB writes inside the VPC
const DB_FUNCTION = process.env.USER_DB_FUNCTION!

/**
 * POST /auth/signup — public, unauthenticated.
 *
 * Self-service signup flow for studio clients:
 *   1. Validate input (Zod)
 *   2. Cognito.SignUp() against the client pool — user picks own password,
 *      Cognito emails a verification code, returns the new `sub`
 *   3. Invoke userDbOps Lambda to insert the user row keyed by `sub`
 *   4. On DB failure, AdminDeleteUser to rollback the Cognito user so we
 *      don't leave an orphan in the pool
 *
 * After this returns, the frontend should send the user to /auth/verify where
 * they enter the 6-digit code and the frontend calls Cognito.ConfirmSignUp()
 * directly (no backend needed for that step — it's a public unauth API too).
 */
export const signup = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const raw = parseBody(event.body)
    const result = ClientSignUpSchema.safeParse(raw)
    if (!result.success) {
      return createResponse(400, { error: "Validation failed", issues: result.error.issues })
    }

    const { full_name, phone, email, password, referral_source } = result.data

    // Step 1: Create user in Cognito (public SignUp — user picks password)
    const sub = await cognito.clientSignUp(email, password, full_name, phone)

    // Step 2: Insert into DB via VPC-bound Lambda
    try {
      const user = await invokeLambda<User>(DB_FUNCTION, {
        action: "insert",
        data: { id: sub, full_name, phone, email, referral_source },
      })
      return createResponse(201, {
        success: true,
        message: "Account created. Check your email for a verification code.",
        user,
      })
    } catch (dbErr) {
      // DB write failed — rollback Cognito to avoid an orphan account.
      // Username at SignUp was email, so we delete by email.
      try {
        await cognito.deleteClientCognitoUser(email)
      } catch (rollbackErr) {
        // Rollback failed too — surface enough info that we (admin) can clean up manually
        console.error("Critical: Cognito rollback failed after DB error", { email, dbErr, rollbackErr })
        return createResponse(500, {
          error: "critical_rollback_failed",
          message: `Account was created in Cognito but failed to save to the database, and rollback failed. Please contact support with email: ${email}`,
        })
      }
      return createResponse(500, {
        error: "db_insert_failed",
        message: "Failed to save user to database. Please try again.",
      })
    }
  } catch (err) {
    return handleError(err)
  }
}
