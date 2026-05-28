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

export const handleError = (err: unknown): APIGatewayProxyResultV2 => {
  const error = err as Error & { code?: string; constraint?: string; detail?: string }
  console.error(error)

  if (error.code === "23505") {
    // Surface a friendly message for known unique constraints — phone is the one the UI cares about
    if (error.constraint?.includes("phone")) {
      return createResponse(409, { error: "Duplicate phone", message: "This phone number is already registered to another client." })
    }
    if (error.constraint?.includes("email")) {
      return createResponse(409, { error: "Duplicate email", message: "This email is already in use." })
    }
    return createResponse(409, { error: "Duplicate entry", message: error.detail || error.message })
  }
  if (error.code === "23503") {
    return createResponse(400, { error: "Foreign key violation", message: error.message })
  }
  // Exclusion constraint violation — overlapping schedule slots
  if (error.code === "23P01") {
    return createResponse(409, { error: "Schedule conflict", message: "Another class is already scheduled during this time slot" })
  }

  // Cognito errors
  if (error.name === "UsernameExistsException") {
    return createResponse(409, { error: "User already exists in Cognito", message: error.message })
  }
  if (error.name === "UserNotFoundException") {
    return createResponse(404, { error: "User not found in Cognito", message: error.message })
  }

  return createResponse(500, { error: "Server error", message: error.message || String(err) })
}
