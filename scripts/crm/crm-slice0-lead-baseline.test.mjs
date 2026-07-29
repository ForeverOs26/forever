#!/usr/bin/env node
/**
 * FOREVER-CRM-SLICE0-MEASURED-BASELINE-001 — static contract test for the
 * Slice 0 read-only lead baseline script.
 * Corrected by FOREVER-CRM-SLICE0-CORRECTION-001.
 *
 * WHY THIS EXISTS
 * ---------------
 * `crm-slice0-lead-baseline.sql` is designed to be pasted into a PRODUCTION
 * SQL editor. The two things that must never become true of it are that it
 * writes, and that it emits personal data. This validator pins both, plus the
 * transaction discipline, the k-anonymity floor, the closed reporting
 * vocabulary, the calendar floor, the privilege and policy evidence, and the
 * count-versus-rate honesty rule.
 *
 * It parses the SQL conservatively and deliberately. A false positive here is
 * always preferable to letting a write statement or a raw personal value
 * through, so every rule fails closed: an unrecognised shape is a failure, not
 * a pass.
 *
 * WHAT THIS FILE CANNOT DO
 * ------------------------
 * It reads text. It never contacts a database, so it cannot observe what the
 * script actually emits for a given table state. The executable proof of the
 * privacy guarantees lives in `crm-slice0-lead-baseline.pg.test.mjs`, which
 * runs the real script against a disposable PostgreSQL cluster seeded with
 * invented synthetic rows. Both are required; neither replaces the other.
 *
 * The validator also proves itself. `NEGATIVE_FIXTURES` are deliberately
 * broken variants of the real script; each must be REJECTED. A rule that
 * cannot fail cannot protect anything.
 *
 * Usage: node scripts/crm/crm-slice0-lead-baseline.test.mjs
 * Exits 0 when every assertion holds, 1 on the first failure.
 *
 * Vitest's `include` is `src/**` only, so this follows the established
 * repository idiom for validators that live under `scripts/`.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL_PATH = join(HERE, "crm-slice0-lead-baseline.sql");

// ---------------------------------------------------------------------------
// Tiny assertion harness
// ---------------------------------------------------------------------------
let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures.push({ name, message: error.message });
    console.log(`  FAIL ${name}\n         ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ---------------------------------------------------------------------------
// Conservative SQL normalisation
//
// Comments and string literals are removed BEFORE any keyword scan. This
// matters: the script legitimately mentions 'INSERT', 'UPDATE', 'DELETE',
// 'TRUNCATE', 'REFERENCES', 'TRIGGER' and 'MAINTAIN' as quoted privilege names
// inside privilege probes, and describes every forbidden verb in its header
// comment. Stripping first means the keyword scan sees executable code only,
// and cannot be fooled by a write verb hidden inside a literal either.
// ---------------------------------------------------------------------------
function stripCommentsAndLiterals(sql) {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? n : nl;
      continue;
    }
    if (two === "/*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      out += " ";
      continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") break;
        j += 1;
      }
      out += "''";
      i = j + 1;
      continue;
    }
    if (sql[i] === '"') {
      const end = sql.indexOf('"', i + 1);
      out += '""';
      i = end === -1 ? n : end + 1;
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

/** Split on semicolons; literals are already gone so this is unambiguous. */
function statements(code) {
  return code
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * The body of a named CTE, from `<name> AS (` up to the closing paren at
 * column 0. The trailing comma is optional so the last CTE before the main
 * SELECT is found too; every nested paren in this script is indented, so a
 * `)` at column 0 unambiguously closes the CTE.
 */
function cteBody(text, name) {
  const re = new RegExp(`${name}\\s*(?:\\([^)]*\\)\\s*)?AS\\s*\\(([\\s\\S]*?)\\n\\),?`);
  const m = text.match(re);
  return m === null ? null : m[1];
}

/**
 * The emitting UNION branch that carries a given metric literal: from the
 * metric literal to the next `UNION ALL SELECT` or the end of the result set.
 */
function branchFor(raw, metricLiteral) {
  const start = raw.indexOf(`'${metricLiteral}'`);
  if (start === -1) return null;
  const next = raw.indexOf("UNION ALL SELECT", start);
  return raw.slice(start, next === -1 ? raw.length : next);
}

const RAW = readFileSync(SQL_PATH, "utf8");
const CODE = stripCommentsAndLiterals(RAW);
const STATEMENTS = statements(CODE);

// ---------------------------------------------------------------------------
// The rules. Each is a pure function of the SQL text so the negative fixtures
// can reuse them verbatim.
// ---------------------------------------------------------------------------

/** Every verb that must never appear as executable code. */
const FORBIDDEN = [
  "INSERT", "UPDATE", "DELETE", "UPSERT", "MERGE", "TRUNCATE",
  "ALTER", "CREATE", "DROP", "GRANT", "REVOKE", "COMMENT",
  "COPY", "CALL", "EXECUTE", "VACUUM", "ANALYZE", "REINDEX", "CLUSTER",
  "REFRESH", "LOCK", "NOTIFY", "PREPARE", "REASSIGN", "IMPORT",
];

/** Multi-word constructs that are forbidden regardless of spacing. */
const FORBIDDEN_PHRASES = [
  ["SECURITY", "DEFINER"],
  ["MATERIALIZED", "VIEW"],
  ["FOR", "UPDATE"],
  ["FOR", "SHARE"],
  ["FOR", "NO", "KEY", "UPDATE"],
  ["SELECT", "INTO"],
];

/** Identifiers that would indicate a temporary or persistent object. */
const FORBIDDEN_OBJECT_WORDS = ["TEMPORARY", "TEMP", "SEQUENCE", "PROCEDURE", "TRIGGER", "NEXTVAL", "SETVAL"];

/** Personal columns that must never be selected as an output value. */
const PII_COLUMNS = ["name", "email", "phone", "message", "country", "budget", "interest"];

/**
 * The closed reporting vocabulary, derived from the repository — never
 * invented. Each entry names the file that proves the value is real.
 */
const REPOSITORY_SOURCE_VALUES = {
  contact_form: "supabase/migrations/20260704132000_create_leads.sql column DEFAULT; src/lib/lead-service.ts fallback; src/components/ContactForm.tsx default prop",
  contact_page: "src/routes/contact.tsx",
  home_page: "src/routes/index.tsx",
  booth: "src/features/navigator/core/lead.ts BOOTH_LEAD_SOURCE",
  project_detail: "src/features/project-detail/components/ProjectContactCTA.tsx, on main until commit 1577207 (PR #123) retired it",
};

/** The five values the migration CHECK constraint permits. */
const REPOSITORY_STATUS_VALUES = ["new", "contacted", "qualified", "closed", "spam"];

/** Every table privilege the baseline must account for. */
const REQUIRED_PRIVILEGES = [
  "SELECT", "INSERT", "UPDATE", "DELETE",
  "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN",
];

/** The roles the privilege matrix must cover at minimum. */
const REQUIRED_ROLES = ["anon", "authenticated", "service_role"];

/** Calendar outputs that must obey the group-size floor. */
const CALENDAR_METRICS = ["earliest_lead_month", "latest_lead_month", "lead_month_range"];

/** Metrics that are ratios and must never be reported as 0 on an empty table. */
const RATE_METRICS = [
  "email_completeness_rate", "phone_completeness_rate",
  "duplicate_rate", "null_or_blank_rate",
];

function ruleNoForbiddenVerbs(code) {
  const upper = code.toUpperCase();
  for (const verb of FORBIDDEN) {
    // \b will not match inside grant_probe / granted / column_name, so ordinary
    // identifiers that merely contain a verb are safe.
    const re = new RegExp(`\\b${verb}\\b`);
    assert(!re.test(upper), `forbidden statement keyword present as code: ${verb}`);
  }
  for (const phrase of FORBIDDEN_PHRASES) {
    const re = new RegExp(`\\b${phrase.join("\\s+")}\\b`);
    assert(!re.test(upper), `forbidden construct present: ${phrase.join(" ")}`);
  }
  for (const word of FORBIDDEN_OBJECT_WORDS) {
    assert(!new RegExp(`\\b${word}\\b`).test(upper), `forbidden object keyword present: ${word}`);
  }
  // The word FUNCTION may not appear as a definition. Guard the whole word.
  assert(!/\bFUNCTION\b/.test(upper), "forbidden object keyword present: FUNCTION");
}

function ruleTransactionDiscipline(code) {
  const stmts = statements(code);
  assert(stmts.length >= 4, "expected at least BEGIN, SET, SHOW and a final ROLLBACK");
  assert(/^BEGIN$/i.test(stmts[0]), `first statement must be BEGIN, found: ${stmts[0].slice(0, 40)}`);
  assert(
    /^SET\s+TRANSACTION\s+READ\s+ONLY$/i.test(stmts[1]),
    `second statement must set the transaction read only in-band, found: ${stmts[1].slice(0, 60)}`,
  );
  assert(
    /^SHOW\s+transaction_read_only$/i.test(stmts[2]),
    `third statement must verify transaction_read_only, found: ${stmts[2].slice(0, 60)}`,
  );
  assert(
    /^ROLLBACK$/i.test(stmts[stmts.length - 1]),
    `last statement must be ROLLBACK, found: ${stmts[stmts.length - 1].slice(0, 40)}`,
  );
  assert(!/\bCOMMIT\b/i.test(code), "COMMIT must never appear");
  const begins = (code.match(/\bBEGIN\b/gi) || []).length;
  assert(begins === 1, `expected exactly one BEGIN, found ${begins}`);
  const rollbacks = (code.match(/\bROLLBACK\b/gi) || []).length;
  assert(rollbacks === 1, `expected exactly one ROLLBACK, found ${rollbacks}`);
}

function ruleReadOnlyReVerifiedInBand(code, raw) {
  assert(
    /current_setting\(/.test(code),
    "the consolidated result must re-read transaction_read_only via current_setting",
  );
  // The literal is stripped, so confirm against the raw text too.
  assert(
    /current_setting\(\s*'transaction_read_only'\s*\)/.test(raw),
    "current_setting('transaction_read_only') must appear so the proof survives into the returned result set",
  );
}

function ruleNoRawPiiSelected(code) {
  for (const col of PII_COLUMNS) {
    const re = new RegExp(`\\b${col}\\b`, "g");
    let m;
    while ((m = re.exec(code)) !== null) {
      // Look back past an optional table qualifier for the required wrapper.
      const before = code.slice(Math.max(0, m.index - 24), m.index);
      const normalised = before.replace(/[A-Za-z_][A-Za-z0-9_]*\.$/, "");
      assert(
        /btrim\($/.test(normalised),
        `personal column "${col}" appears outside a btrim() presence test at offset ${m.index} ` +
          `(context: ${JSON.stringify(code.slice(Math.max(0, m.index - 30), m.index + 12))})`,
      );
    }
  }
}

function ruleEmailOnlyAggregated(code) {
  // Normalized email may appear only inside a CTE whose sole output is a count.
  const body = cteBody(code, "email_groups");
  assert(body !== null, "email_groups CTE not found in the expected shape");
  assert(/SELECT\s+count\(\*\)::bigint\s+AS\s+group_size/i.test(body),
    "email_groups must select only count(*) as group_size");
  assert(!/SELECT[\s\S]*?\bemail\b[\s\S]*?FROM/i.test(body.replace(/WHERE[\s\S]*/i, "")),
    "email must not appear in the email_groups select list");
  // No hashing of any personal value anywhere.
  for (const fn of ["md5", "sha256", "sha512", "digest", "encode", "crypt"]) {
    assert(!new RegExp(`\\b${fn}\\s*\\(`, "i").test(code), `hashing function ${fn}() must not be used`);
  }
}

function ruleSuppressionFloor(code, raw) {
  assert(/min_group_size/.test(code), "a minimum group size parameter must exist");
  assert(/SELECT\s+5::bigint\s+AS\s+min_group_size/i.test(code),
    "the k-anonymity floor must be exactly 5");
  const suppCtes = code.match(/\b\w+_supp\s+AS\s*\(/g) || [];
  assert(suppCtes.length >= 3, `expected a suppressed CTE per grouped section, found ${suppCtes.length}`);
  const guards = code.match(/(?:>=|<)\s*\(\s*SELECT\s+min_group_size\s+FROM\s+params\s*\)/g) || [];
  assert(
    guards.length >= suppCtes.length,
    `every grouped section must apply the floor: ${suppCtes.length} suppressed CTEs but ${guards.length} guards`,
  );
  assert(raw.includes("Other / suppressed"), "small groups must be folded into 'Other / suppressed'");
  assert(raw.includes("SUPPRESSED_LT_5"), "small counts must report SUPPRESSED_LT_5");
}

function ruleHonestUnmeasurables(raw) {
  assert(raw.includes("NOT_MEASURABLE_FROM_CURRENT_SCHEMA"),
    "schema gaps must be reported as NOT_MEASURABLE_FROM_CURRENT_SCHEMA, never as zero");
  assert(raw.includes("NOT_MEASURABLE_NO_DATA"),
    "unmeasurable rates must be reported as NOT_MEASURABLE_NO_DATA, never as zero");
}

function ruleNoSecretsOrProjectRefs(raw) {
  const banned = [
    [/abtvsrcnfwlbawvrjeed/i, "production project ref embedded"],
    [/garjibjhlzeljsnpzisu/i, "staging project ref embedded"],
    [/postgres(ql)?:\/\//i, "connection string embedded"],
    [/\beyJ[A-Za-z0-9_-]{10,}/, "JWT-shaped token embedded"],
    [/service_role_key|SUPABASE_[A-Z_]*KEY|ANON_KEY/i, "credential variable embedded"],
    [/\bsupabase\.co\b/i, "project host embedded"],
    [/password\s*[:=]/i, "password embedded"],
    [/\bsb[ps]_[A-Za-z0-9]{10,}/, "Supabase key embedded"],
  ];
  for (const [re, why] of banned) {
    assert(!re.test(raw), why);
  }
  // Any bare 20-character lowercase token is a Supabase-ref shape.
  const refShaped = raw.match(/\b[a-z]{20}\b/g) || [];
  assert(refShaped.length === 0, `project-ref-shaped token(s) present: ${refShaped.join(", ")}`);
}

function ruleTargetsOnlyLeads(code) {
  // Every FROM/JOIN against a non-catalog relation must be public.leads.
  const refs = code.match(/\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_.]*)/gi) || [];
  const allowedPrefixes = ["pg_catalog.", "information_schema."];
  const allowedExact = new Set([
    "public.leads", "sections", "generate_series",
    // parameter and privacy-boundary CTEs
    "params", "leads_norm", "totals", "disclosure", "email_groups",
    // closed reporting vocabulary
    "source_vocab", "status_vocab", "source_cat", "status_cat",
    // schema introspection
    "cols", "col_probe", "activity_tbl",
    // grouped sections
    "month_raw", "month_supp", "source_raw", "source_supp", "status_raw", "status_supp",
    // security snapshot
    "leads_rel", "acl_rows", "acl_named", "known_roles", "acl_safe",
    "acl_disclosable", "priv_candidates", "eff_priv", "policies",
  ]);
  for (const ref of refs) {
    const target = ref.replace(/^\s*(?:FROM|JOIN)\s+/i, "").trim();
    if (allowedPrefixes.some((p) => target.toLowerCase().startsWith(p))) continue;
    if (allowedExact.has(target)) continue;
    throw new Error(`unexpected relation referenced: ${target}`);
  }
}

// ---------------------------------------------------------------------------
// CORRECTION 2 — the closed reporting vocabulary.
//
// `source` is unconstrained TEXT at the database level, so any stored value
// could be an email address, a phone number, a URL or free text a guest typed.
// It is therefore a LOOKUP KEY only. Every emitted label must come from the
// repository-confirmed vocabulary or from one of two fixed constants.
// ---------------------------------------------------------------------------
function vocabularyKeys(raw, cteName) {
  const body = cteBody(raw, cteName);
  assert(body !== null, `${cteName} CTE not found in the expected shape`);
  return (body.match(/\(\s*'([^']*)'/g) || []).map((s) => s.replace(/^\(\s*'/, "").replace(/'$/, ""));
}

function ruleClosedSourceVocabulary(code, raw) {
  const keys = vocabularyKeys(raw, "source_vocab");
  const expected = Object.keys(REPOSITORY_SOURCE_VALUES);
  assert(
    keys.length === expected.length && expected.every((k) => keys.includes(k)),
    `source_vocab must be exactly the repository-confirmed values ${expected.join(", ")}; found ${keys.join(", ")}`,
  );
  assert(raw.includes("'Other / unknown source'"),
    "every unrecognised source must become the fixed constant 'Other / unknown source'");
  assert(raw.includes("'(missing source)'"),
    "null or blank source must become a fixed missing-source label");

  // The normalized key may be used to test for NULL and to look a label up.
  // It may never travel any further, because that is how a raw value escapes.
  const body = cteBody(code, "source_cat");
  assert(body !== null, "source_cat CTE not found in the expected shape");
  const residue = body
    .replace(/ln\.source_key\s+IS\s+NULL/gi, "")
    .replace(/sv\.source_key\s*=\s*ln\.source_key/gi, "");
  assert(!/source_key/i.test(residue),
    `source_cat may only test source_key for NULL and use it as a vocabulary lookup key; ` +
      `found another use: ${JSON.stringify(residue.replace(/\s+/g, " ").slice(0, 160))}`);

  // The grouped section must aggregate the categorised label, never the raw key.
  const rawCte = cteBody(code, "source_raw");
  assert(rawCte !== null, "source_raw CTE not found in the expected shape");
  assert(/FROM\s+source_cat/i.test(rawCte),
    "source_raw must aggregate the categorised label from source_cat");
  assert(!/source_key|source_norm/i.test(rawCte),
    "source_raw must not reach back to the raw normalized source value");
}

function ruleClosedStatusVocabulary(code, raw) {
  const keys = vocabularyKeys(raw, "status_vocab");
  assert(
    keys.length === REPOSITORY_STATUS_VALUES.length &&
      REPOSITORY_STATUS_VALUES.every((k) => keys.includes(k)),
    `status_vocab must be exactly the CHECK-constraint values ${REPOSITORY_STATUS_VALUES.join(", ")}; found ${keys.join(", ")}`,
  );
  assert(raw.includes("'Other / unknown status'"),
    "every unexpected live status must become the fixed constant 'Other / unknown status'");
  assert(raw.includes("'(missing status)'"),
    "null or blank status must become a fixed missing-status label");

  const body = cteBody(code, "status_cat");
  assert(body !== null, "status_cat CTE not found in the expected shape");
  const residue = body
    .replace(/ln\.status_key\s+IS\s+NULL/gi, "")
    .replace(/stv\.status_key\s*=\s*ln\.status_key/gi, "");
  assert(!/status_key/i.test(residue),
    "status_cat may only test status_key for NULL and use it as a vocabulary lookup key");

  const rawCte = cteBody(code, "status_raw");
  assert(rawCte !== null, "status_raw CTE not found in the expected shape");
  assert(/FROM\s+status_cat/i.test(rawCte),
    "status_raw must aggregate the categorised label from status_cat");
  assert(!/status_key|status_norm/i.test(rawCte),
    "status_raw must not reach back to the raw normalized status value");
}

// ---------------------------------------------------------------------------
// CORRECTION 3 — the calendar floor, applied consistently.
// ---------------------------------------------------------------------------
function ruleCalendarSuppression(code, raw) {
  const body = cteBody(code, "disclosure");
  assert(body !== null, "disclosure CTE not found in the expected shape");
  assert(/calendar_mode/.test(body), "the disclosure CTE must compute calendar_mode");
  const rawBody = cteBody(raw, "disclosure");
  assert(/=\s*0[\s\S]*?NOT_MEASURABLE_NO_DATA/.test(rawBody),
    "calendar_mode must be NOT_MEASURABLE_NO_DATA when there are no leads");
  assert(/<\s*\(\s*SELECT\s+min_group_size\s+FROM\s+params\s*\)[\s\S]*?SUPPRESSED_LT_5/.test(rawBody),
    "calendar_mode must be SUPPRESSED_LT_5 below the group-size floor");
  assert(/DISCLOSE/.test(rawBody), "calendar_mode must have an explicit disclose branch");

  for (const metric of CALENDAR_METRICS) {
    const branch = branchFor(raw, metric);
    assert(branch !== null, `calendar metric ${metric} is missing from the result set`);
    assert(/calendar_mode/.test(branch),
      `calendar metric ${metric} must be gated by calendar_mode, so a 1-to-4 row table cannot ` +
        `reveal its month through an unsuppressed summary`);
  }
}

// ---------------------------------------------------------------------------
// CORRECTION 4 — the full privilege snapshot.
// ---------------------------------------------------------------------------
function ruleFullPrivilegeSnapshot(code, raw) {
  // (a) the relation-ACL view, whose privilege names come from the server.
  assert(/aclexplode\s*\(/i.test(code),
    "the relation ACL must be inspected with aclexplode so no unsupported privilege name is issued");
  assert(/privilege_type/.test(code), "the ACL view must report the privilege type");
  assert(/grantor/.test(code), "the ACL view must report the grantor");
  assert(/is_grantable/.test(code), "the ACL view must report whether the grant is grantable");
  assert(raw.includes("from_relation_acl"),
    "the output must say whether a privilege comes from the relation ACL");

  // (b) the effective view must account for every privilege, version-safely.
  const candidates = cteBody(raw, "priv_candidates");
  assert(candidates !== null, "priv_candidates CTE not found in the expected shape");
  for (const priv of REQUIRED_PRIVILEGES) {
    assert(candidates.includes(`'${priv}'`),
      `the privilege matrix must account for ${priv}`);
  }
  const maintain = candidates.match(/'MAINTAIN'\s*,\s*(\d+)/);
  assert(maintain !== null && Number(maintain[1]) >= 170000,
    "MAINTAIN must be gated on server_version_num >= 170000, never issued blindly");
  // The setting name is a string literal, so it survives only in the raw text.
  assert(/current_setting\(\s*'server_version_num'\s*\)/.test(raw),
    "the effective probe must consult server_version_num before issuing a version-gated privilege");
  assert(raw.includes("NOT_SUPPORTED_BY_SERVER_VERSION"),
    "a privilege the server does not support must be reported, not silently dropped");

  for (const role of REQUIRED_ROLES) {
    assert(raw.includes(`'${role}'`), `the privilege matrix must cover ${role}`);
  }

  // (c) the raw ACL is disclosed only when it cannot carry a personal identifier.
  const aclBranch = branchFor(raw, "relation_acl_raw");
  assert(aclBranch !== null, "the raw relation ACL must be reported");
  assert(/acl_disclosable/.test(aclBranch),
    "the raw ACL may be emitted only behind the known-platform-role gate");
  assert(raw.includes("SUPPRESSED_NON_STANDARD_ROLE_IN_ACL"),
    "a non-standard role in the ACL must suppress the raw ACL rather than print it");
  assert(raw.includes("'Other / non-standard role'"),
    "a role outside the known platform set must be reported as a fixed constant");
}

// ---------------------------------------------------------------------------
// CORRECTION 5 — the complete RLS policy snapshot.
// ---------------------------------------------------------------------------
function ruleCompleteRlsPolicySnapshot(code, raw) {
  const body = cteBody(code, "policies");
  assert(body !== null, "policies CTE not found in the expected shape");
  for (const column of ["policyname", "cmd", "permissive", "roles", "qual", "with_check"]) {
    assert(new RegExp(`\\b${column}\\b`).test(body),
      `the policy snapshot must read ${column} from pg_policies`);
  }
  for (const metric of [
    "policy_command", "policy_mode", "policy_roles", "policy_qual", "policy_with_check",
  ]) {
    assert(branchFor(raw, metric) !== null,
      `${metric} must be emitted — name and command alone hide the actual security boundary`);
  }
  const withCheck = branchFor(raw, "policy_with_check");
  assert(/pol\.with_check/.test(withCheck),
    "the WITH CHECK predicate itself must reach the output, not just its presence");
}

// ---------------------------------------------------------------------------
// CORRECTION 6 — counts, rates, schema gaps and suppression are distinct.
// ---------------------------------------------------------------------------
function ruleEmptyTableSemantics(code, raw) {
  assert(!/absence is never[\s\S]{0,40}zero/i.test(raw),
    "the blanket claim that absence is never reported as zero is false: factual counts truthfully return 0");
  const body = cteBody(code, "disclosure");
  assert(body !== null && /rate_mode/.test(body),
    "the disclosure CTE must compute rate_mode so rates and counts are handled differently");

  for (const metric of RATE_METRICS) {
    const branch = branchFor(raw, metric);
    assert(branch !== null, `rate metric ${metric} is missing from the result set`);
    assert(/rate_mode/.test(branch),
      `${metric} is a ratio and must return NOT_MEASURABLE_NO_DATA on an empty table, never 0`);
  }
  // The completeness section reports a COUNT; it must be named as one.
  assert(branchFor(raw, "null_or_blank_count") !== null,
    "the per-field completeness numbers are counts and must be named null_or_blank_count");
  // Factual counts must remain plain numbers.
  const totalBranch = branchFor(raw, "total_leads");
  assert(totalBranch !== null && !/rate_mode|calendar_mode/.test(totalBranch),
    "total_leads is a factual count and must not be suppressed into a marker");
  const monthsBranch = branchFor(raw, "months_containing_leads");
  assert(monthsBranch !== null && !/calendar_mode/.test(monthsBranch),
    "months_containing_leads is a factual count that identifies no month and must stay numeric");
}

// ---------------------------------------------------------------------------
// CORRECTION 1 — no claim the measurement cannot support.
// ---------------------------------------------------------------------------
const OVERCLAIM_PATTERNS = [
  [/never received a lead/i, "claims production never received a lead"],
  [/never (?:been )?(?:produced|delivered) a (?:row|lead)/i, "claims submitLead never produced a row"],
  [/has never produced a row/i, "claims submitLead never produced a row"],
  [/conclusively confirmed/i, "claims a conclusion the row count cannot support"],
  [/G0 is (?:conclusively )?confirmed open/i, "claims Gate G0 is confirmed open from a row count alone"],
  [/absence is never[\s\S]{0,40}zero/i, "restates the false blanket absence claim"],
  [/no lead was ever (?:submitted|stored)/i, "claims no lead was ever submitted or stored"],
];

/**
 * A phrase is an overclaim only when it is ASSERTED. The same words inside an
 * explicit disclaimer — "it does not prove that no lead was ever submitted" —
 * are the correction, not the defect, so a nearby negation marker clears them.
 */
const NEGATION_MARKERS = /does\s+not\s+prove|do\s+not\s+prove|cannot\s+prove|can\s+not\s+prove|is\s+not\s+evidence|does\s+NOT\s+prove|never\s+proves|it\s+does\s+not/i;

function ruleNoHistoricalOverclaim(raw) {
  for (const [re, why] of OVERCLAIM_PATTERNS) {
    const global = new RegExp(re.source, "gi");
    let m;
    while ((m = global.exec(raw)) !== null) {
      const preceding = raw.slice(Math.max(0, m.index - 300), m.index);
      assert(
        NEGATION_MARKERS.test(preceding),
        `${why} (asserted, not disclaimed, at offset ${m.index}: ` +
          `${JSON.stringify(raw.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\s+/g, " "))})`,
      );
    }
  }
  assert(/contained zero rows|current .{0,40}contents|CURRENT_TABLE_CONTENTS_ONLY/i.test(raw),
    "the script must state that its evidence is the current table contents only");
  assert(/end_to_end_capture_proven|end-to-end capture remains unproven|controlled/i.test(raw),
    "the script must record that end-to-end capture remains unproven and needs a separate controlled test");
}

// ---------------------------------------------------------------------------
// Positive assertions against the real script
// ---------------------------------------------------------------------------
console.log("\nFOREVER-CRM-SLICE0-MEASURED-BASELINE-001 — SQL contract test");
console.log("(corrected by FOREVER-CRM-SLICE0-CORRECTION-001)");
console.log(`\nScript under test: ${SQL_PATH}`);
console.log(`Statements: ${STATEMENTS.length}\n`);

check("contains no forbidden write or DDL statement", () => ruleNoForbiddenVerbs(CODE));
check("opens a transaction and sets it read only in-band", () => ruleTransactionDiscipline(CODE));
check("re-verifies transaction_read_only inside the transaction", () => ruleReadOnlyReVerifiedInBand(CODE, RAW));
check("ends with ROLLBACK and never commits", () => ruleTransactionDiscipline(CODE));
check("never selects a raw personal value", () => ruleNoRawPiiSelected(CODE));
check("uses normalized email only inside an aggregate CTE", () => ruleEmailOnlyAggregated(CODE));
check("applies the group-size-5 suppression floor everywhere", () => ruleSuppressionFloor(CODE, RAW));
check("reports unmeasurable facts honestly", () => ruleHonestUnmeasurables(RAW));
check("embeds no credential, host or project ref", () => ruleNoSecretsOrProjectRefs(RAW));
check("reads only public.leads and system catalogs", () => ruleTargetsOnlyLeads(CODE));
check("emits source only through a closed repository-confirmed vocabulary", () => ruleClosedSourceVocabulary(CODE, RAW));
check("emits status only through a closed repository-confirmed vocabulary", () => ruleClosedStatusVocabulary(CODE, RAW));
check("applies the group-size floor to every calendar output", () => ruleCalendarSuppression(CODE, RAW));
check("reports the full table privilege matrix, version-safely", () => ruleFullPrivilegeSnapshot(CODE, RAW));
check("reports the complete RLS policy snapshot including predicates", () => ruleCompleteRlsPolicySnapshot(CODE, RAW));
check("separates factual counts from unmeasurable rates", () => ruleEmptyTableSemantics(CODE, RAW));
check("makes no historical claim the measurement cannot support", () => ruleNoHistoricalOverclaim(RAW));

// ---------------------------------------------------------------------------
// Negative fixtures — the validator must reject each of these.
// A rule that cannot fail protects nothing.
// ---------------------------------------------------------------------------
const NEGATIVE_FIXTURES = [
  {
    name: "an UPDATE smuggled into the body",
    mutate: (sql) => sql.replace("ROLLBACK;", "UPDATE public.leads SET status = 'new';\nROLLBACK;"),
    rule: (code) => ruleNoForbiddenVerbs(code),
  },
  {
    name: "a CREATE TABLE smuggled into the body",
    mutate: (sql) => sql.replace("ROLLBACK;", "CREATE TABLE public.crm_person (id uuid);\nROLLBACK;"),
    rule: (code) => ruleNoForbiddenVerbs(code),
  },
  {
    name: "a GRANT smuggled into the body",
    mutate: (sql) => sql.replace("ROLLBACK;", "GRANT SELECT ON public.leads TO anon;\nROLLBACK;"),
    rule: (code) => ruleNoForbiddenVerbs(code),
  },
  {
    name: "the read-only guard removed",
    mutate: (sql) => sql.replace("SET TRANSACTION READ ONLY;", ""),
    rule: (code) => ruleTransactionDiscipline(code),
  },
  {
    name: "the rollback swapped for a commit",
    mutate: (sql) => sql.replace(/ROLLBACK;\s*$/, "COMMIT;\n"),
    rule: (code) => ruleTransactionDiscipline(code),
  },
  {
    name: "a raw email selected as output",
    mutate: (sql) => sql.replace("FROM public.leads l\n),", "FROM public.leads l\n),\nleaky AS (SELECT email FROM public.leads),"),
    rule: (code) => ruleNoRawPiiSelected(code),
  },
  {
    name: "a raw name selected as output",
    mutate: (sql) => sql.replace("FROM public.leads l\n),", "FROM public.leads l\n),\nleaky AS (SELECT name FROM public.leads),"),
    rule: (code) => ruleNoRawPiiSelected(code),
  },
  {
    name: "an email hash emitted",
    mutate: (sql) => sql.replace("SELECT count(*)::bigint AS group_size", "SELECT md5(email) AS h, count(*)::bigint AS group_size"),
    rule: (code) => ruleEmailOnlyAggregated(code),
  },
  {
    name: "the suppression floor lowered below 5",
    mutate: (sql) => sql.replace("SELECT 5::bigint AS min_group_size", "SELECT 1::bigint AS min_group_size"),
    rule: (code, raw) => ruleSuppressionFloor(code, raw),
  },
  {
    name: "a project ref embedded",
    mutate: (sql) => sql.replace("-- Task ID:", "-- project: abtvsrcnfwlbawvrjeed\n-- Task ID:"),
    rule: (_code, raw) => ruleNoSecretsOrProjectRefs(raw),
  },
  {
    name: "a connection string embedded",
    mutate: (sql) => sql.replace("-- Task ID:", "-- dsn: postgresql://user@host:5432/postgres\n-- Task ID:"),
    rule: (_code, raw) => ruleNoSecretsOrProjectRefs(raw),
  },
  {
    name: "a second table read",
    mutate: (sql) => sql.replace("FROM public.leads l\n),", "FROM public.leads l JOIN public.projects p ON true\n),"),
    rule: (code) => ruleTargetsOnlyLeads(code),
  },
  // --- CORRECTION 2 ---
  {
    name: "a raw source value echoed instead of categorised",
    mutate: (sql) => sql.replace("        'Other / unknown source')", "        ln.source_key)"),
    rule: (code, raw) => ruleClosedSourceVocabulary(code, raw),
  },
  {
    name: "the source vocabulary widened with an invented value",
    mutate: (sql) => sql.replace("    ('booth',                'booth'),", "    ('booth',                'booth'),\n    ('walk_in',              'walk_in'),"),
    rule: (code, raw) => ruleClosedSourceVocabulary(code, raw),
  },
  {
    name: "the source section aggregating the raw key again",
    mutate: (sql) => sql.replace(
      "  SELECT label, count(*)::bigint AS n FROM source_cat GROUP BY 1",
      "  SELECT COALESCE(source_key, 'x') AS label, count(*)::bigint AS n FROM leads_norm GROUP BY 1",
    ),
    rule: (code, raw) => ruleClosedSourceVocabulary(code, raw),
  },
  {
    name: "a raw status value echoed instead of categorised",
    mutate: (sql) => sql.replace("        'Other / unknown status')", "        ln.status_key)"),
    rule: (code, raw) => ruleClosedStatusVocabulary(code, raw),
  },
  // --- CORRECTION 3 ---
  {
    name: "the earliest month emitted without the calendar floor",
    mutate: (sql) => sql.replace(
      "       CASE WHEN (SELECT calendar_mode FROM disclosure) <> 'DISCLOSE'\n" +
      "            THEN (SELECT calendar_mode FROM disclosure)\n" +
      "            ELSE (SELECT to_char(min(created_month), 'YYYY-MM') FROM leads_norm) END,\n" +
      "       NULL, 'calendar month only; disclosed only at 5 or more total leads'",
      "       COALESCE((SELECT to_char(min(created_month), 'YYYY-MM') FROM leads_norm),\n" +
      "                'NOT_MEASURABLE_NO_DATA'),\n" +
      "       NULL, 'calendar month only'",
    ),
    rule: (code, raw) => ruleCalendarSuppression(code, raw),
  },
  {
    name: "the calendar floor reduced to an empty-table check only",
    mutate: (sql) => sql.replace(
      "      WHEN (SELECT total FROM totals) < (SELECT min_group_size FROM params)\n        THEN 'SUPPRESSED_LT_5'\n",
      "",
    ),
    rule: (code, raw) => ruleCalendarSuppression(code, raw),
  },
  // --- CORRECTION 4 ---
  {
    name: "the privilege probe narrowed back to four privileges",
    mutate: (sql) => sql.replace(
      "    ('SELECT'::text, 0), ('INSERT', 0), ('UPDATE', 0), ('DELETE', 0),\n" +
      "    ('TRUNCATE', 0), ('REFERENCES', 0), ('TRIGGER', 0), ('MAINTAIN', 170000)",
      "    ('SELECT'::text, 0), ('INSERT', 0), ('UPDATE', 0), ('DELETE', 0)",
    ),
    rule: (code, raw) => ruleFullPrivilegeSnapshot(code, raw),
  },
  {
    name: "MAINTAIN issued without a server-version guard",
    mutate: (sql) => sql.replace("('MAINTAIN', 170000)", "('MAINTAIN', 0)"),
    rule: (code, raw) => ruleFullPrivilegeSnapshot(code, raw),
  },
  {
    name: "the raw ACL emitted without the known-role gate",
    mutate: (sql) => sql.replace(
      "       CASE WHEN (SELECT ok FROM acl_disclosable)\n" +
      "            THEN COALESCE((SELECT relacl::text FROM leads_rel), '(no explicit ACL)')\n" +
      "            ELSE 'SUPPRESSED_NON_STANDARD_ROLE_IN_ACL' END,",
      "       COALESCE((SELECT relacl::text FROM leads_rel), '(no explicit ACL)'),",
    ),
    rule: (code, raw) => ruleFullPrivilegeSnapshot(code, raw),
  },
  // --- CORRECTION 5 ---
  {
    name: "the policy WITH CHECK predicate dropped from the snapshot",
    mutate: (sql) => sql.replace(
      "UNION ALL SELECT 3450, '3_SECURITY_SNAPSHOT', 'policy_with_check', pol.policyname::text, NULL,\n" +
      "       COALESCE(pol.with_check::text, '(none)'), NULL,\n" +
      "       'WITH CHECK predicate — the actual write boundary on public.leads'\n" +
      "FROM policies pol\n",
      "",
    ),
    rule: (code, raw) => ruleCompleteRlsPolicySnapshot(code, raw),
  },
  {
    name: "the policy snapshot reduced to name and command",
    mutate: (sql) => sql.replace(
      "  SELECT p.policyname, p.cmd, p.permissive, p.roles, p.qual, p.with_check",
      "  SELECT p.policyname, p.cmd",
    ),
    rule: (code, raw) => ruleCompleteRlsPolicySnapshot(code, raw),
  },
  // --- CORRECTION 6 ---
  {
    name: "a rate reported as a number on an empty table",
    mutate: (sql) => sql.replace(
      "       CASE WHEN (SELECT rate_mode FROM disclosure) = 'MEASURED'\n" +
      "            THEN round(100.0 * (SELECT count(*) FILTER (WHERE has_email) FROM leads_norm)\n" +
      "                       / (SELECT total FROM totals), 2) END,\n" +
      "       CASE WHEN (SELECT rate_mode FROM disclosure) <> 'MEASURED'\n" +
      "            THEN (SELECT rate_mode FROM disclosure) END,",
      "       COALESCE(round(100.0 * (SELECT count(*) FILTER (WHERE has_email) FROM leads_norm)\n" +
      "                / NULLIF((SELECT total FROM totals), 0), 2), 0), NULL,",
    ),
    rule: (code, raw) => ruleEmptyTableSemantics(code, raw),
  },
  {
    name: "the false blanket absence claim restored",
    mutate: (sql) => sql.replace("-- Task ID:", "-- Absence is never converted into a zero.\n-- Task ID:"),
    rule: (code, raw) => ruleEmptyTableSemantics(code, raw),
  },
  // --- CORRECTION 1 ---
  {
    name: "a historical claim the row count cannot support",
    mutate: (sql) => sql.replace("-- Task ID:", "-- Production has never received a lead.\n-- Task ID:"),
    rule: (_code, raw) => ruleNoHistoricalOverclaim(raw),
  },
  {
    name: "Gate G0 declared conclusively confirmed open",
    mutate: (sql) => sql.replace("-- Task ID:", "-- Gate G0 is conclusively confirmed open.\n-- Task ID:"),
    rule: (_code, raw) => ruleNoHistoricalOverclaim(raw),
  },
];

console.log("\nNegative fixtures (each MUST be rejected):\n");
for (const fixture of NEGATIVE_FIXTURES) {
  assertRejected(fixture, fixture.mutate(RAW));
}

function assertRejected(fixture, mutatedRaw) {
  if (mutatedRaw === RAW) {
    failures.push({ name: `rejects: ${fixture.name}`, message: "fixture mutation did not change the script" });
    console.log(`  FAIL rejects: ${fixture.name}\n         fixture mutation did not change the script`);
    return;
  }
  const mutatedCode = stripCommentsAndLiterals(mutatedRaw);
  let rejected = false;
  let detail = "";
  try {
    fixture.rule(mutatedCode, mutatedRaw);
  } catch (error) {
    rejected = true;
    detail = error.message;
  }
  if (rejected) {
    passed += 1;
    console.log(`  ok   rejects: ${fixture.name}`);
  } else {
    failures.push({ name: `rejects: ${fixture.name}`, message: "mutation was NOT rejected" });
    console.log(`  FAIL rejects: ${fixture.name}\n         mutation was NOT rejected${detail ? ` (${detail})` : ""}`);
  }
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length > 0) {
  console.error("CONTRACT TEST FAILED — the Slice 0 script must not be run or committed.\n");
  process.exit(1);
}
console.log(
  "Slice 0 SQL static contract holds: read-only, no PII, closed source/status vocabulary,\n" +
  "calendar floor applied, full privilege and policy evidence, honest counts versus rates.\n" +
  "Run crm-slice0-lead-baseline.pg.test.mjs for the executable proof.\n",
);
process.exit(0);
