import { describe, it, expect, vi, beforeEach } from "vitest"
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda"

// Mock the service and the messaging trigger so no pg Pool is touched.
vi.mock("../../services/itemService", () => ({
  getAllItems: vi.fn(),
  getItemById: vi.fn(),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  isStageBackward: vi.fn(),
}))
vi.mock("../../services/messageTriggers", () => ({ onItemStageChanged: vi.fn() }))

import * as itemService from "../../services/itemService"
import { createItem, updateItem, deleteItem } from "./handler"

// POST /items serves both sections, and they need different permissions: an agent
// may add a walk-in PC piece but not a Studio piece (which hangs off a subscription
// and its clay). These tests keep that split — and the admin-only rewind/delete — honest.

function fakeEvent(opts: {
  source_pool?: "admin" | "client"
  groups?: string
  path?: Record<string, string>
  body?: unknown
}): APIGatewayProxyEventV2 {
  return {
    requestContext: {
      authorizer: {
        lambda: {
          sub: "caller-1",
          email: "test@example.com",
          groups: opts.groups ?? "",
          source_pool: opts.source_pool ?? "admin",
        },
      },
    },
    pathParameters: opts.path,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  } as unknown as APIGatewayProxyEventV2
}

const status = (res: unknown) => (res as APIGatewayProxyStructuredResultV2).statusCode

const pcBody = { user_id: "u-1", user_package_id: null, section: "PC", stage: "glaze fired" }
const studioBody = { user_id: "u-1", user_package_id: 3, section: "Studio" }
const item = { id: 9, user_id: "u-1", user_name: "Sara", stage: "ready", section: "Studio" }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(itemService.createItem).mockResolvedValue(item as never)
  vi.mocked(itemService.getItemById).mockResolvedValue(item as never)
  vi.mocked(itemService.updateItem).mockResolvedValue(item as never)
  vi.mocked(itemService.deleteItem).mockResolvedValue(true)
})

describe("POST /items — creation depends on the section", () => {
  it("an agent can add a PC piece", async () => {
    expect(status(await createItem(fakeEvent({ groups: "agent", body: pcBody })))).toBe(201)
  })

  it("an agent can't add a Studio piece — and nothing is written", async () => {
    expect(status(await createItem(fakeEvent({ groups: "agent", body: studioBody })))).toBe(403)
    expect(itemService.createItem).not.toHaveBeenCalled()
  })

  it.each(["admin", "studio-manager"])("%s can add both kinds", async groups => {
    expect(status(await createItem(fakeEvent({ groups, body: pcBody })))).toBe(201)
    expect(status(await createItem(fakeEvent({ groups, body: studioBody })))).toBe(201)
  })

  it("a client token gets a plain 403 — before any validation feedback", async () => {
    const res = await createItem(fakeEvent({ source_pool: "client", body: { junk: true } }))
    expect(status(res)).toBe(403)
  })
})

describe("PUT/DELETE /items — agents never; rewind and delete are admin-only", () => {
  it("an agent can't edit a piece, even a PC one", async () => {
    const res = await updateItem(fakeEvent({ groups: "agent", path: { id: "9" }, body: { description: "x" } }))
    expect(status(res)).toBe(403)
  })

  it("a studio manager can move a piece forward…", async () => {
    vi.mocked(itemService.isStageBackward).mockReturnValue(false)
    const res = await updateItem(fakeEvent({ groups: "studio-manager", path: { id: "9" }, body: { stage: "picked up" } }))
    expect(status(res)).toBe(200)
  })

  it("…but not backwards", async () => {
    vi.mocked(itemService.isStageBackward).mockReturnValue(true)
    const res = await updateItem(fakeEvent({ groups: "studio-manager", path: { id: "9" }, body: { stage: "glaze fired" } }))
    expect(status(res)).toBe(403)
    expect(itemService.updateItem).not.toHaveBeenCalled()
  })

  it("only an admin can delete", async () => {
    expect(status(await deleteItem(fakeEvent({ groups: "studio-manager", path: { id: "9" } })))).toBe(403)
    expect(status(await deleteItem(fakeEvent({ groups: "admin", path: { id: "9" } })))).toBe(200)
  })
})
