/**
 * FOREVER-PINNED-BINDING-INHERITANCE-IMPLEMENTATION-001 — EMPIRICAL
 * serialization proof.
 * Containment corrected by FOREVER-PR139-REVIEW-CORRECTIONS-001 (P2-2, P2-3).
 *
 * ---------------------------------------------------------------------------
 * WHY CONFIGURATION INSPECTION IS NOT ENOUGH
 * ---------------------------------------------------------------------------
 *
 * The superseded PREUPLOAD contract inspected argv and the generated
 * configuration and returned PASS for an upload that could not have preserved
 * anything. Everything it checked was true; none of it described the bytes that
 * left the machine. So this suite does not inspect configuration — it runs the
 * REAL, repository-locked Wrangler and reads the multipart metadata Wrangler
 * actually emits.
 *
 * An earlier reading of Wrangler's bundled source suggested it strips
 * `version_id`, because one code path destructures only `{ binding }`. That
 * inference was WRONG: unsafe-declared bindings take a different path and
 * `version_id` is forwarded verbatim. This test exists so the empirical answer
 * is re-measured on every run instead of being remembered.
 *
 * ---------------------------------------------------------------------------
 * WHICH WRANGLER — THE SAME FILE THE PRODUCTION UPLOAD RUNS
 * ---------------------------------------------------------------------------
 *
 * The entry point is not a path this file composes. It is whatever
 * `resolveRepositoryWrangler` authorizes — the same shared, fail-closed
 * resolver `scripts/release/wrangler-version-gate.mjs` uses, and therefore the
 * same resolver the production upload wrapper consumes. An external
 * installation reporting the same version resolves to nothing here exactly as
 * it resolves to nothing there, so this proof is about the executable that
 * actually performs releases.
 *
 * ---------------------------------------------------------------------------
 * CONTAINMENT — MEASURED, NOT ASSUMED
 * ---------------------------------------------------------------------------
 *
 * The previous version of this file asserted `expect(request.url).not.toMatch(
 * /api\.cloudflare\.com/)`. `request.url` is a PATH; it can never contain a
 * host, and only requests that had already reached the loopback mock were
 * inspected at all. What is enforced now:
 *
 *   - a PROCESS-LEVEL guard (`loopback-network-guard.cjs`) is preloaded into the
 *     Wrangler child. Sockets, TLS, DNS, `http`/`https` and `fetch` are all
 *     patched, and every destination that is not this test's loopback listener
 *     is refused synchronously — before a connection is opened and before a name
 *     is resolved. `release-network-containment.test.ts` proves that guard
 *     blocks, proves it does not merely block everything, and proves the same
 *     operation is NOT blocked when the guard is absent;
 *   - the guard's sanitized log is asserted here: Wrangler's real network
 *     activity appears in it, every record is the loopback listener, and no
 *     record is a refusal. An empty log would mean the guard never observed the
 *     run, which is itself a failure;
 *   - the `Host` header the mock receives is asserted to be exactly the loopback
 *     listener's `host:port`;
 *   - the child environment is CONSTRUCTED, not inherited: minimal OS variables,
 *     every configuration and cache root redirected into a throwaway directory,
 *     synthetic Cloudflare credentials only, metrics and update checks off. The
 *     operator's real Wrangler/OAuth configuration is unreachable rather than
 *     merely unused;
 *   - no Worker version is created: the mock returns a synthetic response and
 *     nothing is uploaded anywhere.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS CAPTURED, AND WHAT IS DISCARDED
 * ---------------------------------------------------------------------------
 *
 * The multipart request body IS materialized in memory, because parsing a
 * multipart document requires reading it. It is never persisted, never logged
 * and never retained: `extractMetadataPart` returns the parsed `metadata` part
 * and the body buffer goes out of scope with the request handler. Only that one
 * part is kept. The Worker code bytes, the asset contents, the request headers
 * other than `Host`, the credential and the multipart boundaries are all
 * discarded unparsed — but this suite does not claim the body was "dropped
 * unread", because it was read.
 */

import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  SYNTHETIC_CLOUDFLARE_ACCOUNT_ID,
  SYNTHETIC_CLOUDFLARE_API_TOKEN,
  buildContainedChildEnv,
  createIsolatedConfigRoot,
  type IsolatedConfigRoot,
} from "./contained-child-environment";
import {
  allowedDestinations,
  blockedDestinations,
  loopbackGuardEnv,
  loopbackGuardNodeArgs,
  readLoopbackGuardLog,
  type LoopbackGuardRecord,
} from "./loopback-network-guard";
import {
  INHERIT_BINDING_TYPE,
  PINNED_INHERITANCE_BINDINGS,
  buildPinnedInheritanceBindings,
} from "./pinned-binding-inheritance";
import { SUPPORTED_WRANGLER_VERSION } from "./worker-variable-preservation";
import { CANONICAL_WRANGLER_ENTRY, resolveRepositoryWrangler } from "./wrangler-identity";

/** Dummy. Not a production identifier, not a credential. */
const DUMMY_ACCOUNT_ID = SYNTHETIC_CLOUDFLARE_ACCOUNT_ID;
const DUMMY_WORKER_NAME = "forever-offline-serialization-fixture";
/** Dummy stand-in for the verified 100% live version. */
const DUMMY_LIVE_VERSION = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
/** Dummy stand-in for the version the mock pretends to create. Never real. */
const DUMMY_CREATED_VERSION = "2b3c4d5e-6f70-4b8c-9d0e-1f2a3b4c5d6e";

const REPO = process.cwd();
const WRANGLER_MANIFEST = resolve(REPO, "node_modules/wrangler/package.json");

/** The ONE authorized launcher — the shared, fail-closed release resolver. */
const wranglerIdentity = resolveRepositoryWrangler({ repoRoot: REPO });

interface Capture {
  readonly requests: string[];
  readonly hostHeaders: string[];
  metadata: Record<string, unknown> | null;
}

/**
 * Extracts ONLY the `metadata` part from a multipart body.
 *
 * The body must be materialized to be parsed — a multipart document cannot be
 * split without being read. It is read HERE and nowhere else: the buffer is a
 * parameter, the boundary is used to split and then discarded, every part that
 * is not `metadata` is skipped without being turned into a retained value, and
 * nothing about the body is written to disk, logged or asserted against as a
 * whole.
 */
function extractMetadataPart(body: Buffer, contentType: string): Record<string, unknown> | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) return null;
  const boundary = match[1] ?? match[2];
  for (const part of body.toString("latin1").split(`--${boundary}`)) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;
    if (!/name="metadata"/i.test(part.slice(0, headerEnd))) continue;
    const raw = part.slice(headerEnd + 4).replace(/\r\n$/, "");
    try {
      return JSON.parse(Buffer.from(raw, "latin1").toString("utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function startMock(capture: Capture): Promise<{ server: Server; port: number }> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      capture.requests.push(`${request.method} ${request.url?.split("?")[0] ?? ""}`);
      // The one header retained. It is the destination the client BELIEVED it
      // was talking to, which is the fact a path-only assertion could not reach.
      capture.hostHeaders.push(String(request.headers.host ?? ""));
      const json = (body: unknown) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ success: true, errors: [], messages: [], result: body }));
      };

      if (request.method === "POST" && /\/versions$/.test(request.url?.split("?")[0] ?? "")) {
        capture.metadata = extractMetadataPart(
          Buffer.concat(chunks),
          request.headers["content-type"] ?? "",
        );
        json({
          id: DUMMY_CREATED_VERSION,
          number: 1,
          metadata: {},
          resources: { bindings: [] },
        });
        return;
      }
      if (/\/workers\/services\//.test(request.url ?? "")) {
        json({
          id: DUMMY_WORKER_NAME,
          default_environment: {
            environment: "production",
            script: {
              id: DUMMY_WORKER_NAME,
              tag: "fixture",
              etag: "fixture",
              last_deployed_from: "wrangler",
              created_on: "2026-08-01T00:00:00Z",
              modified_on: "2026-08-01T00:00:00Z",
            },
          },
        });
        return;
      }
      json({});
    });
  });
  return new Promise((done) => {
    server.listen(0, "127.0.0.1", () => {
      done({ server, port: (server.address() as { port: number }).port });
    });
  });
}

/**
 * Runs the repository-locked Wrangler against the loopback mock, under the
 * process-level guard and a constructed environment.
 *
 * `spawn`, never `spawnSync`: a synchronous spawn blocks this process's event
 * loop, so the in-process mock could never accept the connection and the run
 * would fail with a misleading "connectivity" error.
 *
 * The guard is installed as a direct `--require` NODE ARGUMENT rather than
 * through `NODE_OPTIONS`, so the child environment can keep `NODE_OPTIONS`
 * absent entirely — the parent's must not travel, and an inherited one is
 * exactly what P2-3 found.
 */
function runWrangler(input: {
  readonly configPath: string;
  readonly port: number;
  readonly isolated: IsolatedConfigRoot;
  readonly guardLogPath: string;
  readonly cwd: string;
}): Promise<{ status: number | null }> {
  return new Promise((done) => {
    const child = spawn(
      wranglerIdentity.launcher?.command ?? process.execPath,
      [
        ...loopbackGuardNodeArgs(),
        ...(wranglerIdentity.launcher?.prefixArgs ?? []),
        "versions",
        "upload",
        "--keep-vars",
        "--config",
        input.configPath,
      ],
      {
        cwd: input.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: buildContainedChildEnv({
          isolated: input.isolated,
          extra: {
            ...loopbackGuardEnv({ allowedPort: input.port, logPath: input.guardLogPath }),
            CLOUDFLARE_API_BASE_URL: `http://127.0.0.1:${input.port}/client/v4`,
          },
        }),
      },
    );
    // stdout/stderr are drained so the child cannot block on a full pipe, and
    // are then discarded: Wrangler output may quote the request.
    child.stdout.resume();
    child.stderr.resume();
    child.on("close", (status) => done({ status }));
  });
}

/**
 * Disables Wrangler's npm update check for the contained run.
 *
 * Wrangler 4.118.0 calls the `update-check` package, which fetches
 * `registry.npmjs.org` unless a cache file inside `os.tmpdir()` is newer than
 * its interval. Wrangler exposes no flag for it. The child's temporary
 * directory is ours, so the cache is SEEDED as already-current and the request
 * is never made.
 *
 * This was found by the guard, not by reading the source: the previous
 * containment assertion could not see an outbound request to npm at all, and
 * this run really did make one. Seeding is the disablement; the guard blocking
 * it would have been a second line of defence, and the suite asserts BOTH — no
 * blocked destination at all, which is only true if the check never fired.
 */
function seedWranglerUpdateCheckCache(isolatedRoot: IsolatedConfigRoot): void {
  const cacheDirectory = join(isolatedRoot.tempDirectory, "update-check");
  mkdirSync(cacheDirectory, { recursive: true });
  const installed = JSON.parse(readFileSync(WRANGLER_MANIFEST, "utf8")) as { version: string };
  writeFileSync(
    join(cacheDirectory, "wrangler-latest.json"),
    JSON.stringify({ latest: installed.version, lastUpdate: Date.now() }),
    "utf8",
  );
}

const capture: Capture = { requests: [], hostHeaders: [], metadata: null };
let workspace = "";
let isolated: IsolatedConfigRoot | null = null;
let guardLogPath = "";
let guardRecords: readonly LoopbackGuardRecord[] = [];
let listenerPort = 0;

beforeAll(async () => {
  const { server, port } = await startMock(capture);
  listenerPort = port;
  workspace = mkdtempSync(join(tmpdir(), "forever-inherit-serialization-"));
  isolated = createIsolatedConfigRoot("forever-inherit-serialization-home-");
  seedWranglerUpdateCheckCache(isolated);
  guardLogPath = join(workspace, "loopback-guard.jsonl");
  writeFileSync(guardLogPath, "", "utf8");

  mkdirSync(join(workspace, "public"), { recursive: true });
  writeFileSync(
    join(workspace, "index.mjs"),
    "export default { fetch() { return new Response('fixture'); } };\n",
  );
  writeFileSync(join(workspace, "public", ".keep"), "");

  // The same shape the release path generates: the build output plus exactly
  // the two pinned inherit records.
  const configuration = {
    name: DUMMY_WORKER_NAME,
    main: "index.mjs",
    compatibility_date: "2026-07-30",
    compatibility_flags: ["nodejs_compat"],
    keep_vars: true,
    unsafe: { bindings: buildPinnedInheritanceBindings(DUMMY_LIVE_VERSION) },
  };
  const configPath = join(workspace, "wrangler.json");
  writeFileSync(configPath, JSON.stringify(configuration, null, 2));

  await runWrangler({
    configPath,
    port,
    isolated,
    guardLogPath,
    // The child runs in the throwaway workspace, not in the repository, so a
    // stray `.env`/`.dev.vars` in a developer's checkout cannot reach it.
    cwd: workspace,
  });
  guardRecords = readLoopbackGuardLog(guardLogPath);
  server.close();
}, 240_000);

afterAll(() => {
  isolated?.dispose();
  if (workspace) rmSync(workspace, { recursive: true, force: true });
});

describe("the Wrangler installation under test", () => {
  it("is the one the SHARED release resolver authorizes, not a path this test composed", () => {
    expect(wranglerIdentity.ok).toBe(true);
    expect(wranglerIdentity.evidence.resolvedFromRepository).toBe(true);
    expect(wranglerIdentity.launcher?.command).toBe(process.execPath);
    expect(wranglerIdentity.canonicalPath).toBe(wranglerIdentity.launcher?.prefixArgs[0]);
    expect(String(wranglerIdentity.canonicalPath).replace(/\\/g, "/")).toContain(
      CANONICAL_WRANGLER_ENTRY,
    );
    expect(existsSync(String(wranglerIdentity.canonicalPath))).toBe(true);
  });

  it("is at exactly the supported version, in the installed tree", () => {
    const installed = JSON.parse(readFileSync(WRANGLER_MANIFEST, "utf8")) as { version: string };
    expect(installed.version).toBe(SUPPORTED_WRANGLER_VERSION);
    expect(wranglerIdentity.evidence.packageVersion).toBe(SUPPORTED_WRANGLER_VERSION);
  });

  it("is pinned to an exact version in package.json, not a floating range", () => {
    const manifest = JSON.parse(readFileSync(resolve(REPO, "package.json"), "utf8")) as {
      devDependencies: Record<string, string>;
    };
    expect(manifest.devDependencies.wrangler).toBe(SUPPORTED_WRANGLER_VERSION);
  });
});

describe("containment", () => {
  it("performed real network activity, and the guard OBSERVED all of it", () => {
    // An empty log would mean the guard was never in the process that made the
    // requests — which would make every assertion below vacuous.
    expect(capture.requests.length).toBeGreaterThan(0);
    expect(guardRecords.length).toBeGreaterThan(0);
  });

  it("was refused nothing, because it attempted nothing but the loopback listener", () => {
    expect(blockedDestinations(guardRecords)).toEqual([]);
    expect(allowedDestinations(guardRecords).length).toBe(guardRecords.length);
  });

  it("reached ONLY 127.0.0.1 on the test listener's port", () => {
    for (const record of guardRecords) {
      expect(["127.0.0.1", "::1", "localhost"], record.api).toContain(record.host);
      expect(record.port, record.api).toBe(listenerPort);
    }
  });

  it("sent a Host header naming exactly the loopback listener", () => {
    expect(capture.hostHeaders.length).toBeGreaterThan(0);
    for (const host of capture.hostHeaders) {
      expect(host).toBe(`127.0.0.1:${listenerPort}`);
    }
  });

  it("selected the documented versions-upload endpoint, and no deployment endpoint", () => {
    expect(capture.requests).toContain(
      `POST /client/v4/accounts/${DUMMY_ACCOUNT_ID}/workers/scripts/${DUMMY_WORKER_NAME}/versions`,
    );
    for (const request of capture.requests) {
      expect(request).not.toMatch(/\/deployments/);
    }
  });

  it("used only a synthetic token and a synthetic account, never an operator credential", () => {
    expect(SYNTHETIC_CLOUDFLARE_API_TOKEN).toBe("dummy-token-not-a-credential");
    expect(DUMMY_ACCOUNT_ID).toBe("00000000000000000000000000000000");
    // The guard log is the only artefact this run writes, and it carries
    // destination metadata only.
    const raw = readFileSync(guardLogPath, "utf8");
    expect(raw).not.toContain(SYNTHETIC_CLOUDFLARE_API_TOKEN);
    expect(raw).not.toContain("authorization");
    expect(raw).not.toContain("/client/v4");
  });
});

describe("what Wrangler actually serialized", () => {
  it("emitted multipart metadata carrying a bindings array", () => {
    expect(capture.metadata).not.toBeNull();
    expect(Array.isArray(capture.metadata?.bindings)).toBe(true);
  });

  it("forwarded BOTH pinned inherit bindings with version_id intact", () => {
    const bindings = capture.metadata?.bindings as Record<string, unknown>[];
    for (const name of PINNED_INHERITANCE_BINDINGS) {
      expect(bindings).toContainEqual({
        name,
        type: INHERIT_BINDING_TYPE,
        version_id: DUMMY_LIVE_VERSION,
      });
    }
  });

  it("did not strip version_id, and did not replace it with `latest`", () => {
    const bindings = capture.metadata?.bindings as Record<string, unknown>[];
    const inherited = bindings.filter((binding) => binding.type === INHERIT_BINDING_TYPE);
    expect(inherited).toHaveLength(PINNED_INHERITANCE_BINDINGS.length);
    for (const binding of inherited) {
      expect(binding.version_id).toBe(DUMMY_LIVE_VERSION);
      expect(binding.version_id).not.toBe("latest");
      expect(binding).toHaveProperty("version_id");
    }
  });

  it("emitted exactly two inherit records — no omission, no duplicate, no third", () => {
    const bindings = capture.metadata?.bindings as Record<string, unknown>[];
    const names = bindings
      .filter((binding) => binding.type === INHERIT_BINDING_TYPE)
      .map((binding) => binding.name);
    expect([...names].sort()).toEqual([...PINNED_INHERITANCE_BINDINGS].sort());
    expect(new Set(names).size).toBe(names.length);
  });

  it("carries no duplicate binding name anywhere in the metadata", () => {
    const bindings = capture.metadata?.bindings as Record<string, unknown>[];
    const names = bindings.map((binding) => String(binding.name));
    expect(new Set(names).size).toBe(names.length);
  });

  it("includes NO plain-text value on any binding", () => {
    const bindings = capture.metadata?.bindings as Record<string, unknown>[];
    for (const binding of bindings) {
      for (const field of ["text", "value", "json", "content"]) {
        expect(binding).not.toHaveProperty(field);
      }
    }
  });

  it("declares no vars block in the serialized metadata", () => {
    expect(capture.metadata).not.toHaveProperty("vars");
  });

  it("still transmits generic keep_bindings as SECONDARY protection", () => {
    // Retained deliberately for the six secrets and the other supported
    // categories. It is no longer the mechanism the two plain-text bindings
    // depend on — that is what the inherit records above are for.
    expect(capture.metadata?.keep_bindings).toEqual([
      "plain_text",
      "json",
      "secret_text",
      "secret_key",
    ]);
  });

  it("matches the approved specification exactly — names, type and source version", () => {
    const bindings = capture.metadata?.bindings as Record<string, unknown>[];
    const approved = buildPinnedInheritanceBindings(DUMMY_LIVE_VERSION);
    const serialized = bindings
      .filter((binding) => binding.type === INHERIT_BINDING_TYPE)
      .map((binding) => ({
        name: binding.name,
        type: binding.type,
        version_id: binding.version_id,
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    expect(serialized).toEqual(
      [...approved].sort((a, b) => a.name.localeCompare(b.name)).map((record) => ({ ...record })),
    );
  });
});
