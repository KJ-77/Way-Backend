// ── AWS End User Messaging SMS provider ──
//
// The live transport. Sends through AWS End User Messaging SMS (the service
// formerly known as Amazon Pinpoint SMS), API version v2.
//
// Lebanon-specific context that shapes this whole file:
//   • Lebanon supports alphanumeric SENDER IDs only — no long codes, no short
//     codes. So `OriginationIdentity` is a name like "WayStudio", not a number.
//   • Sender IDs are OUTBOUND ONLY. There is no inbound path, which is why this
//     provider implements sending and nothing else. Replies are impossible at the
//     carrier level, not merely unimplemented.
//   • A numeric origination identity sent to Lebanon gets silently rewritten by
//     downstream carriers, so the sender ID must be alphanumeric or delivery
//     degrades to best-effort.
//
// See local/claude/plans/sms-implementation.md for the full picture.

import {
  PinpointSMSVoiceV2Client,
  SendTextMessageCommand,
} from "@aws-sdk/client-pinpoint-sms-voice-v2"
import {
  MessagingError,
  type MessagingProvider,
  type SendTemplateParams,
  type SendTextParams,
  type SendResult,
} from "./provider"
import type { MessageChannel, TemplateCategory } from "../types"

// AWS caps a single SendTextMessage body at 1600 characters. We check locally so
// an over-long message fails as a clear validation error in our own taxonomy
// rather than as an opaque ValidationException after a network round-trip.
const MAX_BODY_LENGTH = 1600

export interface SmsProviderOptions {
  region: string
  // Alphanumeric sender ID (max 11 chars) — what the recipient sees as the sender.
  originationIdentity: string
  // Optional configuration set, which is what wires delivery/failure events to the
  // SNS topic. Without it we get no delivery receipts at all.
  configurationSetName?: string
  // Safety valve: refuse to send any single message costing more than this (USD).
  // Guards against a pricing surprise silently draining the client's budget —
  // most relevant for Arabic messages, which fan out into several billable parts.
  maxPricePerMessage?: string
  client?: PinpointSMSVoiceV2Client // injectable for tests
}

export class AwsSmsProvider implements MessagingProvider {
  readonly name = "aws-sms"
  readonly channel: MessageChannel = "sms"

  private readonly client: PinpointSMSVoiceV2Client
  private readonly options: SmsProviderOptions

  constructor(options: SmsProviderOptions) {
    this.options = options
    // One client per Lambda container (see index.ts caching) — constructing an SDK
    // client resolves credentials and builds a request pipeline, which is far too
    // expensive to repeat per invocation.
    this.client = options.client ?? new PinpointSMSVoiceV2Client({ region: options.region })
  }

  /**
   * Sends a "template" message.
   *
   * SMS has no provider-side template concept, so unlike WhatsApp there's nothing
   * to register and nothing for AWS to substitute. We send `renderedBody` — the
   * exact text a staff member approved in the queue — which means the preview and
   * the delivered message are the same string by construction, not by convention.
   */
  async sendTemplate(params: SendTemplateParams): Promise<SendResult> {
    return this.send(params.to, params.renderedBody, params.category)
  }

  /** Free-form send. Identical mechanics — SMS draws no distinction. */
  async sendText(params: SendTextParams): Promise<SendResult> {
    return this.send(params.to, params.body, params.category)
  }

  private async send(
    to: string,
    body: string,
    category: TemplateCategory = "utility",
  ): Promise<SendResult> {
    if (!body || !body.trim()) {
      throw new MessagingError("EMPTY_BODY", "Cannot send an empty SMS")
    }
    if (body.length > MAX_BODY_LENGTH) {
      throw new MessagingError(
        "BODY_TOO_LONG",
        `SMS body is ${body.length} characters; the maximum is ${MAX_BODY_LENGTH}.`,
      )
    }

    // Log the billable size before sending. Arabic text encodes as UCS-2, which
    // cuts a segment from 160 characters to 70 — so a message that looks short can
    // quietly cost 3× an English one. Having this in CloudWatch makes a surprising
    // invoice explainable after the fact.
    const segments = estimateSegments(body)
    console.log("[sms] sending", {
      to: maskPhone(to),
      category,
      characters: body.length,
      segments: segments.count,
      encoding: segments.encoding,
    })

    try {
      const result = await this.client.send(
        new SendTextMessageCommand({
          DestinationPhoneNumber: to,
          OriginationIdentity: this.options.originationIdentity,
          MessageBody: body,
          // Utility messages are transactional: AWS routes them at a higher
          // delivery priority. Marketing is explicitly PROMOTIONAL — mislabelling
          // promos as transactional is exactly the kind of thing that damages
          // sender reputation with carriers.
          MessageType: category === "marketing" ? "PROMOTIONAL" : "TRANSACTIONAL",
          ...(this.options.configurationSetName
            ? { ConfigurationSetName: this.options.configurationSetName }
            : {}),
          ...(this.options.maxPricePerMessage
            ? { MaxPrice: this.options.maxPricePerMessage }
            : {}),
        }),
      )

      if (!result.MessageId) {
        // Shouldn't happen, but a success response with no id would leave us unable
        // to correlate the delivery receipt later. Treat it as unconfirmed rather
        // than pretending the send succeeded cleanly.
        throw new MessagingError(
          "NO_MESSAGE_ID",
          "AWS accepted the message but returned no MessageId",
        )
      }

      return { providerMessageId: result.MessageId }
    } catch (err) {
      throw translateAwsError(err)
    }
  }
}

/**
 * Maps AWS SDK exceptions onto our MessagingError taxonomy.
 *
 * ⚠️ THE REASON THIS FUNCTION EXISTS AT ALL:
 * The SMS v2 API returns HTTP **400** for almost everything — including
 * ThrottlingException and ServiceQuotaExceededException. Only InternalServerException
 * is a 5xx. Our generic `classifyFailure()` treats 4xx as permanent and 5xx as
 * retryable, which is the right default for most APIs but is exactly backwards for
 * throttling here: a rate-limited send would be marked permanently failed and never
 * retried.
 *
 * So we classify by exception NAME, not status code, and hand back a MessagingError
 * carrying an explicit `retryable` flag. `classifyFailure()` checks for
 * MessagingError before it ever looks at the HTTP status, so this wins.
 *
 * Anything we don't recognise is re-thrown UNTOUCHED. That matters: timeouts and
 * socket errors must keep their original shape so they classify as "unconfirmed"
 * and get a human's attention instead of being auto-retried into a double-send.
 */
export function translateAwsError(err: unknown): unknown {
  const e = err as { name?: string; message?: string; Reason?: string }
  const name = e?.name ?? ""
  // Several exceptions carry a `Reason` enum that's far more actionable than the
  // generic message (e.g. DESTINATION_PHONE_NUMBER_OPTED_OUT).
  const detail = e?.Reason ? `${e.Reason}: ${e.message ?? ""}` : (e?.message ?? String(err))

  switch (name) {
    // Retryable — the request was rejected outright, nothing was delivered.
    case "ThrottlingException":
      return new MessagingError("SMS_THROTTLED", `Rate limited by AWS: ${detail}`, true)
    case "InternalServerException":
      return new MessagingError("SMS_SERVER_ERROR", `AWS internal error: ${detail}`, true)

    // Permanent — retrying changes nothing until a human fixes something.
    case "ValidationException":
      // Overwhelmingly this is a malformed destination number. Worth its own code
      // so the dashboard can point staff at the client's phone field.
      return new MessagingError("SMS_INVALID_REQUEST", `Rejected by AWS: ${detail}`, false)
    case "ConflictException":
      // Includes the opted-out-recipient case. The Reason field names which.
      return new MessagingError("SMS_CONFLICT", `Cannot send: ${detail}`, false)
    case "ResourceNotFoundException":
      // Almost always a sender ID or configuration set that doesn't exist in this
      // region — a deployment problem, not a per-message one.
      return new MessagingError("SMS_ORIGIN_NOT_FOUND", `Sender not found: ${detail}`, false)
    case "AccessDeniedException":
      return new MessagingError("SMS_ACCESS_DENIED", `IAM denied the send: ${detail}`, false)
    case "ServiceQuotaExceededException":
      // The big one in practice: a brand-new account is sandboxed to $1/month of
      // spend. Hitting this looks like a mysterious total outage, so the message is
      // written to say plainly what happened.
      return new MessagingError(
        "SMS_QUOTA_EXCEEDED",
        `SMS quota or spending limit reached: ${detail}. ` +
          "If the account is still in the SMS sandbox, this is the $1/month cap.",
        false,
      )

    // Unknown shape — network error, timeout, abort. Pass through so the send-policy
    // layer can classify it as unconfirmed.
    default:
      return err
  }
}

// ── Segment estimation ──────────────────────────────────────────────────────
//
// SMS is billed per 'segment', not per message, and the segment size depends on
// which alphabet the text fits into:
//
//   GSM-7  (Latin + a few extras)  160 chars alone, 153 each when concatenated
//   UCS-2  (anything else, incl. Arabic)  70 chars alone,  67 each when concatenated
//
// The 7-bit and 16-bit sizes differ because a concatenated message spends part of
// each segment on a header saying "part 2 of 3".
//
// This is an ESTIMATE for logging and cost forecasting — AWS's own billing is
// authoritative. It's close enough to answer "why did that one message cost 3×?".

const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"

// These cost TWO septets each — they're encoded as an escape byte plus the char.
const GSM7_EXTENDED = "^{}\\[~]|€"

export interface SegmentEstimate {
  encoding: "GSM-7" | "UCS-2"
  count: number
  // Characters left before the message spills into another billable segment.
  // Handy for a live counter in the compose box.
  remainingInLastSegment: number
}

export function estimateSegments(body: string): SegmentEstimate {
  const chars = [...body] // spread, so astral-plane characters aren't split
  const isGsm7 = chars.every(c => GSM7_BASIC.includes(c) || GSM7_EXTENDED.includes(c))

  if (!isGsm7) {
    // UCS-2. Note surrogate pairs (emoji) occupy two units each.
    const units = body.length
    const single = 70
    const multi = 67
    const count = units <= single ? 1 : Math.ceil(units / multi)
    const capacity = count === 1 ? single : count * multi
    return { encoding: "UCS-2", count, remainingInLastSegment: capacity - units }
  }

  // GSM-7: extended characters bill as two.
  const septets = chars.reduce((sum, c) => sum + (GSM7_EXTENDED.includes(c) ? 2 : 1), 0)
  const single = 160
  const multi = 153
  const count = septets <= single ? 1 : Math.ceil(septets / multi)
  const capacity = count === 1 ? single : count * multi
  return { encoding: "GSM-7", count, remainingInLastSegment: capacity - septets }
}

/**
 * Redacts the subscriber digits before a number reaches CloudWatch.
 * "+96170123456" → "+96170***456". Logs are retained far longer than we need
 * client phone numbers, and there's no reason to put them there in full.
 */
function maskPhone(phone: string): string {
  if (phone.length <= 8) return "***"
  return `${phone.slice(0, 6)}***${phone.slice(-3)}`
}
