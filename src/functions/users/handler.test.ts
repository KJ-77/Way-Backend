import { describe, it, expect, vi, beforeEach } from "vitest"
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda"

// Mock everything the handler module reaches for, so no pg Pool, Cognito client or
// Lambda invoke is touched.
vi.mock("../../services/userService", () => ({
  getAllUsers: vi.fn(),
  getUserById: vi.fn(),
}))
vi.mock("../../lib/cognito", () => ({}))
vi.mock("../../lib/lambda", () => ({ invokeLambda: vi.fn() }))

import * as userService from "../../services/userService"
import { getUsers, createUser, updateUser, deleteUser, restoreUser, resetUserPassword } from "./handler"

// GET /users used to check nothing. The authorizer accepts client-pool tokens, and
// anyone can get one through the public POST /auth/signup — so any signed-up client
// could download every client's personal details. These tests keep that door shut.

function fakeEvent(opts: {
  source_pool: "admin" | "client"
  groups?: string
  path?: Record<string, string>
}): APIGatewayProxyEventV2 {
  return {
    requestContext: {
      authorizer: {
        lambda: {
          sub: "caller-1",
          email: "test@example.com",
          groups: opts.groups ?? "",
          source_pool: opts.source_pool,
        },
      },
    },
    pathParameters: opts.path,
  } as unknown as APIGatewayProxyEventV2
}

const status = (res: unknown) => (res as APIGatewayProxyStructuredResultV2).statusCode

const client = { id: "u-1", full_name: "Sara", phone: "+96170123456" }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(userService.getAllUsers).mockResolvedValue([client] as never)
  vi.mocked(userService.getUserById).mockResolvedValue(client as never)
})

describe("GET /users — client tokens are refused", () => {
  it.each([
    ["the list", {}],
    ["a single client", { path: { id: "u-2" } }],
    // Even their own row: Way-Client never reads /users, so there's no reason to allow it.
    ["their own row", { path: { id: "caller-1" } }],
  ])("403 for %s, and the database is never queried", async (_name, extra) => {
    const res = await getUsers(fakeEvent({ source_pool: "client", ...extra }))
    expect(status(res)).toBe(403)
    expect(userService.getAllUsers).not.toHaveBeenCalled()
    expect(userService.getUserById).not.toHaveBeenCalled()
  })

  it("403 for an admin-pool token that belongs to no staff group", async () => {
    // Being in the admin POOL isn't enough — the group is what makes someone staff.
    expect(status(await getUsers(fakeEvent({ source_pool: "admin", groups: "" })))).toBe(403)
  })

  it("401 with no authorizer context at all", async () => {
    const res = await getUsers({ requestContext: {} } as unknown as APIGatewayProxyEventV2)
    expect(status(res)).toBe(401)
  })
})

describe("GET /users — every staff role can read", () => {
  it.each(["admin", "studio-manager", "agent"])("%s can list clients and open one", async groups => {
    expect(status(await getUsers(fakeEvent({ source_pool: "admin", groups })))).toBe(200)
    expect(status(await getUsers(fakeEvent({ source_pool: "admin", groups, path: { id: "u-1" } })))).toBe(200)
  })
})

describe("client writes — who may do what", () => {
  // Only the gate is under test: 403 means "refused before anything ran". Anything
  // else means the caller got through (the mocked Cognito/Lambda then fail however
  // they fail — irrelevant here).
  const refused = async (call: Promise<unknown>) => status(await call) === 403
  const as = (groups: string) => fakeEvent({ source_pool: "admin", groups, path: { id: "u-1" } })

  // The callers that get through hit the mocked Cognito/Lambda and log an error.
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("agents can add a client but not edit, delete, restore or reset one", async () => {
    expect(await refused(createUser(as("agent")))).toBe(false)
    expect(await refused(updateUser(as("agent")))).toBe(true)
    expect(await refused(deleteUser(as("agent")))).toBe(true)
    expect(await refused(restoreUser(as("agent")))).toBe(true)
    expect(await refused(resetUserPassword(as("agent")))).toBe(true)
  })

  it("studio managers can do everything except delete (restore is allowed)", async () => {
    expect(await refused(deleteUser(as("studio-manager")))).toBe(true)
    expect(await refused(restoreUser(as("studio-manager")))).toBe(false)
    expect(await refused(updateUser(as("studio-manager")))).toBe(false)
  })

  it("admins can delete", async () => {
    expect(await refused(deleteUser(as("admin")))).toBe(false)
  })
})
