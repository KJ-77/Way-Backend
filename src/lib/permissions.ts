// ── Roles & permissions (RBAC) ──
//
// The single source of truth for "which staff role can do what". Handlers never
// name a role: they ask for a PERMISSION — `requirePermission(auth, "clients:delete")`
// (lib/auth.ts) — and the lists below decide which roles hold it. Adding a role, or
// moving an action from one role to another, is an edit to this file instead of a
// hunt through ~60 role checks spread over a dozen handlers. Same model GitHub and
// Stripe use for their dashboards: roles are just named bundles of permissions.
//
// ⚠️ Mirrored in Way-Admin/src/lib/permissions.ts, which decides what the UI SHOWS.
// This file decides what's ENFORCED. Keep the two identical — Way-Admin's
// permissions-parity test fails the suite when they drift.
//
// Deliberately import-free (pure data + pure functions) so that parity test can
// load this file directly from the admin repo.
//
// Not covered here, on purpose:
//   • Client tokens (Way-Client users). They carry no staff group, so every check
//     below refuses them; the few routes clients may use (booking, reading their own
//     sessions/items/subscriptions) branch on `auth.source_pool` in the handler.
//   • Read endpoints that every signed-in user needs (packages, schedule, class and
//     clay types) — those use requireAuth. And GET /sessions, /items, /user-packages
//     give ANY staff role the full list (the pool check, not a permission, scopes
//     clients to their own rows) — a conscious choice: all staff may view everything.

export const ROLES = ["admin", "studio-manager", "agent"] as const
export type Role = (typeof ROLES)[number]

export const PERMISSIONS = [
  // Clients
  "clients:read",
  "clients:create",
  "clients:update", // edit details, reset their password, marketing opt-out
  "clients:delete", // soft delete — disables their login
  "clients:restore", // undo a delete

  // Sessions (bookings)
  "sessions:read", // the class-detail attendee list (GET /schedule/{id}/sessions)
  "sessions:create",
  "sessions:update", // incl. attendance changes (which can credit/debit a session)
  "sessions:delete",

  // Subscriptions (a client's purchased packages)
  "subscriptions:create",
  "subscriptions:update",
  "subscriptions:delete",

  // Packages (the catalog — the studio's product list)
  "packages:create",
  "packages:update",
  "packages:delete",

  // Tutors
  "tutors:read",
  "tutors:create",
  "tutors:update",
  "tutors:delete",

  // Weekly schedule
  "schedule:create", // add a class to the weekly template
  "schedule:update", // edit a class, cancel/un-cancel a week, mark/clear fully booked
  "schedule:delete", // retire a class (refunds its future bookings)

  // Items (pieces). Creation is split by section; everything after is shared.
  "studio-items:create",
  "pc-items:create",
  "items:update", // edit, and move FORWARD through stages — incl. marking discarded
  "items:rewind", // move BACKWARD — incl. un-discard; re-deducts/refunds clay weight
  "items:delete",

  // The "System" pages
  "class-types:manage",
  "clay-types:manage",
  "accounts:manage",

  // Communications
  "messages:read", // queue, "Did these go out?", history, templates, broadcast list
  "messages:create", // draft a message
  "messages:send", // Open in WhatsApp / approve, confirm sent, re-queue, mark read
  "messages:discard", // throw away a draft or a failed send
  "templates:update", // reword an automatic message — affects every future one
  "broadcasts:manage", // create + send a campaign
] as const
export type Permission = (typeof PERMISSIONS)[number]

// Allow-lists: a role holds exactly what's listed, so a permission added later is
// admin-only until someone decides otherwise (deny by default).
const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // Everything, including permissions added later.
  admin: PERMISSIONS,

  // Everything EXCEPT (decided with Khalil, 2026-09-28): any real delete, any
  // change to packages, item rewinds, template edits, broadcasts, and the System
  // pages. Discarding a message or a piece, clearing a class override and restoring
  // a deleted client are NOT deletes, and stay allowed.
  "studio-manager": [
    "clients:read",
    "clients:create",
    "clients:update",
    "clients:restore",
    "sessions:read",
    "sessions:create",
    "sessions:update",
    "subscriptions:create",
    "subscriptions:update",
    "tutors:read",
    "tutors:create",
    "tutors:update",
    "schedule:create",
    "schedule:update",
    "studio-items:create",
    "pc-items:create",
    "items:update",
    "messages:read",
    "messages:create",
    "messages:send",
    "messages:discard",
  ],

  // Views everything outside the System pages; may only ADD clients and PC items.
  // Can read message history but never sends, drafts or discards.
  agent: [
    "clients:read",
    "clients:create",
    "sessions:read",
    "tutors:read",
    "pc-items:create",
    "messages:read",
  ],
}

/** The roles that hold a permission — what requirePermission hands to requireRole. */
export const rolesWith = (permission: Permission): Role[] =>
  ROLES.filter(role => ROLE_PERMISSIONS[role].includes(permission))

/** The permissions a role holds. */
export const permissionsOf = (role: Role): readonly Permission[] => ROLE_PERMISSIONS[role]

const isRole = (group: string): group is Role => (ROLES as readonly string[]).includes(group)

/**
 * True when any of the caller's Cognito groups grants the permission. Unknown
 * groups are ignored rather than trusted — a typo'd or future group grants nothing.
 */
export const can = (groups: readonly string[], permission: Permission): boolean =>
  groups.some(group => isRole(group) && ROLE_PERMISSIONS[group].includes(permission))
