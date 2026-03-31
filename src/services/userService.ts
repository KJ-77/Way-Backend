import { executeQuery } from "../lib/db"
import type { User } from "../lib/types"

export const getAllUsers = async (): Promise<User[]> =>
  executeQuery<User>("SELECT * FROM users ORDER BY created_at DESC")

export const getUserById = async (id: string): Promise<User | null> => {
  const rows = await executeQuery<User>("SELECT * FROM users WHERE id = $1", [id])
  return rows[0] ?? null
}
