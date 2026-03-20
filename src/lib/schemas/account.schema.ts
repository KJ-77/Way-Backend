import { z } from "zod"

export const CreateAccountSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(1),
  phone: z.string().optional(),
  role: z.enum(["admin", "studio-manager"]),
})

export const UpdateAccountSchema = z.object({
  full_name: z.string().min(1).optional(),
  phone: z.string().optional(),
  role: z.enum(["admin", "studio-manager"]).optional(),
})
