import { z } from "zod"

// Tutors used to have no validation at all: the handler passed the raw body to a
// service that builds its UPDATE's SET clause from the body's KEYS. Values were
// parameterised, keys were not, so a crafted key was SQL. z.object() strips unknown
// keys, which makes these schemas the column whitelist as well as the validation.
//
// Deliberately no stricter than the admin form and the DB already are: email is a
// plain string because the form sends "" when it's left blank, and specialty isn't
// pinned to an enum so legacy values stay editable.
export const CreateTutorSchema = z.object({
  full_name: z.string().trim().min(1, "full_name is required").max(255),
  email: z.string().max(255).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  hourly_rate: z.number().nonnegative("hourly_rate can't be negative").nullable().optional(),
  specialty: z.string().max(64).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
})

// Partial — the admin resends the whole form, but a caller may send only what changed.
export const UpdateTutorSchema = CreateTutorSchema.partial()
