import type { APIGatewayProxyResultV2 } from "aws-lambda"
import { createResponse, handleError } from "../../lib/response"
import { getDashboardData } from "../../services/dashboardService"

export const getDashboard = async (): Promise<APIGatewayProxyResultV2> => {
  try {
    const data = await getDashboardData()
    return createResponse(200, data)
  } catch (err) {
    return handleError(err)
  }
}
