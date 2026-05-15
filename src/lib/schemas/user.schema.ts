import { z } from "zod"

export const CreateUserSchema = z.object({
  // Required — minimum for admin creation
  full_name: z.string().min(1),
  phone: z.string().min(1),
  referral_source: z.enum(["Referral", "SCM", "Walk-In"]),
  // Optional — can be filled in later
  email: z.string().email().optional(),
  gender: z.enum(["Male", "Female"]).optional(),
  dob: z.string().min(1).optional(),
  level: z.enum(["Beginner", "Mid", "Advanced"]).optional(),
  preferred_tutor: z.number().optional(),
  loyalty: z.enum(["Low", "Mid", "High"]).optional(),
  first_visit: z.string().min(1).optional(),
  status: z.enum(["Active", "Dormant"]).optional(),
  section: z.enum(["Studio", "PC"]).optional(),
  notes: z.string().optional(),
})

export const UpdateUserSchema = CreateUserSchema.partial()

/**
 * Validation for the public self-signup endpoint (POST /auth/signup).
 * Same required fields as admin-created users, plus the email + password Cognito needs.
 * Email is required because it's used as the Cognito username and is where the
 * verification code is delivered.
 */
export const ClientSignUpSchema = z.object({
  full_name: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  referral_source: z.enum(["Referral", "SCM", "Walk-In"]),
})
