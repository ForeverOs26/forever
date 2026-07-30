#!/usr/bin/env node
/**
 * FOREVER-PR125-INDEPENDENT-REVIEW-CORRECTION-001 — executable privacy,
 * role/RLS and mutation fixtures for the Slice 0 read-only lead baseline.
 *
 * WHY THIS EXISTS
 * ---------------
 * `crm-slice0-lead-baseline.test.mjs` reads the SQL as text. A static rule can
 * prove that the script *says* it categorises `source`; it cannot prove what
 * the script *emits* when the table actually contains an email address in the
 * `source` column. Only running it can.
 *
 * This runner executes the EXACT checked-in script against a disposable
 * PostgreSQL cluster for the full calendar, source, status, completeness and
 * duplication matrix. It also proves ordinary-browser RLS versus BYPASSRLS
 * behavior, known/unknown ACL handling, and executable SQL/privacy mutations.
 *
 * Every value is INVENTED. No production lead is copied, read or referenced.
 * Addresses use the reserved `.invalid` TLD (RFC 2606) so nothing here can
 * resolve to a real person or host.
 *
 * CLUSTER SAFETY
 * --------------
 * A previous run of this task family connected to an ABANDONED disposable
 * cluster left behind by an unrelated harness on a hard-coded port, and issued
 * DDL against it. That must not be possible again, so this runner proves the
 * identity of the server it is talking to BEFORE it issues any DDL:
 *
 *   1  ask the OS for an actually free ephemeral port
 *   2  verify no process owns that port (a TCP connect must be refused)
 *   3  initdb a fresh PostgreSQL cluster in a private mkdtemp directory
 *   4  record the postmaster PID from postmaster.pid
 *   5  verify data_directory, over SQL, equals the directory we just created
 *   6  create and read back a unique task marker
 *   7  prove the marker round-trips, so the connection is to OUR cluster
 *   8  only then create roles, the fixture table, and rows
 *   9  stop the cluster
 *  10  remove its temporary directory
 *
 * If identity cannot be proven the runner stops without issuing DDL. It never
 * connects to a cluster it did not start, never uses a fixed port, and issues
 * no DROP of any kind — between scenarios it deletes rows from its own table.
 *
 * Usage: node scripts/crm/crm-slice0-lead-baseline.pg.test.mjs
 * Exits 0 when every fixture holds, 1 on the first failure, 2 when no
 * PostgreSQL binaries are available (set FOREVER_PG_BIN to point at them).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL_PATH = join(HERE, "crm-slice0-lead-baseline.sql");
const WINDOWS = process.platform === "win32";
const EXE = WINDOWS ? ".exe" : "";
/** Field separator for psql output. ASCII unit separator: never in our data. */
const SEP = "\u001f";

// ---------------------------------------------------------------------------
// Locate the PostgreSQL binaries, following the repository idiom.
// ---------------------------------------------------------------------------
function findBinDir() {
  const candidates = [];
  if (process.env.FOREVER_PG_BIN) {
    candidates.push(process.env.FOREVER_PG_BIN, join(process.env.FOREVER_PG_BIN, "bin"));
  }
  for (const base of [
    "C:\\Program Files\\PostgreSQL",
    "/usr/lib/postgresql",
    "/usr/pgsql",
    "/opt/homebrew/opt",
  ]) {
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base).sort().reverse()) {
      candidates.push(join(base, entry, "bin"), join(base, entry));
    }
  }
  for (const dir of candidates) {
    if (dir && existsSync(join(dir, `initdb${EXE}`)) && existsSync(join(dir, `pg_ctl${EXE}`))) {
      return dir;
    }
  }
  return "";
}

const BIN = findBinDir();
if (!BIN && !existsSync("/usr/bin/initdb")) {
  console.log("[crm-pg] no PostgreSQL binaries found; set FOREVER_PG_BIN. Skipping.");
  process.exit(2);
}
const bin = (name) => (BIN ? join(BIN, `${name}${EXE}`) : name);

// ---------------------------------------------------------------------------
// Assertion harness
// ---------------------------------------------------------------------------
let passed = 0;
const failures = [];
const results = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function check(scenario, name, fn) {
  try {
    fn();
    passed += 1;
    results.push({ scenario, name, ok: true });
    console.log(`    ok   ${name}`);
  } catch (error) {
    failures.push({ scenario, name, message: error.message });
    results.push({ scenario, name, ok: false, message: error.message });
    console.log(`    FAIL ${name}\n           ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// STEP 1-2 — an actually free port that nothing owns.
// ---------------------------------------------------------------------------
function ephemeralPort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

function portIsOwned(port) {
  return new Promise((res) => {
    const sock = connect({ host: "127.0.0.1", port });
    const settle = (owned) => { sock.destroy(); res(owned); };
    sock.setTimeout(1000);
    sock.once("connect", () => settle(true));
    sock.once("timeout", () => settle(true));
    sock.once("error", () => settle(false));
  });
}

async function claimFreePort() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const port = await ephemeralPort();
    if (await portIsOwned(port)) {
      console.log(`[crm-pg] port ${port} is owned by another process; trying another`);
      continue;
    }
    return port;
  }
  throw new Error("could not obtain a free loopback port after 12 attempts");
}

// ---------------------------------------------------------------------------
// Cluster lifecycle
// ---------------------------------------------------------------------------
const work = mkdtempSync(join(tmpdir(), "forever-crm-slice0-"));
const data = join(work, "data");
const logFile = join(work, "postgres.log");
const TASK_TOKEN = `crm_slice0_correction_${process.pid}_${process.hrtime.bigint().toString(36)}`;
const TASK_DB = `crm_slice0_${process.pid}`;
let PORT = 0;
let postmasterPid = 0;
let started = false;

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: "pipe", encoding: "utf8", ...opts });
}

function psqlRaw(db, args) {
  return run(bin("psql"), [
    "-h", "127.0.0.1", "-p", String(PORT), "-U", "postgres", "-d", db,
    "-v", "ON_ERROR_STOP=1", "-X", "-q", ...args,
  ]);
}

/** One scalar, untitled and unaligned. */
function scalar(db, sql) {
  return psqlRaw(db, ["-t", "-A", "-c", sql]).trim();
}

function exec(db, sql) {
  return psqlRaw(db, ["-c", sql]);
}

function stopCluster() {
  if (!started) return;
  try {
    run(bin("pg_ctl"), ["-D", data, "-w", "-m", "immediate", "stop"],
      WINDOWS ? { stdio: "ignore" } : {});
  } catch {
    // Already gone. The directory removal below is the backstop.
  }
  started = false;
}

function cleanup() {
  stopCluster();
  try { rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ }
}

process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

// ---------------------------------------------------------------------------
// Result parsing
// ---------------------------------------------------------------------------
function runBaselineScript(scriptPath = SQL_PATH) {
  const out = psqlRaw(TASK_DB, ["-t", "-A", "-F", SEP, "-f", scriptPath]);
  const lines = out.split(/\r?\n/).filter((l) => l.length > 0);
  const rows = [];
  let readOnlyProof = null;
  for (const line of lines) {
    const parts = line.split(SEP);
    if (parts.length === 1) {
      // The in-band `SHOW transaction_read_only` result.
      if (readOnlyProof === null) readOnlyProof = parts[0].trim();
      continue;
    }
    if (parts.length !== 7) continue;
    rows.push({
      section: parts[0], metric: parts[1], label: parts[2],
      value_num: parts[3], value_text: parts[4], pct: parts[5], note: parts[6],
      raw: line,
    });
  }
  return { rows, readOnlyProof, text: out };
}

const find = (rows, metric, label = null) =>
  rows.find((r) => r.metric === metric && (label === null || r.label === label));
const all = (rows, metric) => rows.filter((r) => r.metric === metric);

// ---------------------------------------------------------------------------
// Invented synthetic values. Nothing here comes from production.
// `.invalid` is the RFC 2606 reserved TLD, so none of it can resolve.
// ---------------------------------------------------------------------------
const UNKNOWN_SOURCE_PLAIN = "whatsapp_broadcast_2026";
const UNKNOWN_SOURCE_EMAIL = "leaked.person@example.invalid";
const UNKNOWN_SOURCE_URL = "https://tracker.example.invalid/campaign?ref=7";
const UNKNOWN_SOURCE_PHONE = "+66000000199";
const UNKNOWN_SOURCE_PERSON = "Synthetic Source Person";
const UNKNOWN_SOURCE_MULTILINE = "line one\nline two";
const UNKNOWN_SOURCE_SQL = "SELECT secret FROM people; --";
const UNKNOWN_SOURCE_HTML = "<img src=x onerror=alert(1)>";
const UNKNOWN_SOURCE_UNICODE = "แหล่งที่มา-未知-🙂";
const UNKNOWN_SOURCE_LONG = `long-${"x".repeat(5000)}`;
const UNKNOWN_STATUS = "archived_by_hand";

/** Every invented value that must never appear in the script's output. */
const SECRETS_THAT_MUST_NOT_LEAK = [
  UNKNOWN_SOURCE_PLAIN, UNKNOWN_SOURCE_EMAIL, UNKNOWN_SOURCE_URL,
  UNKNOWN_SOURCE_PHONE, UNKNOWN_SOURCE_PERSON, UNKNOWN_SOURCE_MULTILINE,
  UNKNOWN_SOURCE_SQL, UNKNOWN_SOURCE_HTML, UNKNOWN_SOURCE_UNICODE,
  UNKNOWN_SOURCE_LONG, UNKNOWN_STATUS,
];

let seq = 0;
function lead(overrides = {}) {
  seq += 1;
  const month = overrides.month ?? "2026-03";
  const row = {
    name: `Synthetic Person ${seq}`,
    email: `synthetic.person.${seq}@example.invalid`,
    phone: `+6600000${String(1000 + seq)}`,
    country: "Invented Country",
    budget: "Invented budget band",
    interest: "Invented interest",
    project_slug: `invented-project-${seq}`,
    message: `Invented fixture message ${seq}`,
    status: "new",
    source: "contact_form",
    created_at: `${month}-15T09:00:00Z`,
  };
  const { month: _month, ...fields } = overrides;
  return { ...row, ...fields };
}

function pii(rows) {
  const values = [];
  for (const r of rows) {
    values.push(r.name, r.email, r.phone, r.country, r.budget, r.interest, r.project_slug, r.message);
  }
  return values.filter((value) => typeof value === "string" && value.length > 0);
}

const q = (v) => v === null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;

function seed(rows) {
  exec(TASK_DB, "DELETE FROM public.leads;");
  if (rows.length === 0) return;
  const tuples = rows.map((r) =>
    `(${q(r.name)}, ${q(r.email)}, ${q(r.phone)}, ${q(r.country)}, ${q(r.budget)}, ` +
    `${q(r.interest)}, ${q(r.project_slug)}, ${q(r.message)}, ${q(r.status)}, ${q(r.source)}, ` +
    `${q(r.created_at)}::timestamptz)`).join(",\n  ");
  exec(TASK_DB,
    "INSERT INTO public.leads " +
    "(name, email, phone, country, budget, interest, project_slug, message, status, source, created_at) " +
    `VALUES\n  ${tuples};`);
}

// ---------------------------------------------------------------------------
// Assertions every scenario must satisfy, whatever the table contains.
// ---------------------------------------------------------------------------
const REQUIRED_PRIVILEGES = [
  "SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN",
];
const REQUIRED_ROLES = ["anon", "authenticated", "service_role"];
const MONTH_SHAPE = /\b(19|20)\d{2}-(0[1-9]|1[0-2])\b/;

function universalAssertions(scenario, rows, out, seeded) {
  check(scenario, "the transaction reported itself read-only in band", () => {
    assert(out.readOnlyProof === "on",
      `expected transaction_read_only = on, got ${JSON.stringify(out.readOnlyProof)}`);
  });

  check(scenario, "no invented personal value appears anywhere in the output", () => {
    for (const value of pii(seeded)) {
      assert(!out.text.includes(value),
        `personal value leaked into the output: ${JSON.stringify(value)}`);
    }
  });

  check(scenario, "no raw unknown source or status text appears in the output", () => {
    for (const value of SECRETS_THAT_MUST_NOT_LEAK) {
      assert(!out.text.includes(value),
        `unconstrained column value leaked into the output: ${JSON.stringify(value)}`);
    }
  });

  check(scenario, "the full privilege matrix is present for every role", () => {
    for (const role of REQUIRED_ROLES) {
      for (const priv of REQUIRED_PRIVILEGES) {
        const row = find(rows, "effective_privilege", `${role}.${priv}`);
        assert(row !== undefined, `missing privilege row for ${role}.${priv}`);
        assert(/granted|not granted|NOT_SUPPORTED_BY_SERVER_VERSION/.test(row.value_text),
          `privilege row ${role}.${priv} has no state: ${row.value_text}`);
        assert(/from_relation_acl (true|false)/.test(row.value_text),
          `privilege row ${role}.${priv} does not say whether it comes from the relation ACL`);
      }
    }
  });

  check(scenario, "the relation ACL is reported with its grantor", () => {
    const aclRows = all(rows, "acl_privilege");
    assert(aclRows.length > 0, "no acl_privilege rows were emitted");
    assert(aclRows.every((r) => /grantor /.test(r.value_text)),
      "an acl_privilege row omits its grantor");
    const raw = find(rows, "relation_acl_raw");
    assert(raw !== undefined, "relation_acl_raw was not emitted");
    assert(raw.value_text.length > 0, "relation_acl_raw is empty");
  });

  check(scenario, "the complete RLS policy snapshot is present", () => {
    for (const metric of ["policy_command", "policy_mode", "policy_roles", "policy_qual", "policy_with_check"]) {
      const row = find(rows, metric);
      assert(row !== undefined, `missing ${metric}`);
    }
    const withCheck = find(rows, "policy_with_check");
    assert(/status/.test(withCheck.value_text),
      `the WITH CHECK predicate did not reach the output: ${withCheck.value_text}`);
    const qual = find(rows, "policy_qual");
    assert(qual.value_text.length > 0, "policy_qual is empty rather than '(none)'");
  });

  check(scenario, "role bypass and relation-owner facts are present", () => {
    const service = find(rows, "role_security_properties", "service_role");
    const owner = all(rows, "role_security_properties").find((r) => /owns_relation true/.test(r.value_text));
    const anon = find(rows, "role_security_properties", "anon");
    assert(service !== undefined && /bypassrls true/.test(service.value_text),
      `service_role BYPASSRLS fact missing: ${service?.value_text}`);
    assert(owner !== undefined && /superuser true/.test(owner.value_text),
      `relation-owner/superuser fact missing: ${owner?.value_text}`);
    assert(anon !== undefined && /bypassrls false/.test(anon.value_text),
      `anon role property row missing: ${anon?.value_text}`);
    assert(find(rows, "relation_owner") !== undefined, "relation_owner row missing");
    assert(/ordinary RLS path/.test(find(rows, "rls_select_boundary")?.value_text ?? ""),
      "role-accurate RLS boundary wording missing");
  });
}

/**
 * No LEAD calendar value may appear anywhere when the table is below the floor.
 *
 * `1_SAFETY_PROOF/measured_at_utc` is deliberately exempt: it is the server
 * clock at the moment the measurement ran — provenance for the result, not a
 * fact about any lead. It is identical whether the table holds zero rows or a
 * million, so it discloses nothing about the data. Every other field is
 * scanned, including labels, so a month can only appear where the floor allows.
 */
const PROVENANCE_EXEMPT = new Set(["measured_at_utc"]);

function assertNoMonthAnywhere(scenario, rows, why) {
  check(scenario, `no lead calendar month appears anywhere in the output (${why})`, () => {
    for (const r of rows) {
      if (r.section === "1_SAFETY_PROOF" && PROVENANCE_EXEMPT.has(r.metric)) continue;
      for (const field of [r.label, r.value_text]) {
        assert(!MONTH_SHAPE.test(field ?? ""),
          `a calendar month leaked through ${r.section}/${r.metric}: ${JSON.stringify(field)}`);
      }
    }
  });
}

function assertSuppressedMetric(scenario, rows, metric, label = null) {
  check(scenario, `${metric}${label === null ? "" : `/${label}`} is SUPPRESSED_LT_5 with no number`, () => {
    const row = find(rows, metric, label);
    assert(row !== undefined, `missing ${metric}${label === null ? "" : `/${label}`}`);
    assert(row.value_text === "SUPPRESSED_LT_5", `expected SUPPRESSED_LT_5, got ${row.value_text}`);
    assert(row.value_num === "" && row.pct === "", `suppressed row carried a number: ${row.raw}`);
  });
}

function assertDimensionSuppressed(scenario, rows, metric) {
  check(scenario, `${metric} is one fixed dimension-level suppression row`, () => {
    const dimensionRows = all(rows, metric);
    assert(dimensionRows.length === 1, `expected one row, got ${dimensionRows.length}`);
    const [row] = dimensionRows;
    assert(row.label === "", `suppressed dimension exposed label ${JSON.stringify(row.label)}`);
    assert(row.value_num === "" && row.pct === "", `suppressed dimension exposed a number: ${row.raw}`);
    assert(row.value_text === "SUPPRESSED_LT_5", `expected SUPPRESSED_LT_5, got ${row.value_text}`);
  });
}

function assertDimensionReleased(scenario, rows, metric, expected) {
  check(scenario, `${metric} releases exactly the expected safe buckets`, () => {
    const actual = all(rows, metric).map((r) => [r.label, r.value_num, r.pct]);
    assert(JSON.stringify(actual) === JSON.stringify(expected),
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  });
}

function rowsWithEmailGroups(groupSizes, uniqueCount = 0, extra = {}) {
  const rows = [];
  groupSizes.forEach((size, groupIndex) => {
    const email = `duplicate.group.${groupIndex + 1}@example.invalid`;
    for (let i = 0; i < size; i += 1) rows.push(lead({ ...extra, email }));
  });
  for (let i = 0; i < uniqueCount; i += 1) rows.push(lead(extra));
  return rows;
}

// ---------------------------------------------------------------------------
// The fourteen scenarios
// ---------------------------------------------------------------------------
function scenarios() {
  const known = (n, source, month = "2026-03") =>
    Array.from({ length: n }, () => lead({ source, month }));
  const mixed = (knownCount, unknownCount, field, unknownValue, extra = {}) => [
    ...Array.from({ length: knownCount }, () => lead(extra)),
    ...Array.from({ length: unknownCount }, () => lead({ ...extra, [field]: unknownValue })),
  ];
  const sourceShapes = [
    ["email", UNKNOWN_SOURCE_EMAIL],
    ["phone", UNKNOWN_SOURCE_PHONE],
    ["URL", UNKNOWN_SOURCE_URL],
    ["person name", UNKNOWN_SOURCE_PERSON],
    ["multiline", UNKNOWN_SOURCE_MULTILINE],
    ["SQL-shaped", UNKNOWN_SOURCE_SQL],
    ["HTML", UNKNOWN_SOURCE_HTML],
    ["Unicode", UNKNOWN_SOURCE_UNICODE],
    ["very long", UNKNOWN_SOURCE_LONG],
  ].map(([shape, value]) => ({
    name: `source shape · ${shape}`,
    rows: Array.from({ length: 5 }, () => lead({ source: value, month: "2026-08" })),
    assert: (s, rows) => {
      check(s, `${shape} source is fixed-vocabulary output only`, () => {
        const row = find(rows, "leads_from_source", "Other / unknown source");
        assert(row?.value_num === "5", `expected safe unknown-source count 5, got ${row?.raw}`);
        assert(!rows.some((r) => `${r.label}${r.value_text}`.includes(value)),
          `${shape} source escaped into output`);
      });
    },
  }));

  return [
    {
      name: "1 · zero rows",
      rows: [],
      assert: (s, rows) => {
        check(s, "total_leads is a factual numeric zero", () => {
          assert(find(rows, "total_leads").value_num === "0",
            `expected 0, got ${JSON.stringify(find(rows, "total_leads").value_num)}`);
        });
        check(s, "every non-total cohort metric is withheld on an empty table", () => {
          for (const metric of ["months_containing_leads", "with_email", "email_completeness_rate", "phone_completeness_rate", "duplicate_rate"]) {
            const row = find(rows, metric);
            assert(row !== undefined, `missing ${metric}`);
            assert(row.value_text === "NOT_MEASURABLE_NO_DATA",
              `${metric} should be NOT_MEASURABLE_NO_DATA, got ${JSON.stringify(row.value_text)}`);
            assert(row.value_num === "", `${metric} must not carry a number, got ${row.value_num}`);
          }
        });
        check(s, "every calendar output reports NOT_MEASURABLE_NO_DATA", () => {
          for (const metric of ["earliest_lead_month", "latest_lead_month", "lead_month_range"]) {
            assert(find(rows, metric).value_text === "NOT_MEASURABLE_NO_DATA",
              `${metric} should be NOT_MEASURABLE_NO_DATA`);
          }
        });
        check(s, "grouped sections report NOT_MEASURABLE_NO_DATA", () => {
          for (const metric of ["leads_in_month", "leads_from_source", "leads_with_status"]) {
            const group = all(rows, metric);
            assert(group.length === 1 && group[0].value_text === "NOT_MEASURABLE_NO_DATA",
              `${metric} should be a single NOT_MEASURABLE_NO_DATA row`);
          }
        });
        assertNoMonthAnywhere(s, rows, "empty table");
      },
    },
    {
      name: "2 · one row",
      rows: [lead({ month: "2026-04" })],
      assert: (s, rows) => {
        check(s, "total_leads is the factual count 1", () => {
          assert(find(rows, "total_leads").value_num === "1", "expected 1");
        });
        check(s, "every calendar output is SUPPRESSED_LT_5", () => {
          for (const metric of ["earliest_lead_month", "latest_lead_month", "lead_month_range"]) {
            assert(find(rows, metric).value_text === "SUPPRESSED_LT_5",
              `${metric} should be SUPPRESSED_LT_5, got ${JSON.stringify(find(rows, metric).value_text)}`);
          }
        });
        assertDimensionSuppressed(s, rows, "leads_in_month");
        assertNoMonthAnywhere(s, rows, "one row");
      },
    },
    {
      name: "3 · four rows",
      rows: Array.from({ length: 4 }, () => lead({ month: "2026-05" })),
      assert: (s, rows) => {
        check(s, "total_leads is the factual count 4", () => {
          assert(find(rows, "total_leads").value_num === "4", "expected 4");
        });
        check(s, "every calendar output is still SUPPRESSED_LT_5 at four rows", () => {
          for (const metric of ["earliest_lead_month", "latest_lead_month", "lead_month_range"]) {
            assert(find(rows, metric).value_text === "SUPPRESSED_LT_5", `${metric} should be SUPPRESSED_LT_5`);
          }
        });
        assertNoMonthAnywhere(s, rows, "four rows");
      },
    },
    {
      name: "4 · five rows",
      rows: known(5, "contact_page", "2026-06"),
      assert: (s, rows) => {
        check(s, "the exact month is disclosed at five rows", () => {
          assert(find(rows, "earliest_lead_month").value_text === "2026-06",
            `expected 2026-06, got ${JSON.stringify(find(rows, "earliest_lead_month").value_text)}`);
          assert(find(rows, "latest_lead_month").value_text === "2026-06", "expected 2026-06");
          assert(find(rows, "lead_month_range").value_text === "2026-06 .. 2026-06", "expected the range");
        });
        check(s, "rates become measurable once rows exist", () => {
          const rate = find(rows, "email_completeness_rate");
          assert(rate.value_text === "", `expected a number, got marker ${rate.value_text}`);
          assert(rate.value_num === "100.00", `expected 100.00, got ${rate.value_num}`);
        });
      },
    },
    {
      name: "5 · five known-source rows",
      rows: known(5, "booth", "2026-06"),
      assert: (s, rows) => {
        check(s, "a repository-confirmed source keeps its own safe label", () => {
          const row = find(rows, "leads_from_source", "booth");
          assert(row !== undefined, `expected a 'booth' row, got ${all(rows, "leads_from_source").map((r) => r.label).join(", ")}`);
          assert(row.value_num === "5", `expected 5, got ${row.value_num}`);
        });
      },
    },
    {
      name: "6 · five rows with an unknown source",
      rows: known(5, UNKNOWN_SOURCE_PLAIN, "2026-06"),
      assert: (s, rows) => {
        check(s, "an unrecognised source is categorised, never echoed", () => {
          const row = find(rows, "leads_from_source", "Other / unknown source");
          assert(row !== undefined, "expected the fixed 'Other / unknown source' label");
          assert(row.value_num === "5", `expected 5, got ${row.value_num}`);
          assert(find(rows, "leads_from_source", UNKNOWN_SOURCE_PLAIN) === undefined,
            "the raw source value must never become a label");
        });
      },
    },
    {
      name: "7 · five rows whose source contains email-shaped text",
      rows: known(5, UNKNOWN_SOURCE_EMAIL, "2026-06"),
      assert: (s, rows) => {
        check(s, "email-shaped source text never reaches the output", () => {
          assert(find(rows, "leads_from_source", "Other / unknown source") !== undefined,
            "expected the fixed unknown-source label");
          for (const r of rows) {
            assert(!/@example\.invalid/.test(`${r.label}${r.value_text}`),
              `an email-shaped value reached ${r.section}/${r.metric}`);
          }
        });
      },
    },
    {
      name: "8 · five rows whose source contains URL-shaped text",
      rows: known(5, UNKNOWN_SOURCE_URL, "2026-06"),
      assert: (s, rows) => {
        check(s, "URL-shaped source text never reaches the output", () => {
          assert(find(rows, "leads_from_source", "Other / unknown source") !== undefined,
            "expected the fixed unknown-source label");
          for (const r of rows) {
            assert(!/https?:\/\//.test(`${r.label}${r.value_text}`),
              `a URL-shaped value reached ${r.section}/${r.metric}`);
          }
        });
      },
    },
    {
      name: "9 · mixed known and unknown statuses",
      rows: [
        ...Array.from({ length: 5 }, () => lead({ month: "2026-06", status: "new" })),
        ...Array.from({ length: 5 }, () => lead({ month: "2026-06", status: UNKNOWN_STATUS })),
      ],
      assert: (s, rows) => {
        check(s, "a constraint-permitted status keeps its own label", () => {
          const row = find(rows, "leads_with_status", "new");
          assert(row !== undefined, "expected a 'new' status row");
          assert(row.value_num === "5", `expected 5, got ${row.value_num}`);
        });
        check(s, "an unexpected live status is grouped, never echoed", () => {
          const row = find(rows, "leads_with_status", "Other / unknown status");
          assert(row !== undefined, "expected the fixed 'Other / unknown status' label");
          assert(row.value_num === "5", `expected 5, got ${row.value_num}`);
          assert(find(rows, "leads_with_status", UNKNOWN_STATUS) === undefined,
            "the raw status value must never become a label");
        });
        check(s, "status variation is reported as measurable", () => {
          assert(find(rows, "status_has_meaningful_variation").value_text === "true",
            "two distinct statuses should read as meaningful variation");
        });
      },
    },
    {
      name: "10 · three rows in a single month",
      rows: Array.from({ length: 3 }, () => lead({ month: "2026-07" })),
      assert: (s, rows) => {
        assertDimensionSuppressed(s, rows, "leads_in_month");
        assertSuppressedMetric(s, rows, "earliest_lead_month");
        assertNoMonthAnywhere(s, rows, "three rows in one month");
      },
    },
    {
      name: "11 · five rows in one month",
      rows: Array.from({ length: 5 }, () => lead({ month: "2026-02" })),
      assert: (s, rows) => {
        check(s, "a month at the floor is disclosed with its exact count", () => {
          const row = find(rows, "leads_in_month", "2026-02");
          assert(row !== undefined,
            `expected the exact month, got ${all(rows, "leads_in_month").map((r) => r.label).join(", ")}`);
          assert(row.value_num === "5", `expected 5, got ${row.value_num}`);
          assert(row.pct === "100.00", `expected 100.00 percent, got ${row.pct}`);
        });
      },
    },
    {
      name: "12 · five rows split across months",
      rows: [
        ...Array.from({ length: 3 }, () => lead({ month: "2026-01" })),
        ...Array.from({ length: 2 }, () => lead({ month: "2026-02" })),
      ],
      assert: (s, rows) => {
        assertDimensionSuppressed(s, rows, "leads_in_month");
        for (const metric of ["earliest_lead_month", "latest_lead_month", "lead_month_range", "months_containing_leads"]) {
          assertSuppressedMetric(s, rows, metric);
        }
        assertNoMonthAnywhere(s, rows, "3+2 split");
      },
    },
    {
      name: "13 · duplicate-email groups",
      rows: [
        ...Array.from({ length: 3 }, () => lead({ month: "2026-06", email: "repeat.one@example.invalid" })),
        ...Array.from({ length: 3 }, () => lead({ month: "2026-06", email: "repeat.two@example.invalid" })),
      ],
      assert: (s, rows) => {
        for (const metric of ["normalized_emails_seen_more_than_once", "rows_in_duplicated_email_groups", "duplicate_rate"]) {
          assertSuppressedMetric(s, rows, metric);
        }
        check(s, "maximum duplicate group size is not emitted", () => {
          assert(find(rows, "max_duplicate_group_size") === undefined, "unsafe maximum group size row remains");
        });
        check(s, "no repeated address appears in the output", () => {
          for (const r of rows) {
            assert(!/repeat\.(one|two)/.test(`${r.label}${r.value_text}`),
              `an address reached ${r.section}/${r.metric}`);
          }
        });
      },
    },
    {
      name: "14 · no duplicate-email groups",
      rows: Array.from({ length: 5 }, () => lead({ month: "2026-06" })),
      assert: (s, rows) => {
        check(s, "zero duplicate groups is a factual zero", () => {
          assert(find(rows, "normalized_emails_seen_more_than_once").value_num === "0", "expected 0");
          assert(find(rows, "rows_in_duplicated_email_groups").value_num === "0", "expected 0");
        });
        check(s, "the duplicate rate is measured, not marked unmeasurable", () => {
          const rate = find(rows, "duplicate_rate");
          assert(rate.value_text === "", `expected a number, got ${rate.value_text}`);
          assert(rate.value_num === "0.00", `expected 0.00, got ${rate.value_num}`);
        });
        check(s, "distinct emails are counted", () => {
          assert(find(rows, "distinct_normalized_emails").value_num === "5", "expected 5");
        });
      },
    },
    {
      name: "calendar · ten rows split 5+5",
      rows: [
        ...Array.from({ length: 5 }, () => lead({ month: "2026-01" })),
        ...Array.from({ length: 5 }, () => lead({ month: "2026-02" })),
      ],
      assert: (s, rows) => {
        check(s, "both floor-sized months and summaries are released", () => {
          assert(find(rows, "leads_in_month", "2026-01")?.value_num === "5", "January 5 missing");
          assert(find(rows, "leads_in_month", "2026-02")?.value_num === "5", "February 5 missing");
          assert(find(rows, "earliest_lead_month")?.value_text === "2026-01", "earliest month missing");
          assert(find(rows, "latest_lead_month")?.value_text === "2026-02", "latest month missing");
          assert(find(rows, "months_containing_leads")?.value_num === "2", "safe distinct-month count missing");
        });
      },
    },
    {
      name: "calendar · twelve rows split 10+2",
      rows: [
        ...Array.from({ length: 10 }, () => lead({ month: "2026-01" })),
        ...Array.from({ length: 2 }, () => lead({ month: "2026-02" })),
      ],
      assert: (s, rows) => {
        assertDimensionSuppressed(s, rows, "leads_in_month");
        for (const metric of ["earliest_lead_month", "latest_lead_month", "lead_month_range", "months_containing_leads"]) {
          assertSuppressedMetric(s, rows, metric);
        }
        assertNoMonthAnywhere(s, rows, "10+2 split");
      },
    },
    {
      name: "source · one unknown beside ten known",
      rows: mixed(10, 1, "source", UNKNOWN_SOURCE_PLAIN, { month: "2026-08" }),
      assert: (s, rows) => {
        assertDimensionSuppressed(s, rows, "leads_from_source");
        assertSuppressedMetric(s, rows, "source_attribution_exists");
      },
    },
    {
      name: "source · four unknown beside ten known",
      rows: mixed(10, 4, "source", UNKNOWN_SOURCE_PLAIN, { month: "2026-08" }),
      assert: (s, rows) => assertDimensionSuppressed(s, rows, "leads_from_source"),
    },
    {
      name: "source · five unknown beside five known",
      rows: mixed(5, 5, "source", UNKNOWN_SOURCE_PLAIN, { month: "2026-08" }),
      assert: (s, rows) => {
        check(s, "both source cohorts at five are released", () => {
          assert(find(rows, "leads_from_source", "contact_form")?.value_num === "5", "known source 5 missing");
          assert(find(rows, "leads_from_source", "Other / unknown source")?.value_num === "5", "unknown source 5 missing");
        });
      },
    },
    ...sourceShapes,
    {
      name: "status · all known",
      rows: Array.from({ length: 5 }, () => lead({ status: "qualified", month: "2026-08" })),
      assert: (s, rows) => {
        assertDimensionReleased(s, rows, "leads_with_status", [["qualified", "5", "100.00"]]);
        check(s, "single safe status reports no variation", () => {
          assert(find(rows, "status_has_meaningful_variation")?.value_text === "false", "expected false");
        });
      },
    },
    {
      name: "status · one unknown beside ten known",
      rows: mixed(10, 1, "status", UNKNOWN_STATUS, { month: "2026-08" }),
      assert: (s, rows) => {
        assertDimensionSuppressed(s, rows, "leads_with_status");
        assertSuppressedMetric(s, rows, "status_has_meaningful_variation");
      },
    },
    {
      name: "status · four unknown beside ten known",
      rows: mixed(10, 4, "status", UNKNOWN_STATUS, { month: "2026-08" }),
      assert: (s, rows) => assertDimensionSuppressed(s, rows, "leads_with_status"),
    },
    {
      name: "status · five unknown beside five known",
      rows: mixed(5, 5, "status", UNKNOWN_STATUS, { month: "2026-08" }),
      assert: (s, rows) => {
        check(s, "both status cohorts at five are released", () => {
          assert(find(rows, "leads_with_status", "new")?.value_num === "5", "known status 5 missing");
          assert(find(rows, "leads_with_status", "Other / unknown status")?.value_num === "5", "unknown status 5 missing");
          assert(find(rows, "status_has_meaningful_variation")?.value_text === "true", "safe variation missing");
        });
      },
    },
    {
      name: "status · multiple large statuses plus one small",
      rows: [
        ...Array.from({ length: 5 }, () => lead({ status: "new", month: "2026-08" })),
        ...Array.from({ length: 5 }, () => lead({ status: "contacted", month: "2026-08" })),
        ...Array.from({ length: 2 }, () => lead({ status: UNKNOWN_STATUS, month: "2026-08" })),
      ],
      assert: (s, rows) => {
        assertDimensionSuppressed(s, rows, "leads_with_status");
        assertSuppressedMetric(s, rows, "status_has_meaningful_variation");
      },
    },
    {
      name: "completeness · one missing message",
      rows: [
        lead({ message: "", month: "2026-08" }),
        ...Array.from({ length: 9 }, () => lead({ month: "2026-08" })),
      ],
      assert: (s, rows) => assertSuppressedMetric(s, rows, "null_or_blank_count", "message"),
    },
    {
      name: "completeness · four missing messages",
      rows: [
        ...Array.from({ length: 4 }, () => lead({ message: "", month: "2026-08" })),
        ...Array.from({ length: 6 }, () => lead({ month: "2026-08" })),
      ],
      assert: (s, rows) => assertSuppressedMetric(s, rows, "null_or_blank_count", "message"),
    },
    {
      name: "completeness · five missing and five present messages",
      rows: [
        ...Array.from({ length: 5 }, () => lead({ message: "", month: "2026-08" })),
        ...Array.from({ length: 5 }, () => lead({ month: "2026-08" })),
      ],
      assert: (s, rows) => {
        check(s, "missing-message partition 5+5 is released", () => {
          const row = find(rows, "null_or_blank_count", "message");
          assert(row?.value_num === "5" && row.pct === "50.00", `expected 5/50%, got ${row?.raw}`);
        });
      },
    },
    {
      name: "completeness · one missing email cannot be inferred from present count",
      rows: [
        lead({ email: "", month: "2026-08" }),
        ...Array.from({ length: 9 }, () => lead({ month: "2026-08" })),
      ],
      assert: (s, rows) => {
        for (const metric of ["with_email", "email_completeness_rate", "distinct_normalized_emails"]) {
          assertSuppressedMetric(s, rows, metric);
        }
        assertSuppressedMetric(s, rows, "null_or_blank_count", "email");
      },
    },
    {
      name: "completeness · both versus without-both complement leak",
      rows: [
        lead({ email: "", phone: "", month: "2026-08" }),
        ...Array.from({ length: 9 }, () => lead({ month: "2026-08" })),
      ],
      assert: (s, rows) => {
        assertSuppressedMetric(s, rows, "with_email_and_phone");
        assertSuppressedMetric(s, rows, "with_neither_email_nor_phone");
      },
    },
    {
      name: "duplicates · one group of two",
      rows: rowsWithEmailGroups([2], 8, { month: "2026-08" }),
      assert: (s, rows) => {
        for (const metric of ["normalized_emails_seen_more_than_once", "rows_in_duplicated_email_groups", "duplicate_rate"]) {
          assertSuppressedMetric(s, rows, metric);
        }
      },
    },
    {
      name: "duplicates · one group of four",
      rows: rowsWithEmailGroups([4], 6, { month: "2026-08" }),
      assert: (s, rows) => {
        for (const metric of ["normalized_emails_seen_more_than_once", "rows_in_duplicated_email_groups", "duplicate_rate"]) {
          assertSuppressedMetric(s, rows, metric);
        }
      },
    },
    {
      name: "duplicates · one group of five",
      rows: rowsWithEmailGroups([5], 5, { month: "2026-08" }),
      assert: (s, rows) => {
        for (const metric of ["normalized_emails_seen_more_than_once", "rows_in_duplicated_email_groups", "duplicate_rate"]) {
          assertSuppressedMetric(s, rows, metric);
        }
      },
    },
    {
      name: "duplicates · four duplicate groups",
      rows: rowsWithEmailGroups([2, 2, 2, 2], 2, { month: "2026-08" }),
      assert: (s, rows) => assertSuppressedMetric(s, rows, "normalized_emails_seen_more_than_once"),
    },
    {
      name: "duplicates · five groups but small non-duplicate complement",
      rows: rowsWithEmailGroups([2, 2, 2, 2, 2], 2, { month: "2026-08" }),
      assert: (s, rows) => {
        for (const metric of ["normalized_emails_seen_more_than_once", "rows_in_duplicated_email_groups", "duplicate_rate"]) {
          assertSuppressedMetric(s, rows, metric);
        }
      },
    },
    {
      name: "duplicates · five groups and safe duplicated/non-duplicated cohorts",
      rows: rowsWithEmailGroups([2, 2, 2, 2, 2], 5, { month: "2026-08" }),
      assert: (s, rows) => {
        check(s, "five groups, ten duplicated rows and five non-duplicated rows are released", () => {
          assert(find(rows, "normalized_emails_seen_more_than_once")?.value_num === "5", "expected five groups");
          assert(find(rows, "rows_in_duplicated_email_groups")?.value_num === "10", "expected ten duplicated rows");
          assert(find(rows, "duplicate_rate")?.value_num === "66.67", "expected 66.67 percent");
        });
      },
    },
    {
      name: "duplicates · duplicated-row cohort of four",
      rows: rowsWithEmailGroups([2, 2], 6, { month: "2026-08" }),
      assert: (s, rows) => assertSuppressedMetric(s, rows, "rows_in_duplicated_email_groups"),
    },
    {
      name: "duplicates · duplicated-row cohort of five",
      rows: rowsWithEmailGroups([2, 3], 5, { month: "2026-08" }),
      assert: (s, rows) => {
        assertSuppressedMetric(s, rows, "rows_in_duplicated_email_groups");
        assertSuppressedMetric(s, rows, "normalized_emails_seen_more_than_once");
      },
    },
  ];
}

const runtimeControls = {
  role_security: {},
  sql_mutations: {},
  mutation_injection: {},
};

function expectSqlFailure(name, sql, expected) {
  let output = "";
  try {
    psqlRaw(TASK_DB, ["-c", sql]);
  } catch (error) {
    output = `${error.stdout ?? ""}\n${error.stderr ?? ""}\n${error.message ?? ""}`;
  }
  assert(output.length > 0, `${name} unexpectedly succeeded`);
  assert(expected.test(output), `${name} failed for the wrong reason: ${output.replace(/\s+/g, " ").slice(0, 300)}`);
  runtimeControls.sql_mutations[name] = { rejected: true, expected_error: expected.source };
}

// ---------------------------------------------------------------------------
// Newline-independent SQL mutation
// ---------------------------------------------------------------------------
/**
 * A privacy-weakening fixture is only a control if the weakening actually
 * reaches the SQL, and that turns out to be a cross-platform problem rather
 * than a cosmetic one. `core.autocrlf=true` is the default on a Windows Git
 * install and this repository pins no `.gitattributes`, so the very same commit
 * legitimately lands on disk as LF for one contributor and as CRLF for the
 * next. A needle carrying a literal "\n" cannot match CRLF text;
 * `String.prototype.replace` then returns its input untouched, and a fixture
 * that weakens nothing proves nothing.
 *
 * So every weakening is declared once, in `SQL_WEAKENINGS`, and injected
 * through one shared helper that compiles each needle to a pattern whose every
 * line break is `\r?\n`, conforms the replacement to whatever convention the
 * file on disk already uses, and then PROVES the result instead of assuming it:
 *
 *   * the pattern must match exactly the expected number of times — zero means
 *     the needle no longer describes the script, more than one means it is no
 *     longer specific enough to weaken a single place;
 *   * an anchor that lies OUTSIDE the needle — normally the very metric the
 *     weakening is meant to expose — must sit within `ANCHOR_WINDOW`
 *     characters of every match, so a needle that starts matching some other
 *     similar-looking span is rejected instead of silently rewriting the wrong
 *     statement;
 *   * the mutated text is assembled by splicing only the matched spans, and its
 *     length is cross-checked against that arithmetic, so nothing else moved;
 *   * the mutated text must differ from the input and must not mix newline
 *     conventions.
 *
 * The SQL under test is never normalised. It is mutated and executed exactly as
 * the checkout produced it, because the point of this runner is to prove what
 * the committed script does on a real machine — not what a tidied copy would do.
 */

/** Characters either side of a match within which the location anchor must appear. */
const ANCHOR_WINDOW = 400;

/**
 * Every privacy weakening this runner injects into the real script. `anchor` is
 * deliberately outside `needle`: it names the emitted metric or CTE output the
 * weakening is supposed to expose, so a needle that drifts is caught.
 */
const SQL_WEAKENINGS = {
  "raw-source": {
    needle: "        'Other / unknown source')",
    replacement: "        ln.source_key)",
    anchor: "sv.source_key = ln.source_key",
  },
  "total-only-calendar": {
    needle: "      WHEN EXISTS (\n        SELECT 1 FROM month_raw\n"
      + "        WHERE n > 0 AND n < (SELECT min_group_size FROM params)\n"
      + "      ) THEN 'SUPPRESSED_LT_5'",
    replacement: "      WHEN (SELECT total FROM totals) < (SELECT min_group_size FROM params)\n"
      + "        THEN 'SUPPRESSED_LT_5'",
    anchor: "END AS calendar_mode",
  },
  "categorical-sibling": {
    needle: "FROM source_raw s\nWHERE (SELECT source_mode FROM dimension_release) = 'DISCLOSE'",
    replacement: "FROM source_raw s",
    anchor: "'6_BY_SOURCE', 'leads_from_source'",
  },
  "binary-complement": {
    needle: "       CASE WHEN (SELECT release_mode FROM binary_release WHERE partition_name = 'presence_email') = 'DISCLOSE'\n"
      + "            THEN (SELECT side_b::numeric FROM binary_release WHERE partition_name = 'presence_email') END,",
    replacement: "       (SELECT side_b::numeric FROM binary_release WHERE partition_name = 'presence_email'),",
    anchor: "'4_LEAD_BASELINE', 'with_email'",
  },
  "duplicate-cohort": {
    needle: "       CASE WHEN (SELECT release_mode FROM duplicate_release) = 'DISCLOSE'\n"
      + "            THEN (SELECT duplicate_groups::numeric FROM duplicate_stats) END,",
    replacement: "       (SELECT duplicate_groups::numeric FROM duplicate_stats),",
    anchor: "'normalized_emails_seen_more_than_once'",
  },
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, (match) => `\\${match}`);
}

/** The newline convention a piece of text already uses. */
function sqlEol(text) {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  const cr = (text.match(/\r/g) ?? []).length - crlf;
  if (cr > 0) return "MIXED";
  if (crlf > 0 && lf === 0) return "CRLF";
  if (lf > 0 && crlf === 0) return "LF";
  if (crlf === 0 && lf === 0) return "NONE";
  return "MIXED";
}

/** Rewrite every line break in `text` to `eol`. */
function conformEol(text, eol) {
  const lf = text.replace(/\r\n/g, "\n");
  return eol === "CRLF" ? lf.replace(/\n/g, "\r\n") : lf;
}

/** A pattern matching `needle` under either newline convention. */
function newlineAgnosticPattern(needle) {
  return new RegExp(escapeRegExp(needle).replace(/\r?\n/g, "\\r?\\n"), "g");
}

/**
 * Apply one declared weakening to `raw` and prove it landed where it should.
 * Throws — so the harness fails closed — on anything less than certainty.
 */
function mutateSqlText(name, raw, needle, replacement, { expected = 1, anchor } = {}) {
  const eol = sqlEol(raw);
  assert(eol === "LF" || eol === "CRLF",
    `${name}: the SQL under test reports ${eol} line endings; refusing to mutate text whose newline convention cannot be preserved`);
  assert(!needle.includes("\r") && !replacement.includes("\r"),
    `${name}: fixture must not hard-code CR — line breaks are matched as \\r?\\n and written in the checkout's own convention`);
  assert(typeof anchor === "string" && anchor.length > 0 && !/[\r\n]/.test(anchor),
    `${name}: a non-empty, newline-free location anchor is required`);

  const matches = [...raw.matchAll(newlineAgnosticPattern(needle))];
  assert(matches.length === expected,
    `${name}: fixture needle matched ${matches.length} time(s) in the SQL under test, expected ${expected}`
      + (matches.length === 0
        ? ` — the needle no longer describes the script (a needle that hard-codes one newline convention cannot match a ${eol} checkout)`
        : " — the needle is not specific enough to weaken exactly one place"));

  const conformed = conformEol(replacement, eol);
  const offsets = [];
  let mutated = "";
  let cursor = 0;
  for (const match of matches) {
    const start = match.index;
    const end = start + match[0].length;
    const window = raw.slice(Math.max(0, start - ANCHOR_WINDOW), Math.min(raw.length, end + ANCHOR_WINDOW));
    assert(window.includes(anchor),
      `${name}: mutation landed at offset ${start}, where the expected anchor ${JSON.stringify(anchor)} is absent — the needle matched the wrong part of the script`);
    mutated += raw.slice(cursor, start) + conformed;
    cursor = end;
    offsets.push({ start, length: match[0].length });
  }
  mutated += raw.slice(cursor);

  assert(mutated !== raw, `${name}: fixture mutation did not change the checked-in SQL`);
  assert(sqlEol(mutated) === eol,
    `${name}: mutation changed the newline convention from ${eol} to ${sqlEol(mutated)}`);
  const removed = offsets.reduce((total, o) => total + o.length, 0);
  assert(mutated.length === raw.length - removed + (conformed.length * offsets.length),
    `${name}: mutated length ${mutated.length} does not equal the input with exactly ${offsets.length} span(s) replaced`);

  return { mutated, eol, replacements: offsets.length, offsets };
}

/**
 * Write the declared weakening `name` to a private copy of the script and
 * return its path. The checked-in SQL is read, never rewritten.
 */
function mutatedBaseline(name) {
  const spec = SQL_WEAKENINGS[name];
  assert(spec !== undefined, `${name}: no such declared SQL weakening`);
  const raw = readFileSync(SQL_PATH, "utf8");
  const proof = mutateSqlText(name, raw, spec.needle, spec.replacement, spec);
  const path = join(work, `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.sql`);
  writeFileSync(path, proof.mutated, "utf8");
  runtimeControls.mutation_injection[name] = {
    checkout_eol_preserved: proof.eol,
    replacements: proof.replacements,
    offsets: proof.offsets,
    changed_the_sql: true,
  };
  return path;
}

/** Prove the shared helper refuses a mutation it cannot vouch for. */
function expectMutationRejected(label, fn, expected) {
  let message = null;
  try {
    fn();
  } catch (error) {
    message = error.message;
  }
  assert(message !== null, `${label}: the mutation helper accepted a mutation it must reject`);
  assert(expected.test(message), `${label}: rejected for the wrong reason: ${message}`);
  runtimeControls.mutation_injection.fail_closed ??= {};
  runtimeControls.mutation_injection.fail_closed[label] = message;
  return message;
}

/**
 * Prove — from whichever representation this checkout actually produced — that
 * every declared weakening injects under all four combinations of newline
 * convention and trailing newline, and that the helper fails closed otherwise.
 * Pure text work: no cluster, no file, no database.
 */
function runMutationHelperProofs() {
  const scenario = "mutation helper cross-platform proof";
  const disk = readFileSync(SQL_PATH, "utf8");
  const body = disk.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  const representations = [
    { name: "LF with final newline", eol: "LF", raw: `${body}\n` },
    { name: "LF without final newline", eol: "LF", raw: body },
    { name: "CRLF with final newline", eol: "CRLF", raw: `${body.replace(/\n/g, "\r\n")}\r\n` },
    { name: "CRLF without final newline", eol: "CRLF", raw: body.replace(/\n/g, "\r\n") },
  ];
  const checkoutEol = sqlEol(disk);
  runtimeControls.mutation_injection.checkout = {
    eol: checkoutEol,
    ends_with_newline: /\n$/.test(disk),
    bytes: Buffer.byteLength(disk, "utf8"),
  };
  runtimeControls.mutation_injection.representations = {};

  check(scenario, `the script is read as ${checkoutEol} and every weakening is declared newline-agnostically`, () => {
    assert(checkoutEol === "LF" || checkoutEol === "CRLF",
      `the SQL on disk reports ${checkoutEol} line endings`);
    const names = Object.keys(SQL_WEAKENINGS);
    assert(names.length === 5, `expected five declared weakenings, found ${names.length}`);
    for (const [name, spec] of Object.entries(SQL_WEAKENINGS)) {
      assert(!spec.needle.includes("\r") && !spec.replacement.includes("\r"),
        `${name} hard-codes CR instead of relying on the \\r?\\n rewrite`);
      assert(!/[\r\n]/.test(spec.anchor), `${name} anchor must be newline-free`);
      assert(!spec.needle.includes(spec.anchor),
        `${name} anchor lies inside its own needle, so it could not detect a mis-located match`);
    }
  });

  for (const rep of representations) {
    check(scenario, `every declared weakening injects exactly once under ${rep.name}`, () => {
      assert(sqlEol(rep.raw) === rep.eol, `representation ${rep.name} is not ${rep.eol}`);
      const proofs = {};
      for (const [name, spec] of Object.entries(SQL_WEAKENINGS)) {
        const proof = mutateSqlText(name, rep.raw, spec.needle, spec.replacement, spec);
        assert(proof.replacements === (spec.expected ?? 1),
          `${name} replaced ${proof.replacements} span(s) under ${rep.name}`);
        assert(proof.eol === rep.eol, `${name} did not preserve ${rep.eol} under ${rep.name}`);
        assert(proof.mutated !== rep.raw, `${name} returned byte-identical SQL under ${rep.name}`);
        proofs[name] = { replacements: proof.replacements, offsets: proof.offsets, eol_preserved: proof.eol };
      }
      runtimeControls.mutation_injection.representations[rep.name] = proofs;
    });
  }

  const crlf = representations[2].raw;
  const calendar = SQL_WEAKENINGS["total-only-calendar"];

  check(scenario, "a needle that cannot match the checkout is rejected, which is what an LF-only needle becomes under CRLF", () => {
    const literal = [...crlf.matchAll(new RegExp(escapeRegExp(calendar.needle), "g"))];
    assert(literal.length === 0,
      "a literal-LF needle unexpectedly matched CRLF text, so this control proves nothing");
    expectMutationRejected("lf_only_needle_under_crlf", () => {
      mutateSqlText("lf-only-needle", crlf,
        calendar.needle.replace("month_raw", "month_raw_that_does_not_exist"),
        calendar.replacement, calendar);
    }, /matched 0 time\(s\)/);
  });

  check(scenario, "a needle carrying a hard-coded CRLF is rejected", () => {
    expectMutationRejected("crlf_only_needle", () => {
      mutateSqlText("crlf-only-needle", crlf,
        calendar.needle.replace(/\n/g, "\r\n"), calendar.replacement, calendar);
    }, /must not hard-code CR/);
  });

  check(scenario, "a needle matching more than the expected number of places is rejected", () => {
    expectMutationRejected("too_many_replacements", () => {
      mutateSqlText("ambiguous-needle", crlf, "'SUPPRESSED_LT_5'", "'DISCLOSED'",
        { expected: 1, anchor: calendar.anchor });
    }, /matched \d+ time\(s\).*expected 1/);
  });

  check(scenario, "a mutation that returns byte-identical SQL is rejected", () => {
    expectMutationRejected("byte_identical_result", () => {
      // The replacement is the needle itself. It is conformed to the source's
      // CRLF, splices back over the span it matched, and so must be caught by
      // the byte-identity guard rather than by any newline guard.
      mutateSqlText("no-op", crlf, calendar.needle, calendar.needle, calendar);
    }, /did not change the checked-in SQL/);
  });

  check(scenario, "a mutation whose location anchor is absent is rejected as mis-located", () => {
    expectMutationRejected("anchor_absent", () => {
      mutateSqlText("wrong-location", crlf, calendar.needle, calendar.replacement,
        { ...calendar, anchor: "END AS duplicate_release_mode" });
    }, /matched the wrong part of the script/);
  });
}

function runRoleSecurityControls() {
  const scenario = "role/security controls";
  seed(Array.from({ length: 5 }, () => lead({ month: "2026-09" })));

  check(scenario, "anon and authenticated ordinary RLS reads return no rows despite SELECT grants", () => {
    for (const role of ["anon", "authenticated"]) {
      const visible = scalar(TASK_DB, `SET ROLE ${role}; SELECT count(*) FROM public.leads; RESET ROLE;`);
      assert(visible === "0", `${role} saw ${visible} rows through the ordinary RLS path`);
    }
    runtimeControls.role_security.browser_roles_rls_denied = true;
  });

  check(scenario, "service_role BYPASSRLS sees fixture rows according to its privileged role", () => {
    const visible = scalar(TASK_DB, "SET ROLE service_role; SELECT count(*) FROM public.leads; RESET ROLE;");
    assert(visible === "5", `service_role saw ${visible} rows, expected 5`);
    runtimeControls.role_security.service_role_bypass_visible_rows = 5;
  });

  check(scenario, "known-role ACL is raw-disclosable", () => {
    const out = runBaselineScript();
    const raw = find(out.rows, "relation_acl_raw");
    assert(raw !== undefined && raw.value_text !== "SUPPRESSED_NON_STANDARD_ROLE_IN_ACL",
      `known-role ACL was unexpectedly suppressed: ${raw?.value_text}`);
    runtimeControls.role_security.known_role_acl_disclosable = true;
  });

  check(scenario, "unknown ACL role suppresses raw ACL and never emits its name", () => {
    const role = `operator_private_${process.pid}`;
    exec(TASK_DB, `CREATE ROLE ${role} NOLOGIN; GRANT SELECT ON public.leads TO ${role};`);
    const out = runBaselineScript();
    assert(find(out.rows, "relation_acl_raw")?.value_text === "SUPPRESSED_NON_STANDARD_ROLE_IN_ACL",
      "raw ACL was not suppressed for an unknown role");
    assert(!out.text.includes(role), "unknown ACL role name leaked into output");
    assert(find(out.rows, "acl_privilege", "Other / non-standard role.SELECT") !== undefined,
      "fixed non-standard role label missing");
    runtimeControls.role_security.unknown_role_acl_suppressed = true;
  });
}

function runSqlMutationControls() {
  const scenario = "SQL mutation controls";
  seed(Array.from({ length: 5 }, () => lead({ month: "2026-10", source: UNKNOWN_SOURCE_EMAIL })));

  check(scenario, "direct UPDATE is rejected in the read-only transaction", () => {
    expectSqlFailure("direct_update", "BEGIN; SET TRANSACTION READ ONLY; UPDATE public.leads SET status = 'contacted'; ROLLBACK;", /read-only transaction/i);
  });
  check(scenario, "writable CTE is rejected in the read-only transaction", () => {
    expectSqlFailure("writable_cte", "BEGIN; SET TRANSACTION READ ONLY; WITH changed AS (UPDATE public.leads SET status = 'contacted' RETURNING 1) SELECT count(*) FROM changed; ROLLBACK;", /read-only transaction/i);
  });
  check(scenario, "volatile mutating function is rejected in the read-only transaction", () => {
    expectSqlFailure("volatile_function", "BEGIN; SET TRANSACTION READ ONLY; SELECT public.mutate_marker(); ROLLBACK;", /read-only transaction/i);
    assert(scalar(TASK_DB, "SELECT value FROM public.mutation_marker;") === "0", "volatile function changed the marker");
  });
  check(scenario, "CALL to a mutating procedure is rejected in the read-only transaction", () => {
    expectSqlFailure("call_procedure", "BEGIN; SET TRANSACTION READ ONLY; CALL public.mutate_leads(); ROLLBACK;", /read-only transaction/i);
  });

  check(scenario, "removing the read-only boundary makes a write visible but ROLLBACK prevents persistence", () => {
    const visible = psqlRaw(TASK_DB, ["-t", "-A", "-c",
      "BEGIN; UPDATE public.leads SET status = 'contacted'; SELECT count(*) FROM public.leads WHERE status = 'contacted'; ROLLBACK;"])
      .split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    assert(visible.includes("5"), `weakened boundary did not expose the write in-transaction: ${visible.join("|")}`);
    assert(scalar(TASK_DB, "SELECT count(*) FROM public.leads WHERE status = 'contacted';") === "0",
      "weakened-boundary control persisted after ROLLBACK");
    runtimeControls.sql_mutations.weakened_readonly_boundary = { detected: true, persisted: false };
  });

  check(scenario, "raw-source mutation emits the synthetic source and is detected", () => {
    const path = mutatedBaseline("raw-source");
    const out = runBaselineScript(path);
    assert(out.text.includes(UNKNOWN_SOURCE_EMAIL), "raw-source mutation did not create the intended leak");
    runtimeControls.sql_mutations.raw_source = { injected: true, detected: true };
  });

  check(scenario, "total-only calendar mutation recreates the 3+2 month leak and is detected", () => {
    seed([
      ...Array.from({ length: 3 }, () => lead({ month: "2026-01" })),
      ...Array.from({ length: 2 }, () => lead({ month: "2026-02" })),
    ]);
    const path = mutatedBaseline("total-only-calendar");
    const out = runBaselineScript(path);
    assert(find(out.rows, "earliest_lead_month")?.value_text === "2026-01", "calendar mutation did not leak earliest month");
    assert(find(out.rows, "latest_lead_month")?.value_text === "2026-02", "calendar mutation did not leak latest month");
    runtimeControls.sql_mutations.total_only_calendar = { injected: true, detected: true };
  });

  check(scenario, "large categorical sibling mutation recreates complement disclosure and is detected", () => {
    seed(mixedRowsForControl(10, 2, "source", UNKNOWN_SOURCE_PLAIN));
    const path = mutatedBaseline("categorical-sibling");
    const out = runBaselineScript(path);
    assert(find(out.rows, "leads_from_source", "contact_form")?.value_num === "10",
      "categorical mutation did not expose the large sibling");
    assert(find(out.rows, "leads_from_source", "Other / unknown source")?.value_num === "2",
      "categorical mutation did not expose the small sibling");
    runtimeControls.sql_mutations.categorical_sibling = { injected: true, detected: true };
  });

  check(scenario, "binary complement mutation exposes present count beside one missing row and is detected", () => {
    seed([lead({ email: "", month: "2026-10" }), ...Array.from({ length: 9 }, () => lead({ month: "2026-10" }))]);
    const path = mutatedBaseline("binary-complement");
    const out = runBaselineScript(path);
    assert(find(out.rows, "with_email")?.value_num === "9", "binary mutation did not expose the complement");
    runtimeControls.sql_mutations.binary_complement = { injected: true, detected: true };
  });

  check(scenario, "duplicate mutation exposes a one-group cohort and is detected", () => {
    seed(rowsWithEmailGroups([2], 8, { month: "2026-10" }));
    const path = mutatedBaseline("duplicate-cohort");
    const out = runBaselineScript(path);
    assert(find(out.rows, "normalized_emails_seen_more_than_once")?.value_num === "1",
      "duplicate mutation did not expose the one-group cohort");
    runtimeControls.sql_mutations.duplicate_cohort = { injected: true, detected: true };
  });
}

function mixedRowsForControl(knownCount, unknownCount, field, unknownValue) {
  return [
    ...Array.from({ length: knownCount }, () => lead({ month: "2026-10" })),
    ...Array.from({ length: unknownCount }, () => lead({ month: "2026-10", [field]: unknownValue })),
  ];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const identity = {};

async function main() {
  console.log("\nFOREVER-PR125-INDEPENDENT-REVIEW-CORRECTION-001 — executable privacy fixtures");
  console.log(`\nScript under test: ${SQL_PATH}`);

  // --- STEP 0: the mutation machinery, before anything costly ----------------
  // Pure text work. It runs first because a fixture that cannot inject its
  // weakening on THIS checkout invalidates the mutation controls at the end of
  // the run, and that should be reported before a cluster is ever started.
  console.log("\n  mutation helper cross-platform proof");
  runMutationHelperProofs();
  console.log("");

  // --- STEPS 1-2: a free port nobody owns -----------------------------------
  PORT = await claimFreePort();
  identity.port = PORT;
  identity.port_verified_unowned = true;
  console.log(`\n[1-2] claimed free loopback port ${PORT}, verified unowned`);

  // --- STEP 3: a fresh cluster ---------------------------------------------
  run(bin("initdb"), ["-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8"],
    WINDOWS ? { stdio: "ignore" } : {});
  run(bin("pg_ctl"), [
    "-D", data, "-l", logFile, "-w", "-o", `-p ${PORT} -h 127.0.0.1`, "start",
  ], WINDOWS ? { stdio: "ignore" } : {});
  started = true;
  identity.data_directory_created = resolve(data);
  console.log(`[3]   started a fresh cluster in ${data}`);

  // --- STEP 4: the postmaster PID, from the cluster's own pid file ----------
  const pidFile = join(data, "postmaster.pid");
  assert(existsSync(pidFile), "postmaster.pid is missing; the cluster did not start");
  const pidLines = readFileSync(pidFile, "utf8").split(/\r?\n/);
  postmasterPid = Number(pidLines[0]);
  identity.postmaster_pid = postmasterPid;
  identity.pidfile_data_directory = pidLines[1];
  identity.pidfile_port = Number(pidLines[3]);
  assert(Number.isInteger(postmasterPid) && postmasterPid > 0,
    `postmaster.pid does not carry a PID: ${JSON.stringify(pidLines[0])}`);
  assert(identity.pidfile_port === PORT,
    `the cluster bound port ${identity.pidfile_port}, not the port we claimed (${PORT}) — refusing to continue`);
  assert(resolve(pidLines[1]) === resolve(data),
    `postmaster.pid names a different data directory: ${pidLines[1]}`);
  console.log(`[4]   postmaster pid ${postmasterPid}, pid file agrees on port and data directory`);

  // --- STEP 5: prove over SQL that this is the cluster we just created ------
  const liveDataDir = scalar("postgres", "SHOW data_directory;");
  identity.data_directory_reported = liveDataDir;
  assert(resolve(liveDataDir) === resolve(data),
    `IDENTITY FAILURE — the server reports data_directory ${liveDataDir}, not ${data}. ` +
      "Refusing to issue any DDL against a cluster this task did not create.");
  const startTime = scalar("postgres", "SELECT pg_postmaster_start_time();");
  identity.postmaster_start_time = startTime;
  console.log(`[5]   data_directory proven: ${liveDataDir}`);

  // --- STEPS 6-7: a unique task marker, created and read back ---------------
  // Identity is already proven read-only above, so this first DDL cannot land
  // anywhere but the cluster this process started.
  exec("postgres", `CREATE DATABASE ${TASK_DB};`);
  exec(TASK_DB, "CREATE TABLE public.forever_task_marker (token text primary key);");
  exec(TASK_DB, `INSERT INTO public.forever_task_marker (token) VALUES (${q(TASK_TOKEN)});`);
  const readBack = scalar(TASK_DB, "SELECT token FROM public.forever_task_marker;");
  assert(readBack === TASK_TOKEN,
    `IDENTITY FAILURE — task marker did not round-trip: wrote ${TASK_TOKEN}, read ${readBack}`);
  identity.task_marker = TASK_TOKEN;
  identity.task_marker_round_tripped = true;
  identity.task_database = TASK_DB;
  console.log(`[6-7] task marker ${TASK_TOKEN} created and read back from ${TASK_DB}`);

  // --- STEP 8: fixtures ----------------------------------------------------
  // The fixture table mirrors supabase/migrations/20260704132000_create_leads.sql
  // with three deliberate, documented deviations:
  //   * no FK to public.projects — a second table is irrelevant to what is
  //     under test here and would add nothing to the privacy proof;
  //   * no status CHECK — the fixture must be able to PRODUCE the unexpected
  //     status that the closed vocabulary exists to defend against;
  //   * no email/phone format CHECK — fixtures deliberately store email-shaped
  //     and URL-shaped text in `source` and vary the contact columns freely.
  // The privilege and policy shape is mirrored exactly, because that is what
  // sections 3 and 10 measure.
  exec(TASK_DB, `
    CREATE TABLE public.leads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      country TEXT,
      budget TEXT,
      interest TEXT,
      project_slug TEXT,
      message TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      source TEXT NOT NULL DEFAULT 'contact_form'
    );
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
    GRANT ALL ON public.leads TO anon, authenticated;
    GRANT ALL ON public.leads TO service_role;
    CREATE POLICY "Anyone can submit a lead"
      ON public.leads FOR INSERT TO anon, authenticated
      WITH CHECK (
        status = 'new'
        AND length(btrim(name)) > 0
        AND length(btrim(email)) > 0
        AND length(btrim(phone)) > 0
      );
    CREATE INDEX idx_leads_created_at ON public.leads(created_at DESC);
    CREATE INDEX idx_leads_status ON public.leads(status);
    CREATE TABLE public.mutation_marker (value integer NOT NULL);
    INSERT INTO public.mutation_marker(value) VALUES (0);
    CREATE FUNCTION public.mutate_marker() RETURNS integer
      LANGUAGE sql VOLATILE
      AS 'UPDATE public.mutation_marker SET value = value + 1 RETURNING value';
    CREATE PROCEDURE public.mutate_leads()
      LANGUAGE sql
      AS 'UPDATE public.leads SET status = status';
  `);
  console.log("[8]   fixture table, roles, grants and policy created\n");

  for (const scenario of scenarios()) {
    console.log(`  ${scenario.name}`);
    seed(scenario.rows);
    const out = runBaselineScript();
    universalAssertions(scenario.name, out.rows, out, scenario.rows);
    scenario.assert(scenario.name, out.rows, out);
    console.log("");
  }

  runRoleSecurityControls();
  console.log("");
  runSqlMutationControls();
  console.log("");
}

let exitCode = 0;
try {
  await main();
} catch (error) {
  console.error(`\n[crm-pg] ABORTED: ${error.message}\n`);
  failures.push({ scenario: "harness", name: "run", message: error.message });
}

// --- STEPS 9-10 ------------------------------------------------------------
stopCluster();
console.log("[9]   cluster stopped");

const summaryPath = process.env.FOREVER_CRM_PG_SUMMARY;
if (summaryPath) {
  writeFileSync(summaryPath, JSON.stringify({
    task_id: "FOREVER-PR125-INDEPENDENT-REVIEW-CORRECTION-001",
    cluster_identity: identity,
    scenarios: scenarios().map((s) => s.name),
    assertions_passed: passed,
    assertions_failed: failures.length,
    failures,
    results,
    runtime_controls: runtimeControls,
  }, null, 2));
  console.log(`      summary written to ${summaryPath}`);
}

try { rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ }
console.log(`[10]  temporary directory removed\n`);

console.log(`${passed} passed, ${failures.length} failed\n`);
if (failures.length > 0) {
  console.error("RUNTIME PRIVACY FIXTURES FAILED — the Slice 0 script must not be run or committed.\n");
  exitCode = 1;
} else {
  console.log(
    "Executable proof holds: complete dimensions and complements suppress together,\n" +
    "all adversarial source shapes remain fixed-vocabulary output, duplicate cohorts\n" +
    "cannot be reconstructed, browser-role and BYPASSRLS behavior are distinguished,\n" +
    "and every intentional SQL/privacy weakening is detected.\n",
  );
}
process.exit(exitCode);
