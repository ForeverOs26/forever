#!/usr/bin/env node
/**
 * FOREVER-LISTINGS-BROWSER-WRITE-REVOKE-001 — disposable PostgreSQL privilege suite.
 *
 * Proves the browser table-write contract that
 * `supabase/migrations/20260730090000_listings_browser_write_revoke.sql` defines:
 *
 *   anon and authenticated keep every SELECT they had, keep INSERT on
 *   public.leads, and hold no INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES,
 *   TRIGGER or MAINTAIN on anything else in schema public — including on a table
 *   created after the migration.
 *
 * Everything runs on a throwaway cluster under the OS temp directory. No
 * production or staging credential is read, no linked project is used, and the
 * data directory is removed in `finally`.
 *
 * Two installation paths, one cluster, two databases. Roles live in the shared
 * catalog exactly as they do in Supabase; relation ACLs and pg_default_acl are
 * per-database, so the paths cannot contaminate each other's privilege state.
 *
 *   Path A  clean install   — the complete chain from zero, on top of
 *                             production-faithful Supabase bootstrap defaults
 *                             (the broad grants the migration exists to correct).
 *   Path B  upgrade path    — the 26 migrations production has applied, safe
 *                             fixtures, ACL/RLS capture, then ONLY the new
 *                             migration, then capture again.
 *
 * Usage: node scripts/security/run-browser-write-revoke-pg-tests.mjs
 *        [--json <path>]   also write the machine-readable result
 * Exits 0 only when every assertion passes.
 */

import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const REPO = process.cwd();
const MIGRATIONS_DIR = join(REPO, "supabase", "migrations");
const BOOTSTRAP = join(REPO, "scripts", "studio", "pg-bootstrap.sql");
const FIXTURES = join(REPO, "scripts", "security", "browser-write-revoke-fixtures.sql");
const NEW_MIGRATION = "20260730090000_listings_browser_write_revoke.sql";

const WRITE_PRIVS = ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"];
const BROWSER_ROLES = ["anon", "authenticated"];
/** The single approved browser table write. Everything else must be denied. */
const APPROVED = new Set(["leads|INSERT"]);

/**
 * Defining owner roles whose schema-public TABLES default the PRODUCTION migration
 * executor is not authorised to alter.
 *
 * Measured, not assumed. In production `postgres` has rolsuper = false and
 * `pg_auth_members` records no postgres -> supabase_admin membership, so
 * `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` there raises 42501.
 *
 * A disposable cluster's `postgres` IS a superuser, so it can alter any role's
 * defaults — which would make the canary below pass locally and fail in production.
 * That is the exact fidelity trap this constant exists to close: before the
 * post-migration canary runs, the suite RESTORES production's uncorrected state for
 * every role named here, so the canary measures what production will actually look
 * like. `assertExecutorAuthorization` independently proves the boundary is real.
 */
const PRODUCTION_UNAUTHORIZED_DEFINERS = new Set(["supabase_admin"]);

const TASK_MARKER = `lbwr-${randomUUID()}`;
const results = {
  task: "FOREVER-LISTINGS-BROWSER-WRITE-REVOKE-001",
  marker: TASK_MARKER,
  checks: [],
};
let failures = 0;

function record(name, pass, detail) {
  results.checks.push({ name, pass, detail: detail ?? null });
  if (pass) {
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function assert(name, condition, detail) {
  record(name, Boolean(condition), detail);
}

// --------------------------------------------------------------------------
// Cluster plumbing
// --------------------------------------------------------------------------

function findBinDir() {
  const candidates = [];
  if (process.platform === "win32") {
    candidates.push("C:/Program Files/PostgreSQL");
  } else {
    candidates.push("/usr/lib/postgresql", "/usr/pgsql", "/opt/homebrew/opt");
  }
  for (const base of candidates) {
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base).sort().reverse()) {
      for (const bin of [join(base, entry, "bin"), join(base, entry)]) {
        const exe = process.platform === "win32" ? ".exe" : "";
        if (existsSync(join(bin, `initdb${exe}`)) && existsSync(join(bin, `pg_ctl${exe}`)))
          return bin;
      }
    }
  }
  return "";
}

const BIN = findBinDir();
const bin = (name) => (BIN ? join(BIN, name) : name);

/**
 * A free port chosen by the kernel, then proven unowned before use. A fixed
 * shared port would make two concurrent runs silently talk to each other's
 * cluster, which is exactly the failure a privilege suite must not have.
 */
async function reserveFreePort() {
  const port = await new Promise((ok, bad) => {
    const server = createServer();
    server.once("error", bad);
    server.listen(0, "127.0.0.1", () => {
      const { port: chosen } = server.address();
      server.close(() => ok(chosen));
    });
  });
  // Prove it is unowned: a fresh connect must be refused.
  const owned = await new Promise((ok) => {
    const probe = createServer();
    probe.once("error", () => ok(true));
    probe.listen(port, "127.0.0.1", () => probe.close(() => ok(false)));
  });
  if (owned) throw new Error(`port ${port} is owned by another process`);
  return port;
}

let work = "";
let data = "";
let port = 0;
let started = false;

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: "pipe", encoding: "utf8", ...opts });
}

function psqlArgs(db, extra) {
  return [
    "-h",
    "127.0.0.1",
    "-p",
    String(port),
    "-U",
    "postgres",
    "-d",
    db,
    "-X",
    "--no-psqlrc",
    "-v",
    "ON_ERROR_STOP=1",
    "-q",
    ...extra,
  ];
}

/** Run a file. Throws on the first error. */
function psqlFile(db, file) {
  return run(bin("psql"), psqlArgs(db, ["-f", file]));
}

/** Run SQL, fail loudly. */
function sql(db, statement) {
  return run(bin("psql"), psqlArgs(db, ["-c", statement]));
}

/** Run SQL, return unaligned tuples-only rows. */
function query(db, statement) {
  const out = run(bin("psql"), psqlArgs(db, ["-A", "-t", "-F", "|", "-c", statement]));
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function scalar(db, statement) {
  const rows = query(db, statement);
  return rows.length > 0 ? rows[0] : "";
}

/** Run SQL expecting failure; return the SQLSTATE-bearing message, or null. */
function expectError(db, statement) {
  try {
    run(bin("psql"), psqlArgs(db, ["-c", statement]));
    return null;
  } catch (error) {
    return [error.stderr, error.stdout, error.message].filter(Boolean).map(String).join("\n");
  }
}

const isInsufficientPrivilege = (text) =>
  /permission denied|insufficient.privilege|\b42501\b/i.test(String(text ?? ""));

// --------------------------------------------------------------------------
// Catalog snapshots
// --------------------------------------------------------------------------

const TABLES_SQL = `
  SELECT c.relname FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p')
  ORDER BY c.relname`;

/** table|role|privilege|granted, for every table, every role, every privilege. */
function privilegeMatrix(db, roles = [...BROWSER_ROLES, "service_role", "postgres"]) {
  const rows = query(
    db,
    `WITH t AS (${TABLES_SQL}),
     w(rolname) AS (VALUES ${roles.map((r) => `('${r}')`).join(",")}),
     p(priv, minver) AS (VALUES ('SELECT',0),('INSERT',0),('UPDATE',0),('DELETE',0),
                                ('TRUNCATE',0),('REFERENCES',0),('TRIGGER',0),('MAINTAIN',170000))
     SELECT t.relname || '|' || w.rolname || '|' || p.priv || '|' ||
            CASE WHEN current_setting('server_version_num')::int < p.minver THEN 'unsupported'
                 WHEN has_table_privilege(w.rolname::name, ('public.' || quote_ident(t.relname))::regclass, p.priv)
                   THEN 'granted' ELSE 'denied' END
     FROM t CROSS JOIN w CROSS JOIN p
     ORDER BY 1`,
  );
  const map = new Map();
  for (const row of rows) {
    const [table, role, priv, state] = row.split("|");
    map.set(`${table}|${role}|${priv}`, state);
  }
  return map;
}

/** Explicit column ACLs only — pg_attribute.attacl, not table grants per column. */
function columnGrants(db) {
  return query(
    db,
    `SELECT c.relname || '.' || a.attname || '|' ||
            COALESCE(gr.rolname::text,'PUBLIC') || '|' || e.privilege_type
     FROM pg_catalog.pg_attribute a
     JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) AS e
     LEFT JOIN pg_catalog.pg_roles gr ON gr.oid = e.grantee
     WHERE n.nspname='public' AND a.attacl IS NOT NULL AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY 1`,
  );
}

/**
 * One line per policy. Policy expressions can contain newlines, and this output is
 * consumed line by line, so whitespace is collapsed — otherwise a multi-line
 * predicate would be counted as several policies and the comparison would still be
 * correct but the reported number would be a lie.
 */
function policyFingerprint(db) {
  return query(
    db,
    `SELECT tablename || '|' || policyname || '|' || permissive || '|' || cmd || '|' ||
            COALESCE(array_to_string(roles, ','), '') || '|' ||
            regexp_replace(COALESCE(qual,''), '\\s+', ' ', 'g') || '|' ||
            regexp_replace(COALESCE(with_check,''), '\\s+', ' ', 'g')
     FROM pg_catalog.pg_policies WHERE schemaname='public'
     ORDER BY tablename, policyname`,
  );
}

function policyCount(db) {
  return Number(
    scalar(db, `SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname='public'`),
  );
}

function rlsFingerprint(db) {
  return query(
    db,
    `SELECT c.relname || '|' || c.relrowsecurity::text || '|' || c.relforcerowsecurity::text
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='public' AND c.relkind IN ('r','p')
     ORDER BY c.relname`,
  );
}

function relaclFingerprint(db) {
  return query(
    db,
    `SELECT c.relname || '|' || COALESCE(c.relacl::text,'NULL')
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='public' AND c.relkind IN ('r','p')
     ORDER BY c.relname`,
  );
}

/** Default TABLE ACLs in schema public, per defining owner role. */
function defaultAclMatrix(db) {
  return query(
    db,
    `SELECT owner.rolname || '|' || COALESCE(gr.rolname::text,'PUBLIC') || '|' || a.privilege_type
     FROM pg_catalog.pg_default_acl d
     JOIN pg_catalog.pg_roles owner ON owner.oid = d.defaclrole
     JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
     CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS a
     LEFT JOIN pg_catalog.pg_roles gr ON gr.oid = a.grantee
     WHERE n.nspname='public' AND d.defaclobjtype='r'
     ORDER BY 1`,
  );
}

const sameSet = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

// --------------------------------------------------------------------------
// Assertion batteries
// --------------------------------------------------------------------------

/** The core invariant. Returns the list of violations rather than throwing. */
function browserWriteViolations(matrix, tables) {
  const violations = [];
  for (const table of tables) {
    for (const role of BROWSER_ROLES) {
      for (const priv of WRITE_PRIVS) {
        const state = matrix.get(`${table}|${role}|${priv}`);
        if (state === "unsupported") continue;
        const approved = APPROVED.has(`${table}|${priv}`);
        if (state === "granted" && !approved) violations.push(`${role} ${priv} on ${table}`);
        if (state !== "granted" && approved) violations.push(`${role} LOST ${priv} on ${table}`);
      }
    }
  }
  return violations;
}

function assertAclMatrix(db, label) {
  const tables = query(db, TABLES_SQL);
  const matrix = privilegeMatrix(db);
  const violations = browserWriteViolations(matrix, tables);
  assert(
    `${label}: browser writes limited to leads INSERT across all ${tables.length} public tables`,
    violations.length === 0,
    violations.length === 0 ? `${tables.length} tables clean` : violations.slice(0, 8).join("; "),
  );
  return { tables, matrix, violations };
}

/**
 * `listings` specifically, at the privilege layer — the finding that started this.
 * Each verb is attempted for real, and the failure must be 42501. A statement that
 * "succeeded, zero rows" is a pass for RLS and a FAILURE for this suite: UPDATE and
 * DELETE do not raise under RLS, they match nothing, so only the privilege layer
 * can turn them into an error.
 */
function assertListingsDenied(db, label) {
  const attempts = [
    ["INSERT", `INSERT INTO public.listings (kind,title) VALUES ('resale','denied probe')`],
    ["UPDATE", `UPDATE public.listings SET title='denied probe'`],
    ["DELETE", `DELETE FROM public.listings`],
    ["TRUNCATE", `TRUNCATE TABLE public.listings`],
    // CREATE TRIGGER requires the TRIGGER privilege on the target table, so this is
    // a real behavioural probe for a privilege row-level security never covered.
    [
      "TRIGGER",
      `CREATE TRIGGER lbwr_trigger_probe BEFORE UPDATE ON public.listings ` +
        `FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()`,
    ],
  ];
  for (const role of BROWSER_ROLES) {
    for (const [verb, statement] of attempts) {
      const error = expectError(db, `SET ROLE ${role}; ${statement};`);
      assert(
        `${label}: listings ${verb} denied by privilege for ${role}`,
        error !== null && isInsufficientPrivilege(error),
        error === null
          ? "the statement SUCCEEDED — the privilege layer did not refuse it"
          : `refused: ${firstLine(error)}`,
      );
    }
    // REFERENCES and MAINTAIN have no behavioural probe available to these roles:
    // a foreign key needs a table the role owns, `anon` holds USAGE but not CREATE
    // on schema public, and a TEMP table may not reference a permanent one
    // ("constraints on temporary tables may reference only temporary tables").
    // So they are asserted where they actually live — the catalogue.
    for (const priv of ["REFERENCES", "MAINTAIN"]) {
      const state = scalar(
        db,
        `SELECT CASE WHEN has_table_privilege('${role}','public.listings','${priv}')
                     THEN 'granted' ELSE 'denied' END`,
      );
      assert(
        `${label}: listings ${priv} denied by privilege for ${role} (catalogue; no behavioural probe is reachable for this privilege)`,
        state === "denied",
        `has_table_privilege=${state}`,
      );
    }
  }
  // SELECT must survive at the privilege layer, and RLS must still scope it.
  for (const role of BROWSER_ROLES) {
    const error = expectError(db, `SET ROLE ${role}; SELECT count(*) FROM public.listings;`);
    assert(
      `${label}: listings SELECT still permitted for ${role}`,
      error === null,
      error ? firstLine(error) : "permitted",
    );
  }
}

function firstLine(text) {
  return (
    String(text)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .find((line) => /error|denied|42501|25006/i.test(line)) ?? String(text).split(/\r?\n/)[0]
  );
}

/**
 * The approved write, exercised for real as each browser role — no RETURNING,
 * matching the `Prefer: return=minimal` shape supabase-js actually sends, and
 * satisfying both the CHECK constraints and the RLS WITH CHECK.
 */
function assertLeadsInsert(db, label) {
  const proofs = [];
  for (const role of BROWSER_ROLES) {
    const before = Number(scalar(db, `SELECT count(*) FROM public.leads`));
    const statement =
      `SET ROLE ${role}; INSERT INTO public.leads (name,email,phone,status,source) ` +
      `VALUES ('Fixture ${role}','${role}@example.invalid','+66000000001','new','contact_form');`;
    const error = expectError(db, statement);
    const after = Number(scalar(db, `SELECT count(*) FROM public.leads`));
    assert(
      `${label}: leads INSERT succeeds as ${role}`,
      error === null && after === before + 1,
      error ? firstLine(error) : `rows ${before} -> ${after}`,
    );
    proofs.push({ role, inserted: after === before + 1, error: error ? firstLine(error) : null });

    // The other verbs on leads must be refused by privilege, not merely filtered.
    for (const [verb, statement2] of [
      ["UPDATE", `UPDATE public.leads SET status='contacted'`],
      ["DELETE", `DELETE FROM public.leads`],
      ["TRUNCATE", `TRUNCATE TABLE public.leads`],
    ]) {
      const denied = expectError(db, `SET ROLE ${role}; ${statement2};`);
      assert(
        `${label}: leads ${verb} denied by privilege for ${role}`,
        denied !== null && isInsufficientPrivilege(denied),
        denied === null ? "the statement SUCCEEDED" : firstLine(denied),
      );
    }

    // SELECT on leads is deliberately preserved by this migration. Assert the
    // ACTUAL posture rather than a hoped-for one: the privilege is present and RLS
    // is the only thing withholding the rows. Stating it plainly is what keeps it
    // from being mistaken for a solved problem.
    const rows = scalar(db, `SET ROLE ${role}; SELECT count(*) FROM public.leads;`);
    assert(
      `${label}: leads SELECT still permitted for ${role} and returns 0 rows (RLS, not privilege)`,
      rows === "0",
      `count=${rows} — table privilege retained by design; no SELECT policy exists, so RLS filters every row`,
    );
  }
  return proofs;
}

/** Every preserved SELECT, exercised as each browser role against real rows. */
function assertSelectPreserved(db, label, beforeMatrix, beforeColumns) {
  const tables = query(db, TABLES_SQL);
  const afterMatrix = privilegeMatrix(db);
  const selectDrift = [];
  for (const table of tables) {
    for (const role of BROWSER_ROLES) {
      const key = `${table}|${role}|SELECT`;
      if (beforeMatrix.get(key) !== afterMatrix.get(key)) {
        selectDrift.push(`${key}: ${beforeMatrix.get(key)} -> ${afterMatrix.get(key)}`);
      }
    }
  }
  assert(
    `${label}: table-level SELECT unchanged for both browser roles`,
    selectDrift.length === 0,
    selectDrift.length === 0 ? `${tables.length} tables compared` : selectDrift.join("; "),
  );

  const afterColumns = columnGrants(db);
  assert(
    `${label}: explicit column grants byte-identical`,
    sameSet(beforeColumns, afterColumns),
    `${beforeColumns.length} before / ${afterColumns.length} after`,
  );

  // Behavioural: the reads the catalogue and project page actually issue.
  const readable = tables.filter((t) => afterMatrix.get(`${t}|anon|SELECT`) === "granted");
  for (const role of BROWSER_ROLES) {
    const errors = [];
    for (const table of readable) {
      const error = expectError(db, `SET ROLE ${role}; SELECT * FROM public.${table} LIMIT 1;`);
      if (error) errors.push(`${table}: ${firstLine(error)}`);
    }
    assert(
      `${label}: every table-SELECT relation still readable by ${role}`,
      errors.length === 0,
      errors.length === 0
        ? `${readable.length} relations read without 42501`
        : errors.slice(0, 4).join("; "),
    );
  }

  // Column-granted tables: read exactly the granted column list.
  const columnTables = query(
    db,
    `SELECT c.relname || '|' || string_agg(DISTINCT quote_ident(a.attname), ',')
     FROM pg_catalog.pg_attribute a
     JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) AS e
     JOIN pg_catalog.pg_roles gr ON gr.oid = e.grantee
     WHERE n.nspname='public' AND a.attacl IS NOT NULL AND a.attnum > 0
       AND NOT a.attisdropped AND gr.rolname='anon' AND e.privilege_type='SELECT'
     GROUP BY c.relname ORDER BY 1`,
  );
  const columnErrors = [];
  for (const row of columnTables) {
    const [table, columns] = row.split("|");
    const error = expectError(db, `SET ROLE anon; SELECT ${columns} FROM public.${table} LIMIT 1;`);
    if (error) columnErrors.push(`${table}: ${firstLine(error)}`);
  }
  assert(
    `${label}: every granted column still readable by anon`,
    columnErrors.length === 0,
    columnErrors.length === 0
      ? `${columnTables.length} column-granted relations read without 42501`
      : columnErrors.join("; "),
  );

  // And the privacy contract still holds in the other direction.
  const privateMetadata = expectError(
    db,
    `SET ROLE anon; SELECT metadata FROM public.project_media LIMIT 1;`,
  );
  assert(
    `${label}: project_media.metadata still private to anon`,
    privateMetadata !== null && isInsufficientPrivilege(privateMetadata),
    privateMetadata ? firstLine(privateMetadata) : "the column was READABLE",
  );
  const privatePrices = expectError(
    db,
    `SET ROLE anon; SELECT * FROM public.unit_price_history LIMIT 1;`,
  );
  assert(
    `${label}: unit_price_history still fully private to anon`,
    privatePrices !== null && isInsufficientPrivilege(privatePrices),
    privatePrices ? firstLine(privatePrices) : "the table was READABLE",
  );

  // A published row is actually returned — a preserved grant that returns nothing
  // would be a preserved grant in name only.
  const published = scalar(db, `SET ROLE anon; SELECT count(*) FROM public.listings;`);
  assert(`${label}: published listing visible to anon`, published === "1", `count=${published}`);
  return { readable: readable.length, columnTables: columnTables.length };
}

function assertServiceRolePreserved(db, label, beforeMatrix) {
  const tables = query(db, TABLES_SQL);
  const afterMatrix = privilegeMatrix(db);
  const drift = [];
  for (const table of tables) {
    for (const role of ["service_role", "postgres"]) {
      for (const priv of ["SELECT", ...WRITE_PRIVS]) {
        const key = `${table}|${role}|${priv}`;
        if (beforeMatrix.get(key) !== afterMatrix.get(key)) {
          drift.push(`${key}: ${beforeMatrix.get(key)} -> ${afterMatrix.get(key)}`);
        }
      }
    }
  }
  assert(
    `${label}: service_role and owner privileges unchanged on every table`,
    drift.length === 0,
    drift.length === 0
      ? `${tables.length} tables x 2 roles x 8 privileges compared`
      : drift.slice(0, 6).join("; "),
  );

  // Behavioural, not only catalogue: a real service-role write cycle.
  const cycle = expectError(
    db,
    `SET ROLE service_role;
     INSERT INTO public.listings (id,kind,title,slug,publication_status)
       VALUES ('a0000000-0000-4000-8000-0000000000ff','resale','svc probe','svc-probe','draft');
     UPDATE public.listings SET title='svc probe 2' WHERE id='a0000000-0000-4000-8000-0000000000ff';
     DELETE FROM public.listings WHERE id='a0000000-0000-4000-8000-0000000000ff';
     INSERT INTO public.leads (id,name,email,phone,status,source)
       VALUES ('11110000-0000-4000-8000-0000000000ff','Svc Probe','svc@example.invalid','+66000000002','new','contact_form');
     DELETE FROM public.leads WHERE id='11110000-0000-4000-8000-0000000000ff';
     INSERT INTO public.studio_upload_jobs (id,created_by,creator_role,workflow,status)
       VALUES ('88880000-0000-4000-8000-0000000000ff','99990000-0000-4000-8000-000000000001','owner','new_development','received');
     DELETE FROM public.studio_upload_jobs WHERE id='88880000-0000-4000-8000-0000000000ff';`,
  );
  assert(
    `${label}: service_role write cycle on listings, leads and studio_upload_jobs succeeds`,
    cycle === null,
    cycle ? firstLine(cycle) : "insert/update/delete completed on all three",
  );

  const rpc = expectError(
    db,
    `SET ROLE service_role;
     SELECT public.studio_save_project_amenities(
       '40000000-0000-4000-8000-000000000001',
       '99990000-0000-4000-8000-000000000001',
       '[{"amenity_slug":"fixture-pool","sort_order":10}]'::jsonb,
       '[]'::jsonb);`,
  );
  assert(
    `${label}: service-role-only amenities RPC still executes`,
    rpc === null,
    rpc ? firstLine(rpc) : "studio_save_project_amenities returned",
  );

  const importOwner = expectError(
    db,
    `SET ROLE forever_import_execution_owner; SELECT count(*) FROM public.projects;`,
  );
  assert(
    `${label}: import execution boundary role still reads projects`,
    importOwner === null,
    importOwner ? firstLine(importOwner) : "SELECT permitted",
  );
}

function assertRlsPreserved(db, label, beforePolicies, beforeRls) {
  assert(
    `${label}: RLS policy set byte-identical (name, command, roles, USING, WITH CHECK)`,
    sameSet(beforePolicies, policyFingerprint(db)),
    `${beforePolicies.length} policies compared, count(*)=${policyCount(db)}`,
  );
  assert(
    `${label}: RLS enabled/forced state byte-identical`,
    sameSet(beforeRls, rlsFingerprint(db)),
    `${beforeRls.length} tables compared`,
  );
  const forced = scalar(
    db,
    `SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relforcerowsecurity`,
  );
  assert(
    `${label}: FORCE ROW LEVEL SECURITY still off everywhere`,
    forced === "0",
    `forced=${forced}`,
  );
}

/**
 * The canary. For every defining owner role that has a schema-public TABLES
 * default, create a table AS that role and read the browser privileges the new
 * table was born with.
 *
 * `expectClean` is false for a defining role the migration executor is not
 * authorised to alter. That canary is expected to show inherited writes and is
 * reported as a FAILING check rather than skipped — a default the executor cannot
 * reach is a real residual exposure, and hiding it would make this suite lie.
 */
function runDefaultAclCanary(db, label, { migrated }) {
  const owners = query(
    db,
    `SELECT DISTINCT owner.rolname
     FROM pg_catalog.pg_default_acl d
     JOIN pg_catalog.pg_roles owner ON owner.oid = d.defaclrole
     JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
     WHERE n.nspname='public' AND d.defaclobjtype='r'
     ORDER BY 1`,
  );
  const outcome = [];
  for (const owner of owners) {
    const canary = `lbwr_canary_${owner.replace(/[^a-z0-9_]/gi, "_")}`;
    // Identity is re-proven before any DDL touches this cluster again.
    proveClusterIdentity(db, `canary:${owner}`);
    sql(db, `SET ROLE ${owner}; CREATE TABLE public.${canary} (id INT);`);
    const inherited = query(
      db,
      `WITH p(priv, minver) AS (VALUES ('INSERT',0),('UPDATE',0),('DELETE',0),('TRUNCATE',0),
                                      ('REFERENCES',0),('TRIGGER',0),('MAINTAIN',170000))
       SELECT w.rolname || '|' || p.priv
       FROM (VALUES ('anon'),('authenticated')) AS w(rolname) CROSS JOIN p
       WHERE current_setting('server_version_num')::int >= p.minver
         AND has_table_privilege(w.rolname::name, 'public.${canary}', p.priv)
       ORDER BY 1`,
    );
    const selectInherited = query(
      db,
      `SELECT w.rolname FROM (VALUES ('anon'),('authenticated')) AS w(rolname)
       WHERE has_table_privilege(w.rolname::name, 'public.${canary}', 'SELECT') ORDER BY 1`,
    );
    // Production authority, not this cluster's. See PRODUCTION_UNAUTHORIZED_DEFINERS.
    const authorized = !PRODUCTION_UNAUTHORIZED_DEFINERS.has(owner);

    if (!migrated) {
      // Pre-migration control: the canary MUST show the leak, otherwise the
      // canary is not measuring anything.
      assert(
        `${label}: pre-migration canary as ${owner} inherits browser writes (control)`,
        inherited.length > 0,
        `${inherited.length} write privileges inherited: ${inherited.join(",")}`,
      );
    } else if (authorized) {
      assert(
        `${label}: new table created by ${owner} inherits NO browser write privilege`,
        inherited.length === 0,
        inherited.length === 0 ? "clean" : `still inherited: ${inherited.join(",")}`,
      );
      // Documented, deliberate: default SELECT is not part of this contract.
      assert(
        `${label}: new table created by ${owner} still inherits browser SELECT (declared, not accidental)`,
        selectInherited.length === 2,
        `SELECT inherited by: ${selectInherited.join(",") || "<none>"} — default SELECT is deliberately unchanged`,
      );
    } else {
      assert(
        `${label}: default TABLES ACL for defining role ${owner} is NOT corrected by this migration`,
        false,
        `the migration executor is not a member of ${owner}, so ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} would raise 42501. ` +
          `A new table created by ${owner} still inherits: ${inherited.join(",")}. ` +
          `Required correction, run as ${owner}: ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public ` +
          `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM anon, authenticated;`,
      );
    }
    outcome.push({
      owner,
      authorized,
      inheritedWrites: inherited,
      inheritedSelect: selectInherited,
    });
    // Drop only after the cluster identity has been re-proven above.
    sql(db, `SET ROLE ${owner}; DROP TABLE public.${canary};`);
  }
  return outcome;
}

/**
 * Production's migration executor is a NON-superuser `postgres` that holds no
 * membership in `supabase_admin`. A disposable cluster's `postgres` is a
 * superuser, so it could alter any role's defaults and the canary above would
 * pass where production fails. This probe reproduces the production authority
 * exactly and measures the boundary instead of assuming it.
 */
function assertExecutorAuthorization(db, label) {
  const probe = "lbwr_exec_probe";
  proveClusterIdentity(db, "executor-probe");
  sql(
    db,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${probe}') THEN CREATE ROLE ${probe} NOSUPERUSER NOLOGIN; END IF; END $$;`,
  );
  sql(db, `GRANT ${probe} TO postgres WITH ADMIN OPTION;`);

  const own = expectError(
    db,
    `SET ROLE ${probe}; ALTER DEFAULT PRIVILEGES FOR ROLE ${probe} IN SCHEMA public ` +
      `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM anon, authenticated;`,
  );
  assert(
    `${label}: a non-superuser executor CAN alter its own schema-public TABLES default`,
    own === null,
    own ? firstLine(own) : "permitted",
  );

  const foreign = expectError(
    db,
    `SET ROLE ${probe}; ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public ` +
      `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM anon, authenticated;`,
  );
  assert(
    `${label}: a non-member executor CANNOT alter the supabase_admin default (production authority)`,
    foreign !== null,
    foreign
      ? firstLine(foreign)
      : "it SUCCEEDED — the probe role is not reproducing production authority",
  );
  return { ownDefaultAlterable: own === null, foreignDefaultAlterable: foreign === null };
}

// --------------------------------------------------------------------------
// Identity proof — runs before any DDL and again before every canary drop
// --------------------------------------------------------------------------

function proveClusterIdentity(db, stage) {
  const pidFile = join(data, "postmaster.pid");
  if (!existsSync(pidFile))
    throw new Error(`[${stage}] postmaster.pid is missing — refusing to touch this cluster`);
  const lines = readFileSync(pidFile, "utf8").split(/\r?\n/);
  const pid = Number(lines[0]);
  if (!Number.isInteger(pid) || pid <= 0)
    throw new Error(`[${stage}] postmaster.pid holds no usable PID`);
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error.code !== "EPERM") throw new Error(`[${stage}] postmaster PID ${pid} is not alive`);
  }
  const pidFileDir = realpathSync(lines[1] ?? "");
  if (pidFileDir !== realpathSync(data)) {
    throw new Error(`[${stage}] postmaster.pid points at ${pidFileDir}, not ${data}`);
  }
  const serverDir = realpathSync(scalar(db, "SHOW data_directory"));
  if (serverDir !== realpathSync(data)) {
    throw new Error(`[${stage}] the server reports data_directory=${serverDir}, not ${data}`);
  }
  const serverPort = scalar(db, "SHOW port");
  if (serverPort !== String(port)) {
    throw new Error(`[${stage}] the server reports port=${serverPort}, not ${port}`);
  }
  const marker = scalar(db, `SELECT current_setting('lbwr.marker', true)`);
  if (marker && marker !== TASK_MARKER) {
    throw new Error(`[${stage}] cluster marker ${marker} is not this run's marker ${TASK_MARKER}`);
  }
  return { pid, dataDirectory: serverDir, port: serverPort };
}

// --------------------------------------------------------------------------
// Bootstrap + chain application
// --------------------------------------------------------------------------

const migrationFiles = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

/**
 * Reproduce the Supabase platform state the migration exists to correct: TWO
 * table default-ACL entries in schema public, one per defining owner role, each
 * granting the browser roles everything. Without this the suite would prove
 * nothing — the chain would start from a clean default and the revoke would be
 * a no-op.
 */
function applyProductionFaithfulDefaults(db) {
  psqlFile(db, BOOTSTRAP);
  sql(
    db,
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_admin') THEN
         CREATE ROLE supabase_admin SUPERUSER LOGIN;
       END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='forever_import_execution_owner') THEN
         CREATE ROLE forever_import_execution_owner NOLOGIN;
       END IF;
     END $$;`,
  );
  sql(db, `GRANT CREATE ON SCHEMA public TO supabase_admin;`);
  sql(
    db,
    `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;`,
  );
  sql(
    db,
    `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;`,
  );
  sql(
    db,
    `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;`,
  );
}

/**
 * The chain, unmodified, in filename order. The Studio suite's
 * `amenities-pre-migration-seed.sql` is deliberately NOT applied here: it creates
 * `public.amenities_pre_migration_baseline`, a table production does not have, and
 * a privilege suite that measures 38 tables where production has 37 is measuring
 * the wrong schema.
 */
function applyChain(db, files) {
  for (const file of files) {
    psqlFile(db, join(MIGRATIONS_DIR, file));
  }
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

try {
  const files = migrationFiles();
  if (!files.includes(NEW_MIGRATION)) {
    throw new Error(`${NEW_MIGRATION} is missing from ${MIGRATIONS_DIR}`);
  }
  const priorFiles = files.filter((file) => file !== NEW_MIGRATION);

  port = await reserveFreePort();
  work = mkdtempSync(join(tmpdir(), "forever-lbwr-pg-"));
  data = join(work, "data");
  console.log(`[lbwr] marker ${TASK_MARKER}`);
  console.log(`[lbwr] private data directory ${data}`);
  console.log(`[lbwr] dynamically reserved port ${port}`);

  run(bin("initdb"), ["-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8"]);
  run(
    bin("pg_ctl"),
    [
      "-D",
      data,
      "-o",
      `-h 127.0.0.1 -p ${port} -c fsync=off -c synchronous_commit=off -c lbwr.marker=${TASK_MARKER}`,
      "-w",
      "-l",
      join(work, "log"),
      "start",
    ],
    { stdio: "ignore" },
  );
  started = true;

  // ---- identity proof BEFORE any DDL ------------------------------------
  const identity = proveClusterIdentity("postgres", "pre-DDL");
  results.identity = { ...identity, marker: TASK_MARKER, dataDirectoryRemovedAtEnd: true };
  const markerSeen = scalar("postgres", `SELECT current_setting('lbwr.marker', true)`);
  assert(
    "cluster identity proven before any DDL",
    markerSeen === TASK_MARKER,
    `marker=${markerSeen}, pid=${identity.pid}, data_directory=${identity.dataDirectory}, port=${identity.port}`,
  );
  assert(
    "PostgreSQL 17 or newer (MAINTAIN is a 17+ privilege)",
    Number(scalar("postgres", "SHOW server_version_num")) >= 170000,
    scalar("postgres", "SHOW server_version"),
  );

  sql("postgres", `CREATE DATABASE clean_install`);
  sql("postgres", `CREATE DATABASE upgrade_path`);

  // ======================================================================
  // PATH A — clean install of the complete chain from zero
  // ======================================================================
  console.log("\n[lbwr] PATH A — clean install (full chain from zero)");
  applyProductionFaithfulDefaults("clean_install");
  const defaultsBeforeA = defaultAclMatrix("clean_install");
  assert(
    "clean install starts from production-faithful broad defaults",
    defaultsBeforeA.filter((row) =>
      /\|(anon|authenticated)\|(INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER|MAINTAIN)$/.test(
        row,
      ),
    ).length >= 14,
    `${defaultsBeforeA.length} default ACL rows across ${new Set(defaultsBeforeA.map((r) => r.split("|")[0])).size} defining roles`,
  );
  applyChain("clean_install", files);
  const cleanResult = assertAclMatrix("clean_install", "clean install");
  psqlFile("clean_install", FIXTURES);
  assertListingsDenied("clean_install", "clean install");
  const cleanLeads = assertLeadsInsert("clean_install", "clean install");
  const defaultsAfterA = defaultAclMatrix("clean_install");
  results.cleanInstall = {
    migrationsApplied: files.length,
    tables: cleanResult.tables.length,
    violations: cleanResult.violations,
    defaultAclBefore: defaultsBeforeA,
    defaultAclAfter: defaultsAfterA,
    leadsInsert: cleanLeads,
  };

  // ======================================================================
  // PATH B — upgrade path: production's 26, then only the new migration
  // ======================================================================
  console.log("\n[lbwr] PATH B — upgrade path (26 applied migrations, then only the new one)");
  applyProductionFaithfulDefaults("upgrade_path");
  applyChain("upgrade_path", priorFiles);
  psqlFile("upgrade_path", FIXTURES);
  assert(
    "upgrade path reconstructs exactly the 26 migrations production has applied",
    priorFiles.length === 26,
    `${priorFiles.length} migrations applied before the new one`,
  );

  const beforeMatrix = privilegeMatrix("upgrade_path");
  const beforeColumns = columnGrants("upgrade_path");
  const beforePolicies = policyFingerprint("upgrade_path");
  const beforeRls = rlsFingerprint("upgrade_path");
  const beforeRelacl = relaclFingerprint("upgrade_path");
  const beforeDefaults = defaultAclMatrix("upgrade_path");
  const beforePolicyCount = policyCount("upgrade_path");
  const tablesB = query("upgrade_path", TABLES_SQL);
  // Fidelity: the reconstructed schema must match what production actually carries,
  // otherwise the ACL matrix is measured against the wrong schema.
  assert(
    "upgrade path reproduces production's 37 public tables and 37 public policies",
    tablesB.length === 37 && beforePolicyCount === 37,
    `tables=${tablesB.length} (production 37), policies=${beforePolicyCount} (production 37)`,
  );
  const beforeViolations = browserWriteViolations(beforeMatrix, tablesB);
  assert(
    "pre-migration state reproduces the production finding (browser writes present)",
    beforeViolations.length > 0,
    `${beforeViolations.length} browser write over-grants present before the migration`,
  );

  // Pre-migration canary control: it must FAIL before, or it proves nothing after.
  const canaryBefore = runDefaultAclCanary("upgrade_path", "pre-migration", { migrated: false });

  console.log(`[lbwr] applying ONLY ${NEW_MIGRATION}`);
  const migrationOutput = run(
    bin("psql"),
    psqlArgs("upgrade_path", ["-f", join(MIGRATIONS_DIR, NEW_MIGRATION)]),
  );
  process.stdout.write(migrationOutput ? `${migrationOutput}\n` : "");

  const upgradeResult = assertAclMatrix("upgrade_path", "upgrade path");
  assertListingsDenied("upgrade_path", "upgrade path");
  const upgradeLeads = assertLeadsInsert("upgrade_path", "upgrade path");
  const selectProof = assertSelectPreserved(
    "upgrade_path",
    "upgrade path",
    beforeMatrix,
    beforeColumns,
  );
  assertServiceRolePreserved("upgrade_path", "upgrade path", beforeMatrix);
  assertRlsPreserved("upgrade_path", "upgrade path", beforePolicies, beforeRls);
  const afterDefaults = defaultAclMatrix("upgrade_path");
  const browserWriteDefaults = afterDefaults.filter((row) =>
    /^postgres\|(anon|authenticated)\|(INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER|MAINTAIN)$/.test(
      row,
    ),
  );
  assert(
    "the postgres schema-public TABLES default no longer grants browser writes",
    browserWriteDefaults.length === 0,
    browserWriteDefaults.length === 0 ? "corrected" : browserWriteDefaults.join(","),
  );
  const defaultSelectKept = afterDefaults.filter((row) =>
    /^postgres\|(anon|authenticated)\|SELECT$/.test(row),
  );
  assert(
    "the postgres default still grants browser SELECT (declared decision, not an oversight)",
    defaultSelectKept.length === 2,
    defaultSelectKept.join(",") || "<none>",
  );

  // Restore production's UNCORRECTED state for every defining role the production
  // executor cannot reach, so the canary below measures production rather than this
  // superuser cluster. Recorded in the result, never silent.
  const restoredForFidelity = [];
  for (const owner of PRODUCTION_UNAUTHORIZED_DEFINERS) {
    const present = scalar(
      "upgrade_path",
      `SELECT count(*) FROM pg_roles WHERE rolname='${owner}'`,
    );
    if (present === "0") continue;
    sql(
      "upgrade_path",
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated`,
    );
    restoredForFidelity.push(owner);
  }
  console.log(
    `[lbwr] restored production's uncorrected default for: ${restoredForFidelity.join(", ") || "<none>"}`,
  );
  const canaryAfter = runDefaultAclCanary("upgrade_path", "post-migration", { migrated: true });
  const executorAuthorization = assertExecutorAuthorization("upgrade_path", "authority");

  // Idempotency: applying twice must leave the ACLs byte-identical.
  const afterFirst = relaclFingerprint("upgrade_path");
  psqlFile("upgrade_path", join(MIGRATIONS_DIR, NEW_MIGRATION));
  const afterSecond = relaclFingerprint("upgrade_path");
  assert(
    "re-applying the migration is a no-op (relacl byte-identical)",
    sameSet(afterFirst, afterSecond),
    `${afterFirst.length} relations compared`,
  );

  results.upgradePath = {
    migrationsBefore: priorFiles.length,
    tables: tablesB.length,
    beforeViolations: beforeViolations.length,
    afterViolations: upgradeResult.violations,
    beforeRelacl,
    afterRelacl: afterFirst,
    beforeDefaults,
    afterDefaults,
    beforePolicies: beforePolicies.length,
    afterPolicies: policyFingerprint("upgrade_path").length,
    leadsInsert: upgradeLeads,
    selectProof,
    canaryBefore,
    canaryAfter,
    executorAuthorization,
    productionUncorrectedDefaultsRestoredForFidelity: restoredForFidelity,
    idempotent: sameSet(afterFirst, afterSecond),
  };

  // ======================================================================
  // NEGATIVE CONTROLS — prove the suite detects each specific mistake
  // ======================================================================
  console.log("\n[lbwr] NEGATIVE CONTROLS");
  const negatives = [];

  /**
   * Each control mutates the database, re-runs the exact detector that owns the
   * invariant, requires it to go red, then restores. `detect` returns true when
   * the mistake WAS detected.
   */
  function negativeControl(name, mutate, detect, restore) {
    sql("upgrade_path", mutate);
    let detected = false;
    let detail = "";
    try {
      const outcome = detect();
      detected = outcome.detected;
      detail = outcome.detail;
    } finally {
      sql("upgrade_path", restore);
    }
    const restoredClean =
      browserWriteViolations(privilegeMatrix("upgrade_path"), query("upgrade_path", TABLES_SQL))
        .length === 0 && sameSet(beforePolicies, policyFingerprint("upgrade_path"));
    assert(`negative control detected: ${name}`, detected, detail);
    assert(
      `negative control restored: ${name}`,
      restoredClean,
      restoredClean ? "invariant clean again" : "STATE LEFT DIRTY",
    );
    negatives.push({ name, detected, restored: restoredClean, detail });
  }

  const writeDetector = () => {
    const violations = browserWriteViolations(
      privilegeMatrix("upgrade_path"),
      query("upgrade_path", TABLES_SQL),
    );
    return {
      detected: violations.length > 0,
      detail: violations.slice(0, 4).join("; ") || "not detected",
    };
  };

  negativeControl(
    "listings INSERT left granted",
    `GRANT INSERT ON public.listings TO anon`,
    writeDetector,
    `REVOKE INSERT ON public.listings FROM anon`,
  );

  negativeControl(
    "listings TRUNCATE left granted",
    `GRANT TRUNCATE ON public.listings TO anon, authenticated`,
    writeDetector,
    `REVOKE TRUNCATE ON public.listings FROM anon, authenticated`,
  );

  negativeControl(
    "existing public SELECT accidentally revoked",
    `REVOKE SELECT ON public.listings FROM anon`,
    () => {
      const matrix = privilegeMatrix("upgrade_path");
      const drift = beforeMatrix.get("listings|anon|SELECT") !== matrix.get("listings|anon|SELECT");
      return {
        detected: drift,
        detail: drift ? "SELECT drift detected on listings for anon" : "not detected",
      };
    },
    `GRANT SELECT ON public.listings TO anon`,
  );

  negativeControl(
    "leads INSERT accidentally revoked",
    `REVOKE INSERT ON public.leads FROM anon`,
    () => {
      const violations = browserWriteViolations(
        privilegeMatrix("upgrade_path"),
        query("upgrade_path", TABLES_SQL),
      );
      const lost = violations.some((entry) => entry.includes("LOST INSERT on leads"));
      const attempt = expectError(
        "upgrade_path",
        `SET ROLE anon; INSERT INTO public.leads (name,email,phone,status,source) VALUES ('x','x@example.invalid','+66000000003','new','contact_form');`,
      );
      return {
        detected: lost && attempt !== null,
        detail: lost
          ? `catalogue: LOST INSERT; behavioural: ${firstLine(attempt ?? "insert SUCCEEDED")}`
          : "not detected",
      };
    },
    `GRANT INSERT ON public.leads TO anon`,
  );

  negativeControl(
    "UPDATE left granted on one public table",
    `GRANT UPDATE ON public.projects TO authenticated`,
    writeDetector,
    `REVOKE UPDATE ON public.projects FROM authenticated`,
  );

  negativeControl(
    "default ACL still granting ALL to browser roles",
    `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated`,
    () => {
      const rows = defaultAclMatrix("upgrade_path").filter((row) =>
        /^postgres\|(anon|authenticated)\|(INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER|MAINTAIN)$/.test(
          row,
        ),
      );
      return {
        detected: rows.length > 0,
        detail:
          rows.length > 0 ? `${rows.length} write privileges back in the default` : "not detected",
      };
    },
    `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM anon, authenticated`,
  );

  negativeControl(
    "a new canary table inheriting browser writes",
    `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT INSERT, UPDATE, DELETE ON TABLES TO anon`,
    () => {
      sql("upgrade_path", `CREATE TABLE public.lbwr_negative_canary (id INT)`);
      const inherited = query(
        "upgrade_path",
        `SELECT p.priv FROM (VALUES ('INSERT'),('UPDATE'),('DELETE')) AS p(priv)
         WHERE has_table_privilege('anon','public.lbwr_negative_canary', p.priv) ORDER BY 1`,
      );
      sql("upgrade_path", `DROP TABLE public.lbwr_negative_canary`);
      return {
        detected: inherited.length > 0,
        detail: inherited.length > 0 ? `canary born with ${inherited.join(",")}` : "not detected",
      };
    },
    `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE INSERT, UPDATE, DELETE ON TABLES FROM anon`,
  );

  negativeControl(
    "RLS policy modified while ACL tests still pass",
    `ALTER POLICY "Published listings are viewable by everyone" ON public.listings USING (true)`,
    () => {
      const aclStillClean =
        browserWriteViolations(privilegeMatrix("upgrade_path"), query("upgrade_path", TABLES_SQL))
          .length === 0;
      const policyDrift = !sameSet(beforePolicies, policyFingerprint("upgrade_path"));
      return {
        detected: aclStillClean && policyDrift,
        detail: policyDrift
          ? "ACL battery stayed green and the policy fingerprint caught the change — the two checks are independent"
          : "not detected",
      };
    },
    `ALTER POLICY "Published listings are viewable by everyone" ON public.listings USING (publication_status = 'published')`,
  );

  negativeControl(
    "service-role access accidentally revoked",
    `REVOKE INSERT, UPDATE, DELETE ON public.listings FROM service_role`,
    () => {
      const matrix = privilegeMatrix("upgrade_path");
      const drift = ["INSERT", "UPDATE", "DELETE"].filter(
        (priv) =>
          beforeMatrix.get(`listings|service_role|${priv}`) !==
          matrix.get(`listings|service_role|${priv}`),
      );
      const behaviour = expectError(
        "upgrade_path",
        `SET ROLE service_role; INSERT INTO public.listings (kind,title) VALUES ('resale','svc regression probe');`,
      );
      return {
        detected: drift.length > 0 && behaviour !== null,
        detail:
          drift.length > 0
            ? `service_role lost ${drift.join(",")}; behavioural: ${firstLine(behaviour ?? "insert SUCCEEDED")}`
            : "not detected",
      };
    },
    `GRANT INSERT, UPDATE, DELETE ON public.listings TO service_role`,
  );

  negativeControl(
    "a test that passes only because RLS blocks rows while the privilege remains",
    `GRANT UPDATE ON public.listings TO anon`,
    () => {
      // The naive assertion — "the UPDATE changed nothing" — passes here, because
      // RLS filters every candidate row and the statement succeeds with zero rows.
      const naive = expectError(
        "upgrade_path",
        `SET ROLE anon; UPDATE public.listings SET title='rls only';`,
      );
      const naivePasses = naive === null;
      // The real assertion requires 42501 and therefore fails.
      const strict = naive !== null && isInsufficientPrivilege(naive);
      const violations = browserWriteViolations(
        privilegeMatrix("upgrade_path"),
        query("upgrade_path", TABLES_SQL),
      );
      return {
        detected: naivePasses && !strict && violations.length > 0,
        detail: naivePasses
          ? `UPDATE succeeded with zero rows (RLS filtered) — a "no rows changed" test would pass; this suite requires 42501 and the privilege matrix reports: ${violations.join("; ")}`
          : `the UPDATE raised ${firstLine(naive)} — the control did not reproduce the RLS-only situation`,
      };
    },
    `REVOKE UPDATE ON public.listings FROM anon`,
  );

  results.negativeControls = negatives;
  assert(
    "all ten negative controls detected and restored",
    negatives.length === 10 && negatives.every((entry) => entry.detected && entry.restored),
    `${negatives.filter((entry) => entry.detected && entry.restored).length}/10`,
  );

  // Final state after every control is restored.
  const finalCheck = assertAclMatrix("upgrade_path", "final state");
  assertRlsPreserved("upgrade_path", "final state", beforePolicies, beforeRls);
  results.finalState = { tables: finalCheck.tables.length, violations: finalCheck.violations };
} catch (error) {
  failures += 1;
  const detail = [error.stdout, error.stderr, error.message]
    .filter(Boolean)
    .map((part) => String(part).trim())
    .filter(Boolean)
    .join("\n");
  console.error(`[lbwr] HARNESS ERROR\n${detail}`);
  results.harnessError = detail;
} finally {
  if (started) {
    try {
      run(bin("pg_ctl"), ["-D", data, "-w", "-m", "fast", "stop"], { stdio: "ignore" });
      results.shutdown = "clean (pg_ctl -m fast stop)";
    } catch {
      try {
        run(bin("pg_ctl"), ["-D", data, "-w", "-m", "immediate", "stop"], { stdio: "ignore" });
        results.shutdown = "immediate fallback";
      } catch {
        results.shutdown = "pg_ctl stop failed";
      }
    }
  }
  if (work) {
    rmSync(work, { recursive: true, force: true });
    results.dataDirectoryRemoved = !existsSync(work);
  }
  results.failures = failures;
  // The supabase_admin default-ACL canary is EXPECTED to fail and is expected to keep
  // failing until someone with that authority runs the statement it prints. It is
  // separated here so it can never be mistaken for a broken test, and it is still
  // counted as a failure so it can never be mistaken for a solved problem.
  const outstanding = results.checks.filter(
    (check) => !check.pass && /is NOT corrected by this migration/.test(check.name),
  );
  results.outstandingPlatformActions = outstanding;
  results.regressions = results.checks.filter(
    (check) => !check.pass && !outstanding.includes(check),
  );
  results.verdict =
    results.regressions.length > 0
      ? "FAIL"
      : outstanding.length > 0
        ? "FAIL (only the known platform-level residual)"
        : "PASS";
  const jsonIndex = process.argv.indexOf("--json");
  if (jsonIndex > -1 && process.argv[jsonIndex + 1]) {
    writeFileSync(
      resolve(process.argv[jsonIndex + 1]),
      `${JSON.stringify(results, null, 2)}\n`,
      "utf8",
    );
  }
  console.log(
    `\n[lbwr] ${results.verdict} — ${results.checks.length} checks, ${failures} failure(s)`,
  );
  if (outstanding.length > 0) {
    console.log(
      `[lbwr] ${outstanding.length} of those failure(s) are the KNOWN platform-level residual that no repository`,
    );
    console.log(
      "[lbwr] migration can correct. Each one prints the exact statement and the role that must run it.",
    );
    console.log(
      "[lbwr] This suite stays red on purpose until that is done — it is a finding, not a broken test.",
    );
  }
  if (results.regressions.length > 0) {
    console.log(
      `[lbwr] ${results.regressions.length} REGRESSION(S) — these are real and must be fixed:`,
    );
    for (const check of results.regressions) console.log(`[lbwr]   - ${check.name}`);
  }
  console.log(`[lbwr] data directory removed: ${results.dataDirectoryRemoved === true}`);
  process.exitCode = failures === 0 ? 0 : 1;
}
