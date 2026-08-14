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
 *   2. Pre-check phone/email against the DB's UNIQUE constraints
 *   3. Cognito.SignUp() against the client pool — user picks own password,
 *      Cognito emails a verification code, returns the new `sub`
 *   4. Invoke userDbOps Lambda to insert the user row keyed by `sub`
 *   5. On DB failure, AdminDeleteUser to rollback the Cognito user so we
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

    // Step 1: Pre-check duplicates BEFORE touching Cognito — same guard POST /users
    // uses. This matters more here than it looks:
    //
    // A duplicate EMAIL is caught by Cognito itself, because clientSignUp() passes
    // email as the Username — SignUp throws UsernameExistsException before anything
    // else happens, and handleError() turns that into a 409 USERNAME_EXISTS.
    //
    // A duplicate PHONE had no such guard. phone_number is only an attribute on this
    // pool and it's never verified (we verify email), so Cognito does NOT enforce
    // uniqueness on it: SignUp succeeded, the user got a verification email, and only
    // then did the INSERT hit UNIQUE(phone) — surfacing as an opaque 500 for what is
    // really a 409, after we'd already emailed them a code for an account that was
    // about to be rolled back.
    //
    // Checking here keeps the two duplicate cases symmetrical and, more importantly,
    // means we never send a verification code for a signup that can't succeed.
    const dupe = await invokeLambda<{ phone: boolean; email: boolean }>(DB_FUNCTION, {
      action: "checkUnique",
      data: { phone, email },
    })
    if (dupe.phone) {
      return createResponse(409, {
        error: "Duplicate phone",
        code: "PHONE_TAKEN",
        message: "This phone number is already registered to another account.",
      })
    }
    if (dupe.email) {
      return createResponse(409, {
        error: "Duplicate email",
        code: "EMAIL_TAKEN",
        message: "This email is already in use by another account.",
      })
    }

    // Step 2: Create user in Cognito (public SignUp — user picks password)
    const sub = await cognito.clientSignUp(email, password, full_name, phone)

    // Step 3: Insert into DB via VPC-bound Lambda
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
      //
      // Username at SignUp was email, so we delete by email. deleteClientCognitoUser's
      // FIRST parameter is `phone`, and passing email into it is deliberate, not a bug:
      // it makes email the username we try first. Do NOT "fix" this to
      // deleteClientCognitoUser(phone, email) — on a duplicate-phone race that would
      // try Username=phone first and delete the OTHER account's Cognito user (the
      // admin-created one that already owns the number), not the one we just made.
      try {
        await cognito.deleteClientCognitoUser(email)
      } catch (rollbackErr) {
        // Rollback failed too — surface enough info that we (admin) can clean up manually
        console.error("Critical: Cognito rollback failed after DB error", { email, dbErr, rollbackErr })
        return createResponse(500, {
          error: "critical_rollback_failed",
          code: "ROLLBACK_FAILED",
          message: `Account was created in Cognito but failed to save to the database, and rollback failed. Please contact support with email: ${email}`,
        })
      }

      // The Cognito user is gone, so it's safe to report the real cause. A constraint
      // violation this late means we lost a race against a concurrent signup between
      // the Step 1 pre-check and this INSERT — answer with the same 409 the pre-check
      // would have given rather than a 500 the client can't act on.
      const pgCode = (dbErr as { code?: string }).code
      if (pgCode === "23505" || pgCode === "23503") return handleError(dbErr)

      return createResponse(500, {
        error: "db_insert_failed",
        code: "DB_INSERT_FAILED",
        message: "Failed to save user to database. Please try again.",
      })
    }
  } catch (err) {
    return handleError(err)
  }
}
