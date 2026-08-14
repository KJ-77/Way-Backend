import { describe, it, expect, vi } from "vitest"
import {
  classifyFailure,
  backoffDelayMs,
  sendWithRetry,
  DEFAULT_RETRY_POLICY,
} from "../send-policy"
import { MessagingError } from "../provider"

// No-op sleep so retry tests don't actually wait.
const noSleep = async () => {}
// Deterministic jitter.
const fixedRandom = () => 0.5

describe("classifyFailure", () => {
  it("treats an explicit retryable MessagingError as retryable", () => {
    expect(classifyFailure(new MessagingError("RATE_LIMIT", "slow down", true))).toBe("retryable")
  })

  it("treats a non-retryable MessagingError as permanent", () => {
    expect(classifyFailure(new MessagingError("TEMPLATE_NOT_APPROVED", "nope", false))).toBe("permanent")
  })

  it("treats connection failures as retryable (request never landed)", () => {
    expect(classifyFailure({ code: "ECONNREFUSED" })).toBe("retryable")
    expect(classifyFailure({ code: "ENOTFOUND" })).toBe("retryable")
  })

  it("treats 429 as retryable", () => {
    expect(classifyFailure({ $metadata: { httpStatusCode: 429 } })).toBe("retryable")
  })

  it("treats 5xx as retryable", () => {
    expect(classifyFailure({ $metadata: { httpStatusCode: 500 } })).toBe("retryable")
    expect(classifyFailure({ $metadata: { httpStatusCode: 503 } })).toBe("retryable")
  })

  it("treats 4xx as permanent", () => {
    expect(classifyFailure({ $metadata: { httpStatusCode: 400 } })).toBe("permanent")
    expect(classifyFailure({ $metadata: { httpStatusCode: 404 } })).toBe("permanent")
  })

  // ── The critical cases: anything that might have been delivered ──

  it("treats a timeout as UNCONFIRMED, never retryable", () => {
    expect(classifyFailure({ code: "ETIMEDOUT" })).toBe("unconfirmed")
  })

  it("treats an aborted request as UNCONFIRMED", () => {
    expect(classifyFailure({ name: "AbortError" })).toBe("unconfirmed")
    expect(classifyFailure({ code: "ABORT_ERR" })).toBe("unconfirmed")
  })

  it("treats 504 Gateway Timeout as UNCONFIRMED, not retryable like other 5xx", () => {
    expect(classifyFailure({ $metadata: { httpStatusCode: 504 } })).toBe("unconfirmed")
  })

  it("prefers UNCONFIRMED over retryable when an error carries both signals", () => {
    // A timeout that also reports a network-ish code must not be retried.
    expect(classifyFailure({ code: "ETIMEDOUT", $metadata: { httpStatusCode: 500 } })).toBe("unconfirmed")
  })

  it("fails closed to UNCONFIRMED for an unrecognised error shape", () => {
    // Safer than guessing: a human looks at it. Guessing 'retryable' could
    // double-send; guessing 'permanent' could silently drop a delivered message.
    expect(classifyFailure(new Error("something weird"))).toBe("unconfirmed")
    expect(classifyFailure(undefined)).toBe("unconfirmed")
  })
})

describe("backoffDelayMs", () => {
  it("grows exponentially with the attempt number", () => {
    expect(backoffDelayMs(0, DEFAULT_RETRY_POLICY, () => 1)).toBe(200)
    expect(backoffDelayMs(1, DEFAULT_RETRY_POLICY, () => 1)).toBe(400)
    expect(backoffDelayMs(2, DEFAULT_RETRY_POLICY, () => 1)).toBe(800)
  })

  it("caps at maxDelayMs", () => {
    expect(backoffDelayMs(20, DEFAULT_RETRY_POLICY, () => 1)).toBe(DEFAULT_RETRY_POLICY.maxDelayMs)
  })

  it("applies jitter (scales the delay by the random factor)", () => {
    expect(backoffDelayMs(1, DEFAULT_RETRY_POLICY, () => 0.5)).toBe(200)
    expect(backoffDelayMs(1, DEFAULT_RETRY_POLICY, () => 0)).toBe(0)
  })
})

describe("sendWithRetry", () => {
  it("returns the result on first success without retrying", async () => {
    const send = vi.fn().mockResolvedValue({ providerMessageId: "wamid.1" })
    const outcome = await sendWithRetry(send, DEFAULT_RETRY_POLICY, noSleep, fixedRandom)

    expect(outcome.result).toEqual({ providerMessageId: "wamid.1" })
    expect(outcome.attempts).toBe(1)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("retries a retryable failure and succeeds", async () => {
    const send = vi.fn()
      .mockRejectedValueOnce({ code: "ECONNRESET" })
      .mockResolvedValue({ providerMessageId: "wamid.2" })

    const outcome = await sendWithRetry(send, DEFAULT_RETRY_POLICY, noSleep, fixedRandom)

    expect(outcome.result).toEqual({ providerMessageId: "wamid.2" })
    expect(outcome.attempts).toBe(2)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it("stops after maxRetries and reports the failure", async () => {
    const send = vi.fn().mockRejectedValue({ code: "ECONNRESET" })
    const outcome = await sendWithRetry(send, DEFAULT_RETRY_POLICY, noSleep, fixedRandom)

    // 1 initial + 2 retries
    expect(send).toHaveBeenCalledTimes(3)
    expect(outcome.attempts).toBe(3)
    expect(outcome.failure?.class).toBe("retryable")
    expect(outcome.result).toBeUndefined()
  })

  it("does NOT retry a permanent failure", async () => {
    const send = vi.fn().mockRejectedValue(new MessagingError("TEMPLATE_NOT_APPROVED", "nope", false))
    const outcome = await sendWithRetry(send, DEFAULT_RETRY_POLICY, noSleep, fixedRandom)

    expect(send).toHaveBeenCalledTimes(1)
    expect(outcome.failure?.class).toBe("permanent")
    expect(outcome.failure?.code).toBe("TEMPLATE_NOT_APPROVED")
  })

  it("does NOT retry an unconfirmed failure — this is what prevents double-sends", async () => {
    const send = vi.fn().mockRejectedValue({ code: "ETIMEDOUT", message: "timed out" })
    const outcome = await sendWithRetry(send, DEFAULT_RETRY_POLICY, noSleep, fixedRandom)

    expect(send).toHaveBeenCalledTimes(1)
    expect(outcome.attempts).toBe(1)
    expect(outcome.failure?.class).toBe("unconfirmed")
  })

  it("reports the error code and message on failure", async () => {
    const send = vi.fn().mockRejectedValue({ code: "ECONNREFUSED", message: "connection refused" })
    const outcome = await sendWithRetry(send, DEFAULT_RETRY_POLICY, noSleep, fixedRandom)

    expect(outcome.failure).toMatchObject({
      class: "retryable",
      code: "ECONNREFUSED",
      message: "connection refused",
    })
  })

  it("sleeps between retries using the backoff delay", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const send = vi.fn().mockRejectedValue({ code: "ECONNRESET" })

    await sendWithRetry(send, DEFAULT_RETRY_POLICY, sleep, () => 1)

    // Two retries → two sleeps, at 200ms then 400ms (no jitter with random()=1)
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenNthCalledWith(1, 200)
    expect(sleep).toHaveBeenNthCalledWith(2, 400)
  })
})
