/**
 * Disposable PostgreSQL cluster plumbing, shared by the integration runners.
 *
 * Two harnesses need the same throwaway cluster:
 *   * scripts/studio/run-postgres-tests.mjs — applies the COMPLETE committed
 *     migration chain to a fresh database and runs the behavioural suites;
 *   * scripts/studio/run-migration-upgrade-test.mjs — applies the chain in two
 *     stages to prove an already-migrated database upgrades in place.
 *
 * Neither ever touches a hosted project: the cluster is initdb'd into a temp
 * directory, listens on nothing a remote host can reach, and is removed on the
 * way out.
 */

import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const WINDOWS = process.platform === "win32";

/**
 * Locate initdb/pg_ctl/psql. Prefers the newest versioned install directory on
 * each platform and falls back to PATH.
 */
export function findBinDir() {
  const bases = WINDOWS
    ? ["C:\\Program Files\\PostgreSQL", "C:\\Program Files (x86)\\PostgreSQL"]
    : ["/usr/lib/postgresql", "/usr/pgsql", "/opt/homebrew/opt"];
  for (const base of bases) {
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base).sort().reverse()) {
      const dir = join(base, entry, "bin");
      const suffix = WINDOWS ? ".exe" : "";
      if (existsSync(join(dir, `initdb${suffix}`)) && existsSync(join(dir, `pg_ctl${suffix}`))) {
        return dir;
      }
    }
  }
  // Fall back to PATH.
  return "";
}

/**
 * Create, start and return a handle to a throwaway cluster.
 *
 * `dispose()` is safe to call unconditionally in a finally block: it stops the
 * server only if it started, and always removes the temp directory.
 */
export function createCluster({ prefix = "forever-pg-", port } = {}) {
  const binDir = findBinDir();
  const bin = (name) => (binDir ? join(binDir, name) : name);

  const work = mkdtempSync(join(tmpdir(), prefix));
  const data = join(work, "data");
  // PostgreSQL on Windows does not support the Unix-domain socket setup used by
  // the POSIX runner. Keep the disposable cluster loopback-only instead.
  const host = WINDOWS ? "127.0.0.1" : work;
  const tcpPort = WINDOWS ? String(port ?? process.env.STUDIO_PG_PORT ?? "55432") : "";
  // Detached Windows postgres children inherit pg_ctl's output handles. Avoid
  // pipe handles there so execFileSync can return once pg_ctl reports ready.
  const pgCtlOptions = WINDOWS ? { stdio: "ignore" } : {};

  // PostgreSQL refuses to run as root. When invoked as root (CI/containers),
  // run the cluster commands as an unprivileged user (default: postgres).
  const runAs =
    process.env.STUDIO_PG_USER || (process.getuid && process.getuid() === 0 ? "postgres" : "");

  function run(cmd, args, opts = {}) {
    if (runAs) {
      return execFileSync("runuser", ["-u", runAs, "--", cmd, ...args], {
        stdio: "pipe",
        encoding: "utf8",
        ...opts,
      });
    }
    return execFileSync(cmd, args, { stdio: "pipe", encoding: "utf8", ...opts });
  }

  if (runAs) {
    // The unprivileged user must own the cluster + socket directory.
    execFileSync("chown", ["-R", `${runAs}:${runAs}`, work]);
    execFileSync("chmod", ["777", work]);
  }

  function psqlArgs(extra) {
    return [
      "-h",
      host,
      ...(WINDOWS ? ["-p", tcpPort] : []),
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      ...extra,
    ];
  }

  let started = false;

  const cluster = {
    work,
    host,
    port: tcpPort,
    bin,
    run,

    start() {
      run(bin("initdb"), ["-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8"]);
      run(
        bin("pg_ctl"),
        [
          "-D",
          data,
          "-o",
          WINDOWS
            ? `-h ${host} -p ${tcpPort} -c fsync=off -c synchronous_commit=off`
            : `-k ${work} -c listen_addresses='' -c fsync=off -c synchronous_commit=off`,
          "-w",
          "-l",
          join(work, "log"),
          "start",
        ],
        pgCtlOptions,
      );
      started = true;
      return cluster;
    },

    /** Run a .sql file. Throws on the first error (ON_ERROR_STOP). */
    psql(file) {
      return run(bin("psql"), psqlArgs(["-f", file]));
    },

    /** Run one -c command string. Throws on error. */
    psqlSql(sql) {
      return run(bin("psql"), psqlArgs(["-c", sql]));
    },

    /**
     * One value, as text. Tuples-only + unaligned, so the caller compares the
     * value itself rather than parsing psql's table framing.
     */
    psqlScalar(sql) {
      return run(bin("psql"), psqlArgs(["-t", "-A", "-c", sql])).trim();
    },

    /** A SECOND live session (async), for real cross-session concurrency probes. */
    psqlSqlAsync(sql) {
      const args = psqlArgs(["-c", sql]);
      if (runAs) {
        return execFileAsync("runuser", ["-u", runAs, "--", bin("psql"), ...args], {
          encoding: "utf8",
        });
      }
      return execFileAsync(bin("psql"), args, { encoding: "utf8" });
    },

    dispose() {
      if (started) {
        try {
          run(bin("pg_ctl"), ["-D", data, "-w", "-m", "immediate", "stop"], pgCtlOptions);
        } catch {
          /* best effort */
        }
      }
      rmSync(work, { recursive: true, force: true });
    },
  };

  return cluster;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Flatten whatever an execFile rejection carries into one searchable string. */
export function errorText(error) {
  return String(error?.stderr ?? "") + String(error?.stdout ?? "") + String(error?.message ?? "");
}
