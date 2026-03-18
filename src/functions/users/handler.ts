import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { createResponse, parseBody, getPathParam, handleError } from "../../lib/response"
import { CreateUserSchema, UpdateUserSchema } from "../../lib/schemas/user.schema"
import * as userService from "../../services/userService"

export const getUsers = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const id = Number(getPathParam(event, "id"));
    if (id) {
      const user = await userService.getUserById(id);
      if (!user) return createResponse(404, { message: "User not found" });
      return createResponse(200, user);
    }
    const users = await userService.getAllUsers();
    return createResponse(200, users);
  } catch (err) {
    return handleError(err);
  }
};

export const createUser = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const raw = parseBody(event.body)
    const result = CreateUserSchema.safeParse(raw)
    if (!result.success) return createResponse(400, { error: "Validation failed", issues: result.error.issues })

    const user = await userService.createUser(result.data)
    return createResponse(201, user)
  } catch (err) {
    return handleError(err)
  }
}

export const updateUser = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid user ID" })

    const raw = parseBody(event.body)
    const result = UpdateUserSchema.safeParse(raw)
    if (!result.success) return createResponse(400, { error: "Validation failed", issues: result.error.issues })

    const user = await userService.updateUser(id, result.data)
    if (!user) return createResponse(404, { error: "User not found" })
    return createResponse(200, user)
  } catch (err) {
    return handleError(err)
  }
}

export const deleteUser = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid user ID" })

    const deleted = await userService.deleteUser(id)
    if (!deleted) return createResponse(404, { error: "User not found" })
    return createResponse(200, { message: "User deleted" })
  } catch (err) {
    return handleError(err)
  }
}
