// ============================================================================
// permissions.test.ts — the studio's access rules, written down as tests.
//
// lib/permissions.ts is the ONE place that decides which staff role may do what.
// These tests restate the business rules in plain terms (decided with Khalil,
// 2026-09-28), so an edit to the map that breaks a rule fails with a sentence
// saying which rule — not just "a list changed".
// ============================================================================

import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { PERMISSIONS, ROLES, can, permissionsOf, rolesWith, type Permission } from "../permissions"

const has = (role: string, permission: Permission) => can([role], permission)

describe("admin", () => {
  it("holds every permission — including any added later", () => {
    for (const permission of PERMISSIONS) expect(has("admin", permission)).toBe(true)
  })
})

describe("studio manager — everything except deletes, packages and System", () => {
  it("can never delete anything", () => {
    const deletes = PERMISSIONS.filter(p => p.endsWith(":delete"))
    expect(deletes.length).toBeGreaterThan(5) // guards against the filter matching nothing
    for (const permission of deletes) expect(has("studio-manager", permission)).toBe(false)
  })

  it("can only view packages — no add, edit or delete", () => {
    for (const permission of PERMISSIONS.filter(p => p.startsWith("packages:"))) {
      expect(has("studio-manager", permission)).toBe(false)
    }
  })

  it("can't reach the System pages", () => {
    for (const permission of ["class-types:manage", "clay-types:manage", "accounts:manage"] as const) {
      expect(has("studio-manager", permission)).toBe(false)
    }
  })

  it("keeps the two actions that were admin-only by design", () => {
    expect(has("studio-manager", "items:rewind")).toBe(false)
    expect(has("studio-manager", "templates:update")).toBe(false)
    expect(has("studio-manager", "broadcasts:manage")).toBe(false)
  })

  it("keeps the removal-LIKE actions Khalil ruled aren't deletes", () => {
    expect(has("studio-manager", "messages:discard")).toBe(true) // discard a draft
    expect(has("studio-manager", "items:update")).toBe(true) // incl. marking a piece discarded
    expect(has("studio-manager", "schedule:update")).toBe(true) // incl. clearing an override
    expect(has("studio-manager", "clients:restore")).toBe(true)
  })

  it("still runs the studio day to day", () => {
    for (const permission of [
      "clients:create", "clients:update", "sessions:create", "sessions:update",
      "subscriptions:create", "subscriptions:update", "studio-items:create",
      "pc-items:create", "schedule:create", "tutors:create", "messages:send",
    ] as const) {
      expect(has("studio-manager", permission)).toBe(true)
    }
  })
})

describe("agent — views everything outside System, adds clients and PC items only", () => {
  it("holds exactly these permissions and nothing else", () => {
    expect([...permissionsOf("agent")].sort()).toEqual(
      ["clients:create", "clients:read", "messages:read", "pc-items:create", "sessions:read", "tutors:read"],
    )
  })

  it("can add a PC piece but not a Studio piece", () => {
    expect(has("agent", "pc-items:create")).toBe(true)
    expect(has("agent", "studio-items:create")).toBe(false)
  })

  it("can read message history but never send, draft or discard", () => {
    expect(has("agent", "messages:read")).toBe(true)
    for (const permission of ["messages:send", "messages:create", "messages:discard"] as const) {
      expect(has("agent", permission)).toBe(false)
    }
  })
})

describe("can() / rolesWith()", () => {
  it("grants nothing to a client token or an unknown group", () => {
    expect(can([], "clients:read")).toBe(false)
    expect(can(["client"], "clients:read")).toBe(false)
    expect(can(["Admin"], "clients:read")).toBe(false) // group names are case-sensitive
  })

  it("unions permissions when someone is in several groups", () => {
    expect(can(["agent", "studio-manager"], "sessions:create")).toBe(true)
  })

  it("lists the roles holding a permission, which is what requireRole receives", () => {
    expect(rolesWith("pc-items:create")).toEqual(["admin", "studio-manager", "agent"])
    expect(rolesWith("clients:delete")).toEqual(["admin"])
  })

  it("never grants a role an undeclared permission", () => {
    for (const role of ROLES) {
      for (const permission of permissionsOf(role)) expect(PERMISSIONS).toContain(permission)
    }
  })
})

describe("handlers ask for permissions, never for roles", () => {
  // If a handler names roles again, the map stops being the single source of truth
  // and the next role change silently misses that route.
  const functionsDir = path.resolve(__dirname, "../../functions")
  const handlerFiles = fs
    .readdirSync(functionsDir, { recursive: true, encoding: "utf8" })
    .filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.includes("__tests__"))

  it("found the handler files", () => {
    expect(handlerFiles.length).toBeGreaterThan(10)
  })

  it.each(handlerFiles)("%s has no requireRole call", file => {
    const source = fs.readFileSync(path.join(functionsDir, file), "utf8")
    expect(source).not.toMatch(/requireRole\(/)
  })
})
