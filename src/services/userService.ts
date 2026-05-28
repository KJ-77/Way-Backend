import { executeQuery } from "../lib/db"
import type { User } from "../lib/types"

// List users. Soft-deleted (is_active=false) users are hidden by default so they don't
// clutter the clients list. Pass { includeDeleted: true } to surface them — used by the
// admin UI's "show deleted" toggle.
export const getAllUsers = async (opts: { includeDeleted?: boolean } = {}): Promise<User[]> => {
  if (opts.includeDeleted) {
    return executeQuery<User>("SELECT * FROM users ORDER BY is_active DESC, created_at DESC")
  }
  return executeQuery<User>("SELECT * FROM users WHERE is_active = TRUE ORDER BY created_at DESC")
}

export const getUserById = async (id: string): Promise<User | null> => {
  const rows = await executeQuery<User>("SELECT * FROM users WHERE id = $1", [id])
  return rows[0] ?? null
}
