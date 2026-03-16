import type { APIGatewayProxyResultV2 } from "aws-lambda"
import { createResponse } from "../../lib/response"

export const health = async (): Promise<APIGatewayProxyResultV2> =>
  createResponse(200, { status: "ok", timestamp: new Date().toISOString() })
