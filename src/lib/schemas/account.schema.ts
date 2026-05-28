import { z } from "zod"

// Optional phone — when provided, strip whitespace so stored form matches Cognito and
// any UNIQUE constraint on the column actually catches duplicates.
const optionalPhone = z.string().optional().transform((s) => (s ? s.replace(/\s+/g, "") : s))

export const CreateAccountSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(1),
  phone: optionalPhone,
  role: z.enum(["admin", "studio-manager"]),
})

export const UpdateAccountSchema = z.object({
  full_name: z.string().min(1).optional(),
  phone: optionalPhone,
  role: z.enum(["admin", "studio-manager"]).optional(),
})
