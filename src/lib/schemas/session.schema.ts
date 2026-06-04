import { z } from "zod"

// ── Create ──
// schedule_slot_id + class_date are REQUIRED for new sessions. Legacy rows can
// have both NULL (allowed by the sessions_class_link_pair CHECK), but the API
// won't accept new rows without the class link. Validation of "is class_date
// the correct DOW for that slot?" and "is the class cancelled?" happens in the
// service layer (needs a DB lookup, can't be expressed in Zod).
export const CreateSessionSchema = z.object({
  user_package_id: z.number().int().positive(),
  schedule_slot_id: z.number().int().positive(),
  class_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: "class_date must be YYYY-MM-DD",
  }),
  attendance: z.enum(["attended", "booked", "cancelled", "cancelled - no charge"]),
  notes: z.string().optional(),
})

// ── Update ──
// Mutable fields: attendance (drives refund logic), notes, session_nb (manual
// admin correction). The class link (schedule_slot_id, class_date) is
// IMMUTABLE on update for the same reason user_package_id is — moving a
// session between occurrences would break audit trail and roster history.
export const UpdateSessionSchema = z.object({
  attendance: z.enum(["attended", "booked", "cancelled", "cancelled - no charge"]).optional(),
  notes: z.string().nullable().optional(),
  session_nb: z.number().int().positive().optional(),
})
