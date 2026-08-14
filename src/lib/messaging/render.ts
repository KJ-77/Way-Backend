// Template rendering — pure functions, no I/O, unit-tested.
//
// WhatsApp templates use POSITIONAL placeholders: {{1}}, {{2}}, … We store the
// approved body verbatim and render a preview locally so staff can read the
// real message in the approval queue before it sends. The provider does its own
// substitution at send time from the same variable array, so the preview and
// the delivered message stay identical.

import { MessagingError } from "./provider"

// Matches {{1}}, {{ 2 }}, … — Meta allows surrounding whitespace.
const PLACEHOLDER_RE = /\{\{\s*(\d+)\s*\}\}/g

/**
 * Returns the distinct placeholder indexes used in a template body, ascending.
 * e.g. "Hi {{1}}, your {{2}} is ready" → [1, 2]
 */
export function extractPlaceholders(body: string): number[] {
  const found = new Set<number>()
  for (const match of body.matchAll(PLACEHOLDER_RE)) {
    found.add(Number(match[1]))
  }
  return [...found].sort((a, b) => a - b)
}

/**
 * Substitutes positional variables into a template body.
 *
 * `variables` is 0-indexed but placeholders are 1-indexed: {{1}} takes
 * variables[0]. Throws when a placeholder has no corresponding value, because
 * sending a message with a literal "{{2}}" in it to a client is worse than
 * failing loudly into the queue.
 */
export function renderTemplate(body: string, variables: string[]): string {
  return body.replace(PLACEHOLDER_RE, (_match, index: string) => {
    const value = variables[Number(index) - 1]
    if (value === undefined || value === null || value === "") {
      throw new MessagingError(
        "TEMPLATE_VARIABLE_MISSING",
        `Template placeholder {{${index}}} has no value`,
      )
    }
    return value
  })
}

/**
 * Converts the `{ "1": "Sara", "2": "mug" }` shape stored on
 * messages.template_variables into the positional array the provider wants.
 * Gaps become empty strings so renderTemplate throws a precise error rather
 * than silently shifting later variables into the wrong slots.
 */
export function variablesToArray(vars: Record<string, string> | null | undefined): string[] {
  if (!vars) return []
  const indexes = Object.keys(vars)
    .map(Number)
    .filter(n => Number.isInteger(n) && n > 0)
  if (indexes.length === 0) return []
  const max = Math.max(...indexes)
  return Array.from({ length: max }, (_, i) => vars[String(i + 1)] ?? "")
}

/**
 * True when a free-form (non-template) message may legally be sent right now.
 *
 * WhatsApp opens a 24-hour "customer service window" each time the client
 * messages the business; outside it, only pre-approved templates are allowed.
 * `lastInboundAt` is derived from the messages table (MAX inbound created_at)
 * — null means the client has never written to us.
 */
export function isServiceWindowOpen(lastInboundAt: string | Date | null, now: Date = new Date()): boolean {
  if (!lastInboundAt) return false
  const last = lastInboundAt instanceof Date ? lastInboundAt : new Date(lastInboundAt)
  if (Number.isNaN(last.getTime())) return false
  const elapsedMs = now.getTime() - last.getTime()
  return elapsedMs >= 0 && elapsedMs < 24 * 60 * 60 * 1000
}
