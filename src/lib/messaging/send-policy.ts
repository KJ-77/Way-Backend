// ── Send policy: how a synchronous send handles failure ──
//
// We send synchronously (no SQS/outbox) because the studio's volume is ~20
// messages a day. The cost of that choice is that there's no background worker
// to retry for us, so the retry/classification rules have to be exactly right
// in-process. This file is that logic, kept pure so it's fully unit-testable.
//
// The central idea — three outcomes, not two:
//
//   PERMANENT   The provider rejected it. Retrying changes nothing.
//               → mark 'failed', show the reason, let staff fix and re-queue.
//
//   RETRYABLE   We know for certain the message never reached the provider
//               (connection refused, DNS failure, 429, 5xx). Safe to retry
//               because nothing was delivered.
//
//   UNCONFIRMED We do NOT know whether it was delivered — a timeout, an
//               aborted request, a crash mid-flight. The request may well have
//               been received and acted on.
//               → NEVER auto-retry. Retrying an unconfirmed send is precisely
//                 how a client receives the same message twice. Park it in
//                 'queued' and surface it to a human to resolve.
//
// Most naive implementations collapse UNCONFIRMED into RETRYABLE and quietly
// double-send on every timeout. Keeping the third case is the single most
// important correctness decision in the synchronous design.

import { MessagingError } from "./provider"

export type FailureClass = "permanent" | "retryable" | "unconfirmed"

// Node/undici network error codes where the request provably never completed.
const RETRYABLE_NET_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "ENETUNREACH",
])

// Codes that mean "we gave up waiting" — the peer may still have processed it.
const TIMEOUT_CODES = new Set([
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "ABORT_ERR",
  "TimeoutError",
  "RequestAbortedException",
])

/**
 * Decides how to treat a failed send.
 *
 * Order matters: timeout/abort is checked BEFORE the generic retryable buckets,
 * because a timeout that also carries a network-ish code must still be treated
 * as unconfirmed rather than retried.
 */
export function classifyFailure(err: unknown): FailureClass {
  const e = err as { name?: string; code?: string; $metadata?: { httpStatusCode?: number }; retryable?: boolean }

  const code = e?.code ?? ""
  const name = e?.name ?? ""

  // 1. Unconfirmed — we stopped waiting; the provider may have acted anyway.
  if (TIMEOUT_CODES.has(code) || TIMEOUT_CODES.has(name)) return "unconfirmed"
  if (name === "AbortError") return "unconfirmed"

  // 2. Our own typed errors carry an explicit intent.
  if (err instanceof MessagingError) {
    return err.retryable ? "retryable" : "permanent"
  }

  // 3. Network failures where the connection never established.
  if (RETRYABLE_NET_CODES.has(code)) return "retryable"

  // 4. HTTP status from the AWS SDK.
  const status = e?.$metadata?.httpStatusCode
  if (typeof status === "number") {
    // Throttling and server-side faults are safe to retry — the request was
    // rejected outright, not partially processed.
    if (status === 429) return "retryable"
    if (status >= 500) {
      // 504 Gateway Timeout is the exception: an upstream timeout means the
      // request may have reached the origin.
      return status === 504 ? "unconfirmed" : "retryable"
    }
    // 4xx — bad template, unregistered number, not-approved template, etc.
    return "permanent"
  }

  // 5. Unknown shape. Treat as unconfirmed rather than permanent or retryable:
  // failing closed here means a human looks at it, which is always safe.
  // Assuming "retryable" could double-send; assuming "permanent" could silently
  // drop a message that actually went out.
  return "unconfirmed"
}

export interface RetryPolicy {
  // Number of RETRIES after the initial attempt (so 2 = up to 3 total sends).
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
}

// Tuned to stay far inside API Gateway's hard 29s response limit:
// worst case ≈ 3 provider calls (8s timeout each is bounded separately) plus
// ~0.8s of backoff. In practice a retry costs a few hundred milliseconds.
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  baseDelayMs: 200,
  maxDelayMs: 2_000,
}

/**
 * Exponential backoff with full jitter.
 *
 * Jitter matters even at our scale: a broadcast drains in chunks, so without it
 * a provider hiccup would make every message in the chunk retry in lockstep and
 * hit the provider as a synchronised burst. `random` is injectable for tests.
 */
export function backoffDelayMs(
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(policy.baseDelayMs * 2 ** attempt, policy.maxDelayMs)
  return Math.round(exponential * random())
}

export interface SendOutcome<T> {
  result?: T
  // Present when the send did not succeed.
  failure?: {
    class: FailureClass
    code: string
    message: string
  }
  attempts: number
}

/**
 * Runs a send with the retry policy, returning a structured outcome rather than
 * throwing — the caller needs to record `attempts` and the failure class on the
 * message row regardless of which way it went.
 *
 * `sleep` is injectable so tests don't actually wait.
 */
export async function sendWithRetry<T>(
  send: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
  random: () => number = Math.random,
): Promise<SendOutcome<T>> {
  let attempts = 0
  let lastError: unknown

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    attempts++
    try {
      return { result: await send(), attempts }
    } catch (err) {
      lastError = err
      const failureClass = classifyFailure(err)

      // Only "retryable" loops. "unconfirmed" must stop immediately — retrying
      // is what causes duplicate messages. "permanent" has nothing to gain.
      if (failureClass !== "retryable" || attempt === policy.maxRetries) {
        return { failure: describeFailure(err, failureClass), attempts }
      }
      await sleep(backoffDelayMs(attempt, policy, random))
    }
  }

  // Unreachable — the loop always returns. Present for exhaustiveness.
  return { failure: describeFailure(lastError, classifyFailure(lastError)), attempts }
}

function describeFailure(err: unknown, failureClass: FailureClass) {
  const e = err as { name?: string; code?: string; message?: string }
  return {
    class: failureClass,
    code: e?.code ?? e?.name ?? "UNKNOWN",
    message: e?.message ?? String(err),
  }
}
