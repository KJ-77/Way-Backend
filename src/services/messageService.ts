import { executeQuery, pool } from "../lib/db"
import {
  getProvider,
  renderTemplate,
  variablesToArray,
  isServiceWindowOpen,
  isManualChannel,
  DEFAULT_CHANNEL,
} from "../lib/messaging"
import { sendWithRetry } from "../lib/messaging/send-policy"
import { toE164 } from "../lib/phone"
import type {
  MessageChannel,
  MessageJoined,
  MessageTemplate,
  ConversationJoined,
  BroadcastJoined,
  BroadcastCreated,
  SkippedRecipient,
  CreateBroadcastDto,
} from "../lib/types"

// Throws an Error with statusCode + code attached — same convention as
// sessionService.businessError(). The handler maps these onto API responses.
function businessError(statusCode: number, code: string, message: string): never {
  throw Object.assign(new Error(message), { statusCode, code })
}

// How long a message may sit in 'queued' before we consider it unconfirmed and
// surface it for human resolution. Generous enough that a slow-but-successful
// send is never flagged.
const UNCONFIRMED_AFTER_MS = 5 * 60 * 1000

// Provider calls are bounded well inside API Gateway's hard 29s response limit,
// leaving room for retries and the surrounding DB writes.
const SEND_TIMEOUT_MS = 8_000

// Recipients per broadcast drain call. Sized so a chunk completes comfortably
// within the gateway limit even if several messages need a retry.
const BROADCAST_CHUNK_SIZE = 25

// ── Shared SELECT fragments ─────────────────────────────────────────────────

const MESSAGE_SELECT = `
  SELECT m.*, c.user_id, c.phone, u.full_name AS user_name,
         t.name AS template_name, t.category AS template_category
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id
  JOIN users u ON u.id = c.user_id
  LEFT JOIN message_templates t ON t.id = m.template_id
`

// ── Templates ───────────────────────────────────────────────────────────────

export const getTemplates = async (): Promise<MessageTemplate[]> =>
  executeQuery<MessageTemplate>(
    "SELECT * FROM message_templates ORDER BY category, name",
  )

export const getTemplateById = async (id: number): Promise<MessageTemplate | null> => {
  const rows = await executeQuery<MessageTemplate>(
    "SELECT * FROM message_templates WHERE id = $1",
    [id],
  )
  return rows[0] ?? null
}

/**
 * Edits a template's wording.
 *
 * Only possible because we're on SMS. Under WhatsApp the body was whatever Meta had
 * approved, and any change meant resubmitting for review — so this endpoint would
 * have been a lie. SMS templates are local text, so an edit is live immediately.
 *
 * `name` and `trigger_event` are intentionally not updatable: `trigger_event` is the
 * key that wires a template to an automatic event, and changing it would silently
 * disconnect the trigger with no visible symptom.
 *
 * Note this does NOT rewrite already-queued messages. Their `body` was snapshotted
 * at enqueue time on purpose — editing a template must never retroactively change
 * what a staff member already read and approved.
 */
export const updateTemplate = async (
  id: number,
  fields: Partial<Pick<MessageTemplate, "body" | "variable_labels" | "category" | "is_active">>,
): Promise<MessageTemplate> => {
  const keys = Object.keys(fields) as (keyof typeof fields)[]
  if (keys.length === 0) businessError(400, "NO_FIELDS", "Nothing to update")

  // Same dynamic-SET idiom as the other services: only touch supplied fields, and
  // parameterise every value so nothing is interpolated into SQL.
  const setClauses = keys.map((key, i) => `${key} = $${i + 2}`)
  const values = keys.map(key => {
    const value = fields[key]
    // variable_labels is a JSONB column — pg needs it pre-serialised.
    return key === "variable_labels" ? JSON.stringify(value) : value
  })

  const rows = await executeQuery<MessageTemplate>(
    `UPDATE message_templates SET ${setClauses.join(", ")} WHERE id = $1 RETURNING *`,
    [id, ...values],
  )
  if (!rows[0]) businessError(404, "TEMPLATE_NOT_FOUND", "Message template not found")
  return rows[0]
}

/**
 * Finds the single active template wired to an automatic trigger, e.g.
 * "client_created" or "item_stage:ready". Returns null when none is configured —
 * callers treat that as "this trigger isn't set up yet", not as an error, so a
 * missing template can never block the underlying business action.
 */
export const getTemplateByTrigger = async (triggerEvent: string): Promise<MessageTemplate | null> => {
  const rows = await executeQuery<MessageTemplate>(
    "SELECT * FROM message_templates WHERE trigger_event = $1 AND is_active LIMIT 1",
    [triggerEvent],
  )
  return rows[0] ?? null
}

// ── Conversations ───────────────────────────────────────────────────────────

/**
 * Returns the client's thread for this channel, creating it on first contact.
 * ON CONFLICT makes this safe under concurrency — two simultaneous auto-drafts
 * for the same client can't create duplicate threads.
 */
export const findOrCreateConversation = async (
  userId: string,
  channel: MessageChannel = DEFAULT_CHANNEL,
): Promise<{ id: number; phone: string }> => {
  const existing = await executeQuery<{ id: number; phone: string }>(
    "SELECT id, phone FROM conversations WHERE user_id = $1 AND channel = $2",
    [userId, channel],
  )
  if (existing[0]) return existing[0]

  const user = await executeQuery<{ phone: string }>(
    "SELECT phone FROM users WHERE id = $1",
    [userId],
  )
  if (!user[0]) businessError(404, "USER_NOT_FOUND", "Client not found")
  if (!user[0].phone) businessError(400, "NO_PHONE", "This client has no phone number on file")

  // Normalise to E.164 at the boundary. AWS rejects anything else outright, and the
  // `users.phone` column is free text that has historically held "03/123456",
  // "70 123 456" and friends. Doing it here (rather than trusting the stored value)
  // means a legacy row that predates the normalisation migration still works.
  const normalised = toE164(user[0].phone)
  if (!normalised) {
    businessError(
      400,
      "INVALID_PHONE",
      `"${user[0].phone}" isn't a phone number we can send to. ` +
        "Update the client's number to a valid Lebanese mobile.",
    )
  }

  const created = await executeQuery<{ id: number; phone: string }>(
    `INSERT INTO conversations (user_id, channel, phone)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, channel) DO UPDATE SET updated_at = NOW()
     RETURNING id, phone`,
    [userId, channel, normalised],
  )
  return created[0]
}

/**
 * Inbox list. Every "live" field (last activity, preview, unread count, whether
 * the reply window is open) is DERIVED here rather than cached on the row —
 * see the migration header for why. LATERAL joins keep it to one query.
 */
export const getConversations = async (): Promise<ConversationJoined[]> =>
  executeQuery<ConversationJoined>(`
    SELECT c.*, u.full_name AS user_name,
           last.created_at AS last_message_at,
           last.body        AS last_message_preview,
           inb.last_inbound_at,
           COALESCE(unread.count, 0)::int AS unread_count
    FROM conversations c
    JOIN users u ON u.id = c.user_id
    LEFT JOIN LATERAL (
      SELECT body, created_at FROM messages
      WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
    ) last ON true
    LEFT JOIN LATERAL (
      SELECT MAX(created_at) AS last_inbound_at FROM messages
      WHERE conversation_id = c.id AND direction = 'inbound'
    ) inb ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS count FROM messages
      WHERE conversation_id = c.id AND direction = 'inbound' AND read_at IS NULL
    ) unread ON true
    ORDER BY last.created_at DESC NULLS LAST
  `)

export const getConversationMessages = async (conversationId: number): Promise<MessageJoined[]> =>
  executeQuery<MessageJoined>(
    `${MESSAGE_SELECT} WHERE m.conversation_id = $1 ORDER BY m.created_at ASC`,
    [conversationId],
  )

export const markConversationRead = async (conversationId: number): Promise<void> => {
  await executeQuery(
    `UPDATE messages SET read_at = NOW()
     WHERE conversation_id = $1 AND direction = 'inbound' AND read_at IS NULL`,
    [conversationId],
  )
}

// ── Queue reads ─────────────────────────────────────────────────────────────

/**
 * Everything waiting on a human's decision: drafts to approve, and sends that
 * failed and can be re-queued.
 *
 * Failed messages were originally left out, but the dashboard splits this list by
 * status to fill both the queue and the "Failed to send" pile — so without them that
 * pile was permanently empty and failures were invisible.
 *
 * Written as an explicit OR rather than `status IN (...)` on purpose. Each arm
 * matches the predicate of one partial index (messages_pending_idx and
 * messages_failed_idx, the latter added in migration 008), which lets Postgres
 * BitmapOr the two. An IN list becomes `status = ANY(...)`, which the planner can't
 * match against either partial predicate.
 */
export const getPendingQueue = async (): Promise<MessageJoined[]> =>
  executeQuery<MessageJoined>(
    `${MESSAGE_SELECT}
     WHERE (m.status = 'pending_approval' AND m.direction = 'outbound')
        OR (m.status = 'failed' AND m.direction = 'outbound')
     ORDER BY m.created_at DESC`,
  )

/**
 * Messages we handed to the provider but never got a confirmed result for.
 * These need a human to check WhatsApp and resolve them — deliberately never
 * auto-retried, because retrying an unconfirmed send is how a client receives
 * the same message twice.
 */
//
// The 5-minute grace period only applies to PROVIDER channels, where 'queued' can
// mean "the API call is still in flight" and flagging it early would be wrong.
// A hand-sent WhatsApp message is different: the moment staff open WhatsApp, our
// part is over and only a human can say what happened. So those surface
// immediately — this list is where staff confirm them. Without this, a message
// would drop out of the approval queue on handoff and appear nowhere for five
// minutes.
//
// Index: served by the partial messages_queued_idx (WHERE status = 'queued'). The
// OR prevents a pure range scan on last_attempt_at, but the partial index already
// narrows to the 'queued' rows, which are a near-empty set by design.
export const getUnconfirmed = async (): Promise<MessageJoined[]> =>
  executeQuery<MessageJoined>(
    `${MESSAGE_SELECT}
     WHERE m.status = 'queued'
       AND m.provider_message_id IS NULL
       AND (
         m.channel::text = 'whatsapp_manual'
         OR m.last_attempt_at < NOW() - INTERVAL '${UNCONFIRMED_AFTER_MS} milliseconds'
       )
     ORDER BY m.last_attempt_at ASC`,
  )

const getMessageById = async (id: number): Promise<MessageJoined | null> => {
  const rows = await executeQuery<MessageJoined>(`${MESSAGE_SELECT} WHERE m.id = $1`, [id])
  return rows[0] ?? null
}

/**
 * True when an identical automatic draft is ALREADY sitting in the queue unapproved.
 *
 * Used by the trigger layer to avoid stacking duplicates. The semantics matter:
 * this checks only for `pending_approval`, deliberately NOT for messages already
 * sent. So —
 *
 *   • Nudging an item's stage back and forth before anyone approves the first
 *     draft leaves ONE draft, not five.
 *   • But if the "ready for pickup" message was already sent, and the piece later
 *     goes back to the kiln and returns to "ready", a NEW message is drafted. That's
 *     correct: the client genuinely needs telling again.
 *
 * Scoped by trigger + trigger_ref (the item id), so two different pieces belonging
 * to the same client never suppress each other.
 */
export const hasPendingTriggerMessage = async (
  trigger: string,
  triggerRef: string,
): Promise<boolean> => {
  const rows = await executeQuery<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM messages
       WHERE status = 'pending_approval'
         AND direction = 'outbound'
         AND trigger = $1
         AND trigger_ref = $2
     ) AS exists`,
    [trigger, triggerRef],
  )
  return rows[0]?.exists === true
}

// ── Drafting ────────────────────────────────────────────────────────────────

interface EnqueueTemplateArgs {
  userId: string
  templateId: number
  variables: Record<string, string>
  trigger: "client_created" | "item_stage" | "broadcast" | "manual"
  triggerRef?: string | null
  channel?: MessageChannel
  createdBy?: string | null
  broadcastId?: number | null
}

/**
 * Drafts a template message into the approval queue. Nothing is sent — the row
 * lands as 'pending_approval' and waits for a human.
 *
 * The rendered `body` is snapshotted here so the queue shows exactly what the
 * client will read, and so later edits to the template never rewrite history.
 */
export const enqueueTemplateMessage = async (args: EnqueueTemplateArgs): Promise<MessageJoined> => {
  const { userId, templateId, variables, trigger, channel = DEFAULT_CHANNEL } = args

  const templates = await executeQuery<MessageTemplate>(
    "SELECT * FROM message_templates WHERE id = $1",
    [templateId],
  )
  const template = templates[0]
  if (!template) businessError(404, "TEMPLATE_NOT_FOUND", "Message template not found")

  const conversation = await findOrCreateConversation(userId, channel)
  const body = renderTemplate(template.body, variablesToArray(variables))

  const rows = await executeQuery<{ id: number }>(
    `INSERT INTO messages
       (conversation_id, direction, channel, status, kind, template_id,
        template_variables, body, trigger, trigger_ref, broadcast_id, created_by)
     VALUES ($1, 'outbound', $2, 'pending_approval', 'template', $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      conversation.id, channel, templateId, JSON.stringify(variables), body,
      trigger, args.triggerRef ?? null, args.broadcastId ?? null, args.createdBy ?? null,
    ],
  )
  return (await getMessageById(rows[0].id))!
}

/**
 * Drafts a free-form message.
 *
 * On SMS this is always legal — there's no template requirement and no service
 * window, so staff can write whatever they like and send it after approval. That
 * makes free-form the PRIMARY path on SMS, not the exception it is on WhatsApp.
 *
 * The 24-hour window check below is retained but only fires for `channel =
 * 'whatsapp'`. It's dead code today; it stays because the rule is real and will
 * apply again the moment WhatsApp is switched on, and re-deriving it later from
 * memory is how compliance bugs get written.
 */
export const enqueueFreeformReply = async (args: {
  userId: string
  body: string
  channel?: MessageChannel
  createdBy?: string | null
}): Promise<MessageJoined> => {
  const { userId, body, channel = DEFAULT_CHANNEL } = args
  const conversation = await findOrCreateConversation(userId, channel)

  const inbound = await executeQuery<{ last_inbound_at: string | null }>(
    `SELECT MAX(created_at) AS last_inbound_at FROM messages
     WHERE conversation_id = $1 AND direction = 'inbound'`,
    [conversation.id],
  )

  // SMS has no window concept — the rule is WhatsApp-specific.
  if (channel === "whatsapp" && !isServiceWindowOpen(inbound[0]?.last_inbound_at ?? null)) {
    businessError(
      400,
      "WINDOW_CLOSED",
      "You can only send a free-form message within 24 hours of the client's last message. Use an approved template instead.",
    )
  }

  const rows = await executeQuery<{ id: number }>(
    `INSERT INTO messages
       (conversation_id, direction, channel, status, kind, body, trigger, created_by)
     VALUES ($1, 'outbound', $2, 'pending_approval', 'freeform', $3, 'manual', $4)
     RETURNING id`,
    [conversation.id, channel, body, args.createdBy ?? null],
  )
  return (await getMessageById(rows[0].id))!
}

// ── Approve + send ──────────────────────────────────────────────────────────

/**
 * Approves a queued message and sends it synchronously.
 *
 * The claim is an atomic compare-and-swap: the UPDATE only matches while the row
 * is still 'pending_approval', so a double-click or two admins clicking at the
 * same moment can never both send. The loser gets ALREADY_PROCESSED. No locks
 * and no read-then-write race.
 *
 * Ordering is deliberate — persist intent, THEN call the provider, THEN record
 * the result. If we crash mid-send the row is left in 'queued', which is
 * detectable and gets surfaced for human resolution, rather than a message that
 * went out with no record of it.
 */
export const approveAndSend = async (
  messageId: number,
  accountId: string,
): Promise<MessageJoined> => {
  // `channel::text` rather than comparing the enum directly: if migration 008 hasn't
  // been applied yet, the literal 'whatsapp_manual' isn't a valid enum value and a
  // direct comparison would throw — breaking approvals for every other channel too.
  // Comparing as text never parses the literal as an enum. The WHERE is on the
  // primary key, so losing index use on `channel` costs nothing.
  const claimed = await executeQuery<{ id: number }>(
    `UPDATE messages
     SET status = 'queued', approved_by = $2, approved_at = NOW(),
         attempt_count = attempt_count + 1, last_attempt_at = NOW()
     WHERE id = $1 AND status = 'pending_approval' AND direction = 'outbound'
       AND channel::text <> 'whatsapp_manual'
     RETURNING id`,
    [messageId, accountId],
  )

  if (claimed.length === 0) {
    const existing = await getMessageById(messageId)
    if (!existing) businessError(404, "MESSAGE_NOT_FOUND", "Message not found")
    // A hand-sent message has no provider to dispatch through. Refusing here — before
    // it's claimed — keeps it in the queue instead of stranding it in 'queued'.
    if (isManualChannel(existing.channel)) {
      businessError(
        400,
        "MANUAL_CHANNEL",
        "This message is sent by hand from WhatsApp — use Open in WhatsApp instead.",
      )
    }
    businessError(
      409,
      "ALREADY_PROCESSED",
      `This message is already ${existing.status.replace("_", " ")} — it can't be approved again.`,
    )
  }

  return dispatch(messageId)
}

/**
 * Claims a hand-sent message: the staff member is about to send it themselves from
 * the studio's WhatsApp, via a wa.me link the dashboard opens.
 *
 * This is approveAndSend() without the send. It exists for two reasons:
 *
 *   1. RACE PROTECTION. The same atomic compare-and-swap as approval, so two staff
 *      members can't both open WhatsApp for the same message and both send it. The
 *      loser gets ALREADY_PROCESSED and the dashboard closes their tab.
 *
 *   2. HONEST STATE. The row moves to 'queued' with no provider_message_id — the
 *      exact shape this system already uses for "handed off, result unknown". We
 *      genuinely can't see whether the person pressed send in WhatsApp, so we don't
 *      claim to. A human confirms via resolveUnconfirmed(). If nobody does, it
 *      surfaces in "Needs attention" after UNCONFIRMED_AFTER_MS on its own.
 */
export const handoffMessage = async (
  messageId: number,
  accountId: string,
): Promise<MessageJoined> => {
  const claimed = await executeQuery<{ id: number }>(
    `UPDATE messages
     SET status = 'queued', approved_by = $2, approved_at = NOW(),
         attempt_count = attempt_count + 1, last_attempt_at = NOW()
     WHERE id = $1 AND status = 'pending_approval' AND direction = 'outbound'
       AND channel::text = 'whatsapp_manual'
     RETURNING id`,
    [messageId, accountId],
  )

  if (claimed.length === 0) {
    const existing = await getMessageById(messageId)
    if (!existing) businessError(404, "MESSAGE_NOT_FOUND", "Message not found")
    if (!isManualChannel(existing.channel)) {
      businessError(
        400,
        "NOT_MANUAL_CHANNEL",
        "This message is sent automatically — approve it instead.",
      )
    }
    businessError(
      409,
      "ALREADY_PROCESSED",
      `This message is already ${existing.status.replace("_", " ")} — someone may have got there first.`,
    )
  }

  return (await getMessageById(messageId))!
}

/**
 * Performs the actual provider call for an already-claimed ('queued') message
 * and records the outcome. Shared by single approval and broadcast draining.
 */
async function dispatch(messageId: number): Promise<MessageJoined> {
  const message = await getMessageById(messageId)
  if (!message) businessError(404, "MESSAGE_NOT_FOUND", "Message not found")

  const provider = getProvider(message.channel)

  // Bound the call so a hanging provider can't push us into API Gateway's 29s
  // limit — failing into a known state beats being killed mid-flight.
  const withTimeout = <T>(p: Promise<T>): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(Object.assign(new Error("Provider timed out"), { code: "ETIMEDOUT" })),
          SEND_TIMEOUT_MS,
        ),
      ),
    ])

  const outcome = await sendWithRetry(() => {
    if (message.kind === "template") {
      if (!message.template_name) {
        businessError(400, "TEMPLATE_NOT_FOUND", "Message template is missing")
      }
      return withTimeout(
        provider.sendTemplate({
          to: message.phone,
          templateName: message.template_name,
          language: "en",
          variables: variablesToArray(message.template_variables),
          // `message.body` is the text rendered and snapshotted at enqueue time —
          // exactly what a staff member read in the approval queue. SMS sends this
          // verbatim; WhatsApp ignores it and re-substitutes from `variables`.
          renderedBody: message.body,
          // Drives TRANSACTIONAL vs PROMOTIONAL routing on SMS. Falls back to
          // 'utility' rather than 'marketing' so a template with a missing category
          // is treated as the safer, higher-priority kind.
          category: message.template_category ?? "utility",
        }),
      )
    }
    // Free-form messages are staff-written replies, never promotional blasts —
    // a broadcast always goes through the template path above.
    return withTimeout(
      provider.sendText({ to: message.phone, body: message.body, category: "utility" }),
    )
  })

  if (outcome.result) {
    await executeQuery(
      `UPDATE messages
       SET status = 'sent', provider_message_id = $2, sent_at = NOW(),
           attempt_count = $3, error_code = NULL, error_message = NULL
       WHERE id = $1`,
      [messageId, outcome.result.providerMessageId, outcome.attempts],
    )
    return (await getMessageById(messageId))!
  }

  const failure = outcome.failure!

  // "unconfirmed" stays in 'queued' — we genuinely don't know whether it was
  // delivered, so a human resolves it. Everything else is a definite failure and
  // can safely be re-queued by staff.
  const nextStatus = failure.class === "unconfirmed" ? "queued" : "failed"

  await executeQuery(
    `UPDATE messages
     SET status = $2, error_code = $3, error_message = $4, attempt_count = $5
     WHERE id = $1`,
    [messageId, nextStatus, failure.code, failure.message, outcome.attempts],
  )

  if (failure.class === "unconfirmed") {
    businessError(
      502,
      "SEND_UNCONFIRMED",
      "We couldn't confirm whether this message was delivered. It's been flagged for review — check WhatsApp before resending.",
    )
  }
  businessError(502, "SEND_FAILED", `Message could not be sent: ${failure.message}`)
}

// ── Queue management ────────────────────────────────────────────────────────

/**
 * Discards a message without sending it.
 *
 * Valid for a pending draft, or for a FAILED send that nobody wants to retry.
 * Without the second case a failure could only ever leave the "Failed to send" pile
 * by being re-queued, so one that shouldn't be resent would sit there forever.
 *
 * Never valid for 'queued' — that message may already have reached the client, and
 * calling it cancelled would be a lie. Those go through resolveUnconfirmed().
 */
export const cancelMessage = async (messageId: number, accountId: string): Promise<MessageJoined> => {
  const rows = await executeQuery<{ id: number }>(
    `UPDATE messages SET status = 'cancelled', approved_by = $2, approved_at = NOW()
     WHERE id = $1 AND status IN ('pending_approval', 'failed')
     RETURNING id`,
    [messageId, accountId],
  )
  if (rows.length === 0) {
    businessError(409, "ALREADY_PROCESSED", "This message can no longer be discarded.")
  }
  return (await getMessageById(messageId))!
}

/** Puts a failed message back in the queue so staff can fix and retry it. */
export const requeueMessage = async (messageId: number): Promise<MessageJoined> => {
  const rows = await executeQuery<{ id: number }>(
    `UPDATE messages
     SET status = 'pending_approval', approved_by = NULL, approved_at = NULL,
         error_code = NULL, error_message = NULL
     WHERE id = $1 AND status = 'failed'
     RETURNING id`,
    [messageId],
  )
  if (rows.length === 0) businessError(409, "NOT_REQUEUABLE", "Only failed messages can be re-queued.")
  return (await getMessageById(messageId))!
}

/**
 * Human resolution of an unconfirmed send. Staff checks WhatsApp and tells us
 * what actually happened — we never guess, because guessing either double-sends
 * or silently drops a delivered message.
 *
 * `not_sent` is for hand-sent WhatsApp only: the person opened WhatsApp and then
 * didn't press send. Nothing went out, so the message goes back into the approval
 * queue untouched. It's refused for provider channels, where reaching 'queued'
 * means an API call was actually made — "nothing was sent" can't be known there,
 * and re-queuing on that assumption is exactly how a client gets a message twice.
 */
export const resolveUnconfirmed = async (
  messageId: number,
  resolution: "sent" | "failed" | "not_sent",
): Promise<MessageJoined> => {
  if (resolution === "not_sent") {
    // Clears the approval pair together (the messages_approval_pair CHECK requires
    // both-or-neither), plus any error left by an earlier attempt.
    const rows = await executeQuery<{ id: number }>(
      `UPDATE messages
       SET status = 'pending_approval', approved_by = NULL, approved_at = NULL,
           error_code = NULL, error_message = NULL
       WHERE id = $1 AND status = 'queued' AND channel::text = 'whatsapp_manual'
       RETURNING id`,
      [messageId],
    )
    if (rows.length === 0) {
      const existing = await getMessageById(messageId)
      if (!existing) businessError(404, "MESSAGE_NOT_FOUND", "Message not found")
      if (!isManualChannel(existing.channel)) {
        businessError(
          400,
          "NOT_MANUAL_CHANNEL",
          "Only hand-sent messages can be marked as not sent. Choose sent or failed.",
        )
      }
      businessError(409, "NOT_UNCONFIRMED", "This message isn't awaiting confirmation.")
    }
    return (await getMessageById(messageId))!
  }

  const rows = await executeQuery<{ id: number }>(
    `UPDATE messages
     SET status = $2, sent_at = CASE WHEN $2 = 'sent' THEN COALESCE(sent_at, NOW()) ELSE sent_at END
     WHERE id = $1 AND status = 'queued'
     RETURNING id`,
    [messageId, resolution],
  )
  if (rows.length === 0) businessError(409, "NOT_UNCONFIRMED", "This message isn't awaiting confirmation.")
  return (await getMessageById(messageId))!
}

// ── Inbound ─────────────────────────────────────────────────────────────────
//
// ⚠️ DORMANT ON SMS. Lebanon supports neither long codes nor short codes, and an
// alphanumeric sender ID is outbound-only — so no inbound message can physically
// reach us. Nothing calls this today.
//
// It is kept, fully working, for two reasons:
//   1. It's the WhatsApp upgrade path. When WhatsApp is switched on, inbound
//      starts arriving and this is already correct — including the at-least-once
//      idempotency, which is easy to get wrong under time pressure later.
//   2. Deleting it would also mean deleting the two inbound indexes and the
//      inbox queries, which is a much larger and riskier change to reverse.
//
// See local/claude/plans/sms-implementation.md § "What SMS costs us".

/**
 * Records a client's incoming message. Idempotent via the partial unique index
 * on provider_message_id — providers deliver webhooks at-least-once, so the
 * same event can legitimately arrive twice; ON CONFLICT makes the duplicate a
 * no-op instead of a duplicated inbox entry.
 */
export const recordInboundMessage = async (args: {
  phone: string
  body: string
  providerMessageId: string
  channel?: MessageChannel
}): Promise<void> => {
  const { phone, body, providerMessageId, channel = DEFAULT_CHANNEL } = args

  // Match on the normalised form: the stored `users.phone` may still be in a
  // legacy local format, so compare E.164 to E.164 rather than string-to-string.
  const normalised = toE164(phone) ?? phone
  const users = await executeQuery<{ id: string }>(
    "SELECT id FROM users WHERE phone = $1 AND is_active LIMIT 1",
    [normalised],
  )
  // Unknown sender — log and drop rather than throwing, so an unrecognised
  // number can't wedge the webhook into an endless retry loop.
  if (!users[0]) {
    console.warn("[messaging] inbound from unknown number", { phone, providerMessageId })
    return
  }

  const conversation = await findOrCreateConversation(users[0].id, channel)

  await executeQuery(
    `INSERT INTO messages
       (conversation_id, direction, channel, status, kind, body, trigger, provider_message_id)
     VALUES ($1, 'inbound', $2, 'delivered', 'freeform', $3, 'inbound', $4)
     ON CONFLICT (provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING`,
    [conversation.id, channel, body, providerMessageId],
  )

  // Honour opt-out keywords immediately — a compliance requirement, and one we
  // must not depend on a human noticing.
  if (isOptOutKeyword(body)) {
    await setMarketingOptOut(users[0].id, true)
  }
}

/**
 * Applies a delivery-status callback. Keyed on provider_message_id (unique), and
 * only ever moves status forward — out-of-order webhooks ('sent' arriving after
 * 'read') must not regress the row.
 */
export const applyStatusUpdate = async (
  providerMessageId: string,
  status: "sent" | "delivered" | "read" | "failed",
  errorMessage?: string,
): Promise<void> => {
  if (status === "failed") {
    // Guard against regression, same principle as the ladder below.
    //
    // This matters far more on SMS than it did on WhatsApp. AWS can emit a carrier
    // event up to 72 HOURS after the send, several of the failure statuses are
    // explicitly documented as transient (UNKNOWN, UNREACHABLE, CARRIER_UNREACHABLE,
    // TTL_EXPIRED), and events are not ordered. Without this guard, a stale
    // "unreachable" arriving after a successful "delivered" would flip a message
    // that the client demonstrably received back to 'failed' — and staff would
    // resend it.
    //
    // A message that has reached the recipient's device is terminal. Nothing later
    // can un-deliver it.
    await executeQuery(
      `UPDATE messages SET status = 'failed', error_message = $2
       WHERE provider_message_id = $1
         AND status NOT IN ('delivered', 'read')`,
      [providerMessageId, errorMessage ?? "Provider reported failure"],
    )
    return
  }

  // Rank the delivery states so an out-of-order webhook can't regress the row
  // (providers don't guarantee ordering — a 'sent' callback can land after
  // 'read'). Anything not in the ladder ranks -1 and is always overtaken.
  const RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 }
  await executeQuery(
    `UPDATE messages SET status = $2
     WHERE provider_message_id = $1
       AND CASE status
             WHEN 'queued'    THEN 0
             WHEN 'sent'      THEN 1
             WHEN 'delivered' THEN 2
             WHEN 'read'      THEN 3
             ELSE -1
           END < $3`,
    [providerMessageId, status, RANK[status]],
  )
}

// ── Opt-out ─────────────────────────────────────────────────────────────────
//
// Honouring opt-out is a compliance obligation, and AWS asks how we handle it in
// the production-access request. On WhatsApp this was automatic: a client replied
// STOP and `recordInboundMessage` flipped the flag without anyone noticing.
//
// SMS in Lebanon has NO inbound path, so that automation cannot run. The opt-out
// route is therefore MANUAL and has three parts, all of which must stay true:
//
//   1. Marketing SMS must tell the recipient how to opt out in words — we can't
//      say "reply STOP", because replying is impossible. It has to name a real
//      channel the studio actually monitors (phone, or WhatsApp to the studio's
//      own number). This lives in the template wording, not in code.
//   2. Staff flip the flag from the dashboard, which calls setMarketingOptOut().
//   3. createBroadcast() excludes opted-out clients at fan-out time (unchanged).
//
// `isOptOutKeyword` below is dormant alongside recordInboundMessage — it is the
// WhatsApp path and it is deliberately preserved, not deleted.

// Keywords that count as "stop messaging me". Matched on the whole trimmed
// message so a sentence merely containing the word doesn't opt someone out.
const OPT_OUT_KEYWORDS = new Set(["stop", "unsubscribe", "cancel", "توقف", "الغاء", "إلغاء"])

export function isOptOutKeyword(body: string): boolean {
  return OPT_OUT_KEYWORDS.has(body.trim().toLowerCase())
}

export const setMarketingOptOut = async (userId: string, optOut: boolean): Promise<void> => {
  await executeQuery(
    `UPDATE users
     SET marketing_opt_out = $2,
         marketing_opt_out_at = CASE WHEN $2 THEN NOW() ELSE NULL END
     WHERE id = $1`,
    [userId, optOut],
  )
}

// ── Broadcasts ──────────────────────────────────────────────────────────────

export const getBroadcasts = async (): Promise<BroadcastJoined[]> =>
  executeQuery<BroadcastJoined>(`
    SELECT b.*, t.name AS template_name,
           COALESCE(s.total, 0)::int   AS total_count,
           COALESCE(s.sent, 0)::int    AS sent_count,
           COALESCE(s.failed, 0)::int  AS failed_count,
           COALESCE(s.pending, 0)::int AS pending_count
    FROM broadcasts b
    JOIN message_templates t ON t.id = b.template_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE status IN ('sent','delivered','read')) AS sent,
             COUNT(*) FILTER (WHERE status = 'failed') AS failed,
             COUNT(*) FILTER (WHERE status IN ('pending_approval','queued')) AS pending
      FROM messages WHERE broadcast_id = b.id
    ) s ON true
    ORDER BY b.created_at DESC
  `)

/**
 * Creates a campaign and fans it out into one queued message per recipient.
 *
 * Opted-out and soft-deleted clients are excluded at fan-out time. Everything
 * lands as 'pending_approval' — approving the campaign is a separate, explicit
 * step, and the actual sending happens in chunks (see drainBroadcast).
 */
export const createBroadcast = async (
  dto: CreateBroadcastDto,
  accountId: string,
): Promise<BroadcastCreated> => {
  const channel = dto.channel ?? DEFAULT_CHANNEL

  // Broadcasts are refused on hand-sent WhatsApp, deliberately.
  //   • Practically: 130 recipients would mean 130 separate trips into WhatsApp.
  //   • Dangerously: a burst of near-identical messages from one personal number is
  //     exactly what Meta's spam detection bans for, with no grace period — and it's
  //     the number the whole studio runs on.
  // The studio handles announcements through a WhatsApp group/community instead.
  // Checked BEFORE opening the transaction so nothing is written.
  if (isManualChannel(channel)) {
    businessError(
      400,
      "BROADCAST_NOT_SUPPORTED",
      "Broadcasts aren't available for hand-sent WhatsApp. Use a WhatsApp group or community for announcements.",
    )
  }

  const client = await pool.connect()
  // Recipients whose stored phone number can't be parsed into E.164. Collected
  // rather than thrown on: one client with a mistyped number must not block a
  // campaign to the other 129. Returned to the caller so the UI can name them.
  const skipped: SkippedRecipient[] = []

  try {
    await client.query("BEGIN")

    const templateRes = await client.query<MessageTemplate>(
      "SELECT * FROM message_templates WHERE id = $1",
      [dto.template_id],
    )
    const template = templateRes.rows[0]
    if (!template) businessError(404, "TEMPLATE_NOT_FOUND", "Message template not found")

    const broadcastRes = await client.query<{ id: number }>(
      `INSERT INTO broadcasts (name, template_id, template_variables, channel, audience, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'draft', $6) RETURNING id`,
      [
        dto.name, dto.template_id, JSON.stringify(dto.variables ?? {}),
        channel, JSON.stringify(dto.audience ?? {}), accountId,
      ],
    )
    const broadcastId = broadcastRes.rows[0].id

    // Marketing goes only to active, opted-in clients who have a phone number.
    const recipients = await client.query<{ id: string; full_name: string; phone: string }>(
      `SELECT id, full_name, phone FROM users
       WHERE is_active AND NOT marketing_opt_out AND phone IS NOT NULL AND phone <> ''`,
    )
    if (recipients.rows.length === 0) {
      businessError(400, "NO_RECIPIENTS", "No clients match this broadcast — everyone is opted out or inactive.")
    }

    for (const recipient of recipients.rows) {
      // Normalise before fan-out. A number we can't parse would fail at send time
      // anyway — catching it here means the failure is reported once, up front,
      // instead of as N mystery failures halfway through the drain.
      const phone = toE164(recipient.phone)
      if (!phone) {
        skipped.push({ id: recipient.id, name: recipient.full_name, phone: recipient.phone })
        continue
      }

      const convRes = await client.query<{ id: number }>(
        `INSERT INTO conversations (user_id, channel, phone) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, channel) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [recipient.id, channel, phone],
      )

      // {{1}} is the client's name by convention; the rest are campaign-wide.
      const variables: Record<string, string> = { "1": recipient.full_name, ...(dto.variables ?? {}) }
      const body = renderTemplate(template.body, variablesToArray(variables))

      await client.query(
        `INSERT INTO messages
           (conversation_id, direction, channel, status, kind, template_id,
            template_variables, body, trigger, broadcast_id, created_by)
         VALUES ($1, 'outbound', $2, 'pending_approval', 'template', $3, $4, $5, 'broadcast', $6, $7)`,
        [
          convRes.rows[0].id, channel, dto.template_id,
          JSON.stringify(variables), body, broadcastId, accountId,
        ],
      )
    }

    // Everyone was unreachable — that's a failed campaign, not a successful one
    // with zero recipients. Roll back rather than leave an empty broadcast row.
    if (skipped.length === recipients.rows.length) {
      businessError(
        400,
        "NO_VALID_RECIPIENTS",
        "None of the matching clients have a usable phone number.",
      )
    }

    await client.query("COMMIT")
    const all = await getBroadcasts()
    return { ...all.find(b => b.id === broadcastId)!, skipped }
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}

/**
 * Sends the next chunk of an approved broadcast.
 *
 * Synchronous sending can't push 100+ messages inside API Gateway's 29s limit,
 * so the frontend calls this repeatedly behind a progress bar until `remaining`
 * hits zero. FOR UPDATE SKIP LOCKED means two admins draining the same campaign
 * simultaneously each claim different rows rather than colliding — the standard
 * "Postgres as a queue" pattern. If the browser closes mid-drain the remaining
 * rows are untouched, so it simply resumes on the next call.
 */
export const drainBroadcast = async (
  broadcastId: number,
  accountId: string,
): Promise<{ sent: number; failed: number; remaining: number }> => {
  const client = await pool.connect()
  let claimed: number[] = []

  try {
    await client.query("BEGIN")
    const rows = await client.query<{ id: number }>(
      `SELECT id FROM messages
       WHERE broadcast_id = $1 AND status = 'pending_approval'
       ORDER BY id
       FOR UPDATE SKIP LOCKED
       LIMIT $2`,
      [broadcastId, BROADCAST_CHUNK_SIZE],
    )
    claimed = rows.rows.map(r => r.id)

    if (claimed.length > 0) {
      await client.query(
        `UPDATE messages
         SET status = 'queued', approved_by = $2, approved_at = NOW(),
             attempt_count = attempt_count + 1, last_attempt_at = NOW()
         WHERE id = ANY($1::bigint[])`,
        [claimed, accountId],
      )
      await client.query(
        "UPDATE broadcasts SET status = 'sending' WHERE id = $1 AND status <> 'sending'",
        [broadcastId],
      )
    }
    await client.query("COMMIT")
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }

  // Provider calls happen OUTSIDE the transaction — holding a DB transaction
  // open across network I/O would pin a connection for the whole chunk.
  let sent = 0
  let failed = 0
  for (const id of claimed) {
    try {
      await dispatch(id)
      sent++
    } catch {
      // dispatch() has already recorded the per-message outcome; one bad
      // recipient must not abort the rest of the chunk.
      failed++
    }
  }

  const remainingRes = await executeQuery<{ count: string }>(
    "SELECT COUNT(*) AS count FROM messages WHERE broadcast_id = $1 AND status = 'pending_approval'",
    [broadcastId],
  )
  const remaining = Number(remainingRes[0].count)

  if (remaining === 0) {
    await executeQuery(
      "UPDATE broadcasts SET status = 'sent', sent_at = NOW() WHERE id = $1",
      [broadcastId],
    )
  }

  return { sent, failed, remaining }
}
