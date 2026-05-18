import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { createResponse, parseBody, getPathParam, handleError } from "../../lib/response"
import { getAuthContext, requireRole } from "../../lib/auth"
import { CreateScheduleSlotSchema, UpdateScheduleSlotSchema } from "../../lib/schemas/schedule.schema"
import * as scheduleService from "../../services/scheduleService"

// Only admins + studio managers can mutate the weekly schedule. Reads are public.
const SCHEDULE_WRITE_ROLES = ["admin", "studio-manager"] as const

export const getSchedule = async (): Promise<APIGatewayProxyResultV2> => {
  try {
    const slots = await scheduleService.getAllSlots()
    return createResponse(200, slots)
  } catch (err) {
    return handleError(err)
  }
}

export const getScheduleSlot = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid slot ID" })

    const slot = await scheduleService.getSlotById(id)
    if (!slot) return createResponse(404, { error: "Schedule slot not found" })
    return createResponse(200, slot)
  } catch (err) {
    return handleError(err)
  }
}

export const createScheduleSlot = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requireRole(getAuthContext(event), ...SCHEDULE_WRITE_ROLES)
    if (denied) return denied

    const raw = parseBody(event.body)
    const result = CreateScheduleSlotSchema.safeParse(raw)
    if (!result.success) return createResponse(400, { error: "Validation failed", issues: result.error.issues })

    const slot = await scheduleService.createSlot(result.data)
    return createResponse(201, slot)
  } catch (err) {
    return handleError(err)
  }
}

export const updateScheduleSlot = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requireRole(getAuthContext(event), ...SCHEDULE_WRITE_ROLES)
    if (denied) return denied

    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid slot ID" })

    const raw = parseBody(event.body)
    const result = UpdateScheduleSlotSchema.safeParse(raw)
    if (!result.success) return createResponse(400, { error: "Validation failed", issues: result.error.issues })

    const slot = await scheduleService.updateSlot(id, result.data)
    if (!slot) return createResponse(404, { error: "Schedule slot not found" })
    return createResponse(200, slot)
  } catch (err) {
    return handleError(err)
  }
}

export const deleteScheduleSlot = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requireRole(getAuthContext(event), ...SCHEDULE_WRITE_ROLES)
    if (denied) return denied

    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid slot ID" })

    const deleted = await scheduleService.deleteSlot(id)
    if (!deleted) return createResponse(404, { error: "Schedule slot not found" })
    return createResponse(200, { message: "Schedule slot deleted" })
  } catch (err) {
    return handleError(err)
  }
}
