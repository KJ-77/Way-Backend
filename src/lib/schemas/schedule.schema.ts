import { z } from "zod"

// ── Template (recurring weekly slot) ──
// is_fully_booked moved off the template and onto schedule_overrides; cancel
// likewise lives only on the override. The template is pure recurrence shape.
export const CreateScheduleSlotSchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/), // HH:MM or HH:MM:SS
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  tutor_id: z.number().int().positive().nullable().optional(),
  package: z.string().min(1).nullable().optional(),       // class type enum — also the slot's display name
})

export const UpdateScheduleSlotSchema = CreateScheduleSlotSchema.partial()

// ── Override (per-week exception) ──
// All fields except week_start are optional so the API can express partial
// updates (e.g. "just update the cancel reason"). The service merges with the
// existing row and enforces the meaningful-row CHECK before writing.
// cancel_reason is nullable so admin can clear an existing reason explicitly.
export const UpsertScheduleOverrideSchema = z.object({
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: "week_start must be YYYY-MM-DD",
  }),
  is_fully_booked: z.boolean().optional(),
  is_cancelled: z.boolean().optional(),
  cancel_reason: z.string().nullable().optional(),
})

// Used by the GET /schedule?week=… query param parser. Same regex as above so
// the validation lives in one place.
export const WeekStartSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: "week must be YYYY-MM-DD",
})
