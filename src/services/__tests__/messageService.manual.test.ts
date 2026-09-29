// Tests for the hand-sent WhatsApp path (channel = 'whatsapp_manual').
//
// The database is mocked: these tests check which statements run, in what order,
// and how each outcome maps to an error code. The SQL itself is exercised against a
// real database only when it's deployed.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../lib/db", () => ({
  executeQuery: vi.fn(),
  pool: { connect: vi.fn() },
}))

import { executeQuery, pool } from "../../lib/db"
import {
  handoffMessage,
  approveAndSend,
  resolveUnconfirmed,
  createBroadcast,
  getUnconfirmed,
  getPendingQueue,
  cancelMessage,
  getConversations,
  getConversationMessages,
} from "../messageService"

const query = vi.mocked(executeQuery)

// Minimal row shape returned by getMessageById's SELECT.
const message = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  channel: "whatsapp_manual",
  status: "pending_approval",
  user_name: "Sara",
  phone: "+96170123456",
  body: "Hi Sara",
  ...overrides,
})

// Extracts the SQL text of the Nth executeQuery call.
const sqlOf = (n: number) => String(query.mock.calls[n][0])

beforeEach(() => {
  query.mockReset()
  vi.mocked(pool.connect).mockReset()
})

describe("handoffMessage", () => {
  it("claims a pending hand-sent message and returns it", async () => {
    query
      .mockResolvedValueOnce([{ id: 7 }]) // the claim
      .mockResolvedValueOnce([message({ status: "queued" })]) // re-read

    const result = await handoffMessage(7, "staff-1")

    expect(result.status).toBe("queued")
    // The claim is the atomic guard: only a still-pending, hand-sent message moves.
    const claim = sqlOf(0)
    expect(claim).toMatch(/status = 'queued'/)
    expect(claim).toMatch(/status = 'pending_approval'/)
    expect(claim).toMatch(/channel::text = 'whatsapp_manual'/)
    expect(query.mock.calls[0][1]).toEqual([7, "staff-1"])
  })

  it("tells the loser of a race that someone got there first", async () => {
    // Two staff press "Open in WhatsApp" at once. The second claim matches no row.
    query
      .mockResolvedValueOnce([]) // claim lost
      .mockResolvedValueOnce([message({ status: "queued" })])

    await expect(handoffMessage(7, "staff-2")).rejects.toMatchObject({
      statusCode: 409,
      code: "ALREADY_PROCESSED",
    })
  })

  it("refuses a message that's sent automatically", async () => {
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([message({ channel: "sms" })])

    await expect(handoffMessage(7, "staff-1")).rejects.toMatchObject({
      statusCode: 400,
      code: "NOT_MANUAL_CHANNEL",
    })
  })

  it("404s for a message that doesn't exist", async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    await expect(handoffMessage(99, "staff-1")).rejects.toMatchObject({
      statusCode: 404,
      code: "MESSAGE_NOT_FOUND",
    })
  })
})

describe("approveAndSend — hand-sent messages", () => {
  it("refuses to dispatch a hand-sent message", async () => {
    // The claim excludes the manual channel, so it matches nothing…
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([message()])

    await expect(approveAndSend(7, "staff-1")).rejects.toMatchObject({
      statusCode: 400,
      code: "MANUAL_CHANNEL",
    })
    // …and nothing past the claim + explanatory read ever runs, so no provider is
    // called and the message stays in the queue rather than stranded in 'queued'.
    expect(query).toHaveBeenCalledTimes(2)
    expect(sqlOf(0)).toMatch(/channel::text <> 'whatsapp_manual'/)
  })
})

describe("resolveUnconfirmed — not_sent", () => {
  it("puts a hand-sent message straight back into the queue", async () => {
    query
      .mockResolvedValueOnce([{ id: 7 }])
      .mockResolvedValueOnce([message({ status: "pending_approval" })])

    const result = await resolveUnconfirmed(7, "not_sent")

    expect(result.status).toBe("pending_approval")
    const sql = sqlOf(0)
    expect(sql).toMatch(/status = 'pending_approval'/)
    // Both halves of the approval pair are cleared together — the
    // messages_approval_pair CHECK constraint requires both-or-neither.
    expect(sql).toMatch(/approved_by = NULL/)
    expect(sql).toMatch(/approved_at = NULL/)
    expect(sql).toMatch(/channel::text = 'whatsapp_manual'/)
  })

  it("refuses not_sent for a provider channel", async () => {
    // Reaching 'queued' on SMS means an API call was made. "Nothing was sent"
    // can't be known there, and re-queuing on that assumption double-sends.
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([message({ channel: "sms", status: "queued" })])

    await expect(resolveUnconfirmed(7, "not_sent")).rejects.toMatchObject({
      statusCode: 400,
      code: "NOT_MANUAL_CHANNEL",
    })
  })

  it("409s when the message isn't awaiting confirmation", async () => {
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([message({ status: "sent" })])

    await expect(resolveUnconfirmed(7, "not_sent")).rejects.toMatchObject({
      statusCode: 409,
      code: "NOT_UNCONFIRMED",
    })
  })

  it("still resolves 'sent' through the original path", async () => {
    query
      .mockResolvedValueOnce([{ id: 7 }])
      .mockResolvedValueOnce([message({ status: "sent" })])

    const result = await resolveUnconfirmed(7, "sent")
    expect(result.status).toBe("sent")
    expect(query.mock.calls[0][1]).toEqual([7, "sent"])
  })

  it("casts $2 to message_status everywhere it's used", async () => {
    // Regression: `status = $2` deduces message_status but a bare `$2 = 'sent'`
    // deduces text, and Postgres refuses a parameter with two types (42P08) — so
    // "Yes, I sent it" failed on every click in production. The mock can't parse
    // SQL, so pin the shape instead: no bare $2 may remain.
    query
      .mockResolvedValueOnce([{ id: 7 }])
      .mockResolvedValueOnce([message({ status: "sent" })])

    await resolveUnconfirmed(7, "sent")
    const sql = sqlOf(0)
    expect(sql.match(/\$2::message_status/g)).toHaveLength(2)
    expect(sql).not.toMatch(/\$2(?!::message_status)/)
  })
})

describe("conversation history — only messages that actually went out", () => {
  // A conversation row exists from the first DRAFT, so History used to list clients
  // (and preview drafts) for messages that were never sent, discarded, or still
  // awaiting "Did these go out?". History is now sent/delivered/read + inbound only.
  const HISTORY = /\(m\.direction = 'inbound' OR m\.status IN \('sent', 'delivered', 'read'\)\)/

  it("the thread keeps only history messages, ordered by when they went out", async () => {
    query.mockResolvedValueOnce([])
    await getConversationMessages(3)

    const sql = sqlOf(0)
    expect(sql).toMatch(HISTORY)
    expect(sql).toMatch(/ORDER BY COALESCE\(m\.sent_at, m\.created_at\) ASC, m\.id ASC/)
    expect(query.mock.calls[0][1]).toEqual([3])
  })

  it("the list drops conversations with no history and previews only history", async () => {
    query.mockResolvedValueOnce([])
    await getConversations()

    const sql = sqlOf(0)
    // The preview comes from the filtered set…
    expect(sql).toMatch(HISTORY)
    // …through an INNER lateral join, which is what drops draft-only conversations.
    expect(sql).toMatch(/\n\s*JOIN LATERAL \(\s*SELECT m\.body/)
    expect(sql).not.toMatch(/LEFT JOIN LATERAL \(\s*SELECT m\.body/)
    expect(sql).toMatch(/ORDER BY last\.happened_at DESC, c\.id DESC/)
  })
})

describe("createBroadcast — hand-sent WhatsApp", () => {
  it("refuses before opening a transaction", async () => {
    await expect(
      createBroadcast({ name: "Promo", template_id: 1, channel: "whatsapp_manual" }, "admin-1"),
    ).rejects.toMatchObject({ statusCode: 400, code: "BROADCAST_NOT_SUPPORTED" })

    // Nothing written, no connection checked out.
    expect(pool.connect).not.toHaveBeenCalled()
  })
})

describe("getUnconfirmed", () => {
  it("surfaces hand-sent handoffs immediately, without the 5-minute grace period", async () => {
    // The grace period exists so an in-flight API call isn't flagged early. A manual
    // handoff has no "in flight" — so it must appear at once, or it would vanish
    // from the queue and show up nowhere for five minutes.
    query.mockResolvedValueOnce([])
    await getUnconfirmed()

    const sql = sqlOf(0)
    expect(sql).toMatch(/status = 'queued'/)
    expect(sql).toMatch(/provider_message_id IS NULL/)
    // The manual branch is OR'd with the time check, not AND'd.
    expect(sql).toMatch(/channel::text = 'whatsapp_manual'\s+OR m\.last_attempt_at </)
  })
})

describe("getPendingQueue", () => {
  it("returns failed messages alongside pending drafts", async () => {
    // The dashboard fills its "Failed to send" pile from this list. When it only
    // returned pending drafts, that pile was permanently empty.
    query.mockResolvedValueOnce([])
    await getPendingQueue()

    const sql = sqlOf(0)
    expect(sql).toMatch(/m\.status = 'pending_approval' AND m\.direction = 'outbound'/)
    expect(sql).toMatch(/m\.status = 'failed' AND m\.direction = 'outbound'/)
    // An explicit OR (not IN) so each arm can use its own partial index.
    expect(sql).not.toMatch(/status IN/)
  })
})

describe("cancelMessage", () => {
  it("can discard a failed message, not just a pending one", async () => {
    query
      .mockResolvedValueOnce([{ id: 7 }])
      .mockResolvedValueOnce([message({ status: "cancelled" })])

    await cancelMessage(7, "staff-1")
    expect(sqlOf(0)).toMatch(/status IN \('pending_approval', 'failed'\)/)
  })

  it("never cancels a message that may already have been delivered", async () => {
    // 'queued' means handed off with an unknown result. Calling that cancelled
    // would be a lie, so it isn't in the allowed set.
    query.mockResolvedValueOnce([])
    await expect(cancelMessage(7, "staff-1")).rejects.toMatchObject({
      statusCode: 409,
      code: "ALREADY_PROCESSED",
    })
    expect(sqlOf(0)).not.toMatch(/'queued'/)
  })
})
