import { z } from "zod"

// True for dates that actually exist. The YYYY-MM-DD regex alone lets "2026-02-31"
// through; round-tripping through Date catches it (same check as purchaseDateProblem).
const isRealDate = (value: string): boolean => {
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

// PUT /user-packages/{id}. Same story as tutor.schema.ts: the handler used to hand
// the raw body to a service that builds its SET clause from the body's keys, so
// z.object()'s key-stripping doubles as the column whitelist.
//
// Only the four columns staff actually adjust are accepted. user_id, package_id and
// purchase_date are fixed once a subscription exists — re-pointing it at another
// client would silently drag that client's sessions and items along with it.
export const UpdateUserPackageSchema = z.object({
  remaining_sessions: z.number().int("remaining_sessions must be a whole number").optional(),
  // Allowed to go negative: that's the "client owes for extra clay" signal.
  remaining_weight: z.number().optional(),
  // Past dates are fine — "edit the expiry to a past date" is how staff retire a
  // subscription without deleting its history.
  expiry_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "expiry_date must be a date in YYYY-MM-DD format")
    .refine(isRealDate, "expiry_date isn't a real date")
    .optional(),
  notes: z.string().max(2000).nullable().optional(),
})
