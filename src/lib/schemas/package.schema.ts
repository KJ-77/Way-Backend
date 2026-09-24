import { z } from "zod"

// How long a subscription to a package lasts, in DAYS, when the package doesn't say
// otherwise. Mirrors the column DEFAULT in migration 010: the DB default covers rows
// written outside the API (psql, scripts), this one keeps the API explicit — same
// split as DEFAULT_CHANNEL vs the channel column defaults in 007/008.
//
// Days rather than months (decided 2026-09-24): any length is expressible (a 10-day
// pass, a 1-week trial), and every client gets the same number of days no matter
// which month they buy in. "2 months" became 60, the membership's "1 month" 30.
export const DEFAULT_VALIDITY_DAYS = 60

// Matches the packages_validity_days_range CHECK constraint (migration 010), so a bad
// value is a clear 400 here instead of a constraint error from Postgres. 730 (two
// years) is a sanity ceiling against typos, not a business rule.
export const MAX_VALIDITY_DAYS = 730
const validityDays = z
  .number()
  .int("validity_days must be a whole number of days")
  .min(1, "validity_days must be at least 1")
  .max(MAX_VALIDITY_DAYS, `validity_days can't be more than ${MAX_VALIDITY_DAYS}`)

// Rules shared by create and update. Nullability mirrors what the admin form sends
// for blank inputs; the DB stays the authority on which columns may actually be NULL.
//
// Like tutor.schema.ts, this is also the column whitelist: updatePackage builds its
// SET clause from the object's keys, and z.object() strips any key not listed here.
const PackageFields = z.object({
  package_type: z.string().trim().min(1, "package_type is required").max(255),
  class_type_id: z.number().int().positive("class_type_id is required"),
  sessions_included: z.number().int().nonnegative().nullable().optional(),
  weight_included: z.number().nonnegative().nullable().optional(),
  price: z.number().nonnegative().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  validity_days: validityDays,
})

// Create — validity_days falls back to the default when omitted.
export const CreatePackageSchema = PackageFields.extend({
  validity_days: validityDays.default(DEFAULT_VALIDITY_DAYS),
})

// Update — built from PackageFields, NOT from CreatePackageSchema. Zod 4 applies a
// .default() even inside .partial() (checked against 4.3.6), so a partial of the
// create schema would quietly reset validity_days to 60 on every edit that didn't
// mention it. There's a test pinning this down.
export const UpdatePackageSchema = PackageFields.partial()
