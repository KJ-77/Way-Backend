// Provider selection. The rest of the codebase imports `getProvider()` and
// never names a concrete implementation.
//
// Going live is a single env var flip (MESSAGING_PROVIDER=aws-sms) — no code
// change above this file.

import type { MessagingProvider } from "./provider"
import { MockMessagingProvider } from "./mock-provider"
import { AwsSmsProvider } from "./sms-provider"
import type { MessageChannel } from "../types"

export * from "./provider"
export * from "./render"

/**
 * The channel the studio actually uses.
 *
 * Currently `whatsapp_manual` — staff send each message by hand from the studio's
 * own WhatsApp via a wa.me link. SMS was built first but AWS declined production
 * access for now (new account, no billing history), so it's dormant.
 *
 * Every default in the service layer reads this constant rather than hardcoding a
 * channel, so switching back to SMS — or on to the WhatsApp Business API — is an
 * env var flip, not a hunt through scattered string literals.
 *
 * The `messages.channel` column is per-row, so channels can coexist; history from
 * one channel stays correctly labelled after the default moves to another.
 */
export const DEFAULT_CHANNEL: MessageChannel =
  (process.env.DEFAULT_MESSAGE_CHANNEL as MessageChannel) || "whatsapp_manual"

/**
 * Channels that have no provider at all — a human does the sending.
 *
 * These messages must never reach dispatch(). They're claimed via
 * messageService.handoffMessage() instead, and resolved when staff confirm.
 */
export const isManualChannel = (channel: MessageChannel): boolean =>
  channel === "whatsapp_manual"

// Cached per Lambda container — providers are stateless but hold an SDK client,
// which is expensive to construct per invocation.
let cached: MessagingProvider | null = null

export function getProvider(channel: MessageChannel = DEFAULT_CHANNEL): MessagingProvider {
  // Fail loudly. A manual-channel message reaching here means something tried to
  // SEND a message that a person is supposed to send — and with MESSAGING_PROVIDER
  // unset, the mock would happily "send" it and mark it delivered. That would be a
  // silent lie in the history, so refuse outright.
  if (isManualChannel(channel)) {
    throw new Error(
      `Channel "${channel}" is sent by hand and has no provider. ` +
        "Use messageService.handoffMessage(), not approveAndSend().",
    )
  }

  if (cached && cached.channel === channel) return cached

  // Defaults to "mock" so a missing/unset env var can never accidentally send
  // real messages to real clients. Going live must be deliberate.
  const kind = process.env.MESSAGING_PROVIDER ?? "mock"

  switch (kind) {
    case "aws-sms": {
      // Fail loudly and specifically at construction rather than letting AWS
      // reject every send with an opaque ResourceNotFoundException. A missing
      // sender ID is a deployment mistake, and it should read like one.
      const originationIdentity = process.env.SMS_SENDER_ID
      if (!originationIdentity) {
        throw new Error(
          "MESSAGING_PROVIDER=aws-sms requires SMS_SENDER_ID (the alphanumeric " +
            'sender ID registered with AWS, e.g. "WayStudio").',
        )
      }
      cached = new AwsSmsProvider({
        region: process.env.SMS_REGION || process.env.AWS_REGION || "eu-west-3",
        originationIdentity,
        configurationSetName: process.env.SMS_CONFIGURATION_SET,
        maxPricePerMessage: process.env.SMS_MAX_PRICE,
      })
      return cached
    }
    case "aws-whatsapp":
      // Reserved for the future WhatsApp rollout, backed by AWS End User Messaging
      // Social. Deliberately unimplemented — shipping a stub that silently no-ops
      // would be worse than failing loudly here.
      throw new Error(
        "MESSAGING_PROVIDER=aws-whatsapp is not implemented. WhatsApp is a planned " +
          "future upgrade; see local/claude/plans/sms-implementation.md.",
      )
    case "mock":
      cached = new MockMessagingProvider(channel)
      return cached
    default:
      throw new Error(
        `Unknown MESSAGING_PROVIDER "${kind}" — expected "mock", "aws-sms" or "aws-whatsapp"`,
      )
  }
}

// Test seam — lets unit tests inject a fake without touching env vars.
export function __setProviderForTests(provider: MessagingProvider | null): void {
  cached = provider
}
