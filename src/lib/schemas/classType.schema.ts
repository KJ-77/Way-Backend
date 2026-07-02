import { z } from "zod"

// ── Create ──
// name is required; description + is_active are optional (is_active defaults
// to true in the DB, matching the migration's column default).
export const CreateClassTypeSchema = z.object({
  name: z.string().min(1, "name is required").max(255, "name must be <= 255 chars"),
  description: z.string().max(2000).nullable().optional(),
  is_active: z.boolean().optional(),
})

// ── Update ──
// Partial — admin might just flip is_active without touching name.
export const UpdateClassTypeSchema = CreateClassTypeSchema.partial()
