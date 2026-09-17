// ── SMS delivery-receipt handler ──
//
// Subscribes to the SNS topic that AWS End User Messaging SMS publishes carrier
// events to (wired up via a configuration set's event destination). Turns those
// events into `messages.status` transitions so the dashboard can show whether a
// message actually landed, rather than only that we handed it to AWS.
//
// Without this the queue can never show anything past 'sent' — 'sent' just means
// "AWS accepted the request", which is not the same as the client's phone buzzing.
//
// Three properties of this event stream drive the whole design:
//
//   1. AT-LEAST-ONCE. SNS redelivers. The same 'DELIVERED' event can arrive twice.
//   2. UNORDERED. A 'SUCCESSFUL' can land after a 'DELIVERED'.
//   3. VERY LATE. Carrier events can arrive up to 72 HOURS after the send, and
//      AWS synthesises an 'UNKNOWN' if nothing final ever comes back.
//
// All three are handled by `applyStatusUpdate`, which only ever ratchets a message
// forward along sent → delivered → read and refuses to regress a delivered row.
// This handler's only job is translating AWS's vocabulary into ours.

import type { SNSEvent, SNSHandler } from "aws-lambda"
import { applyStatusUpdate } from "../../services/messageService"

// The subset of the SMS event payload we care about. AWS sends considerably more
// (mcc, mnc, encoding, carrier fees); we deliberately don't model fields we don't
// use, so a schema addition upstream can't break parsing.
interface SmsEvent {
  eventType?: string
  messageId?: string
  messageStatus?: string
  messageStatusDescription?: string
  // False while the carrier is still working on it. Non-final failures are common
  // and frequently transient, so we treat them very differently to final ones.
  isFinal?: boolean
  totalMessageParts?: number
  totalMessagePrice?: number
  destinationPhoneNumber?: string
}

// AWS's SMS status vocabulary → our `message_status` enum.
//
// Note there is no 'read': SMS has no read receipts. That status exists in the
// schema for WhatsApp and simply never occurs on this channel.
const STATUS_MAP: Record<string, "sent" | "delivered" | "failed"> = {
  // Accepted by the carrier — in flight, not yet on the handset.
  SUCCESSFUL: "sent",
  ACCEPTED: "sent",
  SENT: "sent",

  // On the recipient's device. Terminal success.
  DELIVERED: "delivered",

  // Terminal failures — the message will never arrive.
  INVALID: "failed",
  INVALID_MESSAGE: "failed",
  BLOCKED: "failed",
  CARRIER_BLOCKED: "failed",
  SPAM: "failed",
  UNROUTABLE: "failed",
  PROTECT_BLOCKED: "failed",
  FAILED: "failed",

  // Documented by AWS as "usually transient". Mapped to failed, but only APPLIED
  // when isFinal is true — see below. Recording a transient hiccup as a failure
  // would have staff resending messages that were still on their way.
  UNREACHABLE: "failed",
  CARRIER_UNREACHABLE: "failed",
  TTL_EXPIRED: "failed",
  UNKNOWN: "failed",

  // Explicitly NOT mapped: PENDING, QUEUED. They carry no information we don't
  // already have, and mapping them to anything risks regressing a row that has
  // already progressed further.
}

// Statuses AWS calls transient. We wait for a final event before believing them.
const TRANSIENT_FAILURES = new Set(["UNREACHABLE", "CARRIER_UNREACHABLE", "TTL_EXPIRED", "UNKNOWN"])

export const smsStatusHandler: SNSHandler = async (event: SNSEvent): Promise<void> => {
  for (const record of event.Records) {
    let payload: SmsEvent
    try {
      payload = JSON.parse(record.Sns.Message)
    } catch {
      // Malformed payload. Log and move on — throwing would make SNS redeliver a
      // message that will never parse, retrying forever.
      console.error("[sms-status] unparseable SNS message", { body: record.Sns.Message })
      continue
    }

    const { messageId, messageStatus } = payload
    if (!messageId || !messageStatus) {
      console.warn("[sms-status] event missing messageId or messageStatus", { payload })
      continue
    }

    const mapped = STATUS_MAP[messageStatus]
    if (!mapped) {
      // PENDING/QUEUED and anything AWS adds later. Nothing to do, and that's fine.
      console.log("[sms-status] ignoring non-actionable status", { messageId, messageStatus })
      continue
    }

    // Hold off on transient failures until AWS says it's done trying.
    if (mapped === "failed" && TRANSIENT_FAILURES.has(messageStatus) && payload.isFinal !== true) {
      console.log("[sms-status] deferring non-final transient failure", {
        messageId,
        messageStatus,
      })
      continue
    }

    // `totalMessagePrice` is logged but deliberately NOT stored or converted.
    // AWS's own documentation is self-inconsistent about its units (the attribute
    // table says thousandths of a cent, the worked example reads as dollars), so
    // deriving a currency figure from it in code would bake in a guess. Cost
    // reporting should come from Cost Explorer, which is authoritative.
    console.log("[sms-status] applying", {
      messageId,
      messageStatus,
      mapped,
      isFinal: payload.isFinal,
      parts: payload.totalMessageParts,
      rawPrice: payload.totalMessagePrice,
    })

    try {
      await applyStatusUpdate(
        messageId,
        mapped,
        payload.messageStatusDescription ?? messageStatus,
      )
    } catch (err) {
      // One bad record must not abort the batch — SNS would redeliver the whole
      // thing and we'd reprocess the ones that already succeeded. They're
      // idempotent, so that would be survivable, but it's noise we don't need.
      console.error("[sms-status] failed to apply status", { messageId, err })
    }
  }
}
