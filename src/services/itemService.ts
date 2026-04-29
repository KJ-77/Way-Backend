import { pool, executeQuery } from "../lib/db"
import type { ItemJoined, CreateItemDto, UpdateItemDto } from "../lib/types"

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
    [data.user_id, data.user_package_id, data.stage ?? "drying", data.section, data.description ?? null, data.clay_type ?? null],
  )
  return (await getItemById(rows[0].id))!
}

/**
 * Updates an item. When stage transitions trigger a weigh-in, this runs inside
 * a transaction to atomically set the weight on the item AND deduct it from
 * the linked subscription's remaining_weight.
 *
 * Weight deduction triggers:
 *  - stage → "waiting glaze"  requires mid_weight   (deducted from subscription)
 *  - stage → "ready"          requires final_weight  (deducted from subscription)
 */
export const updateItem = async (id: number, data: UpdateItemDto): Promise<ItemJoined | null> => {
  const fields = Object.keys(data) as (keyof UpdateItemDto)[]
  if (fields.length === 0) return getItemById(id)

  // Determine if this update needs weight deduction
  const needsMidWeight = data.stage === "waiting glaze"
  const needsFinalWeight = data.stage === "ready"

  if (needsMidWeight && !data.mid_weight) {
    throw Object.assign(
      new Error("mid_weight is required when advancing to 'waiting glaze'"),
      { statusCode: 400 },
    )
  }
  if (needsFinalWeight && !data.final_weight) {
    throw Object.assign(
      new Error("final_weight is required when advancing to 'ready'"),
      { statusCode: 400 },
    )
  }

  // If weight deduction is needed, use a transaction
  if ((needsMidWeight && data.mid_weight) || (needsFinalWeight && data.final_weight)) {
    return updateItemWithWeightDeduction(id, data, needsMidWeight ? "mid" : "final")
  }

  // Standard update — no weight involved
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
 * Transactional item update that also deducts weight from the linked subscription.
 * Validates that the subscription has enough remaining_weight before deducting.
 */
async function updateItemWithWeightDeduction(
  id: number,
  data: UpdateItemDto,
  weightType: "mid" | "final",
): Promise<ItemJoined | null> {
  const weight = weightType === "mid" ? data.mid_weight! : data.final_weight!
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

    // Check remaining weight on the subscription
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

    const { remaining_weight } = subResult.rows[0]
    if (remaining_weight < weight) {
      throw Object.assign(
        new Error(`Insufficient remaining weight. Available: ${remaining_weight} kg, requested: ${weight} kg`),
        { statusCode: 400 },
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

    // Deduct weight from subscription
    await client.query(
      `UPDATE user_packages SET remaining_weight = remaining_weight - $1 WHERE id = $2`,
      [weight, user_package_id],
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

export const deleteItem = async (id: number): Promise<boolean> => {
  const rows = await executeQuery("DELETE FROM items WHERE id = $1 RETURNING id", [id])
  return rows.length > 0
}
