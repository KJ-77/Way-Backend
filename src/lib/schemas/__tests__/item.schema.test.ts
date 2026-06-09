import { describe, it, expect } from "vitest"
import { CreateItemSchema, UpdateItemSchema } from "../item.schema"

// ── Helper: base valid Studio item for create ──
const validCreateItem = {
  user_id: "abc-123",
  user_package_id: 1,
  section: "Studio" as const,
}

// ── Helper: base valid PC item for create (walk-in flow, no subscription) ──
const validPCCreateItem = {
  user_id: "abc-123",
  user_package_id: null,
  section: "PC" as const,
}

// ── CreateItemSchema ────────────────────────────────────────────────────────

describe("CreateItemSchema", () => {
  it("accepts valid input with only required fields", () => {
    const result = CreateItemSchema.safeParse(validCreateItem)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.stage).toBe("drying") // default
    }
  })

  it("accepts valid input with all optional fields", () => {
    const result = CreateItemSchema.safeParse({
      ...validCreateItem,
      stage: "bisque fired",
      description: "Small vase",
      clay_type: "lf-clb-white",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.stage).toBe("bisque fired")
      expect(result.data.description).toBe("Small vase")
      expect(result.data.clay_type).toBe("lf-clb-white")
    }
  })

  it("defaults stage to 'drying' when omitted", () => {
    const result = CreateItemSchema.safeParse(validCreateItem)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.stage).toBe("drying")
    }
  })

  it("rejects missing user_id", () => {
    const result = CreateItemSchema.safeParse({
      user_package_id: 1,
      section: "Studio",
    })
    expect(result.success).toBe(false)
  })

  it("rejects empty user_id", () => {
    const result = CreateItemSchema.safeParse({
      ...validCreateItem,
      user_id: "",
    })
    expect(result.success).toBe(false)
  })

  it("rejects missing user_package_id", () => {
    const result = CreateItemSchema.safeParse({
      user_id: "abc-123",
      section: "Studio",
    })
    expect(result.success).toBe(false)
  })

  it("rejects non-positive user_package_id", () => {
    const result = CreateItemSchema.safeParse({
      ...validCreateItem,
      user_package_id: 0,
    })
    expect(result.success).toBe(false)
  })

  it("rejects negative user_package_id", () => {
    const result = CreateItemSchema.safeParse({
      ...validCreateItem,
      user_package_id: -5,
    })
    expect(result.success).toBe(false)
  })

  it("rejects non-integer user_package_id", () => {
    const result = CreateItemSchema.safeParse({
      ...validCreateItem,
      user_package_id: 1.5,
    })
    expect(result.success).toBe(false)
  })

  it("rejects missing section", () => {
    const result = CreateItemSchema.safeParse({
      user_id: "abc-123",
      user_package_id: 1,
    })
    expect(result.success).toBe(false)
  })

  it("rejects invalid section value", () => {
    const result = CreateItemSchema.safeParse({
      ...validCreateItem,
      section: "Home",
    })
    expect(result.success).toBe(false)
  })

  it("rejects invalid stage value", () => {
    const result = CreateItemSchema.safeParse({
      ...validCreateItem,
      stage: "melting",
    })
    expect(result.success).toBe(false)
  })

  // clay_type is now an admin-managed catalog (see /clay-types) — schema accepts any non-empty string
  it("accepts any non-empty clay_type string (admin-managed catalog)", () => {
    const result = CreateItemSchema.safeParse({
      ...validCreateItem,
      clay_type: "terracotta",
    })
    expect(result.success).toBe(true)
  })

  it("rejects empty clay_type string", () => {
    const result = CreateItemSchema.safeParse({
      ...validCreateItem,
      clay_type: "",
    })
    expect(result.success).toBe(false)
  })

  it("accepts null description and clay_type", () => {
    const result = CreateItemSchema.safeParse({
      ...validCreateItem,
      description: null,
      clay_type: null,
    })
    expect(result.success).toBe(true)
  })

  // ── PC section rules (walk-in flow, no subscription) ──

  it("accepts valid PC item with null user_package_id", () => {
    const result = CreateItemSchema.safeParse(validPCCreateItem)
    expect(result.success).toBe(true)
  })

  it("accepts PC item with stage 'glaze fired' (walk-in starting stage)", () => {
    const result = CreateItemSchema.safeParse({
      ...validPCCreateItem,
      stage: "glaze fired",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.stage).toBe("glaze fired")
      expect(result.data.user_package_id).toBeNull()
    }
  })

  it("rejects PC item with non-null user_package_id", () => {
    const result = CreateItemSchema.safeParse({
      ...validPCCreateItem,
      user_package_id: 1,
    })
    expect(result.success).toBe(false)
  })

  it("rejects Studio item with null user_package_id", () => {
    const result = CreateItemSchema.safeParse({
      ...validCreateItem,
      user_package_id: null,
    })
    expect(result.success).toBe(false)
  })
})

// ── UpdateItemSchema ────────────────────────────────────────────────────────

describe("UpdateItemSchema", () => {
  it("accepts empty object (no-op update)", () => {
    const result = UpdateItemSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it("accepts valid stage update", () => {
    const result = UpdateItemSchema.safeParse({ stage: "waiting glaze" })
    expect(result.success).toBe(true)
  })

  it("rejects invalid stage", () => {
    const result = UpdateItemSchema.safeParse({ stage: "cooking" })
    expect(result.success).toBe(false)
  })

  // ── final_weight ──

  it("accepts valid positive final_weight", () => {
    const result = UpdateItemSchema.safeParse({ final_weight: 0.75 })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.final_weight).toBe(0.75)
    }
  })

  it("rejects final_weight of 0", () => {
    const result = UpdateItemSchema.safeParse({ final_weight: 0 })
    expect(result.success).toBe(false)
  })

  it("rejects negative final_weight", () => {
    const result = UpdateItemSchema.safeParse({ final_weight: -1 })
    expect(result.success).toBe(false)
  })

  // ── combined stage + weight (the real use case) ──

  it("accepts stage 'ready' with final_weight", () => {
    const result = UpdateItemSchema.safeParse({
      stage: "ready",
      final_weight: 1.2,
    })
    expect(result.success).toBe(true)
  })

  it("accepts all fields together", () => {
    const result = UpdateItemSchema.safeParse({
      stage: "ready",
      description: "Updated vase",
      clay_type: "hf-prai-white",
      final_weight: 0.5,
    })
    expect(result.success).toBe(true)
  })

  // ── glaze_type (captured when advancing into "glaze fired") ──

  it("accepts glaze_type string", () => {
    const result = UpdateItemSchema.safeParse({
      stage: "glaze fired",
      glaze_type: "Matte black",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.glaze_type).toBe("Matte black")
    }
  })

  it("accepts null glaze_type", () => {
    const result = UpdateItemSchema.safeParse({ glaze_type: null })
    expect(result.success).toBe(true)
  })

  it("rejects empty glaze_type string", () => {
    const result = UpdateItemSchema.safeParse({ glaze_type: "" })
    expect(result.success).toBe(false)
  })

  // ── "picked up" stage ──

  it("accepts stage 'picked up'", () => {
    const result = UpdateItemSchema.safeParse({ stage: "picked up" })
    expect(result.success).toBe(true)
  })
})
