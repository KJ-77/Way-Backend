import { z } from "zod"

// Template variables arrive as { "1": "Sara", "2": "mug" } — string keys because
// they map to Meta-style positional placeholders {{1}}, {{2}}. Kept as strings even
// on SMS so the same payload works unchanged if WhatsApp is switched on later.
const variablesSchema = z.record(z.string(), z.string())

const channelSchema = z.enum(["sms", "whatsapp", "whatsapp_manual"])

/**
 * Staff-composed message.
 *
 * Two mutually exclusive shapes:
 *   • `template_id` (+ optional variables) → a templated send
 *   • `body`                               → a free-form message
 *
 * The refinement enforces exactly one. Allowing both would be ambiguous — we'd have
 * to guess whether the caller wanted the template's wording or the supplied text,
 * and guessing wrong means the client receives the wrong message.
 */
export const CreateMessageSchema = z
  .object({
    user_id: z.string().min(1),
    channel: channelSchema.optional(),
    template_id: z.number().int().positive().optional(),
    variables: variablesSchema.optional(),
    body: z.string().min(1).max(1600).optional(),
  })
  .refine(d => (d.template_id === undefined) !== (d.body === undefined), {
    message: "Provide either template_id (for a templated message) or body (for a free-form one), not both.",
    path: ["template_id"],
  })

export const CreateBroadcastSchema = z.object({
  name: z.string().min(1).max(255),
  template_id: z.number().int().positive(),
  variables: variablesSchema.optional(),
  channel: channelSchema.optional(),
  // Snapshot of the audience filter. Free-form for now — the fan-out currently
  // targets all active, opted-in clients, and this records intent for later.
  audience: z.record(z.string(), z.unknown()).optional(),
})

/**
 * Editing a template's wording.
 *
 * This endpoint only exists because we're on SMS. On WhatsApp the body was locked
 * to whatever Meta approved, and changing it meant resubmitting for review. SMS
 * templates are just local text, so the studio can reword them freely and the
 * change is live immediately.
 *
 * `name` and `trigger_event` are deliberately NOT editable here: the trigger key is
 * what wires a template to an automatic event, and renaming it silently would
 * disconnect the trigger with no visible symptom.
 */
export const UpdateTemplateSchema = z
  .object({
    body: z.string().min(1).max(1600).optional(),
    variable_labels: z.array(z.string()).optional(),
    category: z.enum(["marketing", "utility", "authentication"]).optional(),
    is_active: z.boolean().optional(),
  })
  .refine(d => Object.keys(d).length > 0, { message: "No fields to update" })

/**
 * Human resolution of a send we couldn't confirm — staff report what really happened.
 *
 *   sent      It went out. Final.
 *   failed    An attempt was made and it didn't arrive. Can be re-queued later.
 *   not_sent  Nothing was sent at all — e.g. staff opened WhatsApp for a hand-sent
 *             message and then didn't press send. Goes straight back into the
 *             approval queue as if it had never been touched. Distinct from
 *             `failed`: there was no failed attempt to record.
 */
export const ResolveUnconfirmedSchema = z.object({
  resolution: z.enum(["sent", "failed", "not_sent"]),
})

export const MarketingOptOutSchema = z.object({
  opt_out: z.boolean(),
})
