#!/usr/bin/env node
/**
 * FOREVER-CRM-SLICE0-CORRECTION-001 — EXECUTABLE privacy fixtures for the
 * Slice 0 read-only lead baseline script.
 *
 * WHY THIS EXISTS
 * ---------------
 * `crm-slice0-lead-baseline.test.mjs` reads the SQL as text. A static rule can
 * prove that the script *says* it categorises `source`; it cannot prove what
 * the script *emits* when the table actually contains an email address in the
 * `source` column. Only running it can.
 *
 * This runner executes the EXACT checked-in script against a disposable
 * PostgreSQL cluster, once per table state, and asserts on the real output:
 *
 *   1  zero rows                          8  five rows, URL-shaped source
 *   2  one row                            9  mixed known and unknown statuses
 *   3  four rows                         10  one-to-four rows in a single month
 *   4  five rows                         11  five rows in one month
 *   5  five known-source rows            12  five rows split across months
 *   6  five unknown-source rows          13  duplicate-email groups
 *   7  five rows, email-shaped source    14  no duplicate-email groups
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
function runBaselineScript() {
  const out = psqlRaw(TASK_DB, ["-t", "-A", "-F", SEP, "-f", SQL_PATH]);
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
const UNKNOWN_STATUS = "archived_by_hand";

/** Every invented value that must never appear in the script's output. */
const SECRETS_THAT_MUST_NOT_LEAK = [
  UNKNOWN_SOURCE_PLAIN, UNKNOWN_SOURCE_EMAIL, UNKNOWN_SOURCE_URL,
  UNKNOWN_SOURCE_PHONE, UNKNOWN_STATUS,
];

let seq = 0;
function lead({ month = "2026-03", source = "contact_form", status = "new", email = null } = {}) {
  seq += 1;
  return {
    name: `Synthetic Person ${seq}`,
    email: email ?? `synthetic.person.${seq}@example.invalid`,
    phone: `+6600000${String(1000 + seq)}`,
    country: "Invented Country",
    budget: "Invented budget band",
    interest: "Invented interest",
    project_slug: `invented-project-${seq}`,
    message: `Invented fixture message ${seq}`,
    status,
    source,
    created_at: `${month}-15T09:00:00Z`,
  };
}

function pii(rows) {
  const values = [];
  for (const r of rows) {
    values.push(r.name, r.email, r.phone, r.country, r.budget, r.interest, r.project_slug, r.message);
  }
  return values;
}

const q = (v) => `'${String(v).replace(/'/g, "''")}'`;

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

// ---------------------------------------------------------------------------
// The fourteen scenarios
// ---------------------------------------------------------------------------
function scenarios() {
  const known = (n, source, month = "2026-03") =>
    Array.from({ length: n }, () => lead({ source, month }));

  return [
    {
      name: "1 · zero rows",
      rows: [],
      assert: (s, rows) => {
        check(s, "total_leads is a factual numeric zero", () => {
          assert(find(rows, "total_leads").value_num === "0",
            `expected 0, got ${JSON.stringify(find(rows, "total_leads").value_num)}`);
        });
        check(s, "months_containing_leads is a factual numeric zero", () => {
          assert(find(rows, "months_containing_leads").value_num === "0", "expected a numeric 0");
        });
        check(s, "with_email is a factual numeric zero", () => {
          assert(find(rows, "with_email").value_num === "0", "expected a numeric 0");
        });
        check(s, "every rate reports NOT_MEASURABLE_NO_DATA, never 0", () => {
          for (const metric of ["email_completeness_rate", "phone_completeness_rate", "duplicate_rate", "null_or_blank_rate"]) {
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
        check(s, "the grouped month is folded and its size suppressed", () => {
          const group = all(rows, "leads_in_month");
          assert(group.length === 1, `expected one folded month row, got ${group.length}`);
          assert(group[0].label === "Other / suppressed", `expected the fold-in bucket, got ${group[0].label}`);
          assert(group[0].value_text === "SUPPRESSED_LT_5", "a fold-in bucket below the floor must report SUPPRESSED_LT_5");
          assert(group[0].value_num === "", "a suppressed bucket must not carry a number");
        });
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
        check(s, "a single small month is never revealed", () => {
          const group = all(rows, "leads_in_month");
          assert(group.length === 1 && group[0].label === "Other / suppressed",
            "the only month must be folded into the suppressed bucket");
          assert(group[0].value_text === "SUPPRESSED_LT_5", "its size must be suppressed too");
          assert(find(rows, "earliest_lead_month").value_text === "SUPPRESSED_LT_5",
            "the summary must not reveal what the grouped output suppresses");
        });
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
        check(s, "each month below the floor is folded, and the bucket reaches the floor", () => {
          const group = all(rows, "leads_in_month");
          assert(group.length === 1 && group[0].label === "Other / suppressed",
            `both months are below the floor and must fold, got ${group.map((r) => r.label).join(", ")}`);
          assert(group[0].value_num === "5",
            `the fold-in bucket holds all five rows and is at the floor, so its size shows: got ${group[0].value_num}`);
        });
        check(s, "the calendar summary follows the total, as the rule specifies", () => {
          assert(find(rows, "earliest_lead_month").value_text === "2026-01",
            "at five total leads the summary discloses, per the stated rule");
          assert(find(rows, "lead_month_range").value_text === "2026-01 .. 2026-02", "expected the range");
        });
        check(s, "months_containing_leads stays a factual count", () => {
          assert(find(rows, "months_containing_leads").value_num === "2", "expected 2");
        });
      },
    },
    {
      name: "13 · duplicate-email groups",
      rows: [
        ...Array.from({ length: 3 }, () => lead({ month: "2026-06", email: "repeat.one@example.invalid" })),
        ...Array.from({ length: 3 }, () => lead({ month: "2026-06", email: "repeat.two@example.invalid" })),
      ],
      assert: (s, rows) => {
        check(s, "duplicate groups are counted without emitting an address", () => {
          assert(find(rows, "normalized_emails_seen_more_than_once").value_num === "2", "expected 2 groups");
          assert(find(rows, "rows_in_duplicated_email_groups").value_num === "6", "expected 6 rows");
          assert(find(rows, "max_duplicate_group_size").value_num === "3", "expected a max group of 3");
          assert(find(rows, "duplicate_rate").value_num === "100.00", "expected a measured 100.00 rate");
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
  ];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const identity = {};

async function main() {
  console.log("\nFOREVER-CRM-SLICE0-CORRECTION-001 — executable privacy fixtures");
  console.log(`\nScript under test: ${SQL_PATH}`);

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
      source TEXT NOT NULL DEFAULT 'contact_form',
      CONSTRAINT leads_name_not_empty CHECK (length(btrim(name)) > 0),
      CONSTRAINT leads_phone_not_empty CHECK (length(btrim(phone)) > 0)
    );
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
    GRANT INSERT ON public.leads TO anon, authenticated;
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
    task_id: "FOREVER-CRM-SLICE0-CORRECTION-001",
    cluster_identity: identity,
    scenarios: scenarios().map((s) => s.name),
    assertions_passed: passed,
    assertions_failed: failures.length,
    failures,
    results,
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
    "Executable proof holds: no raw source or status text, no email-shaped or URL-shaped\n" +
    "value, no personal value, months suppressed below five and exact at five or more,\n" +
    "factual zeros stay zero, rates report NOT_MEASURABLE_NO_DATA on an empty table,\n" +
    "and the privilege and policy evidence is present in every state.\n",
  );
}
process.exit(exitCode);
