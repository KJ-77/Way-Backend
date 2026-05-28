// ── Enums ──

export type Gender = "Male" | "Female"
export type Level = "Beginner" | "Middle" | "Advanced"
export type Loyalty = "Low" | "Mid" | "High"
export type ReferralSource = "Referral" | "SCM" | "Walk-In"
export type UserStatus = "Active" | "Dormant"
export type Section = "Studio" | "PC"
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
  status?: UserStatus
  section?: Section
  notes?: string
  // Soft-delete flag — false means the client has been "deleted" from the UI but their
  // history (sessions, items, subscriptions) is preserved. Their Cognito login is disabled.
  is_active: boolean
  created_at: string
  updated_at: string
}

// Product catalog — fixed package definitions offered by the studio
export interface Package {
  id: number
  package_type: string
  sessions_included: number
  weight_included: number
  price: number
}

// DB columns on the sessions table. user_id/package_id are NOT columns here —
// they're derived via the user_package_id FK to user_packages (see
// migration 001-sessions-user-package-fk.sql).
export interface Session {
  id: number
  user_package_id: number
  session_nb: number
  attendance: Attendance
  notes?: string
  created_at: string
}

// JOIN query result — includes user/package fields derived from the user_packages
// JOIN, plus user/package display names. This is the shape every read endpoint
// returns and the shape the frontend consumes.
export interface SessionJoined extends Session {
  user_id: string         // joined via user_packages.user_id
  package_id: number      // joined via user_packages.package_id
  user_name: string       // joined via users.full_name
  package_name: string    // joined via packages.package_type
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

export type CreatePackageDto = Omit<Package, "id">
export type UpdatePackageDto = Partial<CreatePackageDto>

export interface CreateSessionDto {
  // Caller picks the exact subscription this session is created against.
  // Frontend resolves this from the "client → subscriptions" picker flow.
  user_package_id: number
  attendance: Attendance
  notes?: string
}

// Updates can mutate attendance, notes, and session_nb (manual correction).
// user_package_id is immutable — moving a session between subscriptions would
// break audit + accounting (refund would target the wrong sub).
export interface UpdateSessionDto {
  attendance?: Attendance
  notes?: string | null
  session_nb?: number
}

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

// Shape returned by JOIN queries (includes user name + package details)
export interface UserPackageJoined extends UserPackageRow {
  user_name: string
  package_name: string
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
  package: string | null // class type enum — also serves as the slot's display name
  deleted_at: string | null // soft-delete marker; NULL = active
  created_at: string
  updated_at: string
}

// Joined with tutor name for API response
export interface ScheduleSlotJoined extends ScheduleSlot {
  tutor_name: string | null
}

// What the calendar API returns — slot + the override (if any) for the requested
// week, flattened. Frontend never needs to think about the join.
export interface ScheduleSlotForWeek extends ScheduleSlotJoined {
  week_start: string         // YYYY-MM-DD (Monday, Asia/Beirut)
  is_fully_booked: boolean   // effective value (override.is_fully_booked OR false)
  is_cancelled: boolean      // effective value (override.is_cancelled OR false)
  cancel_reason: string | null
  override_id: number | null // null when no override exists for this (slot, week)
}

export interface CreateScheduleSlotDto {
  day_of_week: number
  start_time: string
  end_time: string
  tutor_id?: number | null
  package?: string | null
}

export type UpdateScheduleSlotDto = Partial<CreateScheduleSlotDto>

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
  mid_weight: number | null
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
