// Mock messaging provider — the default until the real WhatsApp Business
// Account is connected (Phase 6).
//
// It "sends" by logging to CloudWatch and returning a synthetic message id, so
// the entire feature — drafting, the approval queue, status transitions, the
// inbox — can be built, demoed to the client, and tested without a WABA, a
// migrated phone number, or a single approved template.
//
// Everything it returns is shaped exactly like the real provider's output, so
// swapping implementations changes no code above this layer.

import { randomUUID } from "node:crypto"
import type {
  MessagingProvider,
  SendTemplateParams,
  SendTextParams,
  SendResult,
} from "./provider"
import type { MessageChannel } from "../types"

export class MockMessagingProvider implements MessagingProvider {
  readonly name = "mock"
  readonly channel: MessageChannel

  // Literal "sms" rather than importing DEFAULT_CHANNEL from ./index — index.ts
  // imports this file, so reading the constant here would be a circular import.
  // getProvider() always passes an explicit channel anyway; this default only
  // covers direct construction in tests. (Not "whatsapp_manual": that channel has
  // no provider at all, mock or otherwise.)
  constructor(channel: MessageChannel = "sms") {
    this.channel = channel
  }

  async sendTemplate(params: SendTemplateParams): Promise<SendResult> {
    console.log("[mock-messaging] template send", {
      to: params.to,
      template: params.templateName,
      language: params.language,
      variables: params.variables,
      // Logged so a dev running against the mock sees the exact text that would
      // have gone out, which is what the SMS provider actually transmits.
      renderedBody: params.renderedBody,
    })
    return { providerMessageId: this.mockId() }
  }

  async sendText(params: SendTextParams): Promise<SendResult> {
    console.log("[mock-messaging] free-form send", {
      to: params.to,
      body: params.body,
    })
    return { providerMessageId: this.mockId() }
  }

  // Prefixed so mock ids are never mistaken for real Meta wamids in the DB.
  private mockId(): string {
    return `mock.${randomUUID()}`
  }
}
