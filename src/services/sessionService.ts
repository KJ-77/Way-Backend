import { executeQuery } from "../lib/db"
import type { Session, CreateSessionDto, UpdateSessionDto } from "../lib/types"

export const getAllSessions = async (): Promise<Session[]> =>
  executeQuery<Session>("SELECT * FROM sessions ORDER BY date DESC, time DESC")

export const getSessionById = async (id: number): Promise<Session | null> => {
  const rows = await executeQuery<Session>("SELECT * FROM sessions WHERE id = $1", [id])
  return rows[0] ?? null
}

export const getSessionsByDate = async (date: string): Promise<Session[]> =>
  executeQuery<Session>(
    "SELECT * FROM sessions WHERE date = $1 ORDER BY time",
    [date]
  )

export const getSessionsByUserId = async (userId: number): Promise<Session[]> =>
  executeQuery<Session>(
    "SELECT * FROM sessions WHERE user_id = $1 ORDER BY date DESC, time DESC",
    [userId]
  )

export const createSession = async (data: CreateSessionDto): Promise<Session> => {
  const rows = await executeQuery<Session>(
    `INSERT INTO sessions (
      date, time, user_id, class_type, package_id,
      session_nb, deduct_group, session_weight, attendance, notes
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      data.date, data.time, data.user_id, data.class_type, data.package_id,
      data.session_nb, data.deduct_group, data.session_weight, data.attendance,
      data.notes ?? null,
    ]
  )
  return rows[0]
}

export const updateSession = async (id: number, data: UpdateSessionDto): Promise<Session | null> => {
  const fields = Object.keys(data)
  if (fields.length === 0) return getSessionById(id)

  const setClauses = fields.map((key, i) => `${key} = $${i + 2}`)
  const values = fields.map((key) => data[key as keyof UpdateSessionDto])

  const rows = await executeQuery<Session>(
    `UPDATE sessions SET ${setClauses.join(", ")} WHERE id = $1 RETURNING *`,
    [id, ...values]
  )
  return rows[0] ?? null
}

export const deleteSession = async (id: number): Promise<boolean> => {
  const rows = await executeQuery("DELETE FROM sessions WHERE id = $1 RETURNING id", [id])
  return rows.length > 0
}
