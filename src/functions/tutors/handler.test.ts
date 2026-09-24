import { describe, it, expect, vi, beforeEach } from "vitest"
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda"

// Mock the service before importing the handler, so no pg Pool is touched.
vi.mock("../../services/tutorService", () => ({
  getAllTutors: vi.fn(),
  getTutorById: vi.fn(),
  createTutor: vi.fn(),
  updateTutor: vi.fn(),
  deleteTutor: vi.fn(),
}))

import * as tutorService from "../../services/tutorService"
import { getTutors, getTutor, createTutor, updateTutor, deleteTutor } from "./handler"

// These routes used to check nothing, and the authorizer accepts client-pool tokens
// — so any client (anyone, via the public signup) could manage tutors, and PUT could
// smuggle SQL through body keys. These tests keep that door shut.

function fakeEvent(opts: {
  source_pool: "admin" | "client"
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
          source_pool: opts.source_pool,
        },
      },
    },
    pathParameters: opts.path,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  } as unknown as APIGatewayProxyEventV2
}

const clientEvent = (extra: Partial<Parameters<typeof fakeEvent>[0]> = {}) =>
  fakeEvent({ source_pool: "client", ...extra })
const staffEvent = (groups: string, extra: Partial<Parameters<typeof fakeEvent>[0]> = {}) =>
  fakeEvent({ source_pool: "admin", groups, ...extra })

const status = (res: unknown) => (res as APIGatewayProxyStructuredResultV2).statusCode
const bodyOf = (res: unknown) => JSON.parse((res as APIGatewayProxyStructuredResultV2).body as string)

const tutor = { id: 1, full_name: "Maya", email: "", phone: "", hourly_rate: 20, specialty: null, notes: null }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(tutorService.getAllTutors).mockResolvedValue([tutor] as never)
  vi.mocked(tutorService.getTutorById).mockResolvedValue(tutor as never)
  vi.mocked(tutorService.createTutor).mockResolvedValue(tutor as never)
  vi.mocked(tutorService.updateTutor).mockResolvedValue(tutor as never)
  vi.mocked(tutorService.deleteTutor).mockResolvedValue(true)
})

describe("tutors — client tokens are refused on every route", () => {
  it.each([
    ["getTutors", () => getTutors(clientEvent())],
    ["getTutor", () => getTutor(clientEvent({ path: { id: "1" } }))],
    ["createTutor", () => createTutor(clientEvent({ body: { full_name: "x" } }))],
    ["updateTutor", () => updateTutor(clientEvent({ path: { id: "1" }, body: { notes: "x" } }))],
    ["deleteTutor", () => deleteTutor(clientEvent({ path: { id: "1" } }))],
  ])("%s returns 403 and never reaches the service", async (_name, call) => {
    expect(status(await call())).toBe(403)
    for (const fn of Object.values(tutorService)) expect(fn).not.toHaveBeenCalled()
  })

  it("returns 401 with no authorizer context at all", async () => {
    const res = await getTutors({ requestContext: {} } as unknown as APIGatewayProxyEventV2)
    expect(status(res)).toBe(401)
  })
})

describe("tutors — staff keep full access", () => {
  it("studio-manager can list tutors", async () => {
    expect(status(await getTutors(staffEvent("studio-manager")))).toBe(200)
  })

  it("admin can create, update and delete", async () => {
    expect(status(await createTutor(staffEvent("admin", { body: { full_name: "Maya" } })))).toBe(201)
    expect(status(await updateTutor(staffEvent("admin", { path: { id: "1" }, body: { hourly_rate: 25 } })))).toBe(200)
    expect(status(await deleteTutor(staffEvent("admin", { path: { id: "1" } })))).toBe(200)
  })
})

describe("updateTutor — only whitelisted columns reach the SQL builder", () => {
  it("drops a key carrying SQL before calling the service", async () => {
    await updateTutor(staffEvent("admin", {
      path: { id: "1" },
      body: { "notes = (SELECT string_agg(phone, ',') FROM users), full_name": "x", notes: "ok" },
    }))
    expect(tutorService.updateTutor).toHaveBeenCalledWith(1, { notes: "ok" })
  })

  it("400s with VALIDATION_FAILED on a bad value", async () => {
    const res = await updateTutor(staffEvent("admin", { path: { id: "1" }, body: { hourly_rate: -1 } }))
    expect(status(res)).toBe(400)
    expect(bodyOf(res).code).toBe("VALIDATION_FAILED")
    expect(tutorService.updateTutor).not.toHaveBeenCalled()
  })
})
