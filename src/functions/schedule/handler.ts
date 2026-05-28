import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { createResponse, parseBody, getPathParam, getQueryParam, handleError } from "../../lib/response"
import { getAuthContext, requireRole } from "../../lib/auth"
import {
  CreateScheduleSlotSchema,
  UpdateScheduleSlotSchema,
  UpsertScheduleOverrideSchema,
  WeekStartSchema,
} from "../../lib/schemas/schedule.schema"
import { getBeirutWeekStart, isMonday } from "../../lib/time"
import * as scheduleService from "../../services/scheduleService"

// Only admins + studio managers can mutate the schedule (template or overrides).
// Reads are public — the customer-facing site at waybeirut.com calls them too.
const SCHEDULE_WRITE_ROLES = ["admin", "studio-manager"] as const

// ── GET /schedule?week=YYYY-MM-DD ──
// Returns active slots merged with the override (if any) for the requested
// week. Defaults to the current Beirut week when no param is given.
export const getSchedule = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const weekParam = getQueryParam(event, "week")
    let weekStart: string

    if (weekParam) {
      const parsed = WeekStartSchema.safeParse(weekParam)
      if (!parsed.success) return createResponse(400, { error: "Invalid week param", issues: parsed.error.issues })
      if (!isMonday(parsed.data)) return createResponse(400, { error: "week must be a Monday (Asia/Beirut)" })
      weekStart = parsed.data
    } else {
      weekStart = getBeirutWeekStart()
    }

    const slots = await scheduleService.getSlotsForWeek(weekStart)
    return createResponse(200, { week_start: weekStart, slots })
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

// Soft-delete — flips schedule.deleted_at. Override history is preserved.
export const deleteScheduleSlot = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requireRole(getAuthContext(event), ...SCHEDULE_WRITE_ROLES)
    if (denied) return denied

    const id = Number(getPathParam(event, "id"))
    if (!id) return createResponse(400, { error: "Invalid slot ID" })

    const deleted = await scheduleService.softDeleteSlot(id)
    if (!deleted) return createResponse(404, { error: "Schedule slot not found or already deleted" })
    return createResponse(200, { message: "Schedule slot deleted" })
  } catch (err) {
    return handleError(err)
  }
}

// ── PUT /schedule/:id/override ──
// Body: { week_start, is_fully_booked?, is_cancelled?, cancel_reason? }
// Service merges with existing row; if the result has both flags false, the
// row is deleted entirely (avoiding a meaningless override).
export const upsertScheduleOverride = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuthContext(event)
    const denied = requireRole(auth, ...SCHEDULE_WRITE_ROLES)
    if (denied) return denied

    const slotId = Number(getPathParam(event, "id"))
    if (!slotId) return createResponse(400, { error: "Invalid slot ID" })

    const raw = parseBody(event.body)
    const result = UpsertScheduleOverrideSchema.safeParse(raw)
    if (!result.success) return createResponse(400, { error: "Validation failed", issues: result.error.issues })
    if (!isMonday(result.data.week_start)) {
      return createResponse(400, { error: "week_start must be a Monday (Asia/Beirut)" })
    }

    // Verify the parent slot exists (soft-deleted slots are rejected — you
    // shouldn't be cancelling next week's session of a class that's retired).
    const parent = await scheduleService.getSlotById(slotId)
    if (!parent) return createResponse(404, { error: "Schedule slot not found" })
    if (parent.deleted_at) return createResponse(409, { error: "Cannot set override on a deleted slot" })

    const override = await scheduleService.upsertOverride(slotId, result.data, auth?.sub ?? null)
    // null = the merge resolved to "no exception," and the row was deleted.
    if (!override) return createResponse(200, { message: "Override cleared", override: null })
    return createResponse(200, override)
  } catch (err) {
    return handleError(err)
  }
}

// ── DELETE /schedule/:id/override?week=YYYY-MM-DD ──
// Explicit clear, used when the UI's "revert to normal" button is clicked.
export const deleteScheduleOverride = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requireRole(getAuthContext(event), ...SCHEDULE_WRITE_ROLES)
    if (denied) return denied

    const slotId = Number(getPathParam(event, "id"))
    if (!slotId) return createResponse(400, { error: "Invalid slot ID" })

    const weekParam = getQueryParam(event, "week")
    if (!weekParam) return createResponse(400, { error: "Missing week query param" })
    const parsed = WeekStartSchema.safeParse(weekParam)
    if (!parsed.success) return createResponse(400, { error: "Invalid week param", issues: parsed.error.issues })
    if (!isMonday(parsed.data)) return createResponse(400, { error: "week must be a Monday (Asia/Beirut)" })

    const deleted = await scheduleService.deleteOverride(slotId, parsed.data)
    if (!deleted) return createResponse(404, { error: "Override not found" })
    return createResponse(200, { message: "Override cleared" })
  } catch (err) {
    return handleError(err)
  }
}
