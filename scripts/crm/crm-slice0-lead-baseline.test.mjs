#!/usr/bin/env node
/**
 * FOREVER-CRM-SLICE0-MEASURED-BASELINE-001 — contract test for the Slice 0
 * read-only lead baseline script.
 *
 * WHY THIS EXISTS
 * ---------------
 * `crm-slice0-lead-baseline.sql` is designed to be pasted into a PRODUCTION
 * SQL editor. The two things that must never become true of it are that it
 * writes, and that it emits personal data. This validator pins both, plus the
 * transaction discipline and the k-anonymity floor that make it safe to run.
 *
 * It parses the SQL conservatively and deliberately. A false positive here is
 * always preferable to letting a write statement or a raw personal value
 * through, so every rule fails closed: an unrecognised shape is a failure, not
 * a pass.
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
// matters: the script legitimately mentions 'INSERT', 'UPDATE' and 'DELETE' as
// quoted privilege names inside `has_table_privilege` probes, and describes
// every forbidden verb in its header comment. Stripping first means the
// keyword scan sees executable code only, and cannot be fooled by a write
// verb hidden inside a literal either.
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

const RAW = readFileSync(SQL_PATH, "utf8");
const CODE = stripCommentsAndLiterals(RAW);
const UPPER = CODE.toUpperCase();
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

function ruleReadOnlyReVerifiedInBand(code) {
  assert(
    /current_setting\(\s*''\s*\)/.test(code) || /current_setting\(/.test(code),
    "the consolidated result must re-read transaction_read_only via current_setting",
  );
  // The literal is stripped, so confirm against the raw text too.
  assert(
    /current_setting\(\s*'transaction_read_only'\s*\)/.test(RAW),
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
  const cte = code.match(/email_groups\s+AS\s*\(([\s\S]*?)\n\),/);
  assert(cte !== null, "email_groups CTE not found in the expected shape");
  const body = cte[1];
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
  const guards = code.match(/>=\s*\(\s*SELECT\s+min_group_size\s+FROM\s+params\s*\)/g) || [];
  assert(
    guards.length >= suppCtes.length,
    `every grouped section must apply the floor: ${suppCtes.length} suppressed CTEs but ${guards.length} guards`,
  );
  assert(raw.includes("Other / suppressed"), "small groups must be folded into 'Other / suppressed'");
  assert(raw.includes("SUPPRESSED_LT_5"), "small null/blank counts must report SUPPRESSED_LT_5");
}

function ruleHonestUnmeasurables(raw) {
  assert(raw.includes("NOT_MEASURABLE_FROM_CURRENT_SCHEMA"),
    "schema gaps must be reported as NOT_MEASURABLE_FROM_CURRENT_SCHEMA, never as zero");
  assert(raw.includes("NOT_MEASURABLE_NO_DATA"),
    "empty-table cases must be reported as NOT_MEASURABLE_NO_DATA, never as zero");
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
    "public.leads", "cols", "params", "leads_norm", "totals", "email_groups",
    "col_probe", "activity_tbl", "month_raw", "month_supp", "source_raw",
    "source_supp", "status_raw", "status_supp", "grant_probe", "sections",
    "generate_series",
  ]);
  for (const ref of refs) {
    const target = ref.replace(/^\s*(?:FROM|JOIN)\s+/i, "").trim();
    if (allowedPrefixes.some((p) => target.toLowerCase().startsWith(p))) continue;
    if (allowedExact.has(target)) continue;
    throw new Error(`unexpected relation referenced: ${target}`);
  }
}

// ---------------------------------------------------------------------------
// Positive assertions against the real script
// ---------------------------------------------------------------------------
console.log("\nFOREVER-CRM-SLICE0-MEASURED-BASELINE-001 — SQL contract test");
console.log(`\nScript under test: ${SQL_PATH}\n`);

check("contains no forbidden write or DDL statement", () => ruleNoForbiddenVerbs(CODE));
check("opens a transaction and sets it read only in-band", () => ruleTransactionDiscipline(CODE));
check("re-verifies transaction_read_only inside the transaction", () => ruleReadOnlyReVerifiedInBand(CODE));
check("ends with ROLLBACK and never commits", () => ruleTransactionDiscipline(CODE));
check("never selects a raw personal value", () => ruleNoRawPiiSelected(CODE));
check("uses normalized email only inside an aggregate CTE", () => ruleEmailOnlyAggregated(CODE));
check("applies the group-size-5 suppression floor everywhere", () => ruleSuppressionFloor(CODE, RAW));
check("reports unmeasurable facts honestly", () => ruleHonestUnmeasurables(RAW));
check("embeds no credential, host or project ref", () => ruleNoSecretsOrProjectRefs(RAW));
check("reads only public.leads and system catalogs", () => ruleTargetsOnlyLeads(CODE));

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
    rule: (code) => ruleSuppressionFloor(code, sqlRawFor(code)),
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
];

// The suppression rule needs the raw text; fixtures mutate raw then strip.
let currentRaw = RAW;
function sqlRawFor() { return currentRaw; }

console.log("\nNegative fixtures (each MUST be rejected):\n");
for (const fixture of NEGATIVE_FIXTURES) {
  const mutatedRaw = fixture.mutate(RAW);
  assertRejected(fixture, mutatedRaw);
}

function assertRejected(fixture, mutatedRaw) {
  currentRaw = mutatedRaw;
  const mutatedCode = stripCommentsAndLiterals(mutatedRaw);
  let rejected = false;
  let detail = "";
  try {
    fixture.rule(mutatedCode, mutatedRaw);
  } catch (error) {
    rejected = true;
    detail = error.message;
  }
  currentRaw = RAW;
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
console.log("Slice 0 SQL contract holds: read-only, no PII, suppressed, credential-free.\n");
process.exit(0);
