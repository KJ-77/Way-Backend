// ── Automatic message triggers ──
//
// Turns business events ("a client was created", "a piece reached Ready") into
// DRAFT messages in the approval queue. Nothing here sends anything — the drafts
// land as 'pending_approval' exactly like a hand-written one and still wait for a
// human. This file only decides *when* to draft and *what to put in the blanks*.
//
// ════════════════════════════════════════════════════════════════════════════
//  THE ONE RULE: a trigger must NEVER break the thing that triggered it.
// ════════════════════════════════════════════════════════════════════════════
//
// Registering a client and moving a piece along are the studio's actual work.
// Messaging is a courtesy layered on top. If the template is missing, the client
// has no phone number, the database hiccups, or this code has a bug, the client
// must still be created and the item must still advance.
//
// So every entry point here is wrapped so that it CANNOT throw. Failures are
// logged to CloudWatch and swallowed. That's a deliberate trade: a silently
// missing welcome message is a nuisance, whereas a client registration that fails
// because of a messaging bug is an outage in the middle of a pottery class.
//
// The corollary is that these functions return void and are called for their side
// effect. Callers must not await them expecting a result, and must not branch on
// them succeeding.

import {
  getTemplateByTrigger,
  enqueueTemplateMessage,
  supersedePendingTriggerMessages,
} from "./messageService"

/**
 * Runs a trigger with the no-throw guarantee described above.
 *
 * Kept as a single wrapper rather than a try/catch at each call site so the rule
 * is enforced in one place and can't be forgotten when a new trigger is added.
 */
async function safely(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    // console.error, not a rethrow. See the header.
    console.error(`[message-trigger] ${label} failed — the business action was not affected`, err)
  }
}

/**
 * A client was just created (by an admin, or via self-signup — both paths land in
 * users/db-handler.ts, so hooking there covers both).
 *
 * Drafts the welcome message if a template is wired to `client_created`.
 */
export async function onClientCreated(user: {
  id: string
  full_name: string
}): Promise<void> {
  await safely("client_created", async () => {
    const template = await getTemplateByTrigger("client_created")
    // No template configured, or it's been switched off. Not an error — it means
    // the studio hasn't set this up (or deliberately turned it off).
    if (!template) return

    await enqueueTemplateMessage({
      userId: user.id,
      templateId: template.id,
      variables: { "1": user.full_name },
      trigger: "client_created",
      // Lets the queue and the duplicate guard tie the draft back to the client.
      triggerRef: user.id,
      createdBy: null, // system-generated
    })
  })
}

/**
 * An item moved to a new stage.
 *
 * Which stages notify is driven entirely by DATA, not by this code: the trigger key
 * is `item_stage:<stage>` and we simply look it up. Seeded templates cover
 * `item_stage:bisque fired`, `item_stage:ready` and `item_stage:picked up` (the
 * thank-you, migration 009), but the studio can add, remove or deactivate templates
 * to change which stages message a client — no deploy.
 *
 * NEWEST WINS: at most one unsent stage draft per piece, and it's always about the
 * stage the piece is actually at. Any older unsent draft is cancelled once the piece
 * moves on — see supersedePendingTriggerMessages for why.
 *
 * Deliberately never ANNOUNCES backward moves. An admin rewinding a piece to fix a
 * mistake is correcting the record, not making progress — and "your piece is now at
 * the drying stage" after it was already ready would be alarming. A rewind still
 * clears the stale draft, though: a "thanks for picking it up!" drafted by a
 * mistaken move to Picked Up must not survive the fix. `isBackward` is supplied by
 * the caller, which already computes it.
 */
export async function onItemStageChanged(args: {
  itemId: number
  userId: string
  userName: string
  /** Human description of the piece — falls back through to something printable. */
  description: string | null
  clayType: string | null
  previousStage: string
  newStage: string
  isBackward: boolean
}): Promise<void> {
  await safely(`item_stage:${args.newStage}`, async () => {
    if (args.newStage === args.previousStage) return

    const triggerRef = String(args.itemId)

    // Rewind: announce nothing, but drop whatever was drafted for the stage we left.
    if (args.isBackward) {
      await supersedePendingTriggerMessages("item_stage", triggerRef)
      return
    }

    const template = await getTemplateByTrigger(`item_stage:${args.newStage}`)
    if (!template) {
      // Nothing to say about the new stage, but anything unsent about the old one is
      // stale now — "ready for pickup!" about a piece that was just discarded.
      await supersedePendingTriggerMessages("item_stage", triggerRef)
      return
    }

    // Draft FIRST, then cancel the older drafts. If drafting fails (no phone, a DB
    // hiccup), the old draft survives and staff still see something in the queue to
    // check — rather than the piece silently having nothing at all.
    const draft = await enqueueTemplateMessage({
      userId: args.userId,
      templateId: template.id,
      variables: {
        "1": args.userName,
        "2": describeItem(args.description, args.clayType),
        "3": args.newStage,
      },
      trigger: "item_stage",
      triggerRef,
      createdBy: null,
    })
    await supersedePendingTriggerMessages("item_stage", triggerRef, draft.id)
  })
}

/**
 * Produces a non-empty description of a piece for the {{2}} blank.
 *
 * `renderTemplate` throws on an empty variable — by design, since sending a client
 * a message with a literal "{{2}}" in it is worse than failing into the queue. But
 * `description` is optional on items, so a plain pass-through would turn a blank
 * description into a failed draft for a perfectly ordinary piece.
 *
 * Falls back: description → clay type → a generic phrase that still reads naturally
 * in "your piece (your piece) is ready"… which it doesn't. Hence the generic case
 * returns wording that works inside the template's parentheses.
 */
function describeItem(description: string | null, clayType: string | null): string {
  const trimmed = description?.trim()
  if (trimmed) return trimmed

  const clay = clayType?.trim()
  if (clay) return `${clay} piece`

  return "your piece"
}
