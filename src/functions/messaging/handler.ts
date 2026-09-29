// ── Communications HTTP API ──
//
// The dashboard's surface onto the messaging engine: the approval queue, the
// "needs attention" pile, per-client message history, templates, and broadcasts.
//
// Everything here is STAFF ONLY. Clients have Cognito logins and their tokens reach
// this API, so every handler asks for a permission (lib/permissions.ts) — a client
// must never be able to read the queue, approve a send, or launch a broadcast.
// `requirePermission` returns 403 for a client token: no staff group, no permission.
//
// These handlers are deliberately thin. All the interesting logic (the atomic
// approve claim, retry classification, chunked broadcast draining) lives in
// messageService and is unit-tested there.

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda"
import { createResponse, parseBody, getPathParam, handleError } from "../../lib/response"
import { getAuthContext, requirePermission } from "../../lib/auth"
import {
  CreateMessageSchema,
  CreateBroadcastSchema,
  UpdateTemplateSchema,
  ResolveUnconfirmedSchema,
  MarketingOptOutSchema,
} from "../../lib/schemas/message.schema"
import * as messageService from "../../services/messageService"

// Who holds which messaging permission lives in lib/permissions.ts. The reasoning:
//   • messages:create / send / discard — admins AND studio managers. There's
//     deliberately no admin-only approval tier: the person at the studio desk
//     approves messages, and gating approval behind `admin` would push staff to share
//     the admin login — worse for the audit trail than the permission it buys.
//     Agents only READ (the queue and the history), never send.
//   • broadcasts:manage + templates:update — admin only. A promo blast goes to every
//     client at once, costs real money per recipient, and over-sending damages sender
//     reputation for ALL traffic; a template edit silently changes every future
//     automatic message. Both are owner-level decisions.

// Small helper: parse a numeric path param, or return a 400 response.
// Returns a discriminated result rather than throwing, so handlers stay flat.
const numericParam = (
  event: APIGatewayProxyEventV2,
  key: string,
  label: string,
): { id: number } | { error: APIGatewayProxyResultV2 } => {
  const raw = getPathParam(event, key)
  const id = Number(raw)
  if (!raw || !Number.isInteger(id) || id <= 0) {
    return { error: createResponse(400, { error: `Invalid ${label}`, code: "INVALID_ID" }) }
  }
  return { id }
}

// ── Queue ───────────────────────────────────────────────────────────────────

/** Messages drafted and waiting for a human. The dashboard's primary view. */
export const getQueue = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requirePermission(getAuthContext(event), "messages:read")
    if (denied) return denied
    return createResponse(200, await messageService.getPendingQueue())
  } catch (err) {
    return handleError(err)
  }
}

/**
 * Sends we couldn't confirm — handed to the provider with no recorded result.
 * These are never auto-retried (that's how a client gets the same message twice),
 * so they sit here until a human says what actually happened.
 */
export const getUnconfirmed = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requirePermission(getAuthContext(event), "messages:read")
    if (denied) return denied
    return createResponse(200, await messageService.getUnconfirmed())
  } catch (err) {
    return handleError(err)
  }
}

/** Drafts a message into the queue. Nothing sends until it's approved. */
export const createMessage = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuthContext(event)
    const denied = requirePermission(auth, "messages:create")
    if (denied) return denied

    const result = CreateMessageSchema.safeParse(parseBody(event.body))
    if (!result.success) {
      return createResponse(400, {
        error: "Validation failed",
        code: "VALIDATION_FAILED",
        issues: result.error.issues,
      })
    }
    const dto = result.data

    // The schema guarantees exactly one of template_id / body is present.
    const message = dto.template_id
      ? await messageService.enqueueTemplateMessage({
          userId: dto.user_id,
          templateId: dto.template_id,
          variables: dto.variables ?? {},
          trigger: "manual",
          channel: dto.channel,
          createdBy: auth!.sub,
        })
      : await messageService.enqueueFreeformReply({
          userId: dto.user_id,
          body: dto.body!,
          channel: dto.channel,
          createdBy: auth!.sub,
        })

    return createResponse(201, message)
  } catch (err) {
    return handleError(err)
  }
}

/**
 * Approves a queued message and sends it, synchronously.
 *
 * The claim inside approveAndSend is an atomic compare-and-swap, so two admins
 * clicking Approve at the same instant can't both send — the loser gets a 409
 * ALREADY_PROCESSED rather than the client getting the message twice.
 */
export const approveMessage = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuthContext(event)
    const denied = requirePermission(auth, "messages:send")
    if (denied) return denied

    const param = numericParam(event, "id", "message ID")
    if ("error" in param) return param.error

    return createResponse(200, await messageService.approveAndSend(param.id, auth!.sub))
  } catch (err) {
    return handleError(err)
  }
}

/**
 * Claims a hand-sent WhatsApp message just before a staff member sends it.
 *
 * The dashboard calls this at the moment someone presses "Open in WhatsApp". It
 * doesn't send anything — a person does that, in their own app. What it does is
 * stop a second staff member sending the same message (atomic claim → 409 for the
 * loser) and move the row into the "handed off, result unknown" state, which a
 * human then resolves via POST /messages/{id}/resolve.
 */
export const handoffMessage = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuthContext(event)
    const denied = requirePermission(auth, "messages:send")
    if (denied) return denied

    const param = numericParam(event, "id", "message ID")
    if ("error" in param) return param.error

    return createResponse(200, await messageService.handoffMessage(param.id, auth!.sub))
  } catch (err) {
    return handleError(err)
  }
}

/** Discards a drafted message. The client never knows it existed. */
export const cancelMessage = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuthContext(event)
    const denied = requirePermission(auth, "messages:discard")
    if (denied) return denied

    const param = numericParam(event, "id", "message ID")
    if ("error" in param) return param.error

    return createResponse(200, await messageService.cancelMessage(param.id, auth!.sub))
  } catch (err) {
    return handleError(err)
  }
}

/** Puts a failed message back in the queue so staff can fix and retry it. */
export const requeueMessage = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requirePermission(getAuthContext(event), "messages:send")
    if (denied) return denied

    const param = numericParam(event, "id", "message ID")
    if ("error" in param) return param.error

    return createResponse(200, await messageService.requeueMessage(param.id))
  } catch (err) {
    return handleError(err)
  }
}

/**
 * Records what really happened to an unconfirmed send.
 *
 * We never guess here. Guessing "sent" silently drops a message that never arrived;
 * guessing "failed" leads staff to resend one the client already has.
 */
export const resolveMessage = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requirePermission(getAuthContext(event), "messages:send")
    if (denied) return denied

    const param = numericParam(event, "id", "message ID")
    if ("error" in param) return param.error

    const result = ResolveUnconfirmedSchema.safeParse(parseBody(event.body))
    if (!result.success) {
      return createResponse(400, {
        error: "Validation failed",
        code: "VALIDATION_FAILED",
        issues: result.error.issues,
      })
    }

    return createResponse(200, await messageService.resolveUnconfirmed(param.id, result.data.resolution))
  } catch (err) {
    return handleError(err)
  }
}

// ── Conversations (message history per client) ──────────────────────────────
//
// On SMS this is a one-way send log, not a chat — Lebanon has no inbound SMS. It's
// still the most useful view in the feature: "what have we actually sent this
// client, and did it arrive?". The queries already handle inbound messages, so this
// becomes a real two-way inbox unchanged the day WhatsApp is switched on.

export const getConversations = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requirePermission(getAuthContext(event), "messages:read")
    if (denied) return denied
    return createResponse(200, await messageService.getConversations())
  } catch (err) {
    return handleError(err)
  }
}

export const getConversationMessages = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requirePermission(getAuthContext(event), "messages:read")
    if (denied) return denied

    const param = numericParam(event, "id", "conversation ID")
    if ("error" in param) return param.error

    return createResponse(200, await messageService.getConversationMessages(param.id))
  } catch (err) {
    return handleError(err)
  }
}

/** Clears the unread badge. No-op on SMS (nothing inbound), kept for WhatsApp. */
export const markConversationRead = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requirePermission(getAuthContext(event), "messages:send")
    if (denied) return denied

    const param = numericParam(event, "id", "conversation ID")
    if ("error" in param) return param.error

    await messageService.markConversationRead(param.id)
    return createResponse(200, { success: true })
  } catch (err) {
    return handleError(err)
  }
}

// ── Templates ───────────────────────────────────────────────────────────────

export const getTemplates = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requirePermission(getAuthContext(event), "messages:read")
    if (denied) return denied
    return createResponse(200, await messageService.getTemplates())
  } catch (err) {
    return handleError(err)
  }
}

/**
 * Edits template wording. Live immediately — no provider review step on SMS.
 * Admin-only: template bodies are what every automatic message says, so a bad edit
 * silently affects every future send of that type.
 */
export const updateTemplate = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requirePermission(getAuthContext(event), "templates:update")
    if (denied) return denied

    const param = numericParam(event, "id", "template ID")
    if ("error" in param) return param.error

    const result = UpdateTemplateSchema.safeParse(parseBody(event.body))
    if (!result.success) {
      return createResponse(400, {
        error: "Validation failed",
        code: "VALIDATION_FAILED",
        issues: result.error.issues,
      })
    }

    return createResponse(200, await messageService.updateTemplate(param.id, result.data))
  } catch (err) {
    return handleError(err)
  }
}

// ── Broadcasts ──────────────────────────────────────────────────────────────

export const getBroadcasts = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requirePermission(getAuthContext(event), "messages:read")
    if (denied) return denied
    return createResponse(200, await messageService.getBroadcasts())
  } catch (err) {
    return handleError(err)
  }
}

/**
 * Creates a campaign and fans it out into one pending message per recipient.
 * Nothing sends yet — draining is a separate, explicit step.
 */
export const createBroadcast = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuthContext(event)
    const denied = requirePermission(auth, "broadcasts:manage")
    if (denied) return denied

    const result = CreateBroadcastSchema.safeParse(parseBody(event.body))
    if (!result.success) {
      return createResponse(400, {
        error: "Validation failed",
        code: "VALIDATION_FAILED",
        issues: result.error.issues,
      })
    }

    return createResponse(201, await messageService.createBroadcast(result.data, auth!.sub))
  } catch (err) {
    return handleError(err)
  }
}

/**
 * Sends the next chunk of a campaign.
 *
 * Synchronous sending can't push 130 messages inside API Gateway's 29-second limit,
 * so the frontend calls this repeatedly behind a progress bar until `remaining`
 * reaches zero. Safe to interrupt: unsent rows are simply left untouched and the
 * next call picks up where it stopped.
 */
export const drainBroadcast = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuthContext(event)
    const denied = requirePermission(auth, "broadcasts:manage")
    if (denied) return denied

    const param = numericParam(event, "id", "broadcast ID")
    if ("error" in param) return param.error

    return createResponse(200, await messageService.drainBroadcast(param.id, auth!.sub))
  } catch (err) {
    return handleError(err)
  }
}

// ── Opt-out ─────────────────────────────────────────────────────────────────

/**
 * Marks a client as opted out of (or back into) marketing broadcasts.
 *
 * This is the ONLY opt-out path on SMS. On WhatsApp a client replying "STOP" was
 * handled automatically, but Lebanon has no inbound SMS, so a human has to record
 * it here when a client asks by phone or in person. Utility messages ("your piece
 * is ready") still send either way — someone who doesn't want promos still wants
 * their pottery.
 */
export const setMarketingOptOut = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const denied = requirePermission(getAuthContext(event), "clients:update")
    if (denied) return denied

    const userId = getPathParam(event, "id")
    if (!userId) return createResponse(400, { error: "Invalid client ID", code: "INVALID_ID" })

    const result = MarketingOptOutSchema.safeParse(parseBody(event.body))
    if (!result.success) {
      return createResponse(400, {
        error: "Validation failed",
        code: "VALIDATION_FAILED",
        issues: result.error.issues,
      })
    }

    await messageService.setMarketingOptOut(userId, result.data.opt_out)
    return createResponse(200, { success: true, opt_out: result.data.opt_out })
  } catch (err) {
    return handleError(err)
  }
}
