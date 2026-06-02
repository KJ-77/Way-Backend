import type { APIGatewayProxyEventV2 } from "aws-lambda"
import { executeQuery } from "../../lib/db"
import type { User } from "../../lib/types"

// Payload shape for direct Lambda invocations from the Cognito-facing handlers
interface DbOpsPayload {
  action: "getById" | "insert" | "update" | "delete" | "setActive" | "checkUnique"
  data: Record<string, unknown>
}

// Result of a pre-check: which (if any) unique constraint would be violated
type UniqueCheckResult = { phone: boolean; email: boolean }

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
      // Hard-delete kept as an escape hatch — the public handler now uses setActive instead
      // for the soft-delete flow. If a hard-delete is ever required (e.g. GDPR erasure),
      // this branch still works.
      const rows = await executeQuery(
        "DELETE FROM users WHERE id = $1 RETURNING id",
        [payload.data.id],
      )
      return rows.length > 0
    }

    case "setActive": {
      // Soft-delete + restore — flips is_active and bumps updated_at
      const rows = await executeQuery<User>(
        "UPDATE users SET is_active = $2, updated_at = NOW() WHERE id = $1 RETURNING *",
        [payload.data.id, payload.data.is_active],
      )
      return rows[0] ?? null
    }

    case "checkUnique": {
      // Pre-check for duplicate phone/email before we touch Cognito. The UNIQUE
      // constraints on these columns are the source of truth — this just avoids
      // the Cognito create → DB fail → Cognito rollback path for the common case.
      // Races still possible (two admins, same instant) but the existing rollback
      // in the create handler covers that edge.
      const phone = payload.data.phone as string | null | undefined
      const email = payload.data.email as string | null | undefined

      const result: UniqueCheckResult = { phone: false, email: false }

      if (phone) {
        const rows = await executeQuery<{ exists: boolean }>(
          "SELECT EXISTS(SELECT 1 FROM users WHERE phone = $1) AS exists",
          [phone],
        )
        result.phone = rows[0]?.exists === true
      }
      if (email) {
        const rows = await executeQuery<{ exists: boolean }>(
          "SELECT EXISTS(SELECT 1 FROM users WHERE email = $1) AS exists",
          [email],
        )
        result.email = rows[0]?.exists === true
      }
      return result
    }

    default:
      throw new Error(`Unknown action: ${(payload as DbOpsPayload).action}`)
  }
}
