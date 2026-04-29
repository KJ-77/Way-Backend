import { z } from "zod"

const STAGES = ["drying", "bisque fired", "waiting glaze", "glaze fired", "ready", "discarded"] as const
const SECTIONS = ["Studio", "PC"] as const
const CLAY_TYPES = ["lf-clb-white", "lf-sio-brown", "hf-prai-white", "lf-pa-white"] as const

export const CreateItemSchema = z.object({
  user_id: z.string().min(1, "user_id is required"),
  user_package_id: z.number().int().positive("user_package_id is required"),
  stage: z.enum(STAGES).optional().default("drying"),
  section: z.enum(SECTIONS, { message: "section is required (Studio or PC)" }),
  description: z.string().nullable().optional(),
  clay_type: z.enum(CLAY_TYPES).nullable().optional(),
})

// Section intentionally excluded — changing section after creation is not allowed
// because Studio and PC have different stage flows
export const UpdateItemSchema = z.object({
  stage: z.enum(STAGES).optional(),
  user_id: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  clay_type: z.enum(CLAY_TYPES).nullable().optional(),
  mid_weight: z.number().positive("mid_weight must be positive").optional(),
  final_weight: z.number().positive("final_weight must be positive").optional(),
})
