// Preserves PostgreSQL error metadata across a Lambda-to-Lambda invoke boundary.
//
// AWS Lambda serializes a thrown error into { errorType, errorMessage, trace },
// where errorType is `err.name` and errorMessage is `err.message`. Every custom
// property is dropped — including the three pg fields handleError() branches on:
// `code` ("23505"), `constraint` ("users_phone_key") and `detail`.
//
// That loss is why a duplicate-phone INSERT used to arrive at the calling handler
// as a bare Error("duplicate key value violates unique constraint ...") and fall
// straight past handleError()'s 23505 branch into a generic 500.
//
// The VPC-side db handler encodes those fields into the message behind a sentinel;
// invokeLambda() decodes them back onto the Error it throws, so handleError() sees
// the same shape it would from a direct pg call.
//
// This module deliberately has no imports — the VPC-bound DB handlers pull it in,
// and it shouldn't drag the AWS SDK along with it.

const SENTINEL = "__PG_ERR__"

type PgErrorFields = {
  message: string
  code?: string
  constraint?: string
  detail?: string
}

/**
 * Called on the DB-Lambda side, just before the error crosses the boundary.
 *
 * Only errors that actually carry pg metadata get wrapped — anything else (a bug
 * in our own code, a connection timeout) is more useful with its original message
 * and stack intact.
 */
export const encodeDbError = (err: unknown): Error => {
  const pg = err as Error & { code?: string; constraint?: string; detail?: string }

  if (!pg?.code) return err instanceof Error ? err : new Error(String(err))

  const fields: PgErrorFields = {
    message: pg.message,
    code: pg.code,
    constraint: pg.constraint,
    detail: pg.detail,
  }

  const wrapped = new Error(`${SENTINEL}${JSON.stringify(fields)}`)
  wrapped.name = pg.name || "Error"
  return wrapped
}

/**
 * Called on the invoking side with the `errorMessage` pulled out of the failed
 * invocation's payload. Returns an Error carrying the original pg fields, or null
 * when the message isn't one of ours (so the caller can fall back to a plain Error).
 */
export const decodeDbError = (errorMessage: unknown): Error | null => {
  if (typeof errorMessage !== "string" || !errorMessage.startsWith(SENTINEL)) return null

  try {
    const fields = JSON.parse(errorMessage.slice(SENTINEL.length)) as PgErrorFields
    return Object.assign(new Error(fields.message), {
      code: fields.code,
      constraint: fields.constraint,
      detail: fields.detail,
    })
  } catch {
    // Malformed envelope — let the caller treat it as an opaque failure rather
    // than throwing something even less useful from inside the error path.
    return null
  }
}
