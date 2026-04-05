import { z } from "zod"

const STAGES = ["drying", "bisque fired", "waiting glaze", "glaze fired", "ready"] as const

export const CreateItemSchema = z.object({
  user_id: z.string().min(1, "user_id is required"),
  stage: z.enum(STAGES).optional().default("drying"),
})

export const UpdateItemSchema = z.object({
  stage: z.enum(STAGES).optional(),
  user_id: z.string().min(1).optional(),
})
