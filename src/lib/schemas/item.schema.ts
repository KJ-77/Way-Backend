import { z } from "zod"

const STAGES = ["drying", "bisque fired", "waiting glaze", "glaze fired", "ready", "picked up", "discarded"] as const
const SECTIONS = ["Studio", "PC"] as const

// clay_type is now an admin-managed dynamic list (see clay_types table + /clay-types API).
// Validated as a free-form string here; the UI restricts selection to the managed list.
// Section-aware item creation rules:
//  - Studio items must reference a user_package (subscription drives weight tracking)
//  - PC items (walk-in painting) skip the subscription model — user_package_id must be null
export const CreateItemSchema = z
  .object({
    user_id: z.string().min(1, "user_id is required"),
    user_package_id: z.number().int().positive().nullable(),
    stage: z.enum(STAGES).optional().default("drying"),
    section: z.enum(SECTIONS, { message: "section is required (Studio or PC)" }),
    description: z.string().nullable().optional(),
    clay_type: z.string().min(1).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.section === "Studio" && data.user_package_id === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["user_package_id"],
        message: "user_package_id is required for Studio items",
      })
    }
    if (data.section === "PC" && data.user_package_id !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["user_package_id"],
        message: "user_package_id must be null for PC items",
      })
    }
  })

// Section intentionally excluded — changing section after creation is not allowed
// because Studio and PC have different stage flows
export const UpdateItemSchema = z.object({
  stage: z.enum(STAGES).optional(),
  user_id: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  clay_type: z.string().min(1).nullable().optional(),
  glaze_type: z.string().min(1).nullable().optional(), // captured when advancing to "glaze fired" (Studio only)
  mid_weight: z.number().positive("mid_weight must be positive").optional(),
  final_weight: z.number().positive("final_weight must be positive").optional(),
})
