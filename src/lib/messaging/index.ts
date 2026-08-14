// Provider selection. The rest of the codebase imports `getProvider()` and
// never names a concrete implementation.
//
// Switching to live WhatsApp is a single env var flip (MESSAGING_PROVIDER=aws)
// once the WABA is connected — no code change above this file.

import type { MessagingProvider } from "./provider"
import { MockMessagingProvider } from "./mock-provider"
import type { MessageChannel } from "../types"

export * from "./provider"
export * from "./render"

// Cached per Lambda container — providers are stateless but may hold an SDK
// client, which is expensive to construct per invocation.
let cached: MessagingProvider | null = null

export function getProvider(channel: MessageChannel = "whatsapp"): MessagingProvider {
  if (cached && cached.channel === channel) return cached

  // Defaults to "mock" so a missing/unset env var can never accidentally send
  // real messages to real clients. Going live must be deliberate.
  const kind = process.env.MESSAGING_PROVIDER ?? "mock"

  switch (kind) {
    case "aws":
      // Phase 6: AwsSocialMessagingProvider, backed by AWS End User Messaging
      // Social (@aws-sdk/client-socialmessaging). Deliberately not implemented
      // yet — it needs a real WABA id + phone number id, and shipping a stub
      // that silently no-ops would be worse than failing loudly here.
      throw new Error(
        "MESSAGING_PROVIDER=aws is not implemented yet (Phase 6). " +
          "Unset the variable to use the mock provider.",
      )
    case "mock":
      cached = new MockMessagingProvider(channel)
      return cached
    default:
      throw new Error(`Unknown MESSAGING_PROVIDER "${kind}" — expected "mock" or "aws"`)
  }
}

// Test seam — lets unit tests inject a fake without touching env vars.
export function __setProviderForTests(provider: MessagingProvider | null): void {
  cached = provider
}
