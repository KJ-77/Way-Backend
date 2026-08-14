// ============================================================================
// dbError.test.ts — Tests for pg error metadata survival across Lambda invokes
//
// WHAT'S BEING TESTED:
// encodeDbError / decodeDbError, the pair that carries a Postgres error's
// `code` / `constraint` / `detail` from the VPC-bound DB Lambda back to the
// handler that invoked it.
//
// WHY IT MATTERS:
// AWS serializes a thrown error to { errorType, errorMessage, trace } and drops
// every custom property. Before this pair existed, a duplicate-phone INSERT
// reached the caller as a bare Error and handleError()'s 23505 branch never
// fired — the client got an opaque 500 for what is really a 409. These tests
// pin the round-trip so that regression can't come back silently.
// ============================================================================

import { describe, it, expect } from "vitest"
import type { APIGatewayProxyResultV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda"
import { encodeDbError, decodeDbError } from "../dbError"
import { handleError } from "../response"

// Mirrors what `pg` actually throws for a UNIQUE violation
const makePgError = (constraint: string) =>
  Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), {
    code: "23505",
    constraint,
    detail: "Key (phone)=(+96176733290) already exists.",
  })

// APIGatewayProxyResultV2 is a union with `string`, so statusCode/body aren't
// addressable without narrowing to the structured arm first.
const asResult = (r: APIGatewayProxyResultV2) => r as APIGatewayProxyStructuredResultV2
const bodyOf = (r: APIGatewayProxyResultV2) => JSON.parse(asResult(r).body ?? "{}")

describe("encodeDbError / decodeDbError round-trip", () => {
  it("preserves code, constraint and detail across the boundary", () => {
    // Arrange: a pg unique-violation, as thrown inside the DB Lambda
    const original = makePgError("users_phone_key")

    // Act: encode on the DB side, then decode from the message AWS would deliver
    const decoded = decodeDbError(encodeDbError(original).message)

    // Assert: the three fields handleError() branches on all survived
    expect(decoded).not.toBeNull()
    expect(decoded).toMatchObject({
      code: "23505",
      constraint: "users_phone_key",
      detail: "Key (phone)=(+96176733290) already exists.",
    })
  })

  it("preserves the original human-readable message", () => {
    const original = makePgError("users_phone_key")
    const decoded = decodeDbError(encodeDbError(original).message)
    expect(decoded?.message).toBe(original.message)
  })

  it("leaves errors without pg metadata untouched", () => {
    // A bug in our own code or a timeout is more useful with its real message
    const plain = new Error("Unknown action: frobnicate")
    const encoded = encodeDbError(plain)

    expect(encoded).toBe(plain)
    expect(decodeDbError(encoded.message)).toBeNull()
  })

  it("returns null for messages it didn't encode", () => {
    expect(decodeDbError("Lambda invocation failed")).toBeNull()
    expect(decodeDbError(undefined)).toBeNull()
    expect(decodeDbError("")).toBeNull()
  })

  it("returns null rather than throwing on a malformed envelope", () => {
    // Guards the error path itself — a bad envelope must not throw from inside
    // the code that's already handling a failure
    expect(decodeDbError("__PG_ERR__{not valid json")).toBeNull()
  })
})

// ── The reason this module exists ───────────────────────────────────────────
// These two assert the end-to-end outcome: a duplicate phone must reach the
// client as 409 PHONE_TAKEN, not 500.

describe("decoded errors drive the right HTTP response", () => {
  it("maps a round-tripped duplicate phone to 409 PHONE_TAKEN", () => {
    const decoded = decodeDbError(encodeDbError(makePgError("users_phone_key")).message)

    const result = handleError(decoded)

    expect(asResult(result).statusCode).toBe(409)
    expect(bodyOf(result).code).toBe("PHONE_TAKEN")
  })

  it("maps a round-tripped duplicate email to 409 EMAIL_TAKEN", () => {
    const decoded = decodeDbError(encodeDbError(makePgError("users_email_key")).message)

    const result = handleError(decoded)

    expect(asResult(result).statusCode).toBe(409)
    expect(bodyOf(result).code).toBe("EMAIL_TAKEN")
  })

  it("still yields a 500 when the metadata is lost (the old behaviour)", () => {
    // Documents exactly what regressing this module would cost us
    const flattened = new Error('duplicate key value violates unique constraint "users_phone_key"')

    expect(asResult(handleError(flattened)).statusCode).toBe(500)
  })
})
