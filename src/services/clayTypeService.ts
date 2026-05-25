import { executeQuery } from "../lib/db"

// Single-column lookup table managed by admins/studio-managers.
// `name` is the primary key — every value is what gets stored on items.clay_type.
//
// Migration required (run manually once):
//   CREATE TABLE IF NOT EXISTS clay_types (
//     name varchar(255) PRIMARY KEY,
//     created_at timestamp DEFAULT NOW()
//   );
//   INSERT INTO clay_types (name) VALUES
//     ('lf-clb-white'), ('lf-sio-brown'), ('hf-prai-white'), ('lf-pa-white')
//   ON CONFLICT DO NOTHING;

export interface ClayType {
  name: string
  created_at: string
}

export const getAllClayTypes = async (): Promise<ClayType[]> =>
  executeQuery<ClayType>("SELECT name, created_at FROM clay_types ORDER BY name ASC")

export const createClayType = async (name: string): Promise<ClayType | null> => {
  const rows = await executeQuery<ClayType>(
    "INSERT INTO clay_types (name) VALUES ($1) RETURNING name, created_at",
    [name],
  )
  return rows[0] ?? null
}

// Rename by inserting the new key, repointing existing items, then dropping the old key — all in one transaction.
// Done in SQL via two statements is simplest; the items.clay_type column has no FK so we just bulk-update it.
export const renameClayType = async (oldName: string, newName: string): Promise<ClayType | null> => {
  await executeQuery("INSERT INTO clay_types (name) VALUES ($1) ON CONFLICT DO NOTHING", [newName])
  await executeQuery("UPDATE items SET clay_type = $1 WHERE clay_type = $2", [newName, oldName])
  const deleted = await executeQuery("DELETE FROM clay_types WHERE name = $1 RETURNING name", [oldName])
  if (deleted.length === 0) return null
  const rows = await executeQuery<ClayType>(
    "SELECT name, created_at FROM clay_types WHERE name = $1",
    [newName],
  )
  return rows[0] ?? null
}

// Deletes a clay type from the lookup. Existing items keep their stored value
// (we leave items.clay_type intact so historical records stay readable) — but
// admins won't be able to pick it for new items.
export const deleteClayType = async (name: string): Promise<boolean> => {
  const rows = await executeQuery("DELETE FROM clay_types WHERE name = $1 RETURNING name", [name])
  return rows.length > 0
}
