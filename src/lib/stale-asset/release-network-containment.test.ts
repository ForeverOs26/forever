/**
 * FOREVER-PR139-REVIEW-CORRECTIONS-001 — the containment the offline release
 * proofs actually run under, proven by making it fail on purpose.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS REPLACES (PR139 independent review, P2-2 and P2-3)
 * ---------------------------------------------------------------------------
 *
 * Containment used to be asserted as `expect(request.url).not.toMatch(
 * /api\.cloudflare\.com/)` on requests that had ALREADY arrived at the loopback
 * mock. `request.url` is a path, so the pattern could never match; and a request
 * that went somewhere else was never inspected at all. The assertion was
 * tautological in both directions.
 *
 * The child environment was `{ ...process.env, ...three dummy values }` — the
 * operator's complete environment, including their real Wrangler OAuth
 * configuration directories and every `CLOUDFLARE_*` credential they happened to
 * have exported.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS PROVEN HERE
 * ---------------------------------------------------------------------------
 *
 * 1. A NEGATIVE CANARY. A child under the guard deliberately attempts four
 *    non-permitted destinations. Each is refused with the named guard code, and
 *    the guard's sanitized log records the refusal. None of them is a real
 *    public host that could be contacted even if the guard failed: the IPs are
 *    RFC 5737 TEST-NET addresses, the hostname is in the reserved `.invalid`
 *    TLD, and `api.cloudflare.com` is refused BEFORE name resolution, which is
 *    the only reason it may be named at all.
 * 2. THE CANARY IS NOT VACUOUS. The identical operation is run once WITHOUT the
 *    guard. It fails with an ordinary `ECONNREFUSED` and writes no guard record,
 *    so a guard that had been removed or disabled would produce a visibly
 *    different result rather than an identical pass.
 * 3. THE GUARD IS NOT MERELY A BLANKET DENY. The permitted loopback listener is
 *    reached successfully under the same guard, and the listener observes the
 *    connection.
 * 4. THE ENVIRONMENT IS CONSTRUCTED, NOT INHERITED. Canary credentials, proxy
 *    settings and `NODE_OPTIONS` are exported into THIS process for the duration
 *    of one spawn, and the child reports back its own `process.env`. None of
 *    them arrives, and every configuration root the child sees is inside a
 *    throwaway directory.
 *
 * NO REAL HOST IS CONTACTED. NO CREDENTIAL IS USED. NOTHING IS UPLOADED.
 */

import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:net";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ALLOWED_SYNTHETIC_CHILD_ENV_KEYS,
  FORBIDDEN_CHILD_ENV_KEYS,
  FORBIDDEN_CHILD_ENV_PREFIXES,
  SYNTHETIC_CLOUDFLARE_ACCOUNT_ID,
  SYNTHETIC_CLOUDFLARE_API_TOKEN,
  auditContainedChildEnv,
  buildContainedChildEnv,
  createIsolatedConfigRoot,
  type IsolatedConfigRoot,
} from "./contained-child-environment";
import {
  LOOPBACK_GUARD_BLOCKED_CODE,
  blockedDestinations,
  loopbackGuardEnv,
  loopbackGuardNodeArgs,
  readLoopbackGuardLog,
} from "./loopback-network-guard";

/**
 * A child that performs ONE named operation and reports the outcome as JSON.
 *
 * Written to a temporary directory rather than tracked: it is a fixture, not
 * source.
 *
 * EVERY DESTINATION IS UNREACHABLE BY CONSTRUCTION, not merely by the guard.
 * The IP is RFC 5737 TEST-NET-1 and the hostnames are in the reserved
 * `.invalid` TLD, so no real host is contacted even when the guard is DELIBERATELY
 * DISABLED — which happens on purpose twice: in the `GUARD_NOT_VACUOUS` control
 * below, and in mutation control 42, which makes the guard permit everything.
 *
 * The production Cloudflare API hostname is therefore NOT used as a live
 * target. Naming it here would mean that a broken or mutated guard sends a real
 * request to Cloudflare, which is exactly the thing this suite exists to make
 * impossible. What is proven instead is that the `https.request` code path is
 * guarded on port 443 for a non-loopback host, which is the same code path and
 * the same decision.
 */
const CANARY_SOURCE = `
const net = require("node:net");
const https = require("node:https");

function report(value) {
  process.stdout.write(JSON.stringify(value));
}
function describeError(error) {
  return { code: error && error.code, name: error && error.name, guardApi: error && error.guardApi };
}

const mode = process.argv[2];
const port = Number.parseInt(process.argv[3] || "0", 10);

async function main() {
  if (mode === "loopback-wrong-port" || mode === "loopback-allowed-port") {
    try {
      await new Promise((done, fail) => {
        const socket = net.connect({ host: "127.0.0.1", port });
        socket.on("connect", () => { socket.destroy(); done(); });
        socket.on("error", fail);
      });
      return report({ outcome: "connected" });
    } catch (error) {
      return report({ outcome: "error", ...describeError(error) });
    }
  }
  if (mode === "test-net-ip") {
    try {
      // RFC 5737 TEST-NET-1. Never routable. The abort bounds the case in which
      // the guard has been deliberately disabled and the connect simply hangs.
      await fetch("http://192.0.2.1:443/", { signal: AbortSignal.timeout(1500) });
      return report({ outcome: "connected" });
    } catch (error) {
      return report({ outcome: "error", ...describeError(error.cause || error) });
    }
  }
  if (mode === "invalid-hostname") {
    try {
      // Reserved TLD. Refused before any name resolution is attempted.
      await fetch("https://forever-release.invalid/v4", { signal: AbortSignal.timeout(1500) });
      return report({ outcome: "connected" });
    } catch (error) {
      return report({ outcome: "error", ...describeError(error.cause || error) });
    }
  }
  if (mode === "https-443") {
    try {
      await new Promise((done, fail) => {
        const request = https.request({
          hostname: "forever-release-api.invalid",
          port: 443,
          path: "/",
          timeout: 1500,
        });
        request.on("error", fail);
        request.on("timeout", () => { request.destroy(new Error("timeout")); });
        request.end();
        done();
      });
      return report({ outcome: "connected" });
    } catch (error) {
      return report({ outcome: "error", ...describeError(error) });
    }
  }
  if (mode === "report-env") {
    return report({ outcome: "env", env: process.env });
  }
  return report({ outcome: "unknown-mode" });
}

main().catch((error) => report({ outcome: "error", ...describeError(error) }));
`;

let workspace = "";
let canaryPath = "";
let isolated: IsolatedConfigRoot | null = null;
let listener: Server | null = null;
let allowedPort = 0;
let closedPort = 0;
const listenerConnections: number[] = [];

function guardLogPath(label: string): string {
  const path = join(workspace, `guard-${label}.jsonl`);
  writeFileSync(path, "", "utf8");
  return path;
}

interface CanaryOutcome {
  readonly outcome: string;
  readonly code?: string;
  readonly name?: string;
  readonly guardApi?: string;
  readonly env?: Record<string, string>;
}

function runCanary(input: {
  readonly mode: string;
  readonly port?: number;
  readonly logPath: string;
  readonly withGuard: boolean;
  readonly extraEnv?: Record<string, string>;
}): { readonly outcome: CanaryOutcome; readonly status: number | null } {
  const run = spawnSync(
    process.execPath,
    [
      ...(input.withGuard ? loopbackGuardNodeArgs() : []),
      canaryPath,
      input.mode,
      String(input.port ?? 0),
    ],
    {
      cwd: workspace,
      encoding: "utf8",
      shell: false,
      // Bounded so a canary whose guard has been disabled fails fast instead of
      // waiting out a non-routable connect.
      timeout: 20_000,
      env: buildContainedChildEnv({
        isolated: isolated as IsolatedConfigRoot,
        extra: {
          ...loopbackGuardEnv({ allowedPort, logPath: input.logPath }),
          ...(input.extraEnv ?? {}),
        },
      }),
    },
  );
  let outcome: CanaryOutcome = { outcome: "no-output" };
  try {
    outcome = JSON.parse(run.stdout ?? "") as CanaryOutcome;
  } catch {
    outcome = { outcome: "no-output", name: (run.stderr ?? "").slice(0, 200) };
  }
  return { outcome, status: run.status };
}

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), "forever-network-containment-"));
  canaryPath = join(workspace, "canary.cjs");
  writeFileSync(canaryPath, CANARY_SOURCE, "utf8");
  isolated = createIsolatedConfigRoot("forever-network-containment-home-");

  listener = createServer((socket) => {
    listenerConnections.push(1);
    socket.end();
  });
  allowedPort = await new Promise<number>((done) => {
    listener?.listen(0, "127.0.0.1", () => {
      done((listener?.address() as { port: number }).port);
    });
  });

  // A port that is bound and immediately released, so a connection to it is a
  // deterministic local ECONNREFUSED rather than a hang or a real destination.
  const spare = createServer();
  closedPort = await new Promise<number>((done) => {
    spare.listen(0, "127.0.0.1", () => done((spare.address() as { port: number }).port));
  });
  await new Promise<void>((done) => spare.close(() => done()));
}, 60_000);

afterAll(async () => {
  if (listener) await new Promise<void>((done) => listener?.close(() => done()));
  isolated?.dispose();
  if (workspace) rmSync(workspace, { recursive: true, force: true });
});

/**
 * `spawnSync` blocks this process's event loop, so the parent's `connection`
 * event is queued and only delivered once it returns. Polled rather than
 * assumed, and bounded so a genuine failure fails rather than hangs.
 */
async function waitForListenerConnection(before: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (listenerConnections.length > before) return;
    await new Promise((done) => setTimeout(done, 20));
  }
}

describe("LOOPBACK_GUARD: only the test's own listener is reachable", () => {
  it("permits the listener, and the listener actually observes the connection", async () => {
    const logPath = guardLogPath("allowed");
    const before = listenerConnections.length;
    const { outcome } = runCanary({
      mode: "loopback-allowed-port",
      port: allowedPort,
      logPath,
      withGuard: true,
    });

    expect(outcome.outcome).toBe("connected");
    await waitForListenerConnection(before);
    expect(listenerConnections.length).toBeGreaterThan(before);

    const records = readLoopbackGuardLog(logPath);
    expect(blockedDestinations(records)).toEqual([]);
    expect(records.some((entry) => entry.allowed && entry.port === allowedPort)).toBe(true);
    for (const entry of records) {
      expect(["127.0.0.1", "::1", "localhost"]).toContain(entry.host);
    }
  });

  it("BLOCKS loopback on any port other than the listener's", () => {
    const logPath = guardLogPath("wrong-port");
    const { outcome } = runCanary({
      mode: "loopback-wrong-port",
      port: closedPort,
      logPath,
      withGuard: true,
    });

    expect(outcome.outcome).toBe("error");
    expect(outcome.code).toBe(LOOPBACK_GUARD_BLOCKED_CODE);

    const blocked = blockedDestinations(readLoopbackGuardLog(logPath));
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.port).toBe(closedPort);
    expect(blocked[0]?.host).toBe("127.0.0.1");
  });

  it("GUARD_NOT_VACUOUS: the identical operation is NOT blocked without the guard", () => {
    // The negative control. Same child, same argument, guard omitted. If the
    // guard were absent or disabled in the tests above, THIS is the result they
    // would have produced — an ordinary refused connection and an empty log —
    // so those assertions cannot be passing for a reason unrelated to the guard.
    const logPath = guardLogPath("no-guard");
    const { outcome } = runCanary({
      mode: "loopback-wrong-port",
      port: closedPort,
      logPath,
      withGuard: false,
    });

    expect(outcome.outcome).toBe("error");
    expect(outcome.code).not.toBe(LOOPBACK_GUARD_BLOCKED_CODE);
    expect(outcome.code).toBe("ECONNREFUSED");
    expect(readLoopbackGuardLog(logPath)).toEqual([]);
  });

  it("BLOCKS a non-loopback IP before any connection is opened", () => {
    const logPath = guardLogPath("test-net");
    const { outcome } = runCanary({ mode: "test-net-ip", logPath, withGuard: true });

    expect(outcome.outcome).toBe("error");
    expect(outcome.code).toBe(LOOPBACK_GUARD_BLOCKED_CODE);

    const blocked = blockedDestinations(readLoopbackGuardLog(logPath));
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0]?.host).toBe("192.0.2.1");
    // Refused at the fetch entry point — before Undici, before connect.
    expect(blocked[0]?.api).toBe("fetch");
  });

  it("BLOCKS a hostname before any name resolution is attempted", () => {
    const logPath = guardLogPath("invalid-host");
    const { outcome } = runCanary({ mode: "invalid-hostname", logPath, withGuard: true });

    expect(outcome.outcome).toBe("error");
    expect(outcome.code).toBe(LOOPBACK_GUARD_BLOCKED_CODE);

    const blocked = blockedDestinations(readLoopbackGuardLog(logPath));
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0]?.host).toBe("forever-release.invalid");
    expect(blocked.some((entry) => entry.api.startsWith("dns."))).toBe(false);
  });

  it("BLOCKS an https.request on port 443 — the Cloudflare API code path", () => {
    // The same `https.request` entry point and the same decision a request to
    // the production API would take. The hostname is reserved rather than real,
    // so a disabled guard cannot turn this assertion into an outbound request.
    const logPath = guardLogPath("https-443");
    const { outcome } = runCanary({ mode: "https-443", logPath, withGuard: true });

    expect(outcome.outcome).toBe("error");
    expect(outcome.code).toBe(LOOPBACK_GUARD_BLOCKED_CODE);

    const blocked = blockedDestinations(readLoopbackGuardLog(logPath));
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toEqual({
      api: "https.request",
      host: "forever-release-api.invalid",
      port: 443,
      allowed: false,
    });
  });

  it("records ONLY sanitized destination metadata", () => {
    const logPath = guardLogPath("sanitized");
    runCanary({ mode: "invalid-hostname", logPath, withGuard: true });
    const raw = readFileSync(logPath, "utf8");

    expect(raw).not.toContain("/v4");
    expect(raw).not.toContain(SYNTHETIC_CLOUDFLARE_API_TOKEN);
    expect(raw).not.toContain("authorization");
    for (const record of readLoopbackGuardLog(logPath)) {
      expect(Object.keys(record).sort()).toEqual(["allowed", "api", "host", "port"]);
    }
  });
});

describe("CONTAINED_ENV: the child environment is constructed, not inherited", () => {
  const CANARY_ENV: Record<string, string> = {
    CLOUDFLARE_API_KEY: "forever-canary-global-key-must-not-travel",
    CLOUDFLARE_EMAIL: "forever-canary@example.invalid",
    CF_API_TOKEN: "forever-canary-legacy-token-must-not-travel",
    CLOUDFLARE_ZONE_ID: "forever-canary-zone",
    WRANGLER_LOG: "debug",
    HTTP_PROXY: "http://forever-canary-proxy.invalid:3128",
    HTTPS_PROXY: "http://forever-canary-proxy.invalid:3128",
    NODE_OPTIONS: "--title=forever-canary",
    NPM_TOKEN: "forever-canary-npm-token",
    SUPABASE_SERVICE_ROLE_KEY: "forever-canary-supabase-key",
    R2_SECRET_ACCESS_KEY: "forever-canary-r2-key",
  };

  let observed: Record<string, string> = {};
  let observedRaw = "";

  beforeAll(() => {
    const restore: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(CANARY_ENV)) {
      restore[key] = process.env[key];
      process.env[key] = value;
    }
    try {
      const logPath = guardLogPath("env");
      const { outcome } = runCanary({ mode: "report-env", logPath, withGuard: true });
      observed = outcome.env ?? {};
      observedRaw = JSON.stringify(observed);
    } finally {
      for (const [key, value] of Object.entries(restore)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }, 60_000);

  it("reported its own environment back, so the audit is on observed reality", () => {
    expect(Object.keys(observed).length).toBeGreaterThan(0);
  });

  it("carries NO canary credential, proxy setting or parent NODE_OPTIONS", () => {
    for (const [key, value] of Object.entries(CANARY_ENV)) {
      expect(observed, key).not.toHaveProperty(key);
      expect(observedRaw, key).not.toContain(value);
    }
  });

  it("carries no forbidden key or prefix at all, beyond the synthetic allowlist", () => {
    const audit = auditContainedChildEnv(observed, (isolated as IsolatedConfigRoot).root);
    expect(audit.findings).toEqual([]);
    expect(audit.ok).toBe(true);

    for (const key of Object.keys(observed)) {
      if ((ALLOWED_SYNTHETIC_CHILD_ENV_KEYS as readonly string[]).includes(key)) continue;
      if (key.startsWith("FOREVER_LOOPBACK_GUARD_")) continue;
      expect(FORBIDDEN_CHILD_ENV_KEYS, key).not.toContain(key);
      for (const prefix of FORBIDDEN_CHILD_ENV_PREFIXES) {
        expect(key.startsWith(prefix), `${key} carries forbidden prefix ${prefix}`).toBe(false);
      }
    }
  });

  it("redirects every configuration and cache root into the throwaway directory", () => {
    const root = (isolated as IsolatedConfigRoot).root.replace(/\\/g, "/").toLowerCase();
    for (const key of [
      "HOME",
      "USERPROFILE",
      "APPDATA",
      "LOCALAPPDATA",
      "XDG_CONFIG_HOME",
      "XDG_CACHE_HOME",
      "TMPDIR",
      "TEMP",
      "TMP",
    ]) {
      const value = String(observed[key] ?? "")
        .replace(/\\/g, "/")
        .toLowerCase();
      expect(value, key).not.toBe("");
      expect(value.startsWith(root), `${key} escaped the isolation root`).toBe(true);
    }
    // The operator's real locations are UNREACHABLE, not merely unused.
    for (const key of ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) {
      const real = process.env[key];
      if (typeof real !== "string" || real.length === 0) continue;
      expect(String(observed[key]).toLowerCase()).not.toBe(real.toLowerCase());
    }
  });

  it("supplies ONLY synthetic Cloudflare credentials, and disables metrics", () => {
    expect(observed.CLOUDFLARE_API_TOKEN).toBe(SYNTHETIC_CLOUDFLARE_API_TOKEN);
    expect(observed.CLOUDFLARE_ACCOUNT_ID).toBe(SYNTHETIC_CLOUDFLARE_ACCOUNT_ID);
    expect(observed.WRANGLER_SEND_METRICS).toBe("false");
    expect(observed.NO_UPDATE_NOTIFIER).toBe("1");
    expect(observed.CI).toBe("1");
  });

  it("reduces PATH to the system directory — Wrangler is never FOUND, only named", () => {
    const path = String(observed.PATH ?? "");
    expect(path.length).toBeGreaterThan(0);
    // `contained-child-environment.ts` sets one System32 entry on Windows and
    // exactly `/usr/bin:/bin` elsewhere. Pin the actual value per platform: a
    // bare segment count silently asserted the Windows shape on POSIX.
    const segments = path.split(process.platform === "win32" ? ";" : ":");
    if (process.platform === "win32") {
      expect(segments).toHaveLength(1);
      expect(segments[0].toLowerCase()).toContain("system32");
    } else {
      expect(segments).toEqual(["/usr/bin", "/bin"]);
    }
    expect(path.toLowerCase()).not.toContain("node_modules");
  });
});
