/**
 * FOREVER-STORAGE-DEFAULT-ACL-HARDENING-001 — the static half of the storage
 * future-table default-ACL contract.
 *
 * The behavioural half runs on a disposable PostgreSQL 17 cluster
 * (`npm run security:storage-pg-test`), because a default ACL is only observable
 * by creating a table and reading what it was born with. What a unit test CAN own
 * is everything decidable from the migration's text: that it targets exactly one
 * defining role, one schema and one object type; that it names seven write
 * privileges instead of reaching for REVOKE ALL; that it never revokes SELECT;
 * that it mutates nothing in `public`, nothing belonging to `supabase_admin`, no
 * sequence or function default and no existing table; that it writes no row; and
 * that it proves its own preservation postconditions before committing.
 *
 * These are precisely the properties a future edit is most likely to break by
 * accident, and the ones that would be expensive to notice in production.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const MIGRATIONS = resolve(root, "supabase/migrations");

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

/** The migration with every comment line stripped — only what the server runs. */
function executable(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

const migrationFiles = readdirSync(MIGRATIONS)
  .filter((entry) => entry.endsWith(".sql"))
  .sort();

const hardeningMigrations = migrationFiles.filter((entry) =>
  entry.includes("storage_default_acl_hardening"),
);

const WRITE_PRIVILEGES = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
  "MAINTAIN",
] as const;

describe("storage future-table default-ACL migration", () => {
  it("exists exactly once and sorts after the migration it completes", () => {
    expect(hardeningMigrations, "exactly one storage default-ACL migration").toHaveLength(1);
    const [file] = hardeningMigrations;

    // It must land after 20260730090000, which hardened the same class of default
    // for schema `public` and established the seven-privilege vocabulary this file
    // reuses. Deliberately not "it is the last migration in the chain": that would
    // be true today and would fail for the next unrelated migration.
    expect(file > "20260730090000").toBe(true);
    expect(migrationFiles.indexOf(file)).toBeGreaterThan(
      migrationFiles.findIndex((entry) => entry.startsWith("20260730090000")),
    );
  });

  const [file] = hardeningMigrations;
  const sql = readFileSync(join(MIGRATIONS, file ?? ""), "utf8");
  const ddl = executable(sql);

  it("is atomic — exactly one BEGIN and one COMMIT", () => {
    expect(ddl.match(/^\s*BEGIN;/gm) ?? []).toHaveLength(1);
    expect(ddl.match(/^\s*COMMIT;\s*$/gm) ?? []).toHaveLength(1);
    // A yielding lock rather than a queueing one, and a bounded statement.
    expect(ddl).toMatch(/SET LOCAL lock_timeout/);
    expect(ddl).toMatch(/SET LOCAL statement_timeout/);
    // No savepoint or exception handler could let a partial change survive.
    expect(ddl).not.toMatch(/\bSAVEPOINT\b/i);
    expect(ddl).not.toMatch(/\bROLLBACK\b/i);
  });

  it("carries exactly one ALTER DEFAULT PRIVILEGES, targeting postgres / storage / TABLES", () => {
    const alters = ddl.match(/ALTER DEFAULT PRIVILEGES/gi) ?? [];
    expect(alters, "exactly one ALTER DEFAULT PRIVILEGES in the whole file").toHaveLength(1);

    // The defining role, the schema and the object type are literal text, so the
    // target is readable without executing anything.
    expect(ddl).toMatch(
      /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage\s*'\s*\n?\s*'REVOKE %s ON TABLES FROM anon, authenticated/,
    );
    // No other defining role, and no other schema, may appear as a target.
    expect(ddl).not.toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE (?!postgres\b)\w+/i);
    expect(ddl).not.toMatch(/ALTER DEFAULT PRIVILEGES[^;]*IN SCHEMA (?!storage\b)\w+/i);
    // Nothing dynamic in the target: no %I / %s where the role or schema belongs.
    expect(ddl).not.toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE %/i);
    expect(ddl).not.toMatch(/IN SCHEMA %/i);
  });

  it("revokes ON TABLES only — never sequences, functions, types or schemas", () => {
    expect(ddl).toMatch(/REVOKE %s ON TABLES FROM/);
    expect(ddl).not.toMatch(
      /ALTER DEFAULT PRIVILEGES[\s\S]{0,200}ON (SEQUENCES|FUNCTIONS|ROUTINES|TYPES|SCHEMAS)/i,
    );
    // And it must not GRANT anything, in a default or otherwise.
    expect(ddl).not.toMatch(/(?<![-\w])GRANT\b/i);
  });

  it("names all seven write privileges and gates MAINTAIN on the live server version", () => {
    // The privilege list is assembled, not hardcoded, because MAINTAIN is a
    // PostgreSQL 17 privilege and naming it on 16 or earlier is a syntax error.
    expect(ddl).toMatch(
      /ARRAY\['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'\]/,
    );
    expect(ddl).toMatch(/server_version_num'\)::int >= 170000/);
    expect(ddl).toMatch(/ARRAY\['MAINTAIN'\]/);
    for (const privilege of WRITE_PRIVILEGES) {
      expect(ddl, `must name ${privilege}`).toContain(privilege);
    }
    // Exactly seven, no more: an eighth would mean SELECT crept into the list.
    const listed = (ddl.match(/ARRAY\['INSERT'[^\]]*\]/)?.[0] ?? "").split(",").length;
    expect(listed, "the base list is the six pre-17 write privileges").toBe(6);
  });

  it("names exactly anon and authenticated as grantees", () => {
    expect(ddl).toMatch(/ON TABLES FROM anon, authenticated/);
    // service_role and postgres must never appear as revoke targets.
    expect(ddl).not.toMatch(/ON TABLES FROM[^']*\bservice_role\b/);
    expect(ddl).not.toMatch(/ON TABLES FROM[^']*\bpostgres\b/);
    expect(ddl).not.toMatch(/ON TABLES FROM PUBLIC/i);
  });

  it("never revokes SELECT and never reaches for REVOKE ALL", () => {
    // A REVOKE ALL would take SELECT with it and change the birth state of every
    // future storage table from readable to unreadable. Naming the privileges is
    // the entire safety property, so it is pinned rather than trusted.
    // `(?<![-\w])` so the task identifier in a NOTICE is not read as a statement.
    expect(ddl).not.toMatch(/(?<![-\w])REVOKE\s+ALL/i);

    // Exactly one REVOKE in the executable text, and it is the parameterised one.
    const revokes = (ddl.match(/(?<![-\w])REVOKE\b[^']*/gi) ?? []).map((s) =>
      s.replace(/\s+/g, " ").trim(),
    );
    expect(revokes).toEqual(["REVOKE %s ON TABLES FROM anon, authenticated"]);
    // And no REVOKE anywhere mentions SELECT.
    expect(ddl).not.toMatch(/(?<![-\w])REVOKE[^;]*\bSELECT\b/i);
  });

  it("mutates nothing in schema public and nothing belonging to supabase_admin", () => {
    // `public` and `supabase_admin` both appear in this file — in read-only
    // preservation queries and in NOTICE text — so the assertion is about
    // MUTATION, not mention.
    expect(ddl).not.toMatch(/ALTER DEFAULT PRIVILEGES[^;]*IN SCHEMA public/i);
    expect(ddl).not.toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin/i);
    expect(ddl).not.toMatch(/(?<![-\w])(GRANT|REVOKE)\b[^;]*\bpublic\./i);
    expect(ddl).not.toMatch(/(?<![-\w])(GRANT|REVOKE)\b[^;]*\bsupabase_admin\b/i);
    expect(ddl).not.toMatch(
      /\bALTER\s+(ROLE|SCHEMA|TABLE|POLICY|FUNCTION|PUBLICATION|DEFAULT PRIVILEGES FOR USER)\b/i,
    );
    // No role-membership change and no impersonation.
    expect(ddl).not.toMatch(/(?<![-\w])SET\s+(LOCAL\s+)?ROLE\b/i);
    expect(ddl).not.toMatch(/SET SESSION AUTHORIZATION/i);
    expect(ddl).not.toMatch(/\bCREATE\s+ROLE\b/i);
    expect(ddl).not.toMatch(/\bDROP\s+(ROLE|OWNED)\b/i);
  });

  it("mutates no existing table, creates nothing and drops nothing", () => {
    expect(ddl).not.toMatch(/(?<![-\w])(GRANT|REVOKE)\b[^;]*\bON\s+TABLE\b/i);
    expect(ddl).not.toMatch(/(?<![-\w])(GRANT|REVOKE)\b[^;]*\bON\s+ALL\s+TABLES\s+IN\s+SCHEMA/i);
    expect(ddl).not.toMatch(
      /\bCREATE\s+(TABLE|VIEW|INDEX|TRIGGER|EVENT\s+TRIGGER|POLICY|SCHEMA|EXTENSION|FUNCTION|SEQUENCE)\b/i,
    );
    expect(ddl).not.toMatch(
      /\bDROP\s+(TABLE|VIEW|INDEX|TRIGGER|EVENT\s+TRIGGER|POLICY|SCHEMA|EXTENSION|FUNCTION|SEQUENCE|COLUMN)\b/i,
    );
    expect(ddl).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(ddl).not.toMatch(/\bPUBLICATION\b/i);
    expect(ddl).not.toMatch(/\bOWNER\s+TO\b/i);
  });

  it("writes no row", () => {
    expect(ddl).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(ddl).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(ddl).not.toMatch(/\bUPDATE\s+[a-z_.]+\s+SET\b/i);
    expect(ddl).not.toMatch(/\bTRUNCATE\s+(TABLE\s+)?[a-z_]/i);
    expect(ddl).not.toMatch(/\bMERGE\s+INTO\b/i);
    expect(ddl).not.toMatch(/\bCOPY\b/i);
  });

  it("never swallows a permission error", () => {
    // Catching 42501 would let the migration report success while having changed
    // nothing. If this executor is ever not entitled, it must raise and roll back.
    expect(ddl).not.toMatch(/EXCEPTION\s+WHEN/i);
    expect(ddl).not.toMatch(/insufficient_privilege/i);
    expect(ddl).not.toMatch(/\b42501\b/);
  });

  it("proves its preservation postconditions before it commits", () => {
    // Each of these is a fingerprint captured before the change and compared
    // after it. Pinned by name so a future edit cannot quietly drop one.
    for (const setting of [
      "forever.sdah_target_before",
      "forever.sdah_target_expected",
      "forever.sdah_other_defaults_fp",
      "forever.sdah_relacl_fp",
      "forever.sdah_owner_fp",
      "forever.sdah_rls_fp",
      "forever.sdah_policy_fp",
      "forever.sdah_schema_priv_fp",
    ]) {
      expect(ddl, `must capture and compare ${setting}`).toContain(setting);
    }
    // The end state is an equality against a computed expectation, not a
    // one-directional "the writes are gone" check.
    expect(ddl).toMatch(/is not the intended end state/);
    expect(ddl).toMatch(/RAISE EXCEPTION[\s\S]{0,200}postcondition failed/);
    // Privileges are read from aclexplode, never from information_schema, which
    // does not expose MAINTAIN and would silently under-report it.
    expect(ddl).toContain("aclexplode");
    expect(ddl).not.toMatch(/information_schema/i);
    expect(ddl).toContain("pg_default_acl");
  });

  it("states what it does NOT close, in the file rather than only in the pull request", () => {
    expect(sql).toMatch(/OWNER_GATED_EXTERNAL_STEP_REQUIRED/);
    expect(sql).toMatch(/does NOT claim complete default-ACL closure/i);
    // The severity claim must stay honest about the defect being latent.
    expect(sql).toMatch(/has_schema_privilege\('postgres','storage','CREATE'\)`? is FALSE/);
    expect(sql).toMatch(/LATENT rather than live/);
    expect(sql).toMatch(/SELECT IS DELIBERATELY PRESERVED/);
    // And it must not claim to have fixed the supabase_admin residual.
    expect(ddl).toMatch(/is NOT addressed by this migration/);
  });

  it("carries no credential, project reference or environment value", () => {
    expect(sql).not.toMatch(/supabase\.co/i);
    expect(sql).not.toMatch(/\bsb_(secret|publishable)_/);
    expect(sql).not.toMatch(/\beyJ[A-Za-z0-9_-]{10,}/); // a JWT
    expect(sql).not.toMatch(/service[_-]?role[_-]?key/i);
    expect(sql).not.toMatch(/\b[a-z]{20}\b(?=[^\n]*(?:ref|project|supabase))/i);
    expect(sql).not.toMatch(/PGPASSWORD|password\s*=/i);
  });
});

describe("the disposable storage default-ACL harness", () => {
  it("is wired to a package script and drives the committed migration", () => {
    const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(packageJson.scripts["security:storage-pg-test"]).toBe(
      "node scripts/security/run-storage-default-acl-pg-tests.mjs",
    );
    const harness = read("scripts/security/run-storage-default-acl-pg-tests.mjs");
    expect(harness).toContain("20260731100000_storage_default_acl_hardening.sql");
    // It must not silently pass on a server too old to have MAINTAIN.
    expect(harness).toContain("170000");
  });

  it("uses a dynamically reserved port and a private data directory, never a fixed one", () => {
    const harness = read("scripts/security/run-storage-default-acl-pg-tests.mjs");
    expect(harness).toContain("reserveFreePort");
    expect(harness).toContain("mkdtempSync");
    // A hardcoded port would let two concurrent runs talk to each other's cluster.
    expect(harness).not.toMatch(/\bport\s*=\s*5\d{4}\b/);
    expect(harness).toContain("proveClusterIdentity");
    expect(harness).toContain("postmaster.pid");
    expect(harness).toContain("SHOW data_directory");
    // And it must clean up after itself.
    expect(harness).toContain("rmSync");
    expect(harness).toContain("dataDirectoryRemoved");
  });

  it("reads privileges from the catalog rather than information_schema", () => {
    // information_schema.role_table_grants does not expose MAINTAIN (finding
    // F-05), so an audit built on it reports a default carrying MAINTAIN as clean.
    const harness = read("scripts/security/run-storage-default-acl-pg-tests.mjs");
    expect(harness).toContain("aclexplode");
    expect(harness).toContain("has_table_privilege");
    // The prohibition is on QUERYING it, not on naming it — the harness explains
    // in a comment why it does not use it, and that comment must not fail this.
    expect(harness).not.toMatch(/(FROM|JOIN)\s+information_schema\./i);
  });

  it("proves the pre-migration defect before claiming to have fixed it", () => {
    const harness = read("scripts/security/run-storage-default-acl-pg-tests.mjs");
    // A canary that shows nothing before the migration proves nothing after it.
    expect(harness).toContain("STARTING DEFECT");
    expect(harness).toMatch(/pre-migration canary in schema storage inherits browser writes/);
    // Both installation paths, and the authority boundary.
    expect(harness).toContain("PATH A");
    expect(harness).toContain("PATH B");
    expect(harness).toContain("assertExecutorAuthorization");
  });
});
