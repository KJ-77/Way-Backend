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

// `notes` used to be missing from this INSERT, so notes typed into the admin's
// "Add package" form were silently dropped (only an edit saved them).
// validity_days always arrives set — CreatePackageSchema fills the default.
export const createPackage = async (data: CreatePackageDto): Promise<PackageJoined> => {
  const rows = await executeQuery<{ id: number }>(
    `INSERT INTO packages
       (package_type, class_type_id, sessions_included, weight_included, price, notes, validity_days)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      data.package_type,
      data.class_type_id,
      data.sessions_included ?? null,
      data.weight_included ?? null,
      data.price ?? null,
      data.notes ?? null,
      data.validity_days,
    ]
  )
  return (await getPackageById(rows[0].id))!
}

// Dynamic UPDATE — only touches columns present in `data`. The keys become SQL, so
// `data` must come out of UpdatePackageSchema (which strips anything unknown), never
// straight from a request body.
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
