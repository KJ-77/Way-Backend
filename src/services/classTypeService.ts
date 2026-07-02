import { executeQuery } from "../lib/db"
import type { ClassType, CreateClassTypeDto, UpdateClassTypeDto } from "../lib/types"

// Small lookup table. UNIQUE(name) is enforced by the schema, so create
// collisions surface as Postgres error 23505 which is mapped to 409 by
// handleError().
//
// FK relationships (ON DELETE RESTRICT):
//   • packages.class_type_id → class_types.id
//   • schedule.class_type_id → class_types.id
// A hard-delete of a class type that still has packages or slots pointing at
// it fails with PG error 23503. The service catches that and returns a
// business error (409) with a clear message rather than a generic 500.

export const getAllClassTypes = async (): Promise<ClassType[]> =>
  executeQuery<ClassType>(
    `SELECT id, name, description, is_active, created_at, updated_at
       FROM class_types
     ORDER BY name ASC`
  )

export const getClassTypeById = async (id: number): Promise<ClassType | null> => {
  const rows = await executeQuery<ClassType>(
    `SELECT id, name, description, is_active, created_at, updated_at
       FROM class_types WHERE id = $1`,
    [id]
  )
  return rows[0] ?? null
}

export const createClassType = async (data: CreateClassTypeDto): Promise<ClassType> => {
  const rows = await executeQuery<ClassType>(
    `INSERT INTO class_types (name, description, is_active)
     VALUES ($1, $2, COALESCE($3, true))
     RETURNING id, name, description, is_active, created_at, updated_at`,
    [data.name, data.description ?? null, data.is_active ?? null]
  )
  return rows[0]
}

export const updateClassType = async (
  id: number,
  data: UpdateClassTypeDto
): Promise<ClassType | null> => {
  const fields = Object.keys(data) as (keyof UpdateClassTypeDto)[]
  if (fields.length === 0) return getClassTypeById(id)

  const setClauses = fields.map((key, i) => `${key} = $${i + 2}`)
  const values = fields.map((key) => (data[key] === undefined ? null : data[key]))

  const rows = await executeQuery<{ id: number }>(
    `UPDATE class_types SET ${setClauses.join(", ")} WHERE id = $1 RETURNING id`,
    [id, ...values]
  )
  if (rows.length === 0) return null
  return getClassTypeById(id)
}

// Hard delete blocked by FK RESTRICT on packages / schedule. Callers should
// prefer flipping is_active=false to retire a class type without losing
// referential integrity. This function surfaces the FK violation as a clean
// business error so the API can respond 409 instead of 500.
export const deleteClassType = async (id: number): Promise<boolean> => {
  try {
    const rows = await executeQuery(
      "DELETE FROM class_types WHERE id = $1 RETURNING id",
      [id]
    )
    return rows.length > 0
  } catch (err) {
    const pgErr = err as { code?: string }
    if (pgErr.code === "23503") {
      throw Object.assign(
        new Error(
          "Cannot delete: packages or scheduled slots still reference this class. " +
            "Retire it by setting is_active=false instead, or reassign the referencing rows first."
        ),
        { statusCode: 409, code: "CLASS_TYPE_IN_USE" }
      )
    }
    throw err
  }
}
