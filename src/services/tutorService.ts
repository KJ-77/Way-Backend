import { executeQuery } from "../lib/db"
import type { Tutor, CreateTutorDto, UpdateTutorDto } from "../lib/types"

export const getAllTutors = async (): Promise<Tutor[]> =>
  executeQuery<Tutor>("SELECT * FROM tutors ORDER BY id")

export const getTutorById = async (id: number): Promise<Tutor | null> => {
  const rows = await executeQuery<Tutor>("SELECT * FROM tutors WHERE id = $1", [id])
  return rows[0] ?? null
}

export const createTutor = async (data: CreateTutorDto): Promise<Tutor> => {
  const rows = await executeQuery<Tutor>(
    `INSERT INTO tutors (full_name, email, phone)
     VALUES ($1, $2, $3) RETURNING *`,
    [data.full_name, data.email, data.phone]
  )
  return rows[0]
}

export const updateTutor = async (id: number, data: UpdateTutorDto): Promise<Tutor | null> => {
  const fields = Object.keys(data)
  if (fields.length === 0) return getTutorById(id)

  const setClauses = fields.map((key, i) => `${key} = $${i + 2}`)
  const values = fields.map((key) => data[key as keyof UpdateTutorDto])

  const rows = await executeQuery<Tutor>(
    `UPDATE tutors SET ${setClauses.join(", ")} WHERE id = $1 RETURNING *`,
    [id, ...values]
  )
  return rows[0] ?? null
}

export const deleteTutor = async (id: number): Promise<boolean> => {
  const rows = await executeQuery("DELETE FROM tutors WHERE id = $1 RETURNING id", [id])
  return rows.length > 0
}
