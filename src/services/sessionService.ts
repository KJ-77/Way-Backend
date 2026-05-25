import { pool, executeQuery } from "../lib/db"
import type { SessionJoined, CreateSessionDto, UpdateSessionDto, Attendance } from "../lib/types"

// Shared JOIN. sessions only carries user_package_id — user/package are
// derived by walking the FK chain through user_packages.
const BASE_SELECT = `
  SELECT
    s.id, s.user_package_id, s.session_nb, s.attendance, s.notes, s.created_at,
    up.user_id, up.package_id,
    u.full_name  AS user_name,
    p.package_type AS package_name
  FROM sessions s
  JOIN user_packages up ON s.user_package_id = up.id
  JOIN users u          ON up.user_id        = u.id
  JOIN packages p       ON up.package_id     = p.id
`

// "cancelled - no charge" is the only attendance value that does NOT consume a
// remaining_session on the user's subscription. Everything else (booked/attended/
// cancelled) is "counted" — the slot was sold and the client owns the cost.
export const isCountedAttendance = (a: Attendance): boolean =>
  a !== "cancelled - no charge"

// Maps a prev→next attendance transition to the delta that should be applied to
// the linked subscription's remaining_sessions. Positive = refund, negative =
// re-deduct, zero = no subscription change required.
export const attendanceRefundDelta = (prev: Attendance, next: Attendance): number => {
  const prevCounted = isCountedAttendance(prev)
  const nextCounted = isCountedAttendance(next)
  if (prevCounted && !nextCounted) return 1   // refund (e.g. booked → cancelled - no charge)
  if (!prevCounted && nextCounted) return -1  // re-deduct (e.g. cancelled - no charge → attended)
  return 0
}

export const getAllSessions = async (): Promise<SessionJoined[]> =>
  executeQuery<SessionJoined>(`${BASE_SELECT} ORDER BY s.created_at DESC`)

export const getSessionById = async (id: number): Promise<SessionJoined | null> => {
  const rows = await executeQuery<SessionJoined>(`${BASE_SELECT} WHERE s.id = $1`, [id])
  return rows[0] ?? null
}

// Filtered by user_id from user_packages — sessions doesn't carry user_id directly.
export const getSessionsByUserId = async (userId: string): Promise<SessionJoined[]> =>
  executeQuery<SessionJoined>(
    `${BASE_SELECT} WHERE up.user_id = $1 ORDER BY s.created_at DESC`,
    [userId]
  )

/**
 * Creates a session inside a transaction:
 * 1. Locks the requested subscription (user_package_id) + loads capacity info
 * 2. Validates it's not expired; if attendance is counted, also that it has
 *    remaining sessions
 * 3. Decrements remaining_sessions by 1 UNLESS attendance is "cancelled - no charge"
 *    (no-charge sessions still anchor to a subscription but don't consume a slot)
 * 4. Inserts the session row
 */
export const createSession = async (data: CreateSessionDto): Promise<SessionJoined> => {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    const counted = isCountedAttendance(data.attendance)

    // Lock the row + fetch the capacity/expiry info we need to validate. Lock
    // prevents concurrent session creation from racing past the depleted check.
    const subResult = await client.query(
      `SELECT up.id, up.remaining_sessions,
              p.sessions_included,
              (up.expiry_date < CURRENT_DATE) AS is_expired
         FROM user_packages up
         JOIN packages p ON up.package_id = p.id
        WHERE up.id = $1
        FOR UPDATE OF up`,
      [data.user_package_id]
    )

    if (subResult.rows.length === 0) {
      throw Object.assign(new Error("Subscription not found"), { statusCode: 404 })
    }
    const sub = subResult.rows[0]

    if (sub.is_expired) {
      throw Object.assign(new Error("Subscription has expired"), { statusCode: 400 })
    }
    if (counted && sub.remaining_sessions <= 0) {
      throw Object.assign(
        new Error("Subscription has no remaining sessions (depleted)"),
        { statusCode: 400 },
      )
    }

    // Auto-calculate session number: e.g. 8/8 remaining → session #1, 7/8 → #2.
    // Computed before the decrement so the number matches "this is session N".
    const sessionNb = sub.sessions_included - sub.remaining_sessions + 1

    if (counted) {
      await client.query(
        `UPDATE user_packages
            SET remaining_sessions = remaining_sessions - 1
          WHERE id = $1`,
        [sub.id]
      )
    }

    const insertResult = await client.query(
      `INSERT INTO sessions (user_package_id, session_nb, attendance, notes)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [data.user_package_id, sessionNb, data.attendance, data.notes ?? null]
    )

    await client.query("COMMIT")
    return (await getSessionById(insertResult.rows[0].id))!
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}

/**
 * Updates a session. When `attendance` is part of the update we run a
 * transaction that may refund or re-deduct a session on the session's linked
 * subscription based on whether the transition crosses the "counted ↔
 * no-charge" boundary.
 *
 * Refund target rules:
 *  - Refund (+1): the linked sub, capped at sessions_included (no over-credit)
 *  - Re-deduct (-1): the linked sub, requires remaining_sessions > 0
 */
export const updateSession = async (id: number, data: UpdateSessionDto): Promise<SessionJoined | null> => {
  const fields = Object.keys(data) as (keyof UpdateSessionDto)[]
  if (fields.length === 0) return getSessionById(id)

  // Fast path: no attendance change → no subscription impact, plain UPDATE.
  if (data.attendance === undefined) {
    const setClauses = fields.map((key, i) => `${key} = $${i + 2}`)
    const values = fields.map((key) => data[key])
    const rows = await executeQuery(
      `UPDATE sessions SET ${setClauses.join(", ")} WHERE id = $1 RETURNING id`,
      [id, ...values]
    )
    if (!rows[0]) return null
    return getSessionById(id)
  }

  // Attendance is changing — run the transactional path so the subscription
  // adjustment and the session UPDATE commit (or roll back) together.
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    // Pull the prev attendance + the linked sub. user_package_id is NOT NULL
    // on the table, so no null-handling needed here.
    const existingResult = await client.query(
      `SELECT user_package_id, attendance FROM sessions WHERE id = $1`,
      [id]
    )
    if (existingResult.rows.length === 0) {
      await client.query("ROLLBACK")
      return null
    }
    const existing = existingResult.rows[0] as {
      user_package_id: number
      attendance: Attendance
    }

    const delta = attendanceRefundDelta(existing.attendance, data.attendance)
    if (delta !== 0) {
      await adjustLinkedSubscription(client, existing.user_package_id, delta)
    }

    // Apply the dynamic UPDATE for whatever fields were provided
    const setClauses = fields.map((key, i) => `${key} = $${i + 2}`)
    const values = fields.map((key) => data[key])
    await client.query(
      `UPDATE sessions SET ${setClauses.join(", ")} WHERE id = $1`,
      [id, ...values]
    )

    await client.query("COMMIT")
    return getSessionById(id)
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}

// Adjusts the linked subscription's remaining_sessions by `delta`. Locks the
// row, validates the change doesn't violate the sold cap (refund) or go
// negative (deduct), then applies. Caller must be inside a transaction.
async function adjustLinkedSubscription(
  // pg.PoolClient — typed loosely to avoid pulling pg types here
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> },
  userPackageId: number,
  delta: number,
): Promise<void> {
  const subResult = await client.query(
    `SELECT up.id, up.remaining_sessions, p.sessions_included
       FROM user_packages up
       JOIN packages p ON up.package_id = p.id
      WHERE up.id = $1
      FOR UPDATE OF up`,
    [userPackageId],
  )

  const sub = subResult.rows[0]
  if (!sub) {
    // Shouldn't happen — FK is ON DELETE RESTRICT — but guard anyway.
    throw Object.assign(
      new Error("Linked subscription no longer exists — cannot adjust"),
      { statusCode: 400 },
    )
  }

  if (delta > 0 && sub.remaining_sessions >= sub.sessions_included) {
    throw Object.assign(
      new Error("Subscription is already at full capacity — nothing to refund"),
      { statusCode: 400 },
    )
  }
  if (delta < 0 && sub.remaining_sessions <= 0) {
    throw Object.assign(
      new Error("Linked subscription has no remaining sessions to deduct from"),
      { statusCode: 400 },
    )
  }

  await client.query(
    `UPDATE user_packages
        SET remaining_sessions = remaining_sessions + $1
      WHERE id = $2`,
    [delta, userPackageId],
  )
}

export const deleteSession = async (id: number): Promise<boolean> => {
  const rows = await executeQuery("DELETE FROM sessions WHERE id = $1 RETURNING id", [id])
  return rows.length > 0
}
