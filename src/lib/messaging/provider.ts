// ── Messaging provider abstraction ──
//
// Everything above this layer (the queue, the approval flow, the inbox) is
// transport-agnostic. Only implementations of `MessagingProvider` know about
// WhatsApp, SMS, AWS End User Messaging Social, or Meta.
//
// Why an interface rather than calling AWS directly:
//   1. The entire feature can be built and exercised end-to-end against the
//      mock provider before a WhatsApp Business Account exists.
//   2. Going live is a config change (MESSAGING_PROVIDER env var), not a
//      refactor.
//   3. SMS fallback slots in as a second implementation, not a second codepath.

import type { MessageChannel, TemplateCategory } from "../types"

// Business-initiated send. WhatsApp requires a pre-approved template for these,
// so we pass the template's registered name + positional variables rather than
// rendered text — the provider is what actually substitutes them.
export interface SendTemplateParams {
  to: string // E.164, e.g. "+96170779950"
  templateName: string
  language: string
  // Positional values for {{1}}, {{2}}, … in order.
  variables: string[]
  // The already-substituted message text, snapshotted at enqueue time.
  //
  // WhatsApp IGNORES this — Meta does its own substitution from `variables`, and
  // sending raw text would bypass the approved-template requirement. SMS has no
  // concept of a provider-side template, so it sends this string verbatim.
  //
  // Passing both is what lets one interface serve both transports: each provider
  // takes the half it can actually use, and the queue preview stays byte-identical
  // to what the client receives either way.
  renderedBody: string
  // Utility vs marketing. Meta infers this from the registered template, but SMS
  // needs it explicitly — AWS routes TRANSACTIONAL traffic at a higher delivery
  // priority than PROMOTIONAL, and the distinction is also a compliance one.
  category?: TemplateCategory
}

// Free-form send. Only legal inside an open 24-hour customer service window
// (WhatsApp) — the SERVICE layer enforces that rule before calling this, since
// it's a business rule, not a transport concern. SMS has no window, so free-form
// is always legal there.
export interface SendTextParams {
  to: string
  body: string
  category?: TemplateCategory
}

export interface SendResult {
  // Provider's own id — Meta's "wamid.…", an SMS id, or a mock id in dev.
  // Stored on messages.provider_message_id, which carries a partial UNIQUE
  // index so duplicate status webhooks can't be processed twice.
  providerMessageId: string
}

export interface MessagingProvider {
  // Identifies the implementation in logs and in the health endpoint.
  readonly name: string
  readonly channel: MessageChannel
  sendTemplate(params: SendTemplateParams): Promise<SendResult>
  sendText(params: SendTextParams): Promise<SendResult>
}

// Typed failure so the handler layer can map provider problems onto stable API
// error codes (see lib/response.ts taxonomy) instead of leaking raw SDK errors.
export class MessagingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    // Whether retrying the same send could plausibly succeed. Transient network
    // or rate-limit failures are retryable; a rejected template is not.
    public readonly retryable = false,
  ) {
    super(message)
    this.name = "MessagingError"
  }
}
