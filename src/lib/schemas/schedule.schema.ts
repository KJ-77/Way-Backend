import { z } from "zod"

export const CreateScheduleSlotSchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/), // HH:MM or HH:MM:SS
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  tutor_id: z.number().int().positive().nullable().optional(),
  package: z.string().min(1).nullable().optional(), // class type enum — also serves as the slot's display name
})

export const UpdateScheduleSlotSchema = CreateScheduleSlotSchema.partial()
