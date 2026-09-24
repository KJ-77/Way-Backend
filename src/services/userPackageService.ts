import { executeQuery } from "../lib/db"
import { getBeirutToday } from "../lib/time"
import type {
  UserPackageRow, UserPackageJoined,
  CreateUserPackageDto, UpdateUserPackageDto,
} from "../lib/types"

// Shared JOIN query — pulls user name + package catalog details alongside the subscription row.
// class_type_id / class_type_name come from the packages → class_types join and are used
// by the booking flow to answer "which slots is this subscription eligible for."
const BASE_SELECT = `
  SELECT
    up.id, up.user_id, up.package_id, up.purchase_date,
    up.remaining_sessions, up.remaining_weight, up.expiry_date, up.notes,
    u.full_name  AS user_name,
    p.package_type AS package_name,
    p.class_type_id,
    ct.name AS class_type_name,
    p.sessions_included, p.weight_included, p.price
  FROM user_packages up
  JOIN users u        ON up.user_id      = u.id
  JOIN packages p     ON up.package_id   = p.id
  JOIN class_types ct ON p.class_type_id = ct.id
`

export const getAllUserPackages = async (): Promise<UserPackageJoined[]> =>
  executeQuery<UserPackageJoined>(`${BASE_SELECT} ORDER BY up.purchase_date DESC`)

export const getUserPackagesByUserId = async (userId: string): Promise<UserPackageJoined[]> =>
  executeQuery<UserPackageJoined>(
    `${BASE_SELECT} WHERE up.user_id = $1 ORDER BY up.purchase_date DESC`,
    [userId]
  )

export const getUserPackageById = async (id: number): Promise<UserPackageJoined | null> => {
  const rows = await executeQuery<UserPackageJoined>(
    `${BASE_SELECT} WHERE up.id = $1`,
    [id]
  )
  return rows[0] ?? null
}

// Inserts a new subscription — remaining sessions/weight and expiry are derived from the package catalog
export const createUserPackage = async (
  data: CreateUserPackageDto
): Promise<UserPackageJoined | null> => {
  // The purchase date anchors the expiry: a subscription bought three weeks ago and
  // recorded today still expires two months after it was BOUGHT, not two months
  // from now. Otherwise backdating would quietly hand the client extra weeks.
  //
  // Defaults to today in Beirut rather than Postgres's CURRENT_DATE. RDS runs in
  // UTC, so between midnight and ~3am in the studio CURRENT_DATE is still
  // yesterday — a subscription sold at 1am would have been dated the day before.
  const purchaseDate = data.purchase_date ?? getBeirutToday()

  // How long it lasts comes from the PACKAGE (validity_days, migration 010): 60 days
  // for most, 30 for the Open Studio Membership. Days, not months, so every client
  // gets the same length whichever month they buy in. It's read once, here, and the
  // resulting expiry_date is stored — so editing a package's validity later only
  // affects subscriptions sold after the edit, never ones a client already bought.
  //
  // In Postgres `date + integer` is already a date (whole days), so no interval or
  // cast is needed.
  const inserted = await executeQuery<UserPackageRow>(
    `INSERT INTO user_packages
       (user_id, package_id, remaining_sessions, remaining_weight,
        purchase_date, expiry_date, notes)
     SELECT $1, $2, p.sessions_included, p.weight_included,
            $4::date, $4::date + p.validity_days, $3
     FROM packages p
     WHERE p.id = $2
     RETURNING *`,
    [data.user_id, data.package_id, data.notes ?? null, purchaseDate]
  )

  // No row inserted means the package_id didn't exist
  if (!inserted[0]) return null
  return getUserPackageById(inserted[0].id)
}

// Dynamic UPDATE — only touches columns present in `data`. The keys become SQL, so
// `data` must come out of UpdateUserPackageSchema (which strips anything unknown),
// never straight from a request body.
export const updateUserPackage = async (
  id: number,
  data: UpdateUserPackageDto
): Promise<UserPackageJoined | null> => {
  const fields = Object.keys(data)
  if (fields.length === 0) return getUserPackageById(id)

  const setClauses = fields.map((key, i) => `${key} = $${i + 2}`)
  const values = fields.map((key) => data[key as keyof UpdateUserPackageDto])

  const rows = await executeQuery<UserPackageRow>(
    `UPDATE user_packages SET ${setClauses.join(", ")} WHERE id = $1 RETURNING *`,
    [id, ...values]
  )
  if (!rows[0]) return null
  return getUserPackageById(id)
}

export const deleteUserPackage = async (id: number): Promise<boolean> => {
  const rows = await executeQuery(
    "DELETE FROM user_packages WHERE id = $1 RETURNING id",
    [id]
  )
  return rows.length > 0
}
