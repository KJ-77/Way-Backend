// ── Phone number normalisation (E.164) ──
//
// Why this file exists:
//   AWS End User Messaging SMS rejects anything that isn't strict E.164
//   ("+96170123456" — a leading plus, then digits, nothing else). Our `users.phone`
//   column is a free-text VARCHAR(50) and the only cleaning it has ever had is
//   `user.schema.ts` stripping whitespace. So the database currently holds a mix of
//   "03/123456", "70 123 456", "0096170123456" and "+961 70 123 456" — all of which
//   are the same person, and none of which AWS will accept.
//
// This is pure string logic with no I/O, so it's fully unit-testable and safe to
// run in a migration backfill as well as on the write path.
//
// Deliberately NOT using libphonenumber-js: it's ~145 kB of metadata for a single
// country, and it would land in every Lambda bundle. Lebanon has a small, stable
// numbering plan; 60 lines of explicit rules is cheaper and easier to audit.

// Lebanese mobile prefixes, in NATIONAL form (i.e. after the trunk "0" is dropped).
//   Alfa  → 3, 70, 71, 76
//   touch → 3, 78, 79, 81
// "3" is the legacy shared prefix and is 1 digit; everything else is 2.
// Each is followed by exactly 6 subscriber digits.
const LB_MOBILE_PREFIXES = ["3", "70", "71", "76", "78", "79", "81"]

// Full-match test for a normalised Lebanese mobile.
// 3 → 7 national digits total; the 2-digit prefixes → 8.
const LB_MOBILE_RE = /^\+961(?:3\d{6}|(?:7[01689]|81)\d{6})$/

// Generic E.164: a plus, a non-zero leading digit, 7–15 digits total.
const E164_RE = /^\+[1-9]\d{6,14}$/

export const LEBANON_COUNTRY_CODE = "961"

/**
 * Converts a human-entered phone number into E.164, or returns null if it can't
 * be interpreted confidently.
 *
 * Returning null rather than throwing is deliberate: the caller decides whether a
 * bad number is a validation error (on the write path) or a row to skip and report
 * (in a bulk backfill). Throwing would force try/catch into both.
 *
 * Handles, in order:
 *   "+961 70 123 456"  → already international, just cleaned
 *   "00961 70123456"   → 00 is the international dialling prefix, same as +
 *   "961 70123456"     → bare country code, no plus
 *   "03/123456"        → national with trunk 0
 *   "70 123 456"       → national without trunk 0 (how most people actually type it)
 */
export function toE164(raw: string | null | undefined, countryCode = LEBANON_COUNTRY_CODE): string | null {
  if (!raw) return null

  // Keep only digits and a plus. Strips spaces, slashes, dashes, brackets, and the
  // stray "tel:" / unicode marks that creep in from copy-paste.
  const cleaned = raw.replace(/[^\d+]/g, "")
  if (!cleaned) return null

  // A plus is only meaningful in first position; "70+123" is junk, not a number.
  const plusCount = (cleaned.match(/\+/g) ?? []).length
  if (plusCount > 1) return null
  if (plusCount === 1 && !cleaned.startsWith("+")) return null

  let digits = cleaned.startsWith("+") ? cleaned.slice(1) : cleaned

  // "00" is the ITU international access prefix — semantically identical to "+".
  if (!cleaned.startsWith("+") && digits.startsWith("00")) {
    digits = digits.slice(2)
  } else if (!cleaned.startsWith("+")) {
    // No explicit international marker, so this is a national-format number.
    // Drop the trunk "0" (Lebanese local convention: 03…, 70… is written 070 rarely,
    // but landlines are 01…) before prefixing the country code.
    if (digits.startsWith("0")) digits = digits.slice(1)

    // If what's left doesn't already start with the country code, add it. The
    // startsWith check matters for input like "961 70123456" typed without a plus —
    // prefixing blindly would produce "961961…".
    if (!digits.startsWith(countryCode) || isNationalNumber(digits, countryCode)) {
      digits = countryCode + digits
    }
  }

  const candidate = `+${digits}`
  return E164_RE.test(candidate) ? candidate : null
}

/**
 * Disambiguates the one genuinely ambiguous case: a national number that happens to
 * begin with the same digits as the country code.
 *
 * Lebanon's code is "961" and there is no mobile prefix "96", so this can't currently
 * fire for +961 — but leaving the check in means the helper stays correct if the
 * studio ever messages a country where it can (e.g. +1 and US numbers starting "1").
 * We treat it as national when the string is too short to be code + subscriber.
 */
function isNationalNumber(digits: string, countryCode: string): boolean {
  const withoutCode = digits.slice(countryCode.length)
  // A real international number always leaves at least 6 subscriber digits behind.
  return withoutCode.length < 6
}

/**
 * True when a normalised number looks like a Lebanese MOBILE line.
 *
 * Used for warnings, never to block a send. Two reasons it stays advisory:
 *   1. New prefixes get allocated by the regulator and we don't want a valid client
 *      silently dropped because our regex is a year out of date.
 *   2. The studio may legitimately have clients on foreign numbers (tourists,
 *      expats), which are perfectly sendable — they're just not +961.
 *
 * SMS to a landline is the case this actually catches, and that one genuinely can't
 * be delivered, so it's worth surfacing in the UI before staff queue a message.
 */
export function isLebaneseMobile(e164: string): boolean {
  return LB_MOBILE_RE.test(e164)
}

/** True for any syntactically valid E.164 string. */
export function isE164(value: string): boolean {
  return E164_RE.test(value)
}

/**
 * Formats an E.164 number for display, e.g. "+96170123456" → "+961 70 123 456".
 * Cosmetic only — never store the result, and never send it to a provider.
 */
export function formatLebaneseForDisplay(e164: string): string {
  if (!isLebaneseMobile(e164)) return e164
  const national = e164.slice(4) // strip "+961"
  // "3" numbers split 1-3-3; the 2-digit prefixes split 2-3-3.
  const prefixLength = LB_MOBILE_PREFIXES.includes(national.slice(0, 2)) ? 2 : 1
  const prefix = national.slice(0, prefixLength)
  const rest = national.slice(prefixLength)
  return `+961 ${prefix} ${rest.slice(0, 3)} ${rest.slice(3)}`
}
