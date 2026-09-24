import { describe, it, expect, vi, beforeEach } from "vitest"

// messageTriggers imports messageService, which imports lib/db and opens a pg Pool
// at module load. Mock the whole service so these tests stay pure.
vi.mock("../messageService", () => ({
  getTemplateByTrigger: vi.fn(),
  enqueueTemplateMessage: vi.fn(),
  supersedePendingTriggerMessages: vi.fn(),
}))

import { onClientCreated, onItemStageChanged } from "../messageTriggers"
import {
  getTemplateByTrigger,
  enqueueTemplateMessage,
  supersedePendingTriggerMessages,
} from "../messageService"

const mockTemplate = (id: number) => ({ id, name: "t", body: "b" })

// The id the freshly drafted message gets — "newest wins" cancels drafts older than it.
const NEW_DRAFT_ID = 99

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(enqueueTemplateMessage).mockResolvedValue({ id: NEW_DRAFT_ID } as never)
  vi.mocked(supersedePendingTriggerMessages).mockResolvedValue(0)
  // Silence the expected error logging in the no-throw tests.
  vi.spyOn(console, "error").mockImplementation(() => {})
})

const stageArgs = (overrides = {}) => ({
  itemId: 42,
  userId: "user-1",
  userName: "Sara",
  description: "mug",
  clayType: "stoneware",
  previousStage: "glaze fired",
  newStage: "ready",
  isBackward: false,
  ...overrides,
})

describe("onClientCreated", () => {
  it("drafts a welcome message when a template is wired to the trigger", async () => {
    vi.mocked(getTemplateByTrigger).mockResolvedValue(mockTemplate(7) as never)

    await onClientCreated({ id: "user-1", full_name: "Sara Mansour" })

    expect(getTemplateByTrigger).toHaveBeenCalledWith("client_created")
    expect(enqueueTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        templateId: 7,
        variables: { "1": "Sara Mansour" },
        trigger: "client_created",
        triggerRef: "user-1",
        createdBy: null, // system-generated, not attributable to a staff member
      }),
    )
  })

  it("does nothing when no template is configured", async () => {
    // Not an error — it means the studio hasn't set this up, or turned it off.
    vi.mocked(getTemplateByTrigger).mockResolvedValue(null)

    await onClientCreated({ id: "user-1", full_name: "Sara" })

    expect(enqueueTemplateMessage).not.toHaveBeenCalled()
  })

  // ══ THE LOAD-BEARING TEST ══
  // Creating a client must succeed even if messaging is completely broken. If this
  // ever starts throwing, a messaging bug becomes a client-registration outage.
  it("never throws, even when the messaging layer fails", async () => {
    vi.mocked(getTemplateByTrigger).mockRejectedValue(new Error("database is on fire"))

    await expect(
      onClientCreated({ id: "user-1", full_name: "Sara" }),
    ).resolves.toBeUndefined()
  })

  it("never throws when enqueueing itself fails", async () => {
    vi.mocked(getTemplateByTrigger).mockResolvedValue(mockTemplate(7) as never)
    // e.g. the client has no phone number, or it isn't valid E.164.
    vi.mocked(enqueueTemplateMessage).mockRejectedValue(
      Object.assign(new Error("no phone"), { statusCode: 400, code: "NO_PHONE" }),
    )

    await expect(
      onClientCreated({ id: "user-1", full_name: "Sara" }),
    ).resolves.toBeUndefined()
  })
})

describe("onItemStageChanged", () => {
  it("drafts a progress message for a forward stage change", async () => {
    vi.mocked(getTemplateByTrigger).mockResolvedValue(mockTemplate(3) as never)

    await onItemStageChanged(stageArgs())

    // The trigger key is data-driven: `item_stage:<stage>`. Which stages notify is
    // controlled by which templates exist, not by this code.
    expect(getTemplateByTrigger).toHaveBeenCalledWith("item_stage:ready")
    expect(enqueueTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        templateId: 3,
        variables: { "1": "Sara", "2": "mug", "3": "ready" },
        trigger: "item_stage",
        triggerRef: "42",
      }),
    )
  })

  it("drafts the thank-you when a piece is picked up", async () => {
    // The 'picked up' template (migration 009) is just data — no code knows about it.
    vi.mocked(getTemplateByTrigger).mockResolvedValue(mockTemplate(5) as never)

    await onItemStageChanged(stageArgs({ previousStage: "ready", newStage: "picked up" }))

    expect(getTemplateByTrigger).toHaveBeenCalledWith("item_stage:picked up")
    expect(enqueueTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: 5,
        variables: expect.objectContaining({ "3": "picked up" }),
        triggerRef: "42",
      }),
    )
  })

  it("drafts even while an older draft for the piece is still pending — newest wins", async () => {
    // The bug this replaced: an unsent "ready for pickup" draft used to BLOCK the
    // thank-you, and the stale "ready" draft stayed in the queue. Now the new draft
    // is created and the older ones are cancelled.
    vi.mocked(getTemplateByTrigger).mockResolvedValue(mockTemplate(5) as never)
    vi.mocked(supersedePendingTriggerMessages).mockResolvedValue(1) // the stale "ready" draft

    await onItemStageChanged(stageArgs({ previousStage: "ready", newStage: "picked up" }))

    expect(enqueueTemplateMessage).toHaveBeenCalledTimes(1)
    // Only drafts OLDER than the new one are cancelled, so the new one survives.
    expect(supersedePendingTriggerMessages).toHaveBeenCalledWith("item_stage", "42", NEW_DRAFT_ID)
  })

  it("cancels the old drafts only AFTER the new one exists", async () => {
    // Draft-then-cancel: a failure in between leaves the old draft visible to staff
    // instead of leaving the piece with nothing in the queue.
    vi.mocked(getTemplateByTrigger).mockResolvedValue(mockTemplate(3) as never)

    await onItemStageChanged(stageArgs())

    const drafted = vi.mocked(enqueueTemplateMessage).mock.invocationCallOrder[0]
    const cancelled = vi.mocked(supersedePendingTriggerMessages).mock.invocationCallOrder[0]
    expect(drafted).toBeLessThan(cancelled)
  })

  it("keeps the old draft when drafting the new one fails", async () => {
    vi.mocked(getTemplateByTrigger).mockResolvedValue(mockTemplate(3) as never)
    vi.mocked(enqueueTemplateMessage).mockRejectedValue(
      Object.assign(new Error("no phone"), { statusCode: 400, code: "NO_PHONE" }),
    )

    await expect(onItemStageChanged(stageArgs())).resolves.toBeUndefined()
    expect(supersedePendingTriggerMessages).not.toHaveBeenCalled()
  })

  it("announces nothing on a rewind, but clears the stale draft", async () => {
    // An admin rewinding to fix a mistake isn't progress worth announcing, and
    // "your piece is now at the drying stage" after it was ready would alarm people.
    // But a draft written for the stage the piece just LEFT is wrong now — e.g. a
    // "thanks for picking it up!" drafted by a mistaken move to Picked Up.
    vi.mocked(getTemplateByTrigger).mockResolvedValue(mockTemplate(3) as never)

    await onItemStageChanged(stageArgs({ previousStage: "picked up", newStage: "ready", isBackward: true }))

    expect(enqueueTemplateMessage).not.toHaveBeenCalled()
    expect(getTemplateByTrigger).not.toHaveBeenCalled()
    // No id: nothing new was drafted, so every unsent draft for the piece goes.
    expect(supersedePendingTriggerMessages).toHaveBeenCalledWith("item_stage", "42")
  })

  it("does nothing at all when the stage didn't actually change", async () => {
    vi.mocked(getTemplateByTrigger).mockResolvedValue(mockTemplate(3) as never)

    await onItemStageChanged(stageArgs({ previousStage: "ready", newStage: "ready" }))

    expect(enqueueTemplateMessage).not.toHaveBeenCalled()
    // The existing draft still describes the current stage — leave it alone.
    expect(supersedePendingTriggerMessages).not.toHaveBeenCalled()
  })

  it("drafts nothing for a stage with no template, but clears the stale draft", async () => {
    // e.g. ready → discarded: "ready for pickup!" must not go out about a discarded piece.
    vi.mocked(getTemplateByTrigger).mockResolvedValue(null)

    await onItemStageChanged(stageArgs({ previousStage: "ready", newStage: "discarded" }))

    expect(enqueueTemplateMessage).not.toHaveBeenCalled()
    expect(supersedePendingTriggerMessages).toHaveBeenCalledWith("item_stage", "42")
  })

  it("falls back to the clay type when the piece has no description", async () => {
    // renderTemplate throws on an empty variable, so a description-less piece would
    // otherwise fail to draft — for a perfectly ordinary item.
    vi.mocked(getTemplateByTrigger).mockResolvedValue(mockTemplate(3) as never)

    await onItemStageChanged(stageArgs({ description: null }))

    expect(enqueueTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({ "2": "stoneware piece" }),
      }),
    )
  })

  it("falls back to a generic phrase when there's no description or clay type", async () => {
    vi.mocked(getTemplateByTrigger).mockResolvedValue(mockTemplate(3) as never)

    await onItemStageChanged(stageArgs({ description: null, clayType: null }))

    expect(enqueueTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({ "2": "your piece" }),
      }),
    )
  })

  it("treats a whitespace-only description as missing", async () => {
    vi.mocked(getTemplateByTrigger).mockResolvedValue(mockTemplate(3) as never)

    await onItemStageChanged(stageArgs({ description: "   " }))

    expect(enqueueTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({ "2": "stoneware piece" }),
      }),
    )
  })

  // ══ THE LOAD-BEARING TESTS ══
  // Advancing an item must succeed even if messaging is broken.
  it("never throws, even when the messaging layer fails", async () => {
    vi.mocked(getTemplateByTrigger).mockRejectedValue(new Error("database is on fire"))

    await expect(onItemStageChanged(stageArgs())).resolves.toBeUndefined()
  })

  it("never throws when cancelling stale drafts fails", async () => {
    vi.mocked(getTemplateByTrigger).mockResolvedValue(mockTemplate(3) as never)
    vi.mocked(supersedePendingTriggerMessages).mockRejectedValue(new Error("lock timeout"))

    await expect(onItemStageChanged(stageArgs())).resolves.toBeUndefined()
    // …and a failing cleanup on a rewind is swallowed the same way.
    await expect(
      onItemStageChanged(stageArgs({ previousStage: "ready", newStage: "drying", isBackward: true })),
    ).resolves.toBeUndefined()
  })
})
