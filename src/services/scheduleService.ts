import { executeQuery, pool } from "../lib/db"
import { getBeirutToday, classDateForWeek } from "../lib/time"
import * as sessionService from "./sessionService"
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
// class_types is INNER JOIN because schedule.class_type_id is NOT NULL — every
// slot belongs to a class. Adds class_type_name so the frontend can render the
// class label without a second lookup.
const BASE_SELECT = `
  SELECT s.*, t.full_name AS tutor_name, ct.name AS class_type_name
  FROM schedule s
  LEFT JOIN tutors t ON s.tutor_id = t.id
  JOIN class_types ct ON s.class_type_id = ct.id
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
 * Also computes attending_count per slot for this week: a correlated subquery
 * over sessions matching (schedule_slot_id, class_date) where class_date is
 * the calendar date that the recurring slot lands on this week, filtered to
 * counted attendance (booked|attended).
 *
 * weekStart is parameterised — Postgres will use the schedule_active_idx
 * partial index for the `deleted_at IS NULL` filter, the
 * schedule_overrides_unique index for the override LEFT JOIN, and the
 * sessions_class_occurrence_idx (schedule_slot_id, class_date) for the
 * attending-count subquery.
 */
export const getSlotsForWeek = async (weekStart: string): Promise<ScheduleSlotForWeek[]> =>
  executeQuery<ScheduleSlotForWeek>(
    `
    SELECT
      s.id, s.day_of_week, s.start_time, s.end_time, s.capacity,
      s.tutor_id, s.class_type_id, s.deleted_at, s.created_at, s.updated_at,
      t.full_name AS tutor_name,
      ct.name AS class_type_name,
      $1::date AS week_start,
      COALESCE(o.is_fully_booked, false) AS is_fully_booked,
      COALESCE(o.is_cancelled, false)    AS is_cancelled,
      o.cancel_reason,
      o.id AS override_id,
      (
        SELECT COUNT(*)::int
        FROM sessions sess
        WHERE sess.schedule_slot_id = s.id
          AND sess.class_date = ($1::date + s.day_of_week)
          AND sess.attendance IN ('booked', 'attended')
      ) AS attending_count
    FROM schedule s
    LEFT JOIN tutors t ON s.tutor_id = t.id
    JOIN class_types ct ON s.class_type_id = ct.id
    LEFT JOIN schedule_overrides o
      ON o.slot_id = s.id AND o.week_start = $1::date
    WHERE s.deleted_at IS NULL
    ORDER BY s.day_of_week, s.start_time
    `,
    [weekStart]
  )

/**
 * Returns a single slot + its override merged + attending_count for a specific
 * class_date. Powers the class-detail page (GET /schedule/:id/sessions?date=).
 *
 * The handler computes weekStart from classDate (Asia/Beirut Monday) and
 * passes both in here so the override JOIN keys on the correct week.
 */
export const getSlotForDate = async (
  slotId: number,
  classDate: string,
  weekStart: string,
): Promise<ScheduleSlotForWeek | null> => {
  const rows = await executeQuery<ScheduleSlotForWeek>(
    `
    SELECT
      s.id, s.day_of_week, s.start_time, s.end_time, s.capacity,
      s.tutor_id, s.class_type_id, s.deleted_at, s.created_at, s.updated_at,
      t.full_name AS tutor_name,
      ct.name AS class_type_name,
      $1::date AS week_start,
      COALESCE(o.is_fully_booked, false) AS is_fully_booked,
      COALESCE(o.is_cancelled, false)    AS is_cancelled,
      o.cancel_reason,
      o.id AS override_id,
      (
        SELECT COUNT(*)::int
        FROM sessions sess
        WHERE sess.schedule_slot_id = s.id
          AND sess.class_date = $3::date
          AND sess.attendance IN ('booked', 'attended')
      ) AS attending_count
    FROM schedule s
    LEFT JOIN tutors t ON s.tutor_id = t.id
    JOIN class_types ct ON s.class_type_id = ct.id
    LEFT JOIN schedule_overrides o
      ON o.slot_id = s.id AND o.week_start = $1::date
    WHERE s.id = $2
    `,
    [weekStart, slotId, classDate]
  )
  return rows[0] ?? null
}

// ── Cancellation transitions ───────────────────────────────────────────────

/**
 * Classifies what an override write does to the cancelled state. Only a genuine
 * transition moves client balances — re-saving an already-cancelled week (an
 * edited cancel_reason, a toggled fully-booked flag, a double-clicked save)
 * must return "none" so nobody gets credited twice.
 *
 * Pure and exported so the idempotency rule is unit-testable on its own; the
 * refund path is otherwise only reachable through a transaction.
 */
export type CancelTransition = "none" | "cancelled" | "uncancelled"

export const cancelTransition = (was: boolean, now: boolean): CancelTransition => {
  if (was === now) return "none"
  return now ? "cancelled" : "uncancelled"
}

// ── Template-level writes ──────────────────────────────────────────────────

export const createSlot = async (data: CreateScheduleSlotDto): Promise<ScheduleSlotJoined> => {
  const rows = await executeQuery<{ id: number }>(
    `INSERT INTO schedule (day_of_week, start_time, end_time, tutor_id, class_type_id, capacity)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      data.day_of_week,
      data.start_time,
      data.end_time,
      data.tutor_id ?? null,
      data.class_type_id,
      data.capacity ?? null,
    ]
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
 *
 * Also refunds every client booked into a FUTURE occurrence of this class: the
 * class is no longer going to run, so nobody should stay charged for it. Past
 * occurrences are left alone — they already happened and were legitimately
 * consumed (see refundFutureSessionsForSlot).
 *
 * Transactional: the refunds and the delete commit together. A half-applied
 * state here means either clients paying for a class that no longer exists, or
 * credited sessions for a class still on the calendar.
 *
 * Returns { deleted, refunded } — refunded is the session count, so the API can
 * tell staff how many clients were credited.
 */
export const softDeleteSlot = async (
  id: number,
): Promise<{ deleted: boolean; refunded: number }> => {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    // Lock the slot first so a concurrent delete can't also refund. The
    // deleted_at IS NULL predicate makes this the idempotency gate: the second
    // caller finds no row and skips the refund entirely.
    const slotResult = await client.query(
      `SELECT id FROM schedule WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [id],
    )
    if (slotResult.rows.length === 0) {
      await client.query("ROLLBACK")
      return { deleted: false, refunded: 0 }
    }

    const refunded = await sessionService.refundFutureSessionsForSlot(
      client,
      id,
      getBeirutToday(),
    )

    await client.query(
      `UPDATE schedule SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id],
    )

    await client.query("COMMIT")
    return { deleted: true, refunded }
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
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
 *  5. If `is_cancelled` flipped, refund (false→true) or restore (true→false)
 *     every booking for that occurrence.
 *
 * Wrapped in a transaction so concurrent admin clicks can't race into an
 * inconsistent state (two upserts on the same key with one DELETE in the
 * middle would otherwise be possible), and so the refunds commit with the
 * cancellation that triggered them.
 *
 * Returns the override row (or null when cleared) plus how many sessions were
 * refunded/restored, so the API can report it to staff.
 */
export const upsertOverride = async (
  slotId: number,
  data: UpsertScheduleOverrideDto,
  createdBy: string | null
): Promise<{ override: ScheduleOverride | null; refunded: number; restored: number }> => {
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

    // Did this write actually flip the cancelled state? See cancelTransition —
    // only a genuine transition moves client balances.
    const transition = cancelTransition(prev?.is_cancelled ?? false, merged.is_cancelled)

    // The actual calendar date this recurring slot falls on in the target week.
    // Needed to find the sessions booked into this specific occurrence.
    const slotRow = await client.query<{ day_of_week: number }>(
      `SELECT day_of_week FROM schedule WHERE id = $1`,
      [slotId],
    )
    const classDate = slotRow.rows[0]
      ? classDateForWeek(data.week_start, slotRow.rows[0].day_of_week)
      : null

    let refunded = 0
    let restored = 0

    if (classDate && transition === "cancelled") {
      // Future occurrences only. Cancelling a week that has already passed is a
      // record-keeping correction — the class ran (or didn't) and attendance was
      // settled at the time, so we don't retroactively move anyone's balance.
      if (classDate >= getBeirutToday()) {
        refunded = await sessionService.refundSessionsForClassOccurrence(
          client, slotId, classDate,
        )
      }
    } else if (classDate && transition === "uncancelled") {
      // Un-cancel restores whatever this feature refunded, whenever it ran. No
      // date guard: if a refund is outstanding it must be reversible, even if
      // the class date has since passed — otherwise undoing a mistaken cancel
      // the following week would silently leave everyone a free session up.
      restored = await sessionService.restoreSessionsForClassOccurrence(
        client, slotId, classDate,
      )
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
      return { override: null, refunded, restored }
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
    return { override: upserted.rows[0], refunded, restored }
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}

/**
 * Explicit "revert this week to normal" — the other way an override goes away.
 * Mirrors upsertOverride's un-cancel path: if the row being cleared was a
 * cancellation, the refunds it caused are reversed. Without this, clearing an
 * override via DELETE instead of a both-flags-false PUT would leave every
 * client permanently credited for a class that's back on the calendar.
 *
 * Returns { deleted, restored }.
 */
export const deleteOverride = async (
  slotId: number,
  weekStart: string,
): Promise<{ deleted: boolean; restored: number }> => {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    // Lock + read before deleting so we know whether it was a cancellation.
    const existing = await client.query<{ is_cancelled: boolean }>(
      `SELECT is_cancelled FROM schedule_overrides
        WHERE slot_id = $1 AND week_start = $2 FOR UPDATE`,
      [slotId, weekStart],
    )
    if (existing.rows.length === 0) {
      await client.query("ROLLBACK")
      return { deleted: false, restored: 0 }
    }

    let restored = 0
    if (existing.rows[0].is_cancelled) {
      const slotRow = await client.query<{ day_of_week: number }>(
        `SELECT day_of_week FROM schedule WHERE id = $1`,
        [slotId],
      )
      if (slotRow.rows[0]) {
        restored = await sessionService.restoreSessionsForClassOccurrence(
          client,
          slotId,
          classDateForWeek(weekStart, slotRow.rows[0].day_of_week),
        )
      }
    }

    await client.query(
      `DELETE FROM schedule_overrides WHERE slot_id = $1 AND week_start = $2`,
      [slotId, weekStart],
    )

    await client.query("COMMIT")
    return { deleted: true, restored }
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}
