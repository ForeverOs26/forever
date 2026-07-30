/**
 * FOREVER-LISTINGS-BROWSER-WRITE-REVOKE-001 — the static half of the browser
 * table-write contract.
 *
 * The behavioural half runs on a disposable PostgreSQL 17 cluster
 * (`npm run security:pg-test`) because privileges are a database property and only
 * a database can answer whether a statement is refused. What a unit test CAN own is
 * everything about the migration that is decidable from its text: that it is
 * atomic, that it names privileges explicitly instead of reaching for REVOKE ALL,
 * that it never touches SELECT, that it restores the one approved exception, that it
 * writes no row, and that it carries no credential.
 *
 * These are the properties a reviewer would otherwise have to re-derive by reading
 * 300 lines of SQL, and the ones a future edit is most likely to break by accident.
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

const revokeMigrations = migrationFiles.filter((entry) =>
  entry.includes("listings_browser_write_revoke"),
);

describe("browser table-write privilege migration", () => {
  it("exists exactly once and sorts after every migration it depends on", () => {
    expect(revokeMigrations, "exactly one browser-write-revoke migration").toHaveLength(1);
    const [file] = revokeMigrations;

    // It must land after `leads` exists, because it restates that grant, and after
    // the amenities editor, which established the partial revoke this completes.
    // Deliberately not "it is the last migration in the chain": that would be true
    // today and would fail for the next person who adds an unrelated migration.
    expect(file > "20260704132000").toBe(true);
    expect(file > "20260728160000").toBe(true);
    expect(migrationFiles.indexOf(file)).toBeGreaterThan(
      migrationFiles.findIndex((entry) => entry.startsWith("20260704132000")),
    );
    expect(migrationFiles.indexOf(file)).toBeGreaterThan(
      migrationFiles.findIndex((entry) => entry.startsWith("20260728160000")),
    );
  });

  const [file] = revokeMigrations;
  const sql = readFileSync(join(MIGRATIONS, file ?? ""), "utf8");
  const ddl = executable(sql);

  it("is atomic", () => {
    expect(ddl).toMatch(/^\s*BEGIN;/m);
    expect(ddl).toMatch(/^\s*COMMIT;\s*$/m);
    // A yielding lock rather than a queueing one: REVOKE takes ACCESS EXCLUSIVE.
    expect(ddl).toMatch(/SET LOCAL lock_timeout/);
  });

  it("names the seven write privileges and gates MAINTAIN on the server version", () => {
    for (const privilege of [
      "INSERT",
      "UPDATE",
      "DELETE",
      "TRUNCATE",
      "REFERENCES",
      "TRIGGER",
      "MAINTAIN",
    ]) {
      expect(ddl, `must name ${privilege}`).toContain(privilege);
    }
    // MAINTAIN is a PostgreSQL 17 privilege. Naming it unconditionally is a syntax
    // error on 16 and earlier, so it must be assembled from the live version.
    expect(ddl).toMatch(/server_version_num'\)::int >= 170000/);
    expect(ddl).toMatch(/MAINTAIN/);
  });

  it("never reaches for REVOKE ALL and never revokes SELECT", () => {
    // A column-less REVOKE ALL removes COLUMN-level grants too, which would blank
    // the catalogue and every project page. Naming privileges is the whole safety
    // property, so it is pinned here rather than trusted.
    // `(?<![-\w])` so the task identifier FOREVER-LISTINGS-BROWSER-WRITE-REVOKE-001
    // in a NOTICE string is not mistaken for a REVOKE statement.
    expect(ddl).not.toMatch(/(?<![-\w])REVOKE\s+ALL/i);
    expect(ddl).not.toMatch(/(?<![-\w])REVOKE\b[^;]*\bSELECT\b/i);
    // And specifically the grant the public amenities embed depends on — the same
    // invariant `amenities-contract.test.tsx` scans the whole chain for.
    expect(ddl).not.toMatch(/REVOKE\s+SELECT\s+ON\s+(?:TABLE\s+)?public\.(project_)?amenities\b/i);
  });

  it("restores the one approved browser table write explicitly", () => {
    expect(ddl).toMatch(/GRANT INSERT ON TABLE public\.leads TO anon, authenticated;/);
    // Exactly one GRANT statement: the exception, and nothing else.
    const grants = ddl.match(/^\s*GRANT\b/gim) ?? [];
    expect(grants).toHaveLength(1);
  });

  it("revokes from PUBLIC as well as from the two named roles", () => {
    // A PUBLIC-derived privilege is not removable by revoking from the role.
    expect(ddl).toMatch(/FROM PUBLIC/);
    expect(ddl).toMatch(/FROM anon, authenticated/);
  });

  it("discovers the default-ACL defining roles from the catalog instead of guessing", () => {
    expect(ddl).toContain("pg_default_acl");
    expect(ddl).toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public/);
    // No hardcoded role name in an executable ALTER DEFAULT PRIVILEGES: a guessed
    // name either misses an entry or invents one.
    expect(ddl).not.toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE (postgres|supabase_admin)\b/);
    // Scoped to schema public, tables only.
    expect(ddl).not.toMatch(/ALTER DEFAULT PRIVILEGES[^;]*IN SCHEMA (?!public)\w+/);
    expect(ddl).not.toMatch(/ALTER DEFAULT PRIVILEGES[^;]*ON (FUNCTIONS|SEQUENCES|TYPES|SCHEMAS)/);
    // And it must record what it could not do rather than passing over it.
    expect(ddl).toMatch(/RAISE WARNING/);
  });

  it("verifies its own postcondition and aborts rather than half-applying", () => {
    expect(ddl).toMatch(/has_table_privilege/);
    expect(ddl).toMatch(/RAISE EXCEPTION[\s\S]{0,200}postcondition failed/);
    // The SELECT surface is snapshotted before and compared after, so "public reads
    // are preserved" is measured by the migration itself, not merely asserted.
    expect(ddl).toMatch(/forever\.lbwr_select_fp/);
  });

  it("writes no row and changes no schema object", () => {
    expect(ddl).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(ddl).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(ddl).not.toMatch(/\bUPDATE\s+(public|forever_import|forever_execution)\./i);
    expect(ddl).not.toMatch(/\bTRUNCATE\s+(TABLE\s+)?public\./i);
    expect(ddl).not.toMatch(
      /\bCREATE\s+(TABLE|VIEW|INDEX|TRIGGER|POLICY|SCHEMA|EXTENSION|ROLE|FUNCTION)\b/i,
    );
    expect(ddl).not.toMatch(
      /\bDROP\s+(TABLE|VIEW|INDEX|TRIGGER|POLICY|SCHEMA|EXTENSION|ROLE|FUNCTION|COLUMN)\b/i,
    );
    expect(ddl).not.toMatch(/\bALTER\s+(TABLE|POLICY|ROLE|SCHEMA|FUNCTION|PUBLICATION)\b/i);
    expect(ddl).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(ddl).not.toMatch(/\bPUBLICATION\b/i);
  });

  it("creates no Studio member, job, archive or amenity", () => {
    for (const table of [
      "studio_members",
      "studio_upload_jobs",
      "studio_archives",
      "studio_archive_entries",
      "studio_object_owners",
      "amenities",
      "project_amenities",
    ]) {
      expect(ddl, `must not write ${table}`).not.toMatch(
        new RegExp(`(INSERT INTO|UPDATE|DELETE FROM)\\s+public\\.${table}\\b`, "i"),
      );
    }
  });

  it("carries no credential, project reference or environment value", () => {
    expect(sql).not.toMatch(/supabase\.co/i);
    expect(sql).not.toMatch(/\bsb_(secret|publishable)_/);
    expect(sql).not.toMatch(/\beyJ[A-Za-z0-9_-]{10,}/); // a JWT
    expect(sql).not.toMatch(/service[_-]?role[_-]?key/i);
    expect(sql).not.toMatch(/\b[a-z]{20}\b(?=[^\n]*(?:ref|project|supabase))/i);
    expect(sql).not.toMatch(/PGPASSWORD|password\s*=/i);
  });

  it("does not claim row-level security covers what it does not", () => {
    // The header is load-bearing: the next person to read this file needs to know
    // that TRUNCATE, REFERENCES, TRIGGER and MAINTAIN were never policy-governed,
    // and that owners, superusers and BYPASSRLS roles are outside RLS entirely.
    expect(sql).toMatch(/TRUNCATE is not governed by row policies/);
    expect(sql).toMatch(/REFERENCES, TRIGGER and MAINTAIN are likewise outside row security/);
    expect(sql).toMatch(/RLS never constrains the table owner, a superuser, or a BYPASSRLS role/);
    expect(sql).toMatch(/No policy is created, altered or dropped by this file/);
    // And it must not promise to have fixed the default it cannot reach.
    expect(sql).toMatch(/ONE THING THIS MIGRATION CANNOT FIX/);
  });
});

describe("the disposable privilege harness", () => {
  it("is wired to a package script and ships its own fixtures", () => {
    const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(packageJson.scripts["security:pg-test"]).toBe(
      "node scripts/security/run-browser-write-revoke-pg-tests.mjs",
    );
    expect(read("scripts/security/run-browser-write-revoke-pg-tests.mjs")).toContain(
      "20260730090000_listings_browser_write_revoke.sql",
    );
    expect(read("scripts/security/browser-write-revoke-fixtures.sql")).toContain("public.leads");
  });

  it("uses a dynamically reserved port and a private data directory, never a fixed one", () => {
    const harness = read("scripts/security/run-browser-write-revoke-pg-tests.mjs");
    expect(harness).toContain("reserveFreePort");
    expect(harness).toContain("mkdtempSync");
    // A hardcoded port would let two concurrent runs talk to each other's cluster.
    expect(harness).not.toMatch(/\bport\s*=\s*5\d{4}\b/);
    expect(harness).toContain("proveClusterIdentity");
    expect(harness).toContain("postmaster.pid");
    expect(harness).toContain("SHOW data_directory");
  });

  it("contains only synthetic, non-personal fixture values", () => {
    const fixtures = read("scripts/security/browser-write-revoke-fixtures.sql");
    // Every address must use a reserved, unroutable TLD.
    const emails = fixtures.match(/'[^']*@[^']*'/g) ?? [];
    expect(emails.length).toBeGreaterThan(0);
    for (const email of emails) {
      expect(email, `${email} must use a reserved TLD`).toMatch(/@example\.invalid'$/);
    }
    // And every phone number must be an all-zero placeholder, never a real range.
    const phones = fixtures.match(/'\+\d[\d ()-]{6,}'/g) ?? [];
    expect(phones.length).toBeGreaterThan(0);
    for (const phone of phones) {
      expect(phone, `${phone} must be a zero placeholder`).toMatch(/^'\+66[01]+'$/);
    }
  });
});
