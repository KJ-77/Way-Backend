import { z } from "zod"

export const CreateUserSchema = z.object({
  full_name: z.string().min(1),
  gender: z.enum(["Male", "Female"]),
  dob: z.string().min(1),
  level: z.enum(["Beginner", "Mid", "Advanced"]),
  preferred_tutor: z.number().optional(),
  loyalty: z.enum(["Low", "Mid", "High"]),
  phone: z.string().min(1),
  email: z.string().email(),
  first_visit: z.string().min(1),
  referral_source: z.enum(["Referral", "SCM", "Walk-In"]),
  status: z.enum(["Active", "Dormant"]),
  section: z.enum(["Studio", "PC"]),
  notes: z.string().optional(),
})

export const UpdateUserSchema = CreateUserSchema.partial()
