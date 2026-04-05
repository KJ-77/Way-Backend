import { executeQuery } from "../lib/db"
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
    `INSERT INTO items (user_id, stage) VALUES ($1, $2) RETURNING id`,
    [data.user_id, data.stage ?? "drying"],
  )
  return (await getItemById(rows[0].id))!
}

export const updateItem = async (id: number, data: UpdateItemDto): Promise<ItemJoined | null> => {
  const fields = Object.keys(data)
  if (fields.length === 0) return getItemById(id)

  // Dynamic SET clause + always bump updated_at
  const setClauses = fields.map((key, i) => `${key} = $${i + 2}`)
  setClauses.push("updated_at = NOW()")
  const values = fields.map((key) => data[key as keyof UpdateItemDto] ?? null)

  const rows = await executeQuery(
    `UPDATE items SET ${setClauses.join(", ")} WHERE id = $1 RETURNING id`,
    [id, ...values],
  )
  if (rows.length === 0) return null
  return getItemById(id)
}

export const deleteItem = async (id: number): Promise<boolean> => {
  const rows = await executeQuery("DELETE FROM items WHERE id = $1 RETURNING id", [id])
  return rows.length > 0
}
