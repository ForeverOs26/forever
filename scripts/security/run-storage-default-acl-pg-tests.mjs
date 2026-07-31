#!/usr/bin/env node
/**
 * FOREVER-STORAGE-DEFAULT-ACL-HARDENING-001 — disposable PostgreSQL suite.
 *
 * Proves the contract that
 * `supabase/migrations/20260731100000_storage_default_acl_hardening.sql` defines:
 *
 *   the `postgres` role's default privileges for FUTURE tables in schema
 *   `storage` grant `anon` and `authenticated` SELECT and nothing else, while
 *   `service_role` and `postgres` keep every privilege they had, every existing
 *   relation ACL is byte-identical, and every other default-ACL entry in the
 *   database — including every `supabase_admin` row, every other schema, and all
 *   SEQUENCE and FUNCTION defaults — is untouched.
 *
 * The behavioural half has to run on a real cluster because a default ACL is only
 * observable by creating a table and reading what it was born with. The canary is
 * the whole point: it is what turns "the catalogue row looks right" into "a table
 * created here is not browser-writable".
 *
 * Everything runs on a throwaway cluster under the OS temp directory. No
 * production or staging credential is read, no linked project is used, and the
 * data directory is removed in `finally`.
 *
 *   Path A  clean install  — the complete chain from zero on top of
 *                            production-faithful Supabase bootstrap defaults.
 *   Path B  upgrade path   — the 27 migrations production has applied, capture,
 *                            then ONLY the new migration, then capture again.
 *
 * Usage: node scripts/security/run-storage-default-acl-pg-tests.mjs
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
const NEW_MIGRATION = "20260731100000_storage_default_acl_hardening.sql";

/** The seven the migration revokes. SELECT is deliberately not among them. */
const WRITE_PRIVS = ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"];
const BROWSER_ROLES = ["anon", "authenticated"];
/** Untouched by this migration, and each proven so rather than assumed. */
const PRESERVED_ROLES = ["service_role", "postgres"];

const TASK_MARKER = `sdah-${randomUUID()}`;
const results = {
  task: "FOREVER-STORAGE-DEFAULT-ACL-HARDENING-001",
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
      for (const dir of [join(base, entry, "bin"), join(base, entry)]) {
        const exe = process.platform === "win32" ? ".exe" : "";
        if (existsSync(join(dir, `initdb${exe}`)) && existsSync(join(dir, `pg_ctl${exe}`)))
          return dir;
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

function psqlFile(db, file) {
  return run(bin("psql"), psqlArgs(db, ["-f", file]));
}

function sql(db, statement) {
  return run(bin("psql"), psqlArgs(db, ["-c", statement]));
}

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

function firstLine(text) {
  return (
    String(text)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .find((line) => /error|denied|42501/i.test(line)) ?? String(text).split(/\r?\n/)[0]
  );
}

const sameSet = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

// --------------------------------------------------------------------------
// Catalog snapshots
// --------------------------------------------------------------------------

/**
 * Default ACLs as `definingRole|schema|objtype|grantee|privilege`.
 *
 * Derived from `aclexplode`, never from `information_schema`, which does not
 * expose MAINTAIN (finding F-05) and would report a default carrying MAINTAIN as
 * clean. `defaclobjtype` is a "char" and needs an explicit cast before it can be
 * concatenated.
 */
function defaultAclMatrix(db) {
  return query(
    db,
    `SELECT owner.rolname || '|' || COALESCE(n.nspname,'<ALL>') || '|' || d.defaclobjtype::text
            || '|' || COALESCE(gr.rolname::text,'PUBLIC') || '|' || a.privilege_type
     FROM pg_catalog.pg_default_acl d
     JOIN pg_catalog.pg_roles owner ON owner.oid = d.defaclrole
     LEFT JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
     CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS a
     LEFT JOIN pg_catalog.pg_roles gr ON gr.oid = a.grantee
     ORDER BY 1`,
  );
}

/** The raw ACL text per default-ACL row — the byte-level preservation baseline. */
function defaultAclRaw(db) {
  return query(
    db,
    `SELECT owner.rolname || '|' || COALESCE(n.nspname,'<ALL>') || '|' || d.defaclobjtype::text
            || '|' || COALESCE(d.defaclacl::text,'NULL')
     FROM pg_catalog.pg_default_acl d
     JOIN pg_catalog.pg_roles owner ON owner.oid = d.defaclrole
     LEFT JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
     ORDER BY 1`,
  );
}

/** Just the row this migration targets. */
const targetRow = (db) =>
  defaultAclMatrix(db)
    .filter((row) => row.startsWith("postgres|storage|r|"))
    .map((row) => row.split("|").slice(3).join("|"));

function relaclFingerprint(db, schemas = ["storage", "public"]) {
  return query(
    db,
    `SELECT n.nspname || '.' || c.relname || '|' || COALESCE(c.relacl::text,'NULL')
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN (${schemas.map((s) => `'${s}'`).join(",")})
     ORDER BY 1`,
  );
}

function ownerFingerprint(db) {
  return query(
    db,
    `SELECT n.nspname || '.' || c.relname || '|' || o.rolname
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_catalog.pg_roles o ON o.oid = c.relowner
     WHERE n.nspname IN ('storage','public')
     ORDER BY 1`,
  );
}

function rlsFingerprint(db) {
  return query(
    db,
    `SELECT n.nspname || '.' || c.relname || '|' || c.relrowsecurity::text || '|' || c.relforcerowsecurity::text
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('storage','public') AND c.relkind IN ('r','p')
     ORDER BY 1`,
  );
}

function policyFingerprint(db) {
  return query(
    db,
    `SELECT schemaname || '.' || tablename || '|' || policyname || '|' || permissive || '|' || cmd
            || '|' || COALESCE(array_to_string(roles, ','), '')
            || '|' || regexp_replace(COALESCE(qual,''), '\\s+', ' ', 'g')
            || '|' || regexp_replace(COALESCE(with_check,''), '\\s+', ' ', 'g')
     FROM pg_catalog.pg_policies WHERE schemaname IN ('storage','public')
     ORDER BY 1`,
  );
}

function schemaPrivFingerprint(db) {
  return query(
    db,
    `SELECT n.nspname || '|' || COALESCE(n.nspacl::text,'NULL')
     FROM pg_catalog.pg_namespace n ORDER BY 1`,
  );
}

/** Everything the migration must leave byte-identical, captured in one shot. */
function preservationSnapshot(db) {
  return {
    otherDefaults: defaultAclRaw(db).filter((row) => !row.startsWith("postgres|storage|r|")),
    relacl: relaclFingerprint(db),
    owners: ownerFingerprint(db),
    rls: rlsFingerprint(db),
    policies: policyFingerprint(db),
    schemaPrivs: schemaPrivFingerprint(db),
  };
}

/**
 * Compare a preservation snapshot against the live database. Returns the list of
 * properties that moved, so a caller can report WHICH one broke rather than only
 * that something did.
 */
function preservationDrift(db, before) {
  const after = preservationSnapshot(db);
  const drift = [];
  for (const key of Object.keys(before)) {
    if (!sameSet(before[key], after[key])) {
      const gained = after[key].filter((row) => !before[key].includes(row));
      const lost = before[key].filter((row) => !after[key].includes(row));
      drift.push(`${key}: +[${gained.slice(0, 3).join("; ")}] -[${lost.slice(0, 3).join("; ")}]`);
    }
  }
  return { drift, after };
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
  const marker = scalar(db, `SELECT current_setting('sdah.marker', true)`);
  if (marker && marker !== TASK_MARKER) {
    throw new Error(`[${stage}] cluster marker ${marker} is not this run's marker ${TASK_MARKER}`);
  }
  return { pid, dataDirectory: serverDir, port: serverPort };
}

// --------------------------------------------------------------------------
// Production-faithful bootstrap
// --------------------------------------------------------------------------

const migrationFiles = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

/**
 * Reproduce the Supabase platform default-ACL state this migration exists to
 * correct, measured read-only from production on 2026-07-31:
 *
 *   postgres | storage | r | {postgres=arwdDxtm, anon=arwdDxtm,
 *                             authenticated=arwdDxtm, service_role=arwdDxtm}
 *   postgres | storage | S | {postgres=rwU, anon=rwU, authenticated=rwU, service_role=rwU}
 *   postgres | storage | f | {postgres=X,   anon=X,   authenticated=X,   service_role=X}
 *
 * and the same three shapes in schema `public`, plus the `supabase_admin` rows in
 * `public`. The owner is named explicitly in each GRANT because production's rows
 * carry an explicit `postgres=...` entry; granting only to the other three
 * produces a row without it and the preservation comparison would then be
 * measuring a shape production does not have.
 *
 * `supabase_admin` deliberately gets NO entry in schema `storage`, because
 * production has none. The suite asserts it still has none afterwards.
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

  // The browser-reachable grants that Supabase Storage actually runs on, which
  // this migration must leave untouched. Production carries them DIRECTLY in the
  // relation ACLs of `storage.objects` and `storage.buckets` — granted by
  // `supabase_storage_admin`, not inherited from any default:
  //
  //   storage.objects  {…, service_role=arwdDxtm, authenticated=arwdDxtm, anon=arwdDxtm, …}
  //
  // `pg-bootstrap.sql` creates both tables before any default is widened and
  // grants only `service_role`, so without this the browser roles would hold
  // nothing on them and "existing storage ACLs are preserved" would be a claim
  // about an empty set.
  sql(db, `GRANT ALL ON storage.objects TO anon, authenticated, service_role;`);
  sql(db, `GRANT ALL ON storage.buckets TO anon, authenticated, service_role;`);

  for (const schema of ["public", "storage"]) {
    sql(
      db,
      `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ${schema} ` +
        `GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;`,
    );
    sql(
      db,
      `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ${schema} ` +
        `GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;`,
    );
    sql(
      db,
      `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ${schema} ` +
        `GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;`,
    );
  }
  // The platform residual (F-01) that this migration must NOT touch. Only in
  // `public`, exactly as production has it.
  sql(
    db,
    `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public ` +
      `GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;`,
  );
  sql(
    db,
    `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public ` +
      `GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;`,
  );
}

function applyChain(db, files) {
  for (const file of files) {
    psqlFile(db, join(MIGRATIONS_DIR, file));
  }
}

// --------------------------------------------------------------------------
// The canary — the only way to observe a default ACL
// --------------------------------------------------------------------------

/**
 * Create a table in schema `storage` AS `postgres` and read the privileges it was
 * born with. `expectClean` false is the pre-migration control: if the canary does
 * NOT show the leak beforehand, the canary is measuring nothing and the
 * post-migration result would prove nothing.
 *
 * Production's `postgres` has USAGE but NOT CREATE on schema `storage` — schema
 * `storage` is owned by `supabase_admin` — so this exact table cannot be created
 * there in production today, which is why the defect is latent rather than live.
 * In this cluster `postgres` owns the bootstrap-created `storage` schema and so
 * can create the canary directly. That is deliberate: the canary's job is to
 * simulate the platform change that WOULD make the default fire, and to measure
 * what a table born under it actually carries. The authority that production's
 * executor really has is measured separately by `assertExecutorAuthorization`.
 */
function storageCanary(db, label, { migrated }) {
  const canary = `sdah_canary_${migrated ? "after" : "before"}`;
  proveClusterIdentity(db, `canary:${canary}`);
  sql(db, `CREATE TABLE storage.${canary} (id INT);`);

  const inheritedWrites = query(
    db,
    `WITH p(priv, minver) AS (VALUES ('INSERT',0),('UPDATE',0),('DELETE',0),('TRUNCATE',0),
                                     ('REFERENCES',0),('TRIGGER',0),('MAINTAIN',170000))
     SELECT w.rolname || '|' || p.priv
     FROM (VALUES ('anon'),('authenticated')) AS w(rolname) CROSS JOIN p
     WHERE current_setting('server_version_num')::int >= p.minver
       AND has_table_privilege(w.rolname::name, 'storage.${canary}', p.priv)
     ORDER BY 1`,
  );
  const inheritedSelect = query(
    db,
    `SELECT w.rolname FROM (VALUES ('anon'),('authenticated')) AS w(rolname)
     WHERE has_table_privilege(w.rolname::name, 'storage.${canary}', 'SELECT') ORDER BY 1`,
  );
  const preserved = query(
    db,
    `WITH p(priv, minver) AS (VALUES ('SELECT',0),('INSERT',0),('UPDATE',0),('DELETE',0),('TRUNCATE',0),
                                     ('REFERENCES',0),('TRIGGER',0),('MAINTAIN',170000))
     SELECT w.rolname || '|' || p.priv
     FROM (VALUES ('service_role'),('postgres')) AS w(rolname) CROSS JOIN p
     WHERE current_setting('server_version_num')::int >= p.minver
       AND has_table_privilege(w.rolname::name, 'storage.${canary}', p.priv)
     ORDER BY 1`,
  );

  if (!migrated) {
    assert(
      `${label}: pre-migration canary in schema storage inherits browser writes (control)`,
      inheritedWrites.length === 14,
      inheritedWrites.length === 14
        ? `both browser roles inherited all 7 write privileges: ${inheritedWrites.join(",")}`
        : `expected 14 inherited write cells, got ${inheritedWrites.length}: ${inheritedWrites.join(",")}`,
    );
  } else {
    assert(
      `${label}: a future storage table created by postgres inherits NO browser write privilege`,
      inheritedWrites.length === 0,
      inheritedWrites.length === 0 ? "clean" : `still inherited: ${inheritedWrites.join(",")}`,
    );
    assert(
      `${label}: it still inherits browser SELECT for both roles (declared decision, not an oversight)`,
      inheritedSelect.length === 2,
      `SELECT inherited by: ${inheritedSelect.join(",") || "<none>"}`,
    );
    assert(
      `${label}: service_role and postgres keep all 8 privileges on the future storage table`,
      preserved.length === 16,
      `${preserved.length}/16 preserved cells`,
    );
    // Behavioural, not only catalogue: the roles are made to try it for real.
    for (const role of BROWSER_ROLES) {
      const write = expectError(
        db,
        `SET ROLE ${role}; INSERT INTO storage.${canary} (id) VALUES (1);`,
      );
      assert(
        `${label}: ${role} is refused an INSERT into the future storage table by privilege`,
        write !== null && isInsufficientPrivilege(write),
        write === null ? "the INSERT SUCCEEDED" : firstLine(write),
      );
      const read = expectError(db, `SET ROLE ${role}; SELECT count(*) FROM storage.${canary};`);
      assert(
        `${label}: ${role} can still SELECT from the future storage table`,
        read === null,
        read ? firstLine(read) : "permitted",
      );
    }
    const svc = expectError(
      db,
      `SET ROLE service_role; INSERT INTO storage.${canary} (id) VALUES (2); DELETE FROM storage.${canary};`,
    );
    assert(
      `${label}: service_role still writes the future storage table`,
      svc === null,
      svc ? firstLine(svc) : "insert/delete completed",
    );
  }

  proveClusterIdentity(db, `canary-drop:${canary}`);
  sql(db, `DROP TABLE storage.${canary};`);
  return { inheritedWrites, inheritedSelect, preserved };
}

/**
 * Production's migration executor is a NON-superuser `postgres` holding USAGE but
 * NOT CREATE on schema `storage`, which is owned by `supabase_admin`. A disposable
 * cluster's `postgres` is a superuser and could alter anyone's defaults, so the
 * canary alone would pass here and could still fail in production. This probe
 * reproduces production's authority exactly and measures the boundary.
 */
function assertExecutorAuthorization(db, label) {
  const probe = "sdah_exec_probe";
  const foreignOwner = "sdah_foreign_owner";
  proveClusterIdentity(db, "executor-probe");
  sql(
    db,
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${probe}') THEN
         CREATE ROLE ${probe} NOSUPERUSER NOLOGIN;
       END IF;
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${foreignOwner}') THEN
         CREATE ROLE ${foreignOwner} NOSUPERUSER NOLOGIN;
       END IF;
     END $$;`,
  );
  sql(db, `GRANT ${probe}, ${foreignOwner} TO postgres WITH ADMIN OPTION;`);
  // Production's exact shape: USAGE on the schema, and explicitly NOT CREATE.
  sql(db, `REVOKE ALL ON SCHEMA storage FROM ${probe};`);
  sql(db, `GRANT USAGE ON SCHEMA storage TO ${probe};`);
  const hasCreate = scalar(db, `SELECT has_schema_privilege('${probe}','storage','CREATE')`);
  const hasUsage = scalar(db, `SELECT has_schema_privilege('${probe}','storage','USAGE')`);
  assert(
    `${label}: the probe reproduces production's executor shape — USAGE yes, CREATE no`,
    hasUsage === "t" && hasCreate === "f",
    `USAGE=${hasUsage} CREATE=${hasCreate}`,
  );

  // The load-bearing authority claim: altering its OWN default is permitted even
  // without CREATE on the schema. This is why F-03 is self-service and F-01 is not.
  const own = expectError(
    db,
    `SET ROLE ${probe}; ALTER DEFAULT PRIVILEGES FOR ROLE ${probe} IN SCHEMA storage ` +
      `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM anon, authenticated;`,
  );
  assert(
    `${label}: a non-superuser with USAGE-only on schema storage CAN alter its OWN TABLES default`,
    own === null,
    own ? firstLine(own) : "permitted — this is the authority the migration relies on",
  );

  // And the boundary that keeps the supabase_admin residual out of reach.
  const foreign = expectError(
    db,
    `SET ROLE ${probe}; ALTER DEFAULT PRIVILEGES FOR ROLE ${foreignOwner} IN SCHEMA storage ` +
      `REVOKE INSERT ON TABLES FROM anon;`,
  );
  assert(
    `${label}: the same role CANNOT alter another role's default (the F-01 boundary)`,
    foreign !== null && isInsufficientPrivilege(foreign),
    foreign
      ? firstLine(foreign)
      : "it SUCCEEDED — the probe is not reproducing production authority",
  );

  sql(db, `REVOKE USAGE ON SCHEMA storage FROM ${probe};`);
  sql(db, `DROP OWNED BY ${probe}, ${foreignOwner};`);
  sql(db, `DROP ROLE IF EXISTS ${probe}; DROP ROLE IF EXISTS ${foreignOwner};`);
  return { ownDefaultAlterable: own === null, foreignDefaultAlterable: foreign === null };
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
  work = mkdtempSync(join(tmpdir(), "forever-sdah-pg-"));
  data = join(work, "data");
  console.log(`[sdah] marker ${TASK_MARKER}`);
  console.log(`[sdah] private data directory ${data}`);
  console.log(`[sdah] dynamically reserved port ${port}`);

  run(bin("initdb"), ["-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8"], {
    stdio: "ignore",
  });
  run(
    bin("pg_ctl"),
    [
      "-D",
      data,
      "-o",
      `-h 127.0.0.1 -p ${port} -c fsync=off -c synchronous_commit=off -c sdah.marker=${TASK_MARKER}`,
      "-w",
      "-l",
      join(work, "log"),
      "start",
    ],
    { stdio: "ignore" },
  );
  started = true;

  const identity = proveClusterIdentity("postgres", "pre-DDL");
  results.identity = { ...identity, marker: TASK_MARKER };
  const markerSeen = scalar("postgres", `SELECT current_setting('sdah.marker', true)`);
  assert(
    "cluster identity proven before any DDL",
    markerSeen === TASK_MARKER,
    `marker=${markerSeen}, pid=${identity.pid}, data_directory=${identity.dataDirectory}, port=${identity.port}`,
  );
  const versionNum = Number(scalar("postgres", "SHOW server_version_num"));
  results.serverVersion = scalar("postgres", "SHOW server_version");
  assert(
    "PostgreSQL 17 or newer (MAINTAIN is a 17+ privilege, and production is 17.6)",
    versionNum >= 170000,
    results.serverVersion,
  );

  sql("postgres", `CREATE DATABASE clean_install`);
  sql("postgres", `CREATE DATABASE upgrade_path`);

  // ======================================================================
  // PATH A — clean install of the complete chain from zero
  // ======================================================================
  console.log("\n[sdah] PATH A — clean install (full chain from zero)");
  applyProductionFaithfulDefaults("clean_install");
  const cleanBeforeTarget = targetRow("clean_install");
  assert(
    "clean install starts from the production-faithful broad storage default",
    WRITE_PRIVS.every((priv) =>
      BROWSER_ROLES.every((role) => cleanBeforeTarget.includes(`${role}|${priv}`)),
    ),
    `${cleanBeforeTarget.length} grantee/privilege cells before the chain`,
  );
  applyChain("clean_install", files);
  const cleanAfterTarget = targetRow("clean_install");
  const cleanLeaks = cleanAfterTarget.filter((cell) =>
    BROWSER_ROLES.some((role) => WRITE_PRIVS.some((priv) => cell === `${role}|${priv}`)),
  );
  assert(
    "clean install: no browser write survives in the postgres/storage TABLES default",
    cleanLeaks.length === 0,
    cleanLeaks.length === 0 ? cleanAfterTarget.join(", ") : `leaked: ${cleanLeaks.join(",")}`,
  );
  assert(
    "clean install: both browser roles keep default SELECT",
    BROWSER_ROLES.every((role) => cleanAfterTarget.includes(`${role}|SELECT`)),
    cleanAfterTarget.filter((c) => c.endsWith("|SELECT")).join(", "),
  );
  const cleanCanary = storageCanary("clean_install", "clean install", { migrated: true });
  results.cleanInstall = {
    migrationsApplied: files.length,
    targetBefore: cleanBeforeTarget,
    targetAfter: cleanAfterTarget,
    canary: cleanCanary,
  };

  // ======================================================================
  // PATH B — upgrade: production's 27, then only the new migration
  // ======================================================================
  console.log("\n[sdah] PATH B — upgrade path (27 applied migrations, then only the new one)");
  applyProductionFaithfulDefaults("upgrade_path");
  applyChain("upgrade_path", priorFiles);
  assert(
    "upgrade path reconstructs exactly the 27 migrations production has applied",
    priorFiles.length === 27,
    `${priorFiles.length} migrations applied before the new one`,
  );
  const tablesPublic = scalar(
    "upgrade_path",
    `SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind IN ('r','p')`,
  );
  assert(
    "upgrade path reproduces production's 37 public tables",
    tablesPublic === "37",
    `tables=${tablesPublic} (production 37)`,
  );

  const beforeTarget = targetRow("upgrade_path");
  const before = preservationSnapshot("upgrade_path");
  results.upgradePath = { targetBefore: beforeTarget };

  // Pre-migration control: the defect must be present, or nothing is being proven.
  const missingBefore = BROWSER_ROLES.flatMap((role) =>
    WRITE_PRIVS.filter((priv) => !beforeTarget.includes(`${role}|${priv}`)).map(
      (priv) => `${role}|${priv}`,
    ),
  );
  assert(
    "STARTING DEFECT: before the migration, the postgres/storage TABLES default grants both browser roles all seven writes",
    missingBefore.length === 0,
    missingBefore.length === 0
      ? `measured: ${beforeTarget.join(", ")}`
      : `not reproduced, missing: ${missingBefore.join(",")}`,
  );
  const canaryBefore = storageCanary("upgrade_path", "pre-migration", { migrated: false });

  console.log(`[sdah] applying ONLY ${NEW_MIGRATION}`);
  const migrationOutput = run(
    bin("psql"),
    psqlArgs("upgrade_path", ["-f", join(MIGRATIONS_DIR, NEW_MIGRATION)]),
  );
  process.stdout.write(migrationOutput ? `${migrationOutput}\n` : "");

  const afterTarget = targetRow("upgrade_path");
  const leaked = afterTarget.filter((cell) =>
    BROWSER_ROLES.some((role) => WRITE_PRIVS.some((priv) => cell === `${role}|${priv}`)),
  );
  assert(
    "upgrade: no browser write survives in the postgres/storage TABLES default",
    leaked.length === 0,
    leaked.length === 0 ? `end state: ${afterTarget.join(", ")}` : `leaked: ${leaked.join(",")}`,
  );
  for (const role of BROWSER_ROLES) {
    assert(
      `upgrade: ${role} keeps default SELECT in the postgres/storage TABLES default`,
      afterTarget.includes(`${role}|SELECT`),
      afterTarget.includes(`${role}|SELECT`)
        ? "SELECT preserved"
        : "SELECT was REVOKED — regression",
    );
  }
  for (const role of PRESERVED_ROLES) {
    const beforeCells = beforeTarget.filter((c) => c.startsWith(`${role}|`)).sort();
    const afterCells = afterTarget.filter((c) => c.startsWith(`${role}|`)).sort();
    assert(
      `upgrade: ${role} privileges inside the targeted default are unchanged`,
      sameSet(beforeCells, afterCells),
      `${beforeCells.length} before / ${afterCells.length} after`,
    );
  }

  // The fourteen preservation properties, in one comparison per property.
  const { drift } = preservationDrift("upgrade_path", before);
  assert(
    "upgrade: every other default ACL, relation ACL, owner, RLS state, policy and schema privilege is byte-identical",
    drift.length === 0,
    drift.length === 0
      ? `otherDefaults=${before.otherDefaults.length}, relacl=${before.relacl.length}, owners=${before.owners.length}, rls=${before.rls.length}, policies=${before.policies.length}, schemaPrivs=${before.schemaPrivs.length} — all identical`
      : drift.join(" || "),
  );
  // Named individually so a reviewer sees each required property asserted.
  assert(
    "upgrade: supabase_admin default ACLs unchanged in EVERY schema",
    sameSet(
      before.otherDefaults.filter((r) => r.startsWith("supabase_admin|")),
      defaultAclRaw("upgrade_path").filter((r) => r.startsWith("supabase_admin|")),
    ),
    `${before.otherDefaults.filter((r) => r.startsWith("supabase_admin|")).length} supabase_admin rows compared`,
  );
  assert(
    "upgrade: supabase_admin still has NO default-ACL entry in schema storage (production has none)",
    defaultAclRaw("upgrade_path").filter((r) => r.startsWith("supabase_admin|storage|")).length ===
      0,
    "absent before and after",
  );
  assert(
    "upgrade: the postgres/public TABLES default is unchanged",
    sameSet(
      before.otherDefaults.filter((r) => r.startsWith("postgres|public|r|")),
      defaultAclRaw("upgrade_path").filter((r) => r.startsWith("postgres|public|r|")),
    ),
    before.otherDefaults.filter((r) => r.startsWith("postgres|public|r|")).join(" "),
  );
  assert(
    "upgrade: SEQUENCE and FUNCTION defaults are unchanged in every schema",
    sameSet(
      before.otherDefaults.filter((r) => /\|[Sf]\|/.test(r)),
      defaultAclRaw("upgrade_path").filter((r) => /\|[Sf]\|/.test(r)),
    ),
    `${before.otherDefaults.filter((r) => /\|[Sf]\|/.test(r)).length} sequence/function rows compared`,
  );

  const canaryAfter = storageCanary("upgrade_path", "post-migration", { migrated: true });
  const executorAuthorization = assertExecutorAuthorization("upgrade_path", "authority");

  // Idempotence: the second application must change nothing at all.
  const beforeSecond = {
    target: targetRow("upgrade_path"),
    ...preservationSnapshot("upgrade_path"),
  };
  psqlFile("upgrade_path", join(MIGRATIONS_DIR, NEW_MIGRATION));
  const afterSecond = {
    target: targetRow("upgrade_path"),
    ...preservationSnapshot("upgrade_path"),
  };
  const idempotentKeys = Object.keys(beforeSecond).filter(
    (key) => !sameSet(beforeSecond[key], afterSecond[key]),
  );
  assert(
    "re-applying the migration is a no-op (default ACL, relation ACL, policy, ownership and schema privileges byte-identical)",
    idempotentKeys.length === 0,
    idempotentKeys.length === 0
      ? `${Object.keys(beforeSecond).length} fingerprints compared, all identical`
      : `moved: ${idempotentKeys.join(",")}`,
  );

  // Clean install and upgrade must converge on the same security state.
  const converge = sameSet(cleanAfterTarget.slice().sort(), afterTarget.slice().sort());
  assert(
    "clean install and upgrade converge on an equivalent postgres/storage TABLES default",
    converge,
    converge
      ? `both: ${afterTarget.join(", ")}`
      : `clean=[${cleanAfterTarget.join(",")}] upgrade=[${afterTarget.join(",")}]`,
  );

  results.upgradePath = {
    migrationsBefore: priorFiles.length,
    targetBefore: beforeTarget,
    targetAfter: afterTarget,
    canaryBefore,
    canaryAfter,
    executorAuthorization,
    preservationDrift: drift,
    idempotent: idempotentKeys.length === 0,
    convergesWithCleanInstall: converge,
  };

  // ======================================================================
  // NEGATIVE CONTROLS — prove the suite detects each specific mistake
  // ======================================================================
  console.log("\n[sdah] NEGATIVE CONTROLS");
  const negatives = [];

  /**
   * Each control mutates the database, re-runs the detector that owns the
   * invariant, requires it to go red, then restores. `detect` returns
   * `{detected, detail}`.
   */
  /** Everything that could possibly move, as one comparable list. */
  const globalState = () => {
    const snapshot = preservationSnapshot("upgrade_path");
    return [
      ...targetRow("upgrade_path").map((row) => `target|${row}`),
      ...Object.entries(snapshot).flatMap(([key, rows]) => rows.map((row) => `${key}|${row}`)),
    ];
  };

  function negativeControl(name, mutate, detect, restore) {
    const stateBeforeMutation = globalState();
    sql("upgrade_path", mutate);
    // A control whose mutation is a silent no-op proves nothing, and its restore
    // then ADDS a privilege that was never there — quietly poisoning every later
    // control. Both halves have to be real, so the mutation is required to move
    // something before the detector is even consulted.
    const mutationTookEffect = !sameSet(stateBeforeMutation, globalState());
    let detected = false;
    let detail = "";
    try {
      const outcome = detect();
      detected = outcome.detected;
      detail = outcome.detail;
    } finally {
      sql("upgrade_path", restore);
    }
    assert(
      `negative control is real (its mutation actually changed the database): ${name}`,
      mutationTookEffect,
      mutationTookEffect
        ? "state moved before the detector ran"
        : "the mutation was a NO-OP against this fixture — the control is vacuous and its restore would add a grant that was never there",
    );
    const target = targetRow("upgrade_path");
    const restoredClean =
      target.filter((cell) =>
        BROWSER_ROLES.some((role) => WRITE_PRIVS.some((priv) => cell === `${role}|${priv}`)),
      ).length === 0 &&
      BROWSER_ROLES.every((role) => target.includes(`${role}|SELECT`)) &&
      preservationDrift("upgrade_path", before).drift.length === 0;
    assert(`negative control detected: ${name}`, detected, detail);
    assert(
      `negative control restored: ${name}`,
      restoredClean,
      restoredClean ? "invariant clean again" : "STATE LEFT DIRTY",
    );
    negatives.push({ name, detected, restored: restoredClean, mutationTookEffect, detail });
  }

  /** The detector that owns "no browser write in the targeted default". */
  const targetWriteDetector = () => {
    const leaks = targetRow("upgrade_path").filter((cell) =>
      BROWSER_ROLES.some((role) => WRITE_PRIVS.some((priv) => cell === `${role}|${priv}`)),
    );
    return { detected: leaks.length > 0, detail: leaks.join(",") || "not detected" };
  };

  /** The detector that owns every preservation property. */
  const preservationDetector = () => {
    const { drift: d } = preservationDrift("upgrade_path", before);
    return { detected: d.length > 0, detail: d.join(" || ") || "not detected" };
  };

  // 1-7. Each of the seven write privileges retained, one control each. A single
  // combined control would pass if the suite detected only one of them.
  for (const priv of WRITE_PRIVS) {
    negativeControl(
      `${priv} retained in the postgres/storage TABLES default`,
      `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ${priv} ON TABLES TO anon, authenticated`,
      () => {
        const outcome = targetWriteDetector();
        // Behavioural too: a table born now must actually carry the privilege.
        sql("upgrade_path", `CREATE TABLE storage.sdah_neg_canary (id INT)`);
        const born = query(
          "upgrade_path",
          `SELECT w.rolname FROM (VALUES ('anon'),('authenticated')) AS w(rolname)
           WHERE has_table_privilege(w.rolname::name,'storage.sdah_neg_canary','${priv}') ORDER BY 1`,
        );
        sql("upgrade_path", `DROP TABLE storage.sdah_neg_canary`);
        return {
          detected: outcome.detected && born.length === 2,
          detail: outcome.detected
            ? `catalogue: ${outcome.detail}; canary born with ${priv} for ${born.join(",")}`
            : "not detected",
        };
      },
      `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage REVOKE ${priv} ON TABLES FROM anon, authenticated`,
    );
  }

  // 8. SELECT accidentally revoked — the opposite mistake, and the one a
  //    REVOKE ALL would make.
  negativeControl(
    "SELECT accidentally revoked from the postgres/storage TABLES default",
    `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage REVOKE SELECT ON TABLES FROM anon, authenticated`,
    () => {
      const target = targetRow("upgrade_path");
      const lost = BROWSER_ROLES.filter((role) => !target.includes(`${role}|SELECT`));
      sql("upgrade_path", `CREATE TABLE storage.sdah_neg_select (id INT)`);
      const readable = query(
        "upgrade_path",
        `SELECT w.rolname FROM (VALUES ('anon'),('authenticated')) AS w(rolname)
         WHERE has_table_privilege(w.rolname::name,'storage.sdah_neg_select','SELECT') ORDER BY 1`,
      );
      sql("upgrade_path", `DROP TABLE storage.sdah_neg_select`);
      return {
        detected: lost.length === 2 && readable.length === 0,
        detail:
          lost.length > 0
            ? `default SELECT lost for ${lost.join(",")}; a table born now is unreadable by both browser roles`
            : "not detected",
      };
    },
    `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT SELECT ON TABLES TO anon, authenticated`,
  );

  // 9. An EXISTING storage table's ACL changed.
  negativeControl(
    "an existing storage table ACL changed",
    `REVOKE SELECT ON storage.objects FROM anon`,
    preservationDetector,
    `GRANT SELECT ON storage.objects TO anon`,
  );

  // 10. The public default ACL changed — the row 20260730090000 established.
  negativeControl(
    "the postgres/public TABLES default ACL changed",
    `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT INSERT ON TABLES TO anon`,
    preservationDetector,
    `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE INSERT ON TABLES FROM anon`,
  );

  // 11. A supabase_admin default changed — the residual this must not touch.
  //     Stated as a GRANT rather than a REVOKE: by this point the chain has
  //     already reduced anon to SELECT in that row (this cluster's superuser
  //     `postgres` IS authorised for supabase_admin, unlike production's), so a
  //     REVOKE of INSERT would be a no-op and the control would be vacuous.
  negativeControl(
    "a supabase_admin default ACL changed",
    `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT INSERT ON TABLES TO anon`,
    preservationDetector,
    `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE INSERT ON TABLES FROM anon`,
  );

  // 12. A SEQUENCE default changed.
  negativeControl(
    "a SEQUENCE default ACL changed",
    `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage REVOKE UPDATE ON SEQUENCES FROM anon`,
    preservationDetector,
    `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT UPDATE ON SEQUENCES TO anon`,
  );

  // 13. A FUNCTION default changed.
  negativeControl(
    "a FUNCTION default ACL changed",
    `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage REVOKE EXECUTE ON FUNCTIONS FROM anon`,
    preservationDetector,
    `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT EXECUTE ON FUNCTIONS TO anon`,
  );

  // 14. service_role's default write access removed.
  negativeControl(
    "service_role lost its default write access in schema storage",
    `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage REVOKE INSERT, UPDATE, DELETE ON TABLES FROM service_role`,
    () => {
      const target = targetRow("upgrade_path");
      const lost = ["INSERT", "UPDATE", "DELETE"].filter(
        (priv) => !target.includes(`service_role|${priv}`),
      );
      sql("upgrade_path", `CREATE TABLE storage.sdah_neg_svc (id INT)`);
      const behaviour = expectError(
        "upgrade_path",
        `SET ROLE service_role; INSERT INTO storage.sdah_neg_svc (id) VALUES (1);`,
      );
      sql("upgrade_path", `DROP TABLE storage.sdah_neg_svc`);
      return {
        detected: lost.length === 3 && behaviour !== null,
        detail:
          lost.length > 0
            ? `service_role lost ${lost.join(",")}; behavioural: ${firstLine(behaviour ?? "the INSERT SUCCEEDED")}`
            : "not detected",
      };
    },
    `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT INSERT, UPDATE, DELETE ON TABLES TO service_role`,
  );

  // 15. The migration targeting a different schema.
  negativeControl(
    "the migration targeting another schema (public instead of storage)",
    `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE SELECT ON TABLES FROM anon, authenticated`,
    preservationDetector,
    `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO anon, authenticated`,
  );

  // 16. The migration targeting a different owner role. Same direction argument
  //     as control 11: anon and authenticated already hold SELECT only in that
  //     row, so the change that is real here is a GRANT.
  negativeControl(
    "the migration targeting another owner role (supabase_admin instead of postgres)",
    `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT TRUNCATE, TRIGGER ON TABLES TO anon, authenticated`,
    preservationDetector,
    `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE TRUNCATE, TRIGGER ON TABLES FROM anon, authenticated`,
  );

  // 17. REVOKE ALL substituted for the seven named privileges. The catalogue row
  //     ends with the writes gone, so the write detector STAYS GREEN — only the
  //     SELECT-preservation check catches it. That is the whole reason the
  //     migration names privileges instead of reaching for ALL.
  negativeControl(
    "REVOKE ALL substituted for the seven named write privileges",
    `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage REVOKE ALL ON TABLES FROM anon, authenticated`,
    () => {
      const writeStillClean = targetWriteDetector().detected === false;
      const target = targetRow("upgrade_path");
      const selectLost = BROWSER_ROLES.filter((role) => !target.includes(`${role}|SELECT`));
      return {
        detected: writeStillClean && selectLost.length === 2,
        detail:
          selectLost.length === 2
            ? `the write detector stayed GREEN (REVOKE ALL does remove the writes) and only the SELECT-preservation check caught it — default SELECT lost for ${selectLost.join(",")}`
            : "not detected",
      };
    },
    `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT SELECT ON TABLES TO anon, authenticated`,
  );

  // 18. Failure after partial modification must roll the whole thing back. The
  //     migration is run with an injected postcondition failure and the database
  //     must be byte-identical afterwards.
  {
    const beforeAbort = {
      target: targetRow("upgrade_path"),
      ...preservationSnapshot("upgrade_path"),
    };
    // Re-widen the default so the migration has real work to do, then force its
    // postcondition to fail by corrupting the expected value it compares against.
    const abortScript = join(work, "abort-control.sql");
    writeFileSync(
      abortScript,
      `BEGIN;
       ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage
         GRANT INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
       DO $$ BEGIN
         IF EXISTS (
           SELECT 1 FROM pg_catalog.pg_default_acl d
           JOIN pg_catalog.pg_roles o ON o.oid=d.defaclrole
           JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace
           CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a
           LEFT JOIN pg_catalog.pg_roles g ON g.oid=a.grantee
           WHERE o.rolname='postgres' AND n.nspname='storage' AND d.defaclobjtype='r'
             AND g.rolname='anon' AND a.privilege_type='INSERT'
         ) THEN
           RAISE EXCEPTION 'sdah injected postcondition failure after a real modification';
         END IF;
       END $$;
       COMMIT;`,
      "utf8",
    );
    const aborted = expectError("upgrade_path", `\\i ${abortScript.replace(/\\/g, "/")}`);
    const afterAbort = {
      target: targetRow("upgrade_path"),
      ...preservationSnapshot("upgrade_path"),
    };
    const movedKeys = Object.keys(beforeAbort).filter(
      (key) => !sameSet(beforeAbort[key], afterAbort[key]),
    );
    const detected = aborted !== null && movedKeys.length === 0;
    assert(
      "negative control detected: failure after partial modification rolls the whole transaction back",
      detected,
      aborted === null
        ? "the script did NOT raise — the control did not reproduce a failure"
        : movedKeys.length === 0
          ? `raised after a real ALTER, and every fingerprint is byte-identical afterwards: ${firstLine(aborted)}`
          : `raised, but state MOVED: ${movedKeys.join(",")}`,
    );
    negatives.push({
      name: "failure after partial modification rolls back",
      detected,
      restored: movedKeys.length === 0,
      detail: aborted ? firstLine(aborted) : "no error raised",
    });
  }

  results.negativeControls = negatives;
  assert(
    "all eighteen negative controls were real, detected and restored",
    negatives.length === 18 &&
      negatives.every(
        (entry) => entry.detected && entry.restored && entry.mutationTookEffect !== false,
      ),
    `${
      negatives.filter(
        (entry) => entry.detected && entry.restored && entry.mutationTookEffect !== false,
      ).length
    }/18`,
  );

  // Final state after every control is restored.
  const finalTarget = targetRow("upgrade_path");
  const finalDrift = preservationDrift("upgrade_path", before).drift;
  assert(
    "final state: the contract holds and nothing is left dirty",
    finalDrift.length === 0 &&
      finalTarget.filter((cell) =>
        BROWSER_ROLES.some((role) => WRITE_PRIVS.some((priv) => cell === `${role}|${priv}`)),
      ).length === 0,
    finalDrift.length === 0 ? finalTarget.join(", ") : finalDrift.join(" || "),
  );
  results.finalState = { target: finalTarget, drift: finalDrift };
} catch (error) {
  failures += 1;
  const detail = [error.stdout, error.stderr, error.message]
    .filter(Boolean)
    .map((part) => String(part).trim())
    .filter(Boolean)
    .join("\n");
  console.error(`[sdah] HARNESS ERROR\n${detail}`);
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
  results.verdict = failures === 0 ? "PASS" : "FAIL";
  const jsonIndex = process.argv.indexOf("--json");
  if (jsonIndex > -1 && process.argv[jsonIndex + 1]) {
    writeFileSync(
      resolve(process.argv[jsonIndex + 1]),
      `${JSON.stringify(results, null, 2)}\n`,
      "utf8",
    );
  }
  console.log(
    `\n[sdah] ${results.verdict} — ${results.checks.length} checks, ${failures} failure(s)`,
  );
  if (failures > 0) {
    for (const check of results.checks.filter((entry) => !entry.pass)) {
      console.log(`[sdah]   - ${check.name}`);
    }
  }
  console.log(`[sdah] data directory removed: ${results.dataDirectoryRemoved === true}`);
  process.exitCode = failures === 0 ? 0 : 1;
}
