import { pool, executeQuery } from "../lib/db"
import type { SessionJoined, CreateSessionDto, UpdateSessionDto } from "../lib/types"

// Shared JOIN — pulls user name + package name alongside each session row
const BASE_SELECT = `
  SELECT
    s.id, s.user_id, s.package_id,
    s.session_nb, s.attendance, s.notes, s.created_at,
    u.full_name  AS user_name,
    p.package_type AS package_name
  FROM sessions s
  JOIN users u    ON s.user_id    = u.id
  JOIN packages p ON s.package_id = p.id
`

export const getAllSessions = async (): Promise<SessionJoined[]> =>
  executeQuery<SessionJoined>(`${BASE_SELECT} ORDER BY s.created_at DESC`)

export const getSessionById = async (id: number): Promise<SessionJoined | null> => {
  const rows = await executeQuery<SessionJoined>(`${BASE_SELECT} WHERE s.id = $1`, [id])
  return rows[0] ?? null
}

export const getSessionsByUserId = async (userId: string): Promise<SessionJoined[]> =>
  executeQuery<SessionJoined>(
    `${BASE_SELECT} WHERE s.user_id = $1 ORDER BY s.created_at DESC`,
    [userId]
  )

/**
 * Creates a session inside a transaction:
 * 1. Finds the oldest active subscription (user_package) for this user + package
 * 2. Validates it's not depleted or expired
 * 3. Decrements remaining_sessions by 1 (weight is deducted later via item stage transitions)
 * 4. Inserts the session row
 */
export const createSession = async (data: CreateSessionDto): Promise<SessionJoined> => {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    // Find oldest active subscription for this user+package (FIFO usage)
    const subResult = await client.query(
      `SELECT up.id, up.remaining_sessions, up.expiry_date,
              p.sessions_included
       FROM user_packages up
       JOIN packages p ON up.package_id = p.id
       WHERE up.user_id = $1 AND up.package_id = $2
         AND up.remaining_sessions > 0
         AND up.expiry_date >= CURRENT_DATE
       ORDER BY up.purchase_date ASC
       LIMIT 1`,
      [data.user_id, data.package_id]
    )

    const sub = subResult.rows[0]
    if (!sub) {
      // Check if there's a subscription at all (just depleted/expired) for a better error msg
      const anySub = await client.query(
        `SELECT id, remaining_sessions, expiry_date FROM user_packages
         WHERE user_id = $1 AND package_id = $2 LIMIT 1`,
        [data.user_id, data.package_id]
      )
      if (anySub.rows.length === 0) {
        throw Object.assign(new Error("No subscription found for this user and package"), { statusCode: 404 })
      }
      const existing = anySub.rows[0]
      if (existing.remaining_sessions <= 0) {
        throw Object.assign(new Error("Subscription has no remaining sessions (depleted)"), { statusCode: 400 })
      }
      throw Object.assign(new Error("Subscription has expired"), { statusCode: 400 })
    }

    // Auto-calculate session number: e.g. 8/8 remaining → session #1, 7/8 → #2
    const sessionNb = sub.sessions_included - sub.remaining_sessions + 1

    // Decrement remaining_sessions only (weight is deducted at item stage transitions)
    await client.query(
      `UPDATE user_packages
       SET remaining_sessions = remaining_sessions - 1
       WHERE id = $1`,
      [sub.id]
    )

    // Insert the session
    const insertResult = await client.query(
      `INSERT INTO sessions (user_id, package_id, session_nb, attendance, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [data.user_id, data.package_id, sessionNb, data.attendance, data.notes ?? null]
    )

    await client.query("COMMIT")

    // Return the joined row
    const session = await getSessionById(insertResult.rows[0].id)
    return session!
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}

// Dynamic UPDATE — only touches columns present in `data`
export const updateSession = async (id: number, data: UpdateSessionDto): Promise<SessionJoined | null> => {
  const fields = Object.keys(data)
  if (fields.length === 0) return getSessionById(id)

  const setClauses = fields.map((key, i) => `${key} = $${i + 2}`)
  const values = fields.map((key) => data[key as keyof UpdateSessionDto])

  const rows = await executeQuery(
    `UPDATE sessions SET ${setClauses.join(", ")} WHERE id = $1 RETURNING id`,
    [id, ...values]
  )
  if (!rows[0]) return null
  return getSessionById(id)
}

export const deleteSession = async (id: number): Promise<boolean> => {
  const rows = await executeQuery("DELETE FROM sessions WHERE id = $1 RETURNING id", [id])
  return rows.length > 0
}
