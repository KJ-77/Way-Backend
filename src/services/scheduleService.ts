import { executeQuery } from "../lib/db"
import type { ScheduleSlotJoined, CreateScheduleSlotDto, UpdateScheduleSlotDto } from "../lib/types"

// Base SELECT — tutor JOIN for name; "package" column is the class type enum value
const BASE_SELECT = `
  SELECT s.*, t.full_name AS tutor_name
  FROM schedule s
  LEFT JOIN tutors t ON s.tutor_id = t.id
`

export const getAllSlots = async (): Promise<ScheduleSlotJoined[]> =>
  executeQuery<ScheduleSlotJoined>(`${BASE_SELECT} ORDER BY s.day_of_week, s.start_time`)

export const getSlotById = async (id: number): Promise<ScheduleSlotJoined | null> => {
  const rows = await executeQuery<ScheduleSlotJoined>(`${BASE_SELECT} WHERE s.id = $1`, [id])
  return rows[0] ?? null
}

export const createSlot = async (data: CreateScheduleSlotDto): Promise<ScheduleSlotJoined> => {
  // Insert then re-fetch with JOINs so the response includes tutor name
  const rows = await executeQuery<{ id: number }>(
    `INSERT INTO schedule (day_of_week, start_time, end_time, tutor_id, package, is_fully_booked)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      data.day_of_week,
      data.start_time,
      data.end_time,
      data.tutor_id ?? null,
      data.package ?? null,
      data.is_fully_booked ?? false,
    ]
  )
  return (await getSlotById(rows[0].id))!
}

export const updateSlot = async (id: number, data: UpdateScheduleSlotDto): Promise<ScheduleSlotJoined | null> => {
  const fields = Object.keys(data)
  if (fields.length === 0) return getSlotById(id)

  // Dynamically build SET clause from provided fields + always bump updated_at
  const setClauses = fields.map((key, i) => `${key} = $${i + 2}`)
  setClauses.push("updated_at = NOW()")
  const values = fields.map((key) => data[key as keyof UpdateScheduleSlotDto] ?? null)

  const rows = await executeQuery(
    `UPDATE schedule SET ${setClauses.join(", ")} WHERE id = $1 RETURNING id`,
    [id, ...values]
  )
  if (rows.length === 0) return null
  return getSlotById(id)
}

export const deleteSlot = async (id: number): Promise<boolean> => {
  const rows = await executeQuery("DELETE FROM schedule WHERE id = $1 RETURNING id", [id])
  return rows.length > 0
}
