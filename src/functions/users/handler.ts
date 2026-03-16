import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { createResponse, parseBody, getPathParam, handleError } from "../../lib/response"
import type { CreateUserDto, UpdateUserDto } from "../../lib/types"
import * as userService from "../../services/userService"

export const getUsers = async (): Promise<APIGatewayProxyResultV2> => {
  try {
    const users = await userService.getAllUsers()
    return createResponse(200, users)
  } catch (err) {
    return handleError(err)
  }
}

export const getUser = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid user ID" })

    const user = await userService.getUserById(id)
    if (!user) return createResponse(404, { error: "User not found" })
    return createResponse(200, user)
  } catch (err) {
    return handleError(err)
  }
}

export const createUser = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const data = parseBody<CreateUserDto>(event.body)
    if (!data.full_name) return createResponse(400, { error: "full_name is required" })

    const user = await userService.createUser(data)
    return createResponse(201, user)
  } catch (err) {
    return handleError(err)
  }
}

export const updateUser = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid user ID" })

    const data = parseBody<UpdateUserDto>(event.body)
    const user = await userService.updateUser(id, data)
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
