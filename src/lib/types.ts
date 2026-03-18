// ── Enums ──

export type Gender = "Male" | "Female"
export type Level = "Beginner" | "Middle" | "Advanced"
export type Loyalty = "Low" | "Mid" | "High"
export type ReferralSource = "Referral" | "SCM" | "Walk-In"
export type UserStatus = "Active" | "Dormant"
export type Section = "Studio" | "PC"
export type PackageType = "basic" | "standard" | "premium"
export type PackageStatus = "active" | "expired" | "depleted"
export type ClassType = "pottery" | "glass" | "canvas" | "mixed-media"
export type Attendance = "present" | "absent" | "late" | "cancelled"

// ── Entities ──

export interface User {
  id: number
  full_name: string
  gender: Gender
  dob: string
  level: Level
  preferred_tutor: number
  loyalty: Loyalty
  phone: string
  email: string
  first_visit: string
  referral_source: ReferralSource
  status: UserStatus
  section: Section
  notes: string
  created_at: string
  updated_at: string
}

export interface Package {
  id: number
  purchase_date: string
  user_id: number
  package_type: PackageType
  sessions_included: number
  weight_included: number
  remaining_sessions: number
  remaining_weight: number
  expiry_date: string
  status: PackageStatus
  notes?: string
}

export interface Session {
  id: number
  date: string
  time: string
  user_id: number
  class_type: ClassType
  package_id: number
  session_nb: number
  deduct_group: number
  session_weight: number
  attendance: Attendance
  notes?: string
}

export interface Tutor {
  id: number
  full_name: string
  email: string
  phone: string
}

// ── DTOs (for create/update — omit id and auto-generated fields) ──

// User DTOs are derived from Zod schemas (see src/lib/schemas/user.schema.ts)
import type { z } from "zod"
import type { CreateUserSchema, UpdateUserSchema } from "./schemas/user.schema"
export type CreateUserDto = z.infer<typeof CreateUserSchema>
export type UpdateUserDto = z.infer<typeof UpdateUserSchema>

export type CreatePackageDto = Omit<Package, "id">
export type UpdatePackageDto = Partial<CreatePackageDto>

export type CreateSessionDto = Omit<Session, "id">
export type UpdateSessionDto = Partial<CreateSessionDto>

export type CreateTutorDto = Omit<Tutor, "id">
export type UpdateTutorDto = Partial<CreateTutorDto>
