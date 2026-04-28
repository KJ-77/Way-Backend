// ── Enums ──

export type Gender = "Male" | "Female"
export type Level = "Beginner" | "Middle" | "Advanced"
export type Loyalty = "Low" | "Mid" | "High"
export type ReferralSource = "Referral" | "SCM" | "Walk-In"
export type UserStatus = "Active" | "Dormant"
export type Section = "Studio" | "PC"
export type PackageStatus = "active" | "expired" | "depleted"
export type Attendance = "attended" | "booked" | "cancelled"

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

export interface Session {
  id: number
  user_id: string
  package_id: number
  session_nb: number
  session_weight: number // decimal(10,2) in DB
  attendance: Attendance
  notes?: string
  created_at: string
}

// JOIN query result — includes user name + package name
export interface SessionJoined extends Session {
  user_name: string
  package_name: string
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
  user_id: string
  package_id: number
  session_weight: number
  attendance: Attendance
  notes?: string
}

export type UpdateSessionDto = Partial<CreateSessionDto>

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

export interface ScheduleSlot {
  id: number
  day_of_week: number // 0=Monday, 6=Sunday
  start_time: string // "HH:MM:SS"
  end_time: string
  title: string
  tutor_id: number | null
  package: string | null // class type enum
  created_at: string
  updated_at: string
}

// Joined with tutor name for API response
export interface ScheduleSlotJoined extends ScheduleSlot {
  tutor_name: string | null
}

export interface CreateScheduleSlotDto {
  day_of_week: number
  start_time: string
  end_time: string
  title: string
  tutor_id?: number | null
  package?: string | null
}

export type UpdateScheduleSlotDto = Partial<CreateScheduleSlotDto>

// ── Items (Client Artwork) ──

export type ItemStage = "drying" | "bisque fired" | "waiting glaze" | "glaze fired" | "ready" | "discarded"

export type ItemSection = "Studio" | "PC"

export interface Item {
  id: number
  user_id: string
  stage: ItemStage
  section: ItemSection
  description?: string | null
  clay_type?: string | null
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
