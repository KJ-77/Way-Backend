import type { APIGatewayProxyResultV2, APIGatewayProxyEventV2 } from "aws-lambda"

export const createResponse = (statusCode: number, data: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify(data),
})

export const parseBody = <T = Record<string, unknown>>(body?: string | null): T => {
  if (!body) return {} as T
  try {
    return JSON.parse(body) as T
  } catch {
    throw new Error("Invalid JSON body")
  }
}

export const getPathParam = (event: APIGatewayProxyEventV2, key: string): string | null =>
  event.pathParameters?.[key] ?? null

export const getQueryParam = (event: APIGatewayProxyEventV2, key: string): string | null =>
  event.queryStringParameters?.[key] ?? null

// Centralized error → response mapper. Every API response carries a stable `code`
// (machine-readable) alongside the human-readable `message`. Frontends key off the
// `code` for translation; the raw error keeps going to CloudWatch via console.error.
//
// CODE TAXONOMY (keep in sync with Way-Admin/src/lib/errors.ts + Way-Client/src/lib/errors.js):
//   PHONE_TAKEN, EMAIL_TAKEN, DUPLICATE       — 409 unique-constraint violations
//   FK_VIOLATION                              — 400 foreign-key violations
//   SCHEDULE_CONFLICT                         — 409 overlapping schedule slots
//   USERNAME_EXISTS                           — 409 Cognito UsernameExistsException
//   USER_NOT_FOUND                            — 404 Cognito UserNotFoundException
//   INVALID_CREDENTIALS                       — 401 Cognito NotAuthorizedException
//   SERVER_ERROR                              — 500 unhandled fallthrough
export const handleError = (err: unknown): APIGatewayProxyResultV2 => {
  const error = err as Error & { code?: string; constraint?: string; detail?: string }
  console.error(error)

  if (error.code === "23505") {
    if (error.constraint?.includes("phone")) {
      return createResponse(409, {
        error: "Duplicate phone",
        code: "PHONE_TAKEN",
        message: "This phone number is already registered to another client.",
      })
    }
    if (error.constraint?.includes("email")) {
      return createResponse(409, {
        error: "Duplicate email",
        code: "EMAIL_TAKEN",
        message: "This email is already in use.",
      })
    }
    return createResponse(409, {
      error: "Duplicate entry",
      code: "DUPLICATE",
      message: error.detail || error.message,
    })
  }
  if (error.code === "23503") {
    return createResponse(400, {
      error: "Foreign key violation",
      code: "FK_VIOLATION",
      message: error.message,
    })
  }
  // Exclusion constraint violation — overlapping schedule slots
  if (error.code === "23P01") {
    return createResponse(409, {
      error: "Schedule conflict",
      code: "SCHEDULE_CONFLICT",
      message: "Another class is already scheduled during this time slot",
    })
  }

  // Cognito errors
  if (error.name === "UsernameExistsException") {
    return createResponse(409, {
      error: "User already exists in Cognito",
      code: "USERNAME_EXISTS",
      message: error.message,
    })
  }
  if (error.name === "UserNotFoundException") {
    return createResponse(404, {
      error: "User not found in Cognito",
      code: "USER_NOT_FOUND",
      message: error.message,
    })
  }
  if (error.name === "NotAuthorizedException") {
    return createResponse(401, {
      error: "Not authorized",
      code: "INVALID_CREDENTIALS",
      message: error.message,
    })
  }

  return createResponse(500, {
    error: "Server error",
    code: "SERVER_ERROR",
    message: error.message || String(err),
  })
}
