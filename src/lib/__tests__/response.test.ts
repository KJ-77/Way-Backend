// ============================================================================
// response.test.ts — Tests for our API response utility functions
//
// WHAT'S BEING TESTED:
// Three pure functions from response.ts: createResponse, parseBody, handleError
// These are the backbone of every API response in our backend.
//
// WHY THESE?
// They're pure functions — given the same input, they always return the same
// output. No database, no network, no side effects. This makes them the ideal
// first thing to test in any codebase.
//
// KEY PATTERN: AAA (Arrange, Act, Assert)
// Every test follows this structure:
//   1. Arrange — set up the inputs
//   2. Act    — call the function
//   3. Assert — check the output matches what you expect
// ============================================================================

import { describe, it, expect, vi } from "vitest"
import { createResponse, parseBody, handleError } from "../response"

// ── createResponse ──────────────────────────────────────────────────────────
// This function wraps data into the shape API Gateway expects:
// { statusCode, headers, body (JSON string) }

describe("createResponse", () => {
  it("returns the correct status code", () => {
    // Arrange: nothing to set up — the function is simple
    // Act: call it with status 200 and some data
    const result = createResponse(200, { message: "ok" })
    // Assert: the status code matches
    expect(result.statusCode).toBe(200)
  })

  it("sets Content-Type header to application/json", () => {
    const result = createResponse(200, {})
    // We check that the header object exists and has the right value
    expect(result.headers).toEqual({ "Content-Type": "application/json" })
  })

  it("JSON-stringifies the body", () => {
    const data = { users: [{ id: 1, name: "Khalil" }] }
    const result = createResponse(200, data)
    // The body should be a JSON string, not the raw object
    expect(result.body).toBe(JSON.stringify(data))
  })

  it("works with error status codes too", () => {
    const result = createResponse(404, { error: "Not found" })
    expect(result.statusCode).toBe(404)
    expect(JSON.parse(result.body as string)).toEqual({ error: "Not found" })
  })
})

// ── parseBody ───────────────────────────────────────────────────────────────
// Parses the JSON body from an API Gateway event. Returns {} for null/undefined,
// throws on invalid JSON.

describe("parseBody", () => {
  it("parses valid JSON into an object", () => {
    const body = JSON.stringify({ full_name: "Tarek", phone: "+961 71 123 456" })
    const result = parseBody(body)
    expect(result).toEqual({ full_name: "Tarek", phone: "+961 71 123 456" })
  })

  it("returns empty object when body is null", () => {
    // API Gateway sends null body on GET requests with no body
    const result = parseBody(null)
    expect(result).toEqual({})
  })

  it("returns empty object when body is undefined", () => {
    const result = parseBody(undefined)
    expect(result).toEqual({})
  })

  it("throws on invalid JSON", () => {
    // expect().toThrow() checks that the function throws an error
    // We wrap the call in a function because toThrow needs a function to call
    expect(() => parseBody("not valid json {{{")).toThrow("Invalid JSON body")
  })
})

// ── handleError ─────────────────────────────────────────────────────────────
// Converts various error types into proper API responses.
// Maps Postgres error codes and Cognito error names to meaningful HTTP statuses.

describe("handleError", () => {
  // Suppress console.error in tests — we don't want error logs cluttering output.
  // vi.spyOn replaces console.error with a no-op function for the duration of each test.
  // This is your first taste of "mocking" — replacing a real function with a fake one.
  vi.spyOn(console, "error").mockImplementation(() => {})

  it("returns 409 for Postgres duplicate entry (code 23505)", () => {
    // Arrange: create an error that looks like what Postgres throws
    const pgError = Object.assign(new Error("duplicate key value"), { code: "23505" })
    // Act
    const result = handleError(pgError)
    // Assert
    expect(result.statusCode).toBe(409)
    expect(JSON.parse(result.body as string).error).toBe("Duplicate entry")
  })

  it("returns 400 for Postgres foreign key violation (code 23503)", () => {
    const pgError = Object.assign(new Error("violates foreign key"), { code: "23503" })
    const result = handleError(pgError)
    expect(result.statusCode).toBe(400)
    expect(JSON.parse(result.body as string).error).toBe("Foreign key violation")
  })

  it("returns 409 for schedule conflicts (code 23P01)", () => {
    const pgError = Object.assign(new Error("exclusion constraint"), { code: "23P01" })
    const result = handleError(pgError)
    expect(result.statusCode).toBe(409)
    expect(JSON.parse(result.body as string).error).toBe("Schedule conflict")
  })

  it("returns 404 for Cognito UserNotFoundException", () => {
    // Arrange: Cognito errors have a `name` property instead of `code`
    const cognitoError = new Error("User does not exist")
    cognitoError.name = "UserNotFoundException"
    const result = handleError(cognitoError)
    expect(result.statusCode).toBe(404)
  })

  it("returns 500 for unknown errors", () => {
    const genericError = new Error("something broke")
    const result = handleError(genericError)
    expect(result.statusCode).toBe(500)
    expect(JSON.parse(result.body as string).error).toBe("Server error")
  })

  // ── Error code taxonomy ────────────────────────────────────────────────────
  // Every error response now includes a stable `code` field that frontends use
  // to translate the error into a user-friendly message. Tests below verify each
  // recognized error path emits the right code.

  it("emits code PHONE_TAKEN for phone unique-constraint violation", () => {
    const pgError = Object.assign(new Error("dup phone"), {
      code: "23505",
      constraint: "users_phone_key",
    })
    const body = JSON.parse(handleError(pgError).body as string)
    expect(body.code).toBe("PHONE_TAKEN")
  })

  it("emits code EMAIL_TAKEN for email unique-constraint violation", () => {
    const pgError = Object.assign(new Error("dup email"), {
      code: "23505",
      constraint: "users_email_key",
    })
    const body = JSON.parse(handleError(pgError).body as string)
    expect(body.code).toBe("EMAIL_TAKEN")
  })

  it("emits code DUPLICATE for other unique-constraint violations", () => {
    const pgError = Object.assign(new Error("dup something"), {
      code: "23505",
      constraint: "some_other_key",
    })
    const body = JSON.parse(handleError(pgError).body as string)
    expect(body.code).toBe("DUPLICATE")
  })

  it("emits code FK_VIOLATION for foreign-key violations", () => {
    const pgError = Object.assign(new Error("fk"), { code: "23503" })
    const body = JSON.parse(handleError(pgError).body as string)
    expect(body.code).toBe("FK_VIOLATION")
  })

  it("emits code SCHEDULE_CONFLICT for exclusion-constraint violations", () => {
    const pgError = Object.assign(new Error("excl"), { code: "23P01" })
    const body = JSON.parse(handleError(pgError).body as string)
    expect(body.code).toBe("SCHEDULE_CONFLICT")
  })

  it("emits code USERNAME_EXISTS for Cognito UsernameExistsException", () => {
    const cognitoError = new Error("user exists")
    cognitoError.name = "UsernameExistsException"
    const body = JSON.parse(handleError(cognitoError).body as string)
    expect(body.code).toBe("USERNAME_EXISTS")
  })

  it("emits code USER_NOT_FOUND for Cognito UserNotFoundException", () => {
    const cognitoError = new Error("not found")
    cognitoError.name = "UserNotFoundException"
    const body = JSON.parse(handleError(cognitoError).body as string)
    expect(body.code).toBe("USER_NOT_FOUND")
  })

  it("emits code INVALID_CREDENTIALS for Cognito NotAuthorizedException", () => {
    const cognitoError = new Error("wrong password")
    cognitoError.name = "NotAuthorizedException"
    const result = handleError(cognitoError)
    expect(result.statusCode).toBe(401)
    expect(JSON.parse(result.body as string).code).toBe("INVALID_CREDENTIALS")
  })

  it("emits code SERVER_ERROR for unknown errors", () => {
    const body = JSON.parse(handleError(new Error("boom")).body as string)
    expect(body.code).toBe("SERVER_ERROR")
  })
})
