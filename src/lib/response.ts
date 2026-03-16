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
  const error = err as Error & { code?: string }
  console.error(error)

  if (error.code === "23505") {
    return createResponse(409, { error: "Duplicate entry", message: error.message })
  }
  if (error.code === "23503") {
    return createResponse(400, { error: "Foreign key violation", message: error.message })
  }

  return createResponse(500, { error: "Server error", message: error.message || String(err) })
}
