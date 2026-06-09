import { pool, executeQuery } from "../lib/db"
import type { ItemJoined, CreateItemDto, UpdateItemDto, ItemStage } from "../lib/types"

// JOIN users to include client name alongside item data
const BASE_SELECT = `
  SELECT i.*, u.full_name AS user_name
  FROM items i
  LEFT JOIN users u ON i.user_id = u.id
`

// Sorted by updated_at ASC so the oldest (most neglected) items appear first — FIFO queue
export const getAllItems = async (userId?: string): Promise<ItemJoined[]> => {
  if (userId) {
    return executeQuery<ItemJoined>(
      `${BASE_SELECT} WHERE i.user_id = $1 ORDER BY i.updated_at ASC`,
      [userId],
    )
  }
  return executeQuery<ItemJoined>(`${BASE_SELECT} ORDER BY i.updated_at ASC`)
}

export const getItemById = async (id: number): Promise<ItemJoined | null> => {
  const rows = await executeQuery<ItemJoined>(`${BASE_SELECT} WHERE i.id = $1`, [id])
  return rows[0] ?? null
}

export const createItem = async (data: CreateItemDto): Promise<ItemJoined> => {
  const rows = await executeQuery<{ id: number }>(
    `INSERT INTO items (user_id, user_package_id, stage, section, description, clay_type)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      data.user_id,
      data.user_package_id, // nullable — PC items send null, Studio items send a subscription id
      data.stage ?? "drying",
      data.section,
      data.description ?? null,
      data.clay_type ?? null,
    ],
  )
  return (await getItemById(rows[0].id))!
}

// Ordered ranking of stages used to detect forward vs. backward transitions.
// "discarded" is terminal and isn't part of the linear flow — we treat it
// specially in `isStageBackward` so it isn't ranked alongside the others.
const STAGE_ORDER: Record<Exclude<ItemStage, "discarded">, number> = {
  "drying": 0,
  "bisque fired": 1,
  "waiting glaze": 2,
  "glaze fired": 3,
  "ready": 4,
  "picked up": 5,
}

// Returns true if moving from `from` to `to` is a backward step in the progression.
// Discarded is a terminal sink — moving in or out of it is not "backward" by index;
// we conservatively treat any transition out of "discarded" as a rewind so the
// admin-only gate applies.
export function isStageBackward(from: ItemStage, to: ItemStage): boolean {
  if (from === to) return false
  if (from === "discarded") return true
  if (to === "discarded") return false
  return STAGE_ORDER[to] < STAGE_ORDER[from]
}

/**
 * Updates an item. Three flows depending on the requested change:
 *
 *  1. Forward to (or past) a weigh-in / glaze stage (Studio only):
 *       - Crossing "glaze fired" requires glaze_type    (no weight deduction)
 *       - Crossing "ready"       requires final_weight  → deduct from subscription
 *     A single update can cross both thresholds at once (e.g. waiting glaze → ready);
 *     final_weight deducts in the same transaction as the item update.
 *
 *  2. Backward rewind (Studio only, admin-gated at handler level):
 *       - If rewinding past "ready", refund final_weight to subscription + null on item
 *
 *  3. Standard update with no weight implications (PC items always land here).
 */
export const updateItem = async (id: number, data: UpdateItemDto): Promise<ItemJoined | null> => {
  const fields = Object.keys(data) as (keyof UpdateItemDto)[]
  if (fields.length === 0) return getItemById(id)

  // Fetch existing item so we can branch on section (PC skips all weight logic)
  // and detect forward-vs-backward stage transitions
  const existing = await getItemById(id)
  if (!existing) return null

  const isStudio = existing.section === "Studio"
  const stageChange = data.stage && data.stage !== existing.stage
  const goingForward = !!stageChange && !isStageBackward(existing.stage, data.stage as ItemStage)

  // Ranks for threshold-crossing math. "discarded" has no rank in the linear flow —
  // we never treat moves into/out of discarded as forward crossings (that's a rewind).
  const currentRank = existing.stage === "discarded"
    ? -1
    : STAGE_ORDER[existing.stage as Exclude<ItemStage, "discarded">]
  const newRank = !data.stage || data.stage === "discarded"
    ? currentRank
    : STAGE_ORDER[data.stage as Exclude<ItemStage, "discarded">]

  // ── Forward transition requirements (Studio only) ──
  // A forward update "crosses" a threshold when the old rank is below it and the
  // new rank is at or above it. Skipping multiple stages crosses multiple thresholds.
  const crosses = (threshold: Exclude<ItemStage, "discarded">) =>
    goingForward && currentRank < STAGE_ORDER[threshold] && newRank >= STAGE_ORDER[threshold]

  // Only require the input if it isn't already recorded on the item (e.g. an admin
  // who rewound and re-advanced — the weight was refunded but the column kept its value).
  const needsFinalWeight = isStudio && crosses("ready") && existing.final_weight == null
  const needsGlazeType = isStudio && crosses("glaze fired") && !existing.glaze_type

  if (needsFinalWeight && !data.final_weight) {
    throw Object.assign(
      new Error("final_weight is required when advancing past 'ready'"),
      { statusCode: 400 },
    )
  }
  if (needsGlazeType && !data.glaze_type) {
    throw Object.assign(
      new Error("glaze_type is required when advancing past 'glaze fired'"),
      { statusCode: 400 },
    )
  }

  // ── Backward transition: detect what (if anything) needs refunding (Studio only) ──
  const rewinding = stageChange && isStageBackward(existing.stage, data.stage as ItemStage)
  let refundFinal = 0
  if (rewinding && isStudio) {
    // Old stage was at/past the final weigh-in point and new stage is before it → refund
    if (existing.final_weight != null && currentRank >= STAGE_ORDER["ready"] && newRank < STAGE_ORDER["ready"]) {
      refundFinal = Number(existing.final_weight)
    }
  }

  // ── Pick execution path ──
  // Forward weight stage → transactional deduction
  if (needsFinalWeight && data.final_weight) {
    return updateItemWithWeightDeduction(id, data, data.final_weight)
  }
  // Backward rewind with refund obligation → transactional refund + clear item weight
  if (refundFinal > 0) {
    return updateItemWithWeightRefund(id, data, refundFinal, existing.user_package_id)
  }

  // Standard update — no weight involved (PC items always land here)
  const setClauses = fields.map((key, i) => `${key} = $${i + 2}`)
  setClauses.push("updated_at = NOW()")
  const values = fields.map((key) => data[key] ?? null)

  const rows = await executeQuery(
    `UPDATE items SET ${setClauses.join(", ")} WHERE id = $1 RETURNING id`,
    [id, ...values],
  )
  if (rows.length === 0) return null
  return getItemById(id)
}

/**
 * Transactional item update that also deducts final_weight from the linked
 * subscription. Weight is allowed to go negative — that signals to staff the
 * client owes for overage.
 */
async function updateItemWithWeightDeduction(
  id: number,
  data: UpdateItemDto,
  finalWeight: number,
): Promise<ItemJoined | null> {
  const client = await pool.connect()

  try {
    await client.query("BEGIN")

    // Fetch the item to get its linked subscription
    const itemResult = await client.query(
      "SELECT user_package_id FROM items WHERE id = $1",
      [id],
    )
    if (itemResult.rows.length === 0) {
      await client.query("ROLLBACK")
      return null
    }

    const { user_package_id } = itemResult.rows[0]
    if (!user_package_id) {
      throw Object.assign(
        new Error("Item has no linked subscription — cannot deduct weight"),
        { statusCode: 400 },
      )
    }

    // Lock the subscription row against concurrent deductions.
    const subResult = await client.query(
      "SELECT remaining_weight FROM user_packages WHERE id = $1 FOR UPDATE",
      [user_package_id],
    )
    if (subResult.rows.length === 0) {
      throw Object.assign(
        new Error("Linked subscription not found"),
        { statusCode: 404 },
      )
    }

    // Build dynamic SET clause for the item update
    const fields = Object.keys(data) as (keyof UpdateItemDto)[]
    const setClauses = fields.map((key, i) => `${key} = $${i + 2}`)
    setClauses.push("updated_at = NOW()")
    const values = fields.map((key) => data[key] ?? null)

    await client.query(
      `UPDATE items SET ${setClauses.join(", ")} WHERE id = $1`,
      [id, ...values],
    )

    await client.query(
      `UPDATE user_packages SET remaining_weight = remaining_weight - $1 WHERE id = $2`,
      [finalWeight, user_package_id],
    )

    await client.query("COMMIT")
    return getItemById(id)
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}

/**
 * Transactional rewind — refunds the previously-deducted final_weight to the
 * subscription and nulls the column on the item.
 *
 * Studio items only (PC items have no subscription / weight tracking).
 */
async function updateItemWithWeightRefund(
  id: number,
  data: UpdateItemDto,
  refundFinal: number,
  userPackageId: number | null,
): Promise<ItemJoined | null> {
  const client = await pool.connect()

  try {
    await client.query("BEGIN")

    // Merge the requested data with a null-out of final_weight so the item is
    // consistent with the new stage after the rewind.
    const merged: Record<string, unknown> = { ...data, final_weight: null }

    const fields = Object.keys(merged)
    const setClauses = fields.map((key, i) => `${key} = $${i + 2}`)
    setClauses.push("updated_at = NOW()")
    const values = fields.map((key) => merged[key] ?? null)

    await client.query(
      `UPDATE items SET ${setClauses.join(", ")} WHERE id = $1`,
      [id, ...values],
    )

    // Refund to the subscription (lock first for safety against concurrent deductions)
    if (refundFinal > 0 && userPackageId) {
      await client.query(
        "SELECT id FROM user_packages WHERE id = $1 FOR UPDATE",
        [userPackageId],
      )
      await client.query(
        "UPDATE user_packages SET remaining_weight = remaining_weight + $1 WHERE id = $2",
        [refundFinal, userPackageId],
      )
    }

    await client.query("COMMIT")
    return getItemById(id)
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}

export const deleteItem = async (id: number): Promise<boolean> => {
  const rows = await executeQuery("DELETE FROM items WHERE id = $1 RETURNING id", [id])
  return rows.length > 0
}
