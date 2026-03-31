import { executeQuery } from "../lib/db"
import type { Package, CreatePackageDto, UpdatePackageDto } from "../lib/types"

export const getAllPackages = async (): Promise<Package[]> =>
  executeQuery<Package>("SELECT * FROM packages ORDER BY id ASC")

export const getPackageById = async (id: number): Promise<Package | null> => {
  const rows = await executeQuery<Package>("SELECT * FROM packages WHERE id = $1", [id])
  return rows[0] ?? null
}

export const createPackage = async (data: CreatePackageDto): Promise<Package> => {
  const rows = await executeQuery<Package>(
    `INSERT INTO packages (package_type, sessions_included, weight_included, price)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [data.package_type, data.sessions_included, data.weight_included, data.price]
  )
  return rows[0]
}

export const updatePackage = async (id: number, data: UpdatePackageDto): Promise<Package | null> => {
  const fields = Object.keys(data)
  if (fields.length === 0) return getPackageById(id)

  const setClauses = fields.map((key, i) => `${key} = $${i + 2}`)
  const values = fields.map((key) => data[key as keyof UpdatePackageDto])

  const rows = await executeQuery<Package>(
    `UPDATE packages SET ${setClauses.join(", ")} WHERE id = $1 RETURNING *`,
    [id, ...values]
  )
  return rows[0] ?? null
}

export const deletePackage = async (id: number): Promise<boolean> => {
  const rows = await executeQuery("DELETE FROM packages WHERE id = $1 RETURNING id", [id])
  return rows.length > 0
}
