import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { executeQuery, pool } from "../../lib/db"
import { createResponse, parseBody, handleError } from "../../lib/response"
import { getAuthContext, requireRole } from "../../lib/auth"
import type { Account } from "../../lib/types"

// Payload shape for direct Lambda invocations from the Cognito-facing handlers
interface DbOpsPayload {
  action: "getById" | "insert" | "update" | "delete"
  data: Record<string, unknown>
}

// Direct Lambda invocation handler — no HTTP, no auth (caller is trusted internal Lambda)
export const accountDbOps = async (event: unknown): Promise<unknown> => {
  // If this is an HTTP event (has requestContext), reject — use syncAccount instead
  if ((event as APIGatewayProxyEventV2).requestContext) {
    return { statusCode: 400, body: "Use /accounts/sync for HTTP access" }
  }

  const payload = event as DbOpsPayload

  switch (payload.action) {
    case "getById": {
      const rows = await executeQuery<Account>(
        "SELECT * FROM accounts WHERE id = $1",
        [payload.data.id],
      )
      return rows[0] ?? null
    }

    case "insert": {
      const { id, email, full_name, phone, role } = payload.data
      const result = await executeQuery<Account>(
        `INSERT INTO accounts (id, email, full_name, phone, role)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [id, email, full_name, phone || null, role],
      )
      return result[0]
    }

    case "update": {
      const { id, ...fields } = payload.data
      const keys = Object.keys(fields)
      if (keys.length === 0) return null

      const setClauses = keys.map((key, i) => `${key} = $${i + 2}`)
      setClauses.push("updated_at = NOW()")
      const values = keys.map((key) => fields[key])

      const rows = await executeQuery<Account>(
        `UPDATE accounts SET ${setClauses.join(", ")} WHERE id = $1 RETURNING *`,
        [id, ...values],
      )
      return rows[0] ?? null
    }

    case "delete": {
      const rows = await executeQuery(
        "DELETE FROM accounts WHERE id = $1 RETURNING id",
        [payload.data.id],
      )
      return rows.length > 0
    }

    default:
      throw new Error(`Unknown action: ${(payload as DbOpsPayload).action}`)
  }
}

// HTTP endpoint for admin retry — POST /accounts/sync
// Lets an admin manually insert an account into the DB after a failed sync
export const syncAccount = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuthContext(event)
    const denied = requireRole(auth, "admin")
    if (denied) return denied

    const body = parseBody<{ id: string; email: string; full_name: string; phone?: string; role: string }>(event.body)

    if (!body.id || !body.email || !body.full_name || !body.role) {
      return createResponse(400, { error: "Missing required fields: id, email, full_name, role" })
    }

    // Check if account already exists in DB
    const existing = await executeQuery<Account>("SELECT id FROM accounts WHERE id = $1", [body.id])
    if (existing.length > 0) {
      return createResponse(409, { error: "Account already exists in database" })
    }

    const client = await pool.connect()
    try {
      const result = await client.query(
        `INSERT INTO accounts (id, email, full_name, phone, role)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [body.id, body.email, body.full_name, body.phone || null, body.role],
      )
      return createResponse(201, result.rows[0])
    } finally {
      client.release()
    }
  } catch (err) {
    return handleError(err)
  }
}
