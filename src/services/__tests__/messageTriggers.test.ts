import { describe, it, expect, vi, beforeEach } from "vitest"

// messageTriggers imports messageService, which imports lib/db and opens a pg Pool
// at module load. Mock the whole service so these tests stay pure.
vi.mock("../messageService", () => ({
  getTemplateByTrigger: vi.fn(),
  enqueueTemplateMessage: vi.fn(),
  hasPendingTriggerMessage: vi.fn(),
}))

import { onClientCreated, onItemStageChanged } from "../messageTriggers"
import {
  getTemplateByTrigger,
  enqueueTemplateMessage,
  hasPendingTriggerMessage,
} from "../messageService"

const mockTemplate = (id: number) => ({ id, name: "t", body: "b" })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(hasPendingTriggerMessage).mockResolvedValue(false)
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

  it("does not fire on a backward stage change", async () => {
    // An admin rewinding to fix a mistake isn't progress worth announcing, and
    // "your piece is now at the drying stage" after it was ready would alarm people.
    vi.mocked(getTemplateByTrigger).mockResolvedValue(mockTemplate(3) as never)

    await onItemStageChanged(stageArgs({ previousStage: "ready", newStage: "drying", isBackward: true }))

    expect(enqueueTemplateMessage).not.toHaveBeenCalled()
  })

  it("does not fire when the stage didn't actually change", async () => {
    vi.mocked(getTemplateByTrigger).mockResolvedValue(mockTemplate(3) as never)

    await onItemStageChanged(stageArgs({ previousStage: "ready", newStage: "ready" }))

    expect(enqueueTemplateMessage).not.toHaveBeenCalled()
  })

  it("does not fire for a stage with no template", async () => {
    vi.mocked(getTemplateByTrigger).mockResolvedValue(null)

    await onItemStageChanged(stageArgs({ newStage: "drying" }))

    expect(enqueueTemplateMessage).not.toHaveBeenCalled()
  })

  it("does not stack a second draft while one is still pending", async () => {
    // Toggling a piece back and forth before anyone approves should leave ONE draft.
    vi.mocked(getTemplateByTrigger).mockResolvedValue(mockTemplate(3) as never)
    vi.mocked(hasPendingTriggerMessage).mockResolvedValue(true)

    await onItemStageChanged(stageArgs())

    expect(hasPendingTriggerMessage).toHaveBeenCalledWith("item_stage", "42")
    expect(enqueueTemplateMessage).not.toHaveBeenCalled()
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

  // ══ THE LOAD-BEARING TEST ══
  // Advancing an item must succeed even if messaging is broken.
  it("never throws, even when the messaging layer fails", async () => {
    vi.mocked(getTemplateByTrigger).mockRejectedValue(new Error("database is on fire"))

    await expect(onItemStageChanged(stageArgs())).resolves.toBeUndefined()
  })
})
