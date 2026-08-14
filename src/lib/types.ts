// ── Enums ──

export type Gender = "Male" | "Female"
export type Level = "Beginner" | "Middle" | "Advanced"
export type Loyalty = "Low" | "Mid" | "High"
export type ReferralSource = "Referral" | "SCM" | "Walk-In"
export type PackageStatus = "active" | "expired" | "depleted"
export type Attendance = "attended" | "booked" | "cancelled" | "cancelled - no charge"

// ── Entities ──

export interface User {
  id: string // cognito_sub
  full_name: string
  phone: string
  referral_source: ReferralSource
  gender?: Gender
  dob?: string
  level?: Level
  preferred_tutor?: number
  loyalty?: Loyalty
  email?: string
  first_visit?: string
  notes?: string
  // Soft-delete flag — false means the client has been "deleted" from the UI but their
  // history (sessions, items, subscriptions) is preserved. Their Cognito login is disabled.
  is_active: boolean
  // Excludes the client from marketing broadcasts (compliance requirement for
  // WhatsApp). Utility messages — "your piece is ready" — still send.
  marketing_opt_out: boolean
  marketing_opt_out_at?: string | null
  created_at: string
  updated_at: string
}

// Abstract class concept. Both packages and schedule slots FK into this — a
// class ("Hand Building") can have many packages (4-session, 8-session tiers)
// and many scheduled occurrences. Enables the booking eligibility rule:
// user can book slot S iff they have an active sub whose package.class_type_id
// matches S.class_type_id.
export interface ClassType {
  id: number
  name: string
  description: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

// Product catalog — fixed package definitions offered by the studio.
// package_type is the SKU-like display label ("Hand Building - 4 Sessions");
// class_type_id is the FK identifying which class this package unlocks. Two
// packages with the same class_type_id are alternative purchase options for
// the same underlying class.
export interface Package {
  id: number
  package_type: string
  class_type_id: number
  sessions_included: number
  weight_included: number
  price: number
}

// Package + joined class_type name — the shape read endpoints return.
export interface PackageJoined extends Package {
  class_type_name: string
}

// DB columns on the sessions table. user_id/package_id are NOT columns here —
// they're derived via the user_package_id FK to user_packages (see
// migration 001-sessions-user-package-fk.sql).
//
// schedule_slot_id + class_date together identify the specific class occurrence
// this session is for (e.g. "Wheel Throwing Explorer on 2026-06-15"). Both are
// NULL on legacy rows that pre-date migration 003 — the CHECK constraint
// enforces both-or-neither so we never have half-linked rows going forward.
export interface Session {
  id: number
  user_package_id: number
  schedule_slot_id: number | null
  class_date: string | null  // "YYYY-MM-DD" (no time component)
  session_nb: number
  attendance: Attendance
  notes?: string
  created_at: string
}

// JOIN query result — includes user/package fields derived from the user_packages
// JOIN, plus the schedule slot's display fields. This is the shape every read
// endpoint returns and the shape the frontend consumes.
export interface SessionJoined extends Session {
  user_id: string                    // joined via user_packages.user_id
  package_id: number                 // joined via user_packages.package_id
  user_name: string                  // joined via users.full_name
  package_name: string               // joined via packages.package_type
  class_name: string | null          // joined via schedule → class_types.name; null for legacy rows
  class_start_time: string | null    // schedule.start_time "HH:MM:SS"
  class_end_time: string | null      // schedule.end_time "HH:MM:SS"
}

export interface Tutor {
  id: number
  full_name: string
  email: string
  phone: string
  hourly_rate: number | null  // decimal(10,2)
  specialty: string | null
  notes: string | null
}

// ── DTOs (for create/update — omit id and auto-generated fields) ──

// User DTOs are derived from Zod schemas (see src/lib/schemas/user.schema.ts)
import type { z } from "zod"
import type { CreateUserSchema, UpdateUserSchema } from "./schemas/user.schema"
export type CreateUserDto = z.infer<typeof CreateUserSchema>
export type UpdateUserDto = z.infer<typeof UpdateUserSchema>

// class_type_id required on create (packages must belong to a class).
export type CreatePackageDto = Omit<Package, "id">
export type UpdatePackageDto = Partial<CreatePackageDto>

// CreateSessionDto is derived from the Zod schema; see schemas/session.schema.ts.
import type { CreateSessionSchema, UpdateSessionSchema } from "./schemas/session.schema"
export type CreateSessionDto = z.infer<typeof CreateSessionSchema>
export type UpdateSessionDto = z.infer<typeof UpdateSessionSchema>

// ── User Packages (Subscriptions) ──

// Raw DB row — no status column (computed at API response time)
export interface UserPackageRow {
  id: number
  user_id: string
  package_id: number
  purchase_date: string
  remaining_sessions: number
  remaining_weight: number
  expiry_date: string
  notes: string | null
}

// Shape returned by JOIN queries (includes user name + package details).
// class_type_id / class_type_name are surfaced for the client booking flow's
// eligibility check ("does this sub cover this slot's class?").
export interface UserPackageJoined extends UserPackageRow {
  user_name: string
  package_name: string
  class_type_id: number
  class_type_name: string
  sessions_included: number
  weight_included: number
  price: number
}

// Final API response — joined data + computed status
export interface UserPackageResponse extends UserPackageJoined {
  status: PackageStatus
}

export interface CreateUserPackageDto {
  user_id: string
  package_id: number
  notes?: string
}

export interface UpdateUserPackageDto {
  remaining_sessions?: number
  remaining_weight?: number
  expiry_date?: string
  notes?: string | null
}

export type CreateTutorDto = Omit<Tutor, "id">
export type UpdateTutorDto = Partial<CreateTutorDto>

// ── Schedule ──

// Recurring weekly template — one row per slot. Per-week state (cancellation,
// fully-booked) lives on schedule_overrides, not here.
export interface ScheduleSlot {
  id: number
  day_of_week: number // 0=Monday, 6=Sunday
  start_time: string // "HH:MM:SS"
  end_time: string
  tutor_id: number | null
  class_type_id: number // FK → class_types.id; the class this slot is an instance of
  capacity: number | null // max headcount admin set for this slot (informational, not enforced)
  deleted_at: string | null // soft-delete marker; NULL = active
  created_at: string
  updated_at: string
}

// Joined with tutor name + class_type name for API response
export interface ScheduleSlotJoined extends ScheduleSlot {
  tutor_name: string | null
  class_type_name: string
}

// What the calendar API returns — slot + the override (if any) for the requested
// week, flattened. Frontend never needs to think about the join.
export interface ScheduleSlotForWeek extends ScheduleSlotJoined {
  week_start: string         // YYYY-MM-DD (Monday, Asia/Beirut)
  is_fully_booked: boolean   // effective value (override.is_fully_booked OR false)
  is_cancelled: boolean      // effective value (override.is_cancelled OR false)
  cancel_reason: string | null
  override_id: number | null // null when no override exists for this (slot, week)
  attending_count: number    // sessions for the (slot, week) date with attendance booked|attended
}

// Returned by GET /schedule/:id/sessions?date=…
// Single round-trip for the class-detail page: slot+override merged for the
// specific date, plus the joined session list for it.
export interface ClassDetailResponse {
  slot: ScheduleSlotForWeek
  class_date: string         // YYYY-MM-DD
  sessions: SessionJoined[]
}

export interface CreateScheduleSlotDto {
  day_of_week: number
  start_time: string
  end_time: string
  tutor_id?: number | null
  class_type_id: number
  capacity?: number | null
}

export type UpdateScheduleSlotDto = Partial<CreateScheduleSlotDto>

// ── Class Types ──

export type CreateClassTypeDto = {
  name: string
  description?: string | null
  is_active?: boolean
}

export type UpdateClassTypeDto = Partial<CreateClassTypeDto>

// ── Schedule Overrides (per-week exceptions to the template) ──

export interface ScheduleOverride {
  id: number
  slot_id: number
  week_start: string         // YYYY-MM-DD (Monday, Asia/Beirut)
  is_fully_booked: boolean
  is_cancelled: boolean
  cancel_reason: string | null
  created_by: string | null  // accounts.id; NULL after the account is deleted
  created_at: string
  updated_at: string
}

// Body for PUT /schedule/:slotId/override — all override fields are individually
// optional so admin can update just a reason without touching the flags. Service
// merges with the existing row (if any) and validates the meaningful-row rule.
export interface UpsertScheduleOverrideDto {
  week_start: string
  is_fully_booked?: boolean
  is_cancelled?: boolean
  cancel_reason?: string | null
}

// ── Items (Client Artwork) ──

export type ItemStage = "drying" | "bisque fired" | "waiting glaze" | "glaze fired" | "ready" | "picked up" | "discarded"

export type ItemSection = "Studio" | "PC"

export interface Item {
  id: number
  user_id: string
  user_package_id: number | null
  stage: ItemStage
  section: ItemSection
  description?: string | null
  clay_type?: string | null
  glaze_type?: string | null
  final_weight: number | null
  created_at: string
  updated_at: string
}

// Joined with user name for API response
export interface ItemJoined extends Item {
  user_name: string
}

import type { CreateItemSchema, UpdateItemSchema } from "./schemas/item.schema"
export type CreateItemDto = z.infer<typeof CreateItemSchema>
export type UpdateItemDto = z.infer<typeof UpdateItemSchema>

// ── Accounts ──

export type AccountRole = "admin" | "studio-manager"

export interface Account {
  id: string // cognito_sub
  email: string
  full_name: string
  phone: string | null
  role: AccountRole
  created_at: string
  updated_at: string
}

import type { CreateAccountSchema, UpdateAccountSchema } from "./schemas/account.schema"
export type CreateAccountDto = z.infer<typeof CreateAccountSchema>
export type UpdateAccountDto = z.infer<typeof UpdateAccountSchema>

// ── Communications (see migration 004-communications.sql) ──
//
// Outbound messages are DRAFTED into a queue (status 'pending_approval') and
// only sent once a staff member approves — nothing ever sends automatically.
// Inbound client replies land in the same `messages` table so the inbox is a
// single ordered read per conversation.

export type MessageDirection = "outbound" | "inbound"
export type MessageChannel = "whatsapp" | "sms"
export type MessageStatus =
  | "pending_approval"
  | "queued"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "cancelled"
export type MessageKind = "template" | "freeform"
export type MessageTrigger = "client_created" | "item_stage" | "broadcast" | "manual" | "inbound"
export type TemplateCategory = "marketing" | "utility" | "authentication"
export type TemplateStatus = "draft" | "pending" | "approved" | "rejected" | "disabled"
export type BroadcastStatus = "draft" | "pending_approval" | "sending" | "sent" | "cancelled"

// Local mirror of a provider-registered template. Meta is the source of truth
// for `status` / `provider_template_id`; everything else is ours.
export interface MessageTemplate {
  id: number
  name: string
  language: string
  category: TemplateCategory
  // Body using Meta's positional placeholders: {{1}}, {{2}}, …
  body: string
  // Human labels for each placeholder, in order — e.g. ["client name", "stage"]
  variable_labels: string[]
  status: TemplateStatus
  provider_template_id: string | null
  // Compound trigger key: "client_created", "item_stage:ready", … NULL when the
  // template is only used manually or for broadcasts. At most one ACTIVE
  // template may claim a given trigger (partial unique index).
  trigger_event: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

// One thread per (client, channel). Intentionally thin — activity/unread state
// is derived from `messages`, never cached here.
export interface Conversation {
  id: number
  user_id: string
  channel: MessageChannel
  // E.164 snapshot of where messages were actually addressed (audit fact).
  phone: string
  created_at: string
  updated_at: string
}

// Conversation + the fields the inbox list derives on read.
export interface ConversationJoined extends Conversation {
  user_name: string
  last_message_at: string | null
  last_message_preview: string | null
  // MAX(created_at) of inbound messages — the 24-hour free-form window opens
  // from here. NULL means the client has never messaged us, so only templates
  // are legal.
  last_inbound_at: string | null
  unread_count: number
}

export interface Message {
  id: number
  conversation_id: number
  direction: MessageDirection
  channel: MessageChannel
  status: MessageStatus
  kind: MessageKind
  template_id: number | null
  // The {{n}} values used for this specific message, e.g. { "1": "Sara" }
  template_variables: Record<string, string> | null
  // Fully-rendered text, snapshotted at enqueue time so template edits never
  // rewrite history.
  body: string
  trigger: MessageTrigger
  trigger_ref: string | null
  broadcast_id: number | null
  provider_message_id: string | null
  error_code: string | null
  error_message: string | null
  // Send-attempt bookkeeping. status='queued' + last_attempt_at set +
  // provider_message_id NULL means UNCONFIRMED: handed to the provider but the
  // result was never recorded. Surfaced to a human; never auto-retried.
  attempt_count: number
  last_attempt_at: string | null
  created_by: string | null
  approved_by: string | null
  approved_at: string | null
  sent_at: string | null
  read_at: string | null
  created_at: string
  updated_at: string
}

// Shape the queue + inbox endpoints return.
export interface MessageJoined extends Message {
  user_id: string
  user_name: string
  phone: string
  template_name: string | null
}

export interface Broadcast {
  id: number
  name: string
  template_id: number
  template_variables: Record<string, string>
  channel: MessageChannel
  // Snapshot of the audience filter used, e.g. { level: "Beginner" }
  audience: Record<string, unknown>
  status: BroadcastStatus
  created_by: string | null
  created_at: string
  updated_at: string
  sent_at: string | null
}

// Broadcast + derived per-status counts of its fanned-out messages.
export interface BroadcastJoined extends Broadcast {
  template_name: string
  total_count: number
  sent_count: number
  failed_count: number
  pending_count: number
}

// ── Communications DTOs ──

// Staff-composed message. `template_id` + `variables` for a business-initiated
// send; `body` alone for a free-form reply (only legal inside an open 24h
// window — the service enforces this, not the type).
export interface CreateMessageDto {
  user_id: string
  channel?: MessageChannel
  template_id?: number
  variables?: Record<string, string>
  body?: string
}

export interface CreateBroadcastDto {
  name: string
  template_id: number
  variables?: Record<string, string>
  channel?: MessageChannel
  audience?: Record<string, unknown>
}
