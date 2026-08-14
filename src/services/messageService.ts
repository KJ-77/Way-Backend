import { executeQuery, pool } from "../lib/db"
import { getProvider, renderTemplate, variablesToArray, isServiceWindowOpen } from "../lib/messaging"
import { sendWithRetry } from "../lib/messaging/send-policy"
import type {
  MessageChannel,
  MessageJoined,
  MessageTemplate,
  ConversationJoined,
  BroadcastJoined,
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
  SELECT m.*, c.user_id, c.phone, u.full_name AS user_name, t.name AS template_name
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
  channel: MessageChannel = "whatsapp",
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

  const created = await executeQuery<{ id: number; phone: string }>(
    `INSERT INTO conversations (user_id, channel, phone)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, channel) DO UPDATE SET updated_at = NOW()
     RETURNING id, phone`,
    [userId, channel, user[0].phone],
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

export const getPendingQueue = async (): Promise<MessageJoined[]> =>
  executeQuery<MessageJoined>(
    `${MESSAGE_SELECT}
     WHERE m.status = 'pending_approval' AND m.direction = 'outbound'
     ORDER BY m.created_at DESC`,
  )

/**
 * Messages we handed to the provider but never got a confirmed result for.
 * These need a human to check WhatsApp and resolve them — deliberately never
 * auto-retried, because retrying an unconfirmed send is how a client receives
 * the same message twice.
 */
export const getUnconfirmed = async (): Promise<MessageJoined[]> =>
  executeQuery<MessageJoined>(
    `${MESSAGE_SELECT}
     WHERE m.status = 'queued'
       AND m.provider_message_id IS NULL
       AND m.last_attempt_at < NOW() - INTERVAL '${UNCONFIRMED_AFTER_MS} milliseconds'
     ORDER BY m.last_attempt_at ASC`,
  )

const getMessageById = async (id: number): Promise<MessageJoined | null> => {
  const rows = await executeQuery<MessageJoined>(`${MESSAGE_SELECT} WHERE m.id = $1`, [id])
  return rows[0] ?? null
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
  const { userId, templateId, variables, trigger, channel = "whatsapp" } = args

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
 * Drafts a free-form reply. Only legal while the 24-hour customer service window
 * is open (i.e. the client messaged us recently) — outside it WhatsApp requires
 * a pre-approved template, so we reject early with a clear code rather than
 * letting the provider fail at send time.
 */
export const enqueueFreeformReply = async (args: {
  userId: string
  body: string
  channel?: MessageChannel
  createdBy?: string | null
}): Promise<MessageJoined> => {
  const { userId, body, channel = "whatsapp" } = args
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
  const claimed = await executeQuery<{ id: number }>(
    `UPDATE messages
     SET status = 'queued', approved_by = $2, approved_at = NOW(),
         attempt_count = attempt_count + 1, last_attempt_at = NOW()
     WHERE id = $1 AND status = 'pending_approval' AND direction = 'outbound'
     RETURNING id`,
    [messageId, accountId],
  )

  if (claimed.length === 0) {
    const existing = await getMessageById(messageId)
    if (!existing) businessError(404, "MESSAGE_NOT_FOUND", "Message not found")
    businessError(
      409,
      "ALREADY_PROCESSED",
      `This message is already ${existing.status.replace("_", " ")} — it can't be approved again.`,
    )
  }

  return dispatch(messageId)
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
        }),
      )
    }
    return withTimeout(provider.sendText({ to: message.phone, body: message.body }))
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

/** Discards a drafted message without sending. Only valid while pending. */
export const cancelMessage = async (messageId: number, accountId: string): Promise<MessageJoined> => {
  const rows = await executeQuery<{ id: number }>(
    `UPDATE messages SET status = 'cancelled', approved_by = $2, approved_at = NOW()
     WHERE id = $1 AND status = 'pending_approval'
     RETURNING id`,
    [messageId, accountId],
  )
  if (rows.length === 0) businessError(409, "ALREADY_PROCESSED", "This message is no longer pending.")
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
 */
export const resolveUnconfirmed = async (
  messageId: number,
  resolution: "sent" | "failed",
): Promise<MessageJoined> => {
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

// ── Inbound (called by the webhook handler in Phase 3) ──────────────────────

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
  const { phone, body, providerMessageId, channel = "whatsapp" } = args

  const users = await executeQuery<{ id: string }>(
    "SELECT id FROM users WHERE phone = $1 AND is_active LIMIT 1",
    [phone],
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
    await executeQuery(
      `UPDATE messages SET status = 'failed', error_message = $2
       WHERE provider_message_id = $1`,
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
): Promise<BroadcastJoined> => {
  const client = await pool.connect()
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
        dto.channel ?? "whatsapp", JSON.stringify(dto.audience ?? {}), accountId,
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
      const convRes = await client.query<{ id: number }>(
        `INSERT INTO conversations (user_id, channel, phone) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, channel) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [recipient.id, dto.channel ?? "whatsapp", recipient.phone],
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
          convRes.rows[0].id, dto.channel ?? "whatsapp", dto.template_id,
          JSON.stringify(variables), body, broadcastId, accountId,
        ],
      )
    }

    await client.query("COMMIT")
    const all = await getBroadcasts()
    return all.find(b => b.id === broadcastId)!
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
