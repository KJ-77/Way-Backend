import { executeQuery, pool } from "../lib/db"
import * as cognito from "../lib/cognito"
import type { Account, CreateAccountDto, UpdateAccountDto } from "../lib/types"

export const getAllAccounts = async (): Promise<Account[]> =>
  executeQuery<Account>("SELECT * FROM accounts ORDER BY created_at DESC")

export const getAccountById = async (id: string): Promise<Account | null> => {
  const rows = await executeQuery<Account>("SELECT * FROM accounts WHERE id = $1", [id])
  return rows[0] ?? null
}

export const getAccountByEmail = async (email: string): Promise<Account | null> => {
  const rows = await executeQuery<Account>("SELECT * FROM accounts WHERE email = $1", [email])
  return rows[0] ?? null
}

export const createAccount = async (data: CreateAccountDto): Promise<Account> => {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    // 1. Create user in Cognito — returns cognito_sub
    const cognitoSub = await cognito.createCognitoUser(data.email, data.full_name, data.phone)

    // 2. Add to Cognito group
    await cognito.addUserToGroup(data.email, data.role)

    // 3. Insert into DB using cognito_sub as PK
    const result = await client.query(
      `INSERT INTO accounts (id, email, full_name, phone, role)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [cognitoSub, data.email, data.full_name, data.phone || null, data.role],
    )

    await client.query("COMMIT")
    return result.rows[0]
  } catch (err) {
    await client.query("ROLLBACK")
    // Best-effort cleanup: delete Cognito user if it was created
    try {
      await cognito.deleteCognitoUser(data.email)
    } catch {
      // ignore cleanup error
    }
    throw err
  } finally {
    client.release()
  }
}

export const updateAccount = async (id: string, data: UpdateAccountDto): Promise<Account | null> => {
  const existing = await getAccountById(id)
  if (!existing) return null

  // If role changed, update Cognito group
  if (data.role && data.role !== existing.role) {
    await cognito.removeUserFromGroup(existing.email, existing.role)
    await cognito.addUserToGroup(existing.email, data.role)
  }

  const fields = Object.keys(data)
  if (fields.length === 0) return existing

  const setClauses = fields.map((key, i) => `${key} = $${i + 2}`)
  setClauses.push(`updated_at = NOW()`)
  const values = fields.map((key) => data[key as keyof UpdateAccountDto])

  const rows = await executeQuery<Account>(
    `UPDATE accounts SET ${setClauses.join(", ")} WHERE id = $1 RETURNING *`,
    [id, ...values],
  )
  return rows[0] ?? null
}

export const deleteAccount = async (id: string): Promise<boolean> => {
  const existing = await getAccountById(id)
  if (!existing) return false

  // Delete from Cognito first
  await cognito.deleteCognitoUser(existing.email)

  // Then delete from DB
  const rows = await executeQuery("DELETE FROM accounts WHERE id = $1 RETURNING id", [id])
  return rows.length > 0
}
