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

  constructor(channel: MessageChannel = "whatsapp") {
    this.channel = channel
  }

  async sendTemplate(params: SendTemplateParams): Promise<SendResult> {
    console.log("[mock-messaging] template send", {
      to: params.to,
      template: params.templateName,
      language: params.language,
      variables: params.variables,
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
