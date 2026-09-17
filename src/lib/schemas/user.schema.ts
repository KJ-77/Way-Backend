import { z } from "zod"
import { toE164 } from "../phone"

// ── Phone validation: strict on CREATE, lenient on UPDATE ──
//
// These are deliberately two different schemas. Read this before merging them.
//
// Admin-created clients use their phone number as their Cognito USERNAME
// (lib/cognito.ts → createClientCognitoUser), and every later Cognito call —
// disable, delete, reset password, global sign-out — finds the user by passing
// `users.phone` back in as that username. Cognito usernames are immutable. So the
// stored phone string and the Cognito username must never drift apart.

// CREATE / SIGNUP — normalise to E.164 ("+96170123456").
//
// Safe here because the SAME normalised string goes to both Cognito and the DB in
// one request, so they start out identical. It also means staff can type a number
// the way Lebanese people actually write them ("70 123 456", "03/123456") — before
// this, Cognito rejected anything without a leading "+" and creation just failed.
//
// Bonus: UNIQUE(phone) now means "one client per number". Previously "03123456" and
// "+9613123456" were the same person stored twice and the constraint couldn't tell.
const strictPhoneSchema = z
  .string()
  .min(1)
  .transform((s, ctx) => {
    const normalised = toE164(s)
    if (!normalised) {
      ctx.addIssue({
        code: "custom",
        message:
          `"${s}" isn't a valid phone number. Enter a Lebanese mobile ` +
          "(e.g. 70 123 456 or +961 70 123 456).",
      })
      return z.NEVER
    }
    return normalised
  })

// UPDATE — whitespace-strip only. Byte-identical to the behaviour before E.164
// normalisation existed. Do NOT "upgrade" this to strictPhoneSchema.
//
// The admin edit form always resends the phone, even though the field is locked
// (it's the Cognito username). Normalising it here would silently turn an
// unrelated edit — say, changing a client's notes — into a phone "change":
//   • the handler compares the normalised value against the stored one, sees a
//     difference, and fires a Cognito attribute update it never used to fire;
//   • for a legacy row with no matching Cognito user, that call fails and the
//     whole edit fails with it — for a client who was editable yesterday;
//   • and toE164 is stricter than Cognito (it requires 7–15 digits), so a stored
//     number Cognito accepted but toE164 rejects would make the client impossible
//     to edit at all.
// Leaving update alone costs nothing: the messaging send path normalises at send
// time anyway (messageService.findOrCreateConversation).
const lenientPhoneSchema = z
  .string()
  .min(1)
  .transform((s) => s.replace(/\s+/g, ""))

export const CreateUserSchema = z.object({
  // Required — minimum for admin creation
  full_name: z.string().min(1),
  phone: strictPhoneSchema,
  referral_source: z.enum(["Referral", "SCM", "Walk-In"]),
  // Optional — can be filled in later
  email: z.string().email().optional(),
  gender: z.enum(["Male", "Female"]).optional(),
  dob: z.string().min(1).optional(),
  level: z.enum(["Beginner", "Mid", "Advanced"]).optional(),
  preferred_tutor: z.number().optional(),
  loyalty: z.enum(["Low", "Mid", "High"]).optional(),
  first_visit: z.string().min(1).optional(),
  notes: z.string().optional(),
})

// Every field optional, and phone swapped for the lenient version (see above).
export const UpdateUserSchema = CreateUserSchema.partial().extend({
  phone: lenientPhoneSchema.optional(),
})

/**
 * Validation for the public self-signup endpoint (POST /auth/signup).
 * Same required fields as admin-created users, plus the email + password Cognito needs.
 * Email is required because it's used as the Cognito username and is where the
 * verification code is delivered.
 *
 * Strict phone is safe here: self-signup users are looked up by EMAIL, and the
 * normalised phone goes to Cognito and the DB together in the same request.
 */
export const ClientSignUpSchema = z.object({
  full_name: z.string().min(1),
  phone: strictPhoneSchema,
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  referral_source: z.enum(["Referral", "SCM", "Walk-In"]),
})
