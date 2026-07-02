import { executeQuery } from "../lib/db"
import type { PackageJoined, CreatePackageDto, UpdatePackageDto } from "../lib/types"

// Every package belongs to exactly one class (class_type_id NOT NULL, ON DELETE
// RESTRICT). Reads always join class_types so the frontend gets class_type_name
// alongside the package's own display label (package_type). package_type is a
// per-package label ("Hand Building - 4 Sessions"); class_type_name is the
// shared class ("Hand Building"). Two different packages for the same class
// share class_type_name but differ in package_type.
const BASE_SELECT = `
  SELECT p.*, ct.name AS class_type_name
  FROM packages p
  JOIN class_types ct ON p.class_type_id = ct.id
`

export const getAllPackages = async (): Promise<PackageJoined[]> =>
  executeQuery<PackageJoined>(`${BASE_SELECT} ORDER BY p.id ASC`)

export const getPackageById = async (id: number): Promise<PackageJoined | null> => {
  const rows = await executeQuery<PackageJoined>(`${BASE_SELECT} WHERE p.id = $1`, [id])
  return rows[0] ?? null
}

export const createPackage = async (data: CreatePackageDto): Promise<PackageJoined> => {
  const rows = await executeQuery<{ id: number }>(
    `INSERT INTO packages (package_type, class_type_id, sessions_included, weight_included, price)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      data.package_type,
      data.class_type_id,
      data.sessions_included,
      data.weight_included,
      data.price,
    ]
  )
  return (await getPackageById(rows[0].id))!
}

export const updatePackage = async (
  id: number,
  data: UpdatePackageDto
): Promise<PackageJoined | null> => {
  const fields = Object.keys(data)
  if (fields.length === 0) return getPackageById(id)

  const setClauses = fields.map((key, i) => `${key} = $${i + 2}`)
  const values = fields.map((key) => data[key as keyof UpdatePackageDto])

  const rows = await executeQuery<{ id: number }>(
    `UPDATE packages SET ${setClauses.join(", ")} WHERE id = $1 RETURNING id`,
    [id, ...values]
  )
  if (rows.length === 0) return null
  return getPackageById(id)
}

export const deletePackage = async (id: number): Promise<boolean> => {
  const rows = await executeQuery("DELETE FROM packages WHERE id = $1 RETURNING id", [id])
  return rows.length > 0
}
