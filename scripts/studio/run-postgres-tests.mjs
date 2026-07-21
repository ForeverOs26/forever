#!/usr/bin/env node
/**
 * Forever Studio — disposable PostgreSQL integration runner (item 14).
 *
 * Spins up a throwaway PostgreSQL cluster, applies the prerequisites stub, the
 * COMPLETE committed migration chain in filename order (including the already-
 * applied progressive migration and the pending Studio migration), then runs
 * the behavioral assertion suite. No production connection, no linked project.
 *
 * Usage: node scripts/studio/run-postgres-tests.mjs
 * Exits 0 on success, non-zero on the first failed assertion or apply error.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.cwd();
const MIGRATIONS_DIR = join(REPO, "supabase", "migrations");
const BOOTSTRAP = join(REPO, "scripts", "studio", "pg-bootstrap.sql");
const SUITE = join(REPO, "src", "features", "forever-studio", "tests", "studio.postgres.sql");

function findBinDir() {
  for (const base of ["/usr/lib/postgresql", "/usr/pgsql", "/opt/homebrew/opt"]) {
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base).sort().reverse()) {
      const bin = join(base, entry, "bin");
      if (existsSync(join(bin, "initdb")) && existsSync(join(bin, "pg_ctl"))) return bin;
    }
  }
  // Fall back to PATH.
  return "";
}

const BIN = findBinDir();
const bin = (name) => (BIN ? join(BIN, name) : name);
const WINDOWS = process.platform === "win32";
// PostgreSQL on Windows does not support the Unix-domain socket setup used by
// the POSIX runner. Keep the disposable cluster loopback-only instead.
const HOST = WINDOWS ? "127.0.0.1" : work;
const PORT = WINDOWS ? (process.env.STUDIO_PG_PORT || "55432") : "";
// Detached Windows postgres children inherit pg_ctl's output handles. Avoid
// pipe handles there so execFileSync can return once pg_ctl reports ready.
const PG_CTL_OPTIONS = WINDOWS ? { stdio: "ignore" } : {};

// PostgreSQL refuses to run as root. When invoked as root (CI/containers),
// run the cluster commands as an unprivileged user (default: postgres).
const RUN_AS =
  process.env.STUDIO_PG_USER || (process.getuid && process.getuid() === 0 ? "postgres" : "");

const work = mkdtempSync(join(tmpdir(), "forever-studio-pg-"));
const data = join(work, "data");
let started = false;

if (RUN_AS) {
  // The unprivileged user must own the cluster + socket directory.
  execFileSync("chown", ["-R", `${RUN_AS}:${RUN_AS}`, work]);
  execFileSync("chmod", ["777", work]);
}

function run(cmd, args, opts = {}) {
  if (RUN_AS) {
    return execFileSync("runuser", ["-u", RUN_AS, "--", cmd, ...args], {
      stdio: "pipe",
      encoding: "utf8",
      ...opts,
    });
  }
  return execFileSync(cmd, args, { stdio: "pipe", encoding: "utf8", ...opts });
}

function psql(file) {
  return run(bin("psql"), [
    "-h",
    HOST,
    ...(WINDOWS ? ["-p", PORT] : []),
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-q",
    "-f",
    file,
  ]);
}

function psqlSql(sql) {
  return run(bin("psql"), [
    "-h",
    HOST,
    ...(WINDOWS ? ["-p", PORT] : []),
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-q",
    "-c",
    sql,
  ]);
}

try {
  run(bin("initdb"), ["-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8"]);
  run(bin("pg_ctl"), [
    "-D",
    data,
    "-o",
    WINDOWS
      ? `-h ${HOST} -p ${PORT} -c fsync=off -c synchronous_commit=off`
      : `-k ${work} -c listen_addresses='' -c fsync=off -c synchronous_commit=off`,
    "-w",
    "-l",
    join(work, "log"),
    "start",
  ], PG_CTL_OPTIONS);
  started = true;

  console.log("[studio-pg] applying bootstrap prerequisites");
  psql(BOOTSTRAP);

  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of migrations) {
    // Supabase projects can have platform-level public-schema defaults that
    // grant browser roles table access. Reproduce that state immediately
    // before Studio creates its server-only tables; the corrective migration
    // must explicitly revoke it.
    if (file === "20260721120000_forever_studio_v1.sql") {
      psqlSql("GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated");
    }
    console.log(`[studio-pg] applying ${file}`);
    psql(join(MIGRATIONS_DIR, file));
  }

  console.log("[studio-pg] running behavioral suite");
  const out = psql(SUITE);
  process.stdout.write(out);
  console.log("[studio-pg] PASS");
} catch (error) {
  const detail = error.stdout || error.stderr || error.message || String(error);
  console.error("[studio-pg] FAIL\n" + detail);
  process.exitCode = 1;
} finally {
  if (started) {
    try {
      run(bin("pg_ctl"), ["-D", data, "-w", "-m", "immediate", "stop"], PG_CTL_OPTIONS);
    } catch {
      /* best effort */
    }
  }
  rmSync(work, { recursive: true, force: true });
}
