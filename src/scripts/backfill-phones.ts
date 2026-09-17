// ── One-off backfill: normalise users.phone to E.164 ──
//
// Run with:
//   npm run backfill:phones          → DRY RUN. Reports what would change, writes nothing.
//   npm run backfill:phones -- --apply → actually performs the update.
//
// Dry run is the default on purpose. This touches a UNIQUE column on live client
// data, and the interesting cases (collisions) are exactly the ones you want to see
// before anything is written.
//
// Why a script and not a migration:
//   The parsing rules live in src/lib/phone.ts and are unit-tested. Reimplementing
//   them in PL/pgSQL would create a second copy that can drift. This uses the same
//   function the send path uses, so if a number normalises here it will normalise
//   at send time too — no daylight between the two.
//
// Safe to re-run. Rows already in E.164 are skipped, so a second pass is a no-op.
//
// ⚠️ COGNITO: admin-created clients use their phone as their Cognito USERNAME, and
// every later Cognito call (disable, delete, reset password) finds them by passing
// `users.phone` back in. Cognito usernames can't be changed — so rewriting a phone
// that IS a username would orphan that client's login management.
//
// Why this script is still safe: Cognito only accepts phone numbers that are a "+"
// followed by digits, so every Cognito-backed row already looks like that, and
// toE164() returns those unchanged. The rows this script DOES rewrite ("03/123456",
// "70 123 456") can't be Cognito usernames — Cognito would have rejected them.
//
// As a belt-and-braces guard, any "+"-prefixed row that WOULD change is withheld
// and reported rather than written. That case shouldn't exist; if it ever shows up,
// something about the data is not what we assumed and a human should look.

import { pool } from "../lib/db"
import { toE164, isE164, isLebaneseMobile } from "../lib/phone"

interface UserRow {
  id: string
  full_name: string
  phone: string
}

interface Plan {
  // Rows that will be rewritten.
  updates: { id: string; name: string; from: string; to: string }[]
  // Already valid E.164 — nothing to do.
  alreadyValid: number
  // Couldn't be parsed at all. These clients cannot receive SMS until fixed by hand.
  unparseable: UserRow[]
  // Parsed fine, but two or more clients resolve to the SAME number. Applying these
  // would violate users_phone_key, so they're withheld for a human to resolve.
  collisions: Map<string, { id: string; name: string; from: string }[]>
  // Parsed, but doesn't look like a Lebanese mobile — a landline, or a foreign
  // number. Not blocked (foreign clients are perfectly sendable), just flagged.
  suspicious: { id: string; name: string; to: string }[]
  // Already "+"-prefixed but would still change. Possibly a Cognito username, so
  // withheld — see the header. Expected to be empty.
  possibleCognitoUsernames: { id: string; name: string; from: string; to: string }[]
}

async function buildPlan(): Promise<Plan> {
  const { rows } = await pool.query<UserRow>(
    `SELECT id, full_name, phone FROM users
      WHERE phone IS NOT NULL AND phone <> ''
      ORDER BY full_name`,
  )

  const plan: Plan = {
    updates: [],
    alreadyValid: 0,
    unparseable: [],
    collisions: new Map(),
    suspicious: [],
    possibleCognitoUsernames: [],
  }

  // Track every target number so we can spot two clients landing on the same one.
  // Includes rows that were ALREADY valid E.164 — a stored "+9613123456" collides
  // with an unnormalised "03123456" just as surely as two unnormalised rows do.
  const claimedBy = new Map<string, { id: string; name: string; from: string }[]>()

  for (const row of rows) {
    const normalised = toE164(row.phone)
    if (!normalised) {
      plan.unparseable.push(row)
      continue
    }

    const existing = claimedBy.get(normalised) ?? []
    existing.push({ id: row.id, name: row.full_name, from: row.phone })
    claimedBy.set(normalised, existing)

    if (isE164(row.phone) && row.phone === normalised) {
      plan.alreadyValid++
    } else if (row.phone.startsWith("+")) {
      // Shouldn't happen — see the header. Withhold rather than risk orphaning a
      // Cognito login.
      plan.possibleCognitoUsernames.push({
        id: row.id, name: row.full_name, from: row.phone, to: normalised,
      })
    } else {
      plan.updates.push({ id: row.id, name: row.full_name, from: row.phone, to: normalised })
    }

    if (!isLebaneseMobile(normalised)) {
      plan.suspicious.push({ id: row.id, name: row.full_name, to: normalised })
    }
  }

  // Anything claimed by more than one client is a collision.
  for (const [number, claimants] of claimedBy) {
    if (claimants.length > 1) plan.collisions.set(number, claimants)
  }

  // Withhold every row involved in a collision — including ones that look like
  // clean updates. Applying half a collision would leave the data in a worse state
  // than before, with no error to signal it.
  const collidingIds = new Set(
    [...plan.collisions.values()].flat().map(c => c.id),
  )
  plan.updates = plan.updates.filter(u => !collidingIds.has(u.id))

  return plan
}

function report(plan: Plan, applied: boolean): void {
  const verb = applied ? "Updated" : "Would update"
  console.log("\n─────────────────────────────────────────────")
  console.log("  users.phone → E.164 backfill")
  console.log("─────────────────────────────────────────────\n")

  console.log(`Already valid E.164 : ${plan.alreadyValid}`)
  console.log(`${verb.padEnd(20)}: ${plan.updates.length}`)
  console.log(`Unparseable         : ${plan.unparseable.length}`)
  console.log(`Collisions          : ${plan.collisions.size}`)
  console.log(`Possible Cognito    : ${plan.possibleCognitoUsernames.length}`)
  console.log(`Not a LB mobile     : ${plan.suspicious.length}\n`)

  if (plan.possibleCognitoUsernames.length) {
    console.log("── ⚠️  WITHHELD — may be a Cognito username ──")
    console.log("  These already start with '+' but would still change. Admin-created")
    console.log("  clients use their phone as their Cognito username, which can't be")
    console.log("  renamed — rewriting it would break delete / reset-password for them.")
    console.log("  Check the client in the Cognito console before changing by hand.\n")
    for (const p of plan.possibleCognitoUsernames) {
      console.log(`  ${p.name.padEnd(28)} ${p.from.padEnd(20)} → ${p.to}  (id ${p.id})`)
    }
    console.log()
  }

  if (plan.updates.length) {
    console.log(`── ${verb} ──`)
    for (const u of plan.updates) {
      console.log(`  ${u.name.padEnd(28)} ${u.from.padEnd(20)} → ${u.to}`)
    }
    console.log()
  }

  if (plan.collisions.size) {
    console.log("── ⚠️  COLLISIONS — not applied, fix by hand ──")
    console.log("  Two or more clients resolve to the same number. Decide which record")
    console.log("  is real (or correct the wrong one) before re-running.\n")
    for (const [number, claimants] of plan.collisions) {
      console.log(`  ${number}`)
      for (const c of claimants) {
        console.log(`      ${c.name.padEnd(28)} (stored as "${c.from}", id ${c.id})`)
      }
    }
    console.log()
  }

  if (plan.unparseable.length) {
    console.log("── ⚠️  UNPARSEABLE — these clients cannot receive SMS ──")
    for (const r of plan.unparseable) {
      console.log(`  ${r.full_name.padEnd(28)} "${r.phone}"  (id ${r.id})`)
    }
    console.log()
  }

  if (plan.suspicious.length) {
    console.log("── Note: not a Lebanese mobile ──")
    console.log("  Landlines can't receive SMS. Foreign mobiles can — no action needed.\n")
    for (const s of plan.suspicious) {
      console.log(`  ${s.name.padEnd(28)} ${s.to}`)
    }
    console.log()
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply")
  const plan = await buildPlan()

  if (apply && plan.updates.length > 0) {
    const client = await pool.connect()
    try {
      // One transaction for the whole batch. If any single row violates the unique
      // constraint despite our collision check — say, a concurrent write between
      // the plan and the apply — the entire backfill rolls back rather than leaving
      // the table half-normalised.
      await client.query("BEGIN")
      for (const u of plan.updates) {
        await client.query("UPDATE users SET phone = $2 WHERE id = $1", [u.id, u.to])
      }
      await client.query("COMMIT")
    } catch (err) {
      await client.query("ROLLBACK")
      console.error("\n❌ Backfill rolled back — no changes were made.\n", err)
      throw err
    } finally {
      client.release()
    }
  }

  report(plan, apply)

  if (!apply) {
    console.log("Dry run — nothing was written.")
    console.log("Re-run with `npm run backfill:phones -- --apply` to commit these changes.\n")
  } else {
    console.log("✅ Backfill committed.\n")
  }
}

main()
  .then(() => pool.end())
  .catch(err => {
    console.error(err)
    pool.end()
    process.exitCode = 1
  })
