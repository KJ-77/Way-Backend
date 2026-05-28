import { executeQuery, pool } from "../lib/db"
import type {
  ScheduleSlotJoined,
  ScheduleSlotForWeek,
  ScheduleOverride,
  CreateScheduleSlotDto,
  UpdateScheduleSlotDto,
  UpsertScheduleOverrideDto,
} from "../lib/types"

// ── Base SELECTs ───────────────────────────────────────────────────────────
// All schedule reads filter out soft-deleted slots by default. Use the
// `*IncludingDeleted` variants for audit/admin lookups when you need to see
// a slot that's been retired.
const BASE_SELECT = `
  SELECT s.*, t.full_name AS tutor_name
  FROM schedule s
  LEFT JOIN tutors t ON s.tutor_id = t.id
`

// ── Template-level reads ───────────────────────────────────────────────────

export const getAllSlots = async (): Promise<ScheduleSlotJoined[]> =>
  executeQuery<ScheduleSlotJoined>(
    `${BASE_SELECT} WHERE s.deleted_at IS NULL ORDER BY s.day_of_week, s.start_time`
  )

// Single-slot lookup. Does NOT filter soft-deleted slots — admin tooling might
// need to inspect a retired slot for audit, and the override APIs need to be
// able to fetch the parent slot to verify the FK before upserting.
export const getSlotById = async (id: number): Promise<ScheduleSlotJoined | null> => {
  const rows = await executeQuery<ScheduleSlotJoined>(`${BASE_SELECT} WHERE s.id = $1`, [id])
  return rows[0] ?? null
}

// ── Weekly view: slots joined with their (optional) override for `weekStart` ──

/**
 * Returns active slots with the per-week override merged in. LEFT JOIN means
 * slots without an override row still appear, with effective flags defaulting
 * to false and `override_id = null`.
 *
 * weekStart is parameterised — Postgres will use the schedule_active_idx
 * partial index for the `deleted_at IS NULL` filter and the
 * schedule_overrides_unique index (leading column = week_start) for the LEFT
 * JOIN lookup. End-to-end this is an index-only-friendly query.
 */
export const getSlotsForWeek = async (weekStart: string): Promise<ScheduleSlotForWeek[]> =>
  executeQuery<ScheduleSlotForWeek>(
    `
    SELECT
      s.id, s.day_of_week, s.start_time, s.end_time,
      s.tutor_id, s.package, s.deleted_at, s.created_at, s.updated_at,
      t.full_name AS tutor_name,
      $1::date AS week_start,
      COALESCE(o.is_fully_booked, false) AS is_fully_booked,
      COALESCE(o.is_cancelled, false)    AS is_cancelled,
      o.cancel_reason,
      o.id AS override_id
    FROM schedule s
    LEFT JOIN tutors t ON s.tutor_id = t.id
    LEFT JOIN schedule_overrides o
      ON o.slot_id = s.id AND o.week_start = $1::date
    WHERE s.deleted_at IS NULL
    ORDER BY s.day_of_week, s.start_time
    `,
    [weekStart]
  )

// ── Template-level writes ──────────────────────────────────────────────────

export const createSlot = async (data: CreateScheduleSlotDto): Promise<ScheduleSlotJoined> => {
  const rows = await executeQuery<{ id: number }>(
    `INSERT INTO schedule (day_of_week, start_time, end_time, tutor_id, package)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [data.day_of_week, data.start_time, data.end_time, data.tutor_id ?? null, data.package ?? null]
  )
  return (await getSlotById(rows[0].id))!
}

export const updateSlot = async (
  id: number,
  data: UpdateScheduleSlotDto
): Promise<ScheduleSlotJoined | null> => {
  const fields = Object.keys(data)
  if (fields.length === 0) return getSlotById(id)

  const setClauses = fields.map((key, i) => `${key} = $${i + 2}`)
  setClauses.push("updated_at = NOW()")
  const values = fields.map((key) => data[key as keyof UpdateScheduleSlotDto] ?? null)

  const rows = await executeQuery(
    `UPDATE schedule SET ${setClauses.join(", ")}
     WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id, ...values]
  )
  if (rows.length === 0) return null
  return getSlotById(id)
}

/**
 * Soft-delete: flips `deleted_at` to NOW(). Preserves the row and all linked
 * override history. Idempotent — re-deleting a deleted slot is a no-op.
 * Returns true if a row was newly marked deleted, false if it was already
 * deleted or doesn't exist.
 */
export const softDeleteSlot = async (id: number): Promise<boolean> => {
  const rows = await executeQuery(
    `UPDATE schedule SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id]
  )
  return rows.length > 0
}

// ── Override-level reads/writes ────────────────────────────────────────────

export const getOverride = async (
  slotId: number,
  weekStart: string
): Promise<ScheduleOverride | null> => {
  const rows = await executeQuery<ScheduleOverride>(
    `SELECT * FROM schedule_overrides WHERE slot_id = $1 AND week_start = $2`,
    [slotId, weekStart]
  )
  return rows[0] ?? null
}

/**
 * Merge-then-upsert an override row. Logic:
 *  1. Read the existing row (if any) for (slot_id, week_start).
 *  2. Apply the incoming partial on top.
 *  3. If the merged result has BOTH flags false → DELETE the row (clearing
 *     the override entirely, since an all-false row would violate the
 *     meaningful CHECK constraint anyway).
 *  4. Otherwise INSERT/UPDATE.
 *
 * Wrapped in a transaction so concurrent admin clicks can't race into an
 * inconsistent state (two upserts on the same key with one DELETE in the
 * middle would otherwise be possible).
 */
export const upsertOverride = async (
  slotId: number,
  data: UpsertScheduleOverrideDto,
  createdBy: string | null
): Promise<ScheduleOverride | null> => {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    // Lock the (slot, week) row if it exists so concurrent writers serialise.
    const existing = await client.query<ScheduleOverride>(
      `SELECT * FROM schedule_overrides
       WHERE slot_id = $1 AND week_start = $2 FOR UPDATE`,
      [slotId, data.week_start]
    )
    const prev = existing.rows[0] ?? null

    // Apply the incoming partial to whatever the row currently is.
    const merged = {
      is_fully_booked: data.is_fully_booked ?? prev?.is_fully_booked ?? false,
      is_cancelled:    data.is_cancelled    ?? prev?.is_cancelled    ?? false,
      // cancel_reason is explicitly nullable — if caller passes null, clear it.
      cancel_reason:   data.cancel_reason === undefined
        ? (prev?.cancel_reason ?? null)
        : data.cancel_reason,
    }

    // If the merged result is meaningless, delete the override entirely.
    if (!merged.is_fully_booked && !merged.is_cancelled) {
      if (prev) {
        await client.query(
          `DELETE FROM schedule_overrides WHERE slot_id = $1 AND week_start = $2`,
          [slotId, data.week_start]
        )
      }
      await client.query("COMMIT")
      return null
    }

    // INSERT or UPDATE the row. ON CONFLICT keys on the unique (week_start, slot_id).
    const upserted = await client.query<ScheduleOverride>(
      `INSERT INTO schedule_overrides
         (slot_id, week_start, is_fully_booked, is_cancelled, cancel_reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (week_start, slot_id) DO UPDATE SET
         is_fully_booked = EXCLUDED.is_fully_booked,
         is_cancelled    = EXCLUDED.is_cancelled,
         cancel_reason   = EXCLUDED.cancel_reason
       RETURNING *`,
      [
        slotId,
        data.week_start,
        merged.is_fully_booked,
        merged.is_cancelled,
        merged.cancel_reason,
        createdBy,
      ]
    )

    await client.query("COMMIT")
    return upserted.rows[0]
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}

export const deleteOverride = async (slotId: number, weekStart: string): Promise<boolean> => {
  const rows = await executeQuery(
    `DELETE FROM schedule_overrides
     WHERE slot_id = $1 AND week_start = $2 RETURNING id`,
    [slotId, weekStart]
  )
  return rows.length > 0
}
