import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { createResponse, parseBody, getPathParam, handleError } from "../../lib/response"
import type { CreateTutorDto, UpdateTutorDto } from "../../lib/types"
import * as tutorService from "../../services/tutorService"

export const getTutors = async (): Promise<APIGatewayProxyResultV2> => {
  try {
    const tutors = await tutorService.getAllTutors()
    return createResponse(200, tutors)
  } catch (err) {
    return handleError(err)
  }
}

export const getTutor = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid tutor ID" })

    const tutor = await tutorService.getTutorById(id)
    if (!tutor) return createResponse(404, { error: "Tutor not found" })
    return createResponse(200, tutor)
  } catch (err) {
    return handleError(err)
  }
}

export const createTutor = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const data = parseBody<CreateTutorDto>(event.body)
    if (!data.full_name) return createResponse(400, { error: "full_name is required" })

    const tutor = await tutorService.createTutor(data)
    return createResponse(201, tutor)
  } catch (err) {
    return handleError(err)
  }
}

export const updateTutor = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid tutor ID" })

    const data = parseBody<UpdateTutorDto>(event.body)
    const tutor = await tutorService.updateTutor(id, data)
    if (!tutor) return createResponse(404, { error: "Tutor not found" })
    return createResponse(200, tutor)
  } catch (err) {
    return handleError(err)
  }
}

export const deleteTutor = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid tutor ID" })

    const deleted = await tutorService.deleteTutor(id)
    if (!deleted) return createResponse(404, { error: "Tutor not found" })
    return createResponse(200, { message: "Tutor deleted" })
  } catch (err) {
    return handleError(err)
  }
}
