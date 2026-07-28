/**
 * Canonical bytes — the only reason two runs can be compared
 * (FOREVER-SEMANTIC-MEDIA-BACKFILL-001).
 *
 * Every safety property of this backfill reduces to one question: are these the
 * bytes that were reviewed? An approval is worth nothing if the artifact it
 * approved cannot be reproduced exactly, so the manifest, the exceptions file
 * and every digest are built from the functions here and nowhere else.
 *
 * Four decisions, each because the obvious alternative silently breaks:
 *
 *   1. **Key order is byte order, not insertion order.** `JSON.stringify`
 *      preserves the order keys happened to be assigned in, which depends on
 *      the order the planner encountered evidence — i.e. on directory listing
 *      order. Two runs over identical inputs would produce different bytes and
 *      the digest guard would reject a plan nothing had changed.
 *
 *   2. **Sorting is bytewise, not `Array.prototype.sort`.** The default
 *      comparator sorts UTF-16 code units, so a URL containing an astral
 *      character orders differently from the same list sorted in PostgreSQL
 *      with `COLLATE "C"`. The digests are compared against server-side
 *      aggregates; the two orders have to be the same order.
 *
 *   3. **`undefined` is omitted, never emitted as `null`.** Absent evidence and
 *      recorded-as-nothing are different claims and this contract turns on the
 *      difference — see the `unknown` trap in `role-resolution`.
 *
 *   4. **Fields are joined with U+001F, not with a printable separator.** Every
 *      hashed record contains a URL and a classifier reason, both of which can
 *      contain `|`, `:` and spaces. A separator that can appear inside a field
 *      lets two different record sets hash identically, which is exactly the
 *      collision a state digest exists to detect.
 *
 * Pure: no I/O, no clock, no randomness, no credentials.
 */

import { createHash } from "node:crypto";

/** Field separator. Unit Separator, chosen because no field can contain it. */
export const UNIT_SEP = "\u001f";

/**
 * Line endings normalised, and nothing else.
 *
 * Policy files are hashed to detect an edit. Git checks them out with CRLF on
 * Windows and LF on the Owner's other machines, so hashing raw bytes would
 * report "the policy changed" on every platform switch and train whoever sees
 * it to ignore the guard. Whitespace inside a line is NOT normalised: a change
 * there is a real change to a file whose exact text is the contract.
 */
export function normaliseText(raw: string): string {
  return raw.split("\r\n").join("\n");
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256")
    .update(typeof input === "string" ? Buffer.from(input, "utf8") : input)
    .digest("hex");
}

export function md5Hex(input: string | Buffer): string {
  return createHash("md5")
    .update(typeof input === "string" ? Buffer.from(input, "utf8") : input)
    .digest("hex");
}

/** Sort by UTF-8 bytes — the same order PostgreSQL gives under `COLLATE "C"`. */
export function byteSort(values: readonly string[]): string[] {
  return [...values].sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
}

/** sha256 over byte-sorted records, newline-joined. Order-independent by design. */
export function digestRecords(records: readonly string[]): string {
  return sha256Hex(byteSort(records).join("\n"));
}

/**
 * One field of a hashed record.
 *
 * A non-integer number throws rather than being rounded. Every number this
 * contract hashes is a count or a `sort_order`; a fractional one means the
 * caller passed the wrong thing, and truncating it would fold two different
 * inputs onto one digest — the one failure a digest must not have.
 */
export function field(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "t" : "f";
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new Error(`canonical.field: refusing to hash a non-integer number (${value})`);
    }
    return value.toString(10);
  }
  return value;
}

export function record(...fields: Array<string | number | boolean | null | undefined>): string {
  return fields.map(field).join(UNIT_SEP);
}

function canonicalise(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(canonicalise);
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of byteSort(Object.keys(source))) {
      const entry = source[key];
      if (entry === undefined) continue;
      out[key] = canonicalise(entry);
    }
    return out;
  }
  return value;
}

/**
 * The exact bytes a manifest or an exceptions file is written as.
 *
 * Two-space indent and a trailing newline so the artifact stays reviewable in a
 * diff — the Owner reads this file before approving it, and a single-line blob
 * cannot be reviewed line by line.
 */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalise(value), null, 2)}\n`.split("\r\n").join("\n");
}

/**
 * Patterns that must never reach a committed file, a report, or a log.
 *
 * The drive-letter rule is anchored on a non-scheme character on purpose. The
 * naive `/[A-Za-z]:[\\/]/` matches the `s://` inside every `https://` URL, and
 * this manifest is mostly URLs — the check would have thrown on every honest
 * run and been removed within a day. Anchoring it means `C:/Users/...` is
 * caught and `https://…` is not.
 */
const PRIVATE_PATTERNS: ReadonlyArray<{ pattern: RegExp; what: string }> = [
  { pattern: /(^|[^A-Za-z0-9+.\-_])[A-Za-z]:[\\/]/, what: "a Windows filesystem path" },
  { pattern: /\/Users\//, what: "a POSIX home path" },
  { pattern: /\\Users\\/, what: "a Windows user path" },
  { pattern: /Downloads/, what: 'the "Downloads" folder name' },
  { pattern: /Telegram/, what: 'the "Telegram" folder name' },
  { pattern: /Documents/, what: 'the "Documents" folder name' },
  { pattern: /eyJ/, what: "a JWT-shaped token" },
  { pattern: /sb_secret/, what: "a Supabase secret key" },
  { pattern: /service_role/, what: "a service-role credential name" },
];

/**
 * Refuse to emit text carrying a private path or a credential.
 *
 * Called before every write, not after. A report that has already been written
 * to disk with an Owner's home directory in it is a leak whether or not
 * something later notices; the only useful time to check is before the write.
 */
export function assertNoPrivatePaths(text: string, label: string): void {
  for (const { pattern, what } of PRIVATE_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const at = Math.max(0, match.index - 20);
    throw new Error(
      `${label} contains ${what} and was not written. ` +
        `Near offset ${match.index}: …${redactSecrets(text.slice(at, match.index + 40))}…`,
    );
  }
}

const SECRET_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  // Connection strings first: they can contain everything below, and a partial
  // redaction that leaves `user:password@host` intact is not a redaction.
  [
    /\b(?:postgres|postgresql|mysql|mongodb\+srv|mongodb|redis|amqp)s?:\/\/\S*/gi,
    "<connection string redacted>",
  ],
  [/\beyJ[A-Za-z0-9_-]{4,}(?:\.[A-Za-z0-9_-]+){1,2}/g, "<token redacted>"],
  [/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "<key redacted>"],
  [/\bPGPASSWORD=\S+/gi, "PGPASSWORD=<redacted>"],
  [/(^|[^A-Za-z0-9+.\-_])([A-Za-z]:[\\/][^\s"'<>|]*)/g, "$1<path redacted>"],
  [/(^|[\s"'(])(\/(?:home|Users)\/[^\s"'<>|]*)/g, "$1<path redacted>"],
];

/**
 * Scrub a string before it is printed or written.
 *
 * `assertNoPrivatePaths` refuses; this one rewrites. Both exist because the two
 * situations are different: an artifact that would carry a secret is a bug and
 * must not be produced, but an error message thrown by `psql` is not under our
 * control and still has to be shown to the operator. Redacting is the only way
 * to show it.
 */
export function redactSecrets(
  text: unknown,
  ...alsoRedact: ReadonlyArray<string | undefined>
): string {
  let out = String(text ?? "");
  for (const literal of alsoRedact) {
    if (literal && literal.length >= 8) out = out.split(literal).join("<redacted>");
  }
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
