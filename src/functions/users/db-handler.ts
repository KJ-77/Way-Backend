import type { APIGatewayProxyEventV2 } from "aws-lambda"
import { executeQuery } from "../../lib/db"
import type { User } from "../../lib/types"

// Payload shape for direct Lambda invocations from the Cognito-facing handlers
interface DbOpsPayload {
  action: "getById" | "insert" | "update" | "delete"
  data: Record<string, unknown>
}

// Direct Lambda invocation handler — no HTTP, no auth (caller is trusted internal Lambda)
export const userDbOps = async (event: unknown): Promise<unknown> => {
  // Reject HTTP events — this handler is internal-only
  if ((event as APIGatewayProxyEventV2).requestContext) {
    return { statusCode: 400, body: "Internal handler, not exposed via HTTP" }
  }

  const payload = event as DbOpsPayload

  switch (payload.action) {
    case "getById": {
      const rows = await executeQuery<User>(
        "SELECT * FROM users WHERE id = $1",
        [payload.data.id],
      )
      return rows[0] ?? null
    }

    case "insert": {
      // Build dynamic INSERT — only include provided fields
      const { id, ...fields } = payload.data
      const columns = ["id", ...Object.keys(fields)]
      const placeholders = columns.map((_, i) => `$${i + 1}`)
      const values = [id, ...Object.values(fields)]

      const rows = await executeQuery<User>(
        `INSERT INTO users (${columns.join(", ")})
         VALUES (${placeholders.join(", ")}) RETURNING *`,
        values,
      )
      return rows[0]
    }

    case "update": {
      const { id, ...fields } = payload.data
      const keys = Object.keys(fields)
      if (keys.length === 0) return null

      const setClauses = keys.map((key, i) => `${key} = $${i + 2}`)
      setClauses.push("updated_at = NOW()")
      const values = keys.map((key) => fields[key])

      const rows = await executeQuery<User>(
        `UPDATE users SET ${setClauses.join(", ")} WHERE id = $1 RETURNING *`,
        [id, ...values],
      )
      return rows[0] ?? null
    }

    case "delete": {
      const rows = await executeQuery(
        "DELETE FROM users WHERE id = $1 RETURNING id",
        [payload.data.id],
      )
      return rows.length > 0
    }

    default:
      throw new Error(`Unknown action: ${(payload as DbOpsPayload).action}`)
  }
}
