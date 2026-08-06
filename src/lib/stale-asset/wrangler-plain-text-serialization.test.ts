/**
 * FOREVER-PR140-CORRECTIONS-002 — EMPIRICAL serialization proof for the
 * EXPLICIT `plain_text` mechanism.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS AGAIN, AND WHAT IT IS ALLOWED TO CLAIM
 * ---------------------------------------------------------------------------
 *
 * PR #139 shipped an offline proof that the repository-locked Wrangler forwards
 * a pinned `inherit` `version_id` verbatim. That proof was correct about
 * Wrangler and irrelevant about Cloudflare, which refused the result with HTTP
 * 400 [code: 10057]. It was deleted along with the mechanism it defended.
 *
 * PR #140 replaced inheritance with two explicit `plain_text` records — and
 * shipped NO Wrangler-side proof at all, so the new mechanism rested on
 * inspecting the configuration this repository writes. That is exactly the gap
 * the superseded PREUPLOAD contract had: everything it checked was true, and
 * none of it described the bytes that leave the machine.
 *
 * So the proof is restored for the new mechanism, with the narrower claim the
 * previous one should have carried:
 *
 *   PROVEN HERE — that the repository-locked Wrangler, handed a specification in
 *   the exact shape this release path generates, serializes exactly two
 *   `plain_text` binding records, with the right names, carrying the values the
 *   specification supplied, with zero `inherit` records and no duplicate name.
 *
 *   NOT PROVEN HERE, AND NOT CLAIMED — anything about what Cloudflare does with
 *   that request. This suite never reaches Cloudflare and could not measure it.
 *   Post-upload capture and comparison (§2 step 6 of the runbook) remain the
 *   only evidence of what the API actually produced.
 *
 * ---------------------------------------------------------------------------
 * WHICH WRANGLER — THE SAME FILE THE PRODUCTION UPLOAD RUNS
 * ---------------------------------------------------------------------------
 *
 * The entry point is not a path this file composes. It is whatever
 * `resolveRepositoryWrangler` authorizes — the same shared, fail-closed resolver
 * `scripts/release/wrangler-version-gate.mjs` uses, and therefore the same
 * resolver the production upload wrapper consumes. An external installation
 * reporting the same version resolves to nothing here exactly as it resolves to
 * nothing there.
 *
 * ---------------------------------------------------------------------------
 * CONTAINMENT — MEASURED, NOT ASSUMED
 * ---------------------------------------------------------------------------
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
 *     merely unused, and no `FOREVER_RELEASE_*` input can travel because nothing
 *     of the parent environment is spread;
 *   - no Worker version is created: the mock returns a synthetic response and
 *     nothing is uploaded anywhere.
 *
 * ---------------------------------------------------------------------------
 * THE VALUES IN THIS FILE ARE SYNTHETIC, AND THEY STAY IN THE REQUEST
 * ---------------------------------------------------------------------------
 *
 * The origin is a `.test` host that cannot resolve; the provider is a documented
 * identifier from `studio-types.ts`. They are asserted INSIDE the captured
 * metadata — that is the point of the proof — and asserted to be absent from the
 * guard log, which is the only artefact this run writes.
 *
 * The multipart body IS materialized in memory, because parsing a multipart
 * document requires reading it. Only the `metadata` part is retained; the Worker
 * code bytes, the asset contents, every header other than `Host`, the credential
 * and the boundaries are discarded unparsed. This suite does not claim the body
 * was "dropped unread", because it was read.
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
  EXPLICIT_PLAIN_TEXT_BINDINGS,
  PLAIN_TEXT_BINDING_TYPE,
  REFUSED_INHERIT_BINDING_TYPE,
  REFUSED_INHERIT_LATEST,
  buildExplicitPlainTextBindings,
} from "./explicit-plain-text-bindings";
import {
  allowedDestinations,
  blockedDestinations,
  loopbackGuardEnv,
  loopbackGuardNodeArgs,
  readLoopbackGuardLog,
  type LoopbackGuardRecord,
} from "./loopback-network-guard";
import { RELEASE_VALUE_ENV_KEYS } from "./release-child-environment";
import { SUPPORTED_WRANGLER_VERSION } from "./worker-variable-preservation";
import { CANONICAL_WRANGLER_ENTRY, resolveRepositoryWrangler } from "./wrangler-identity";

/** Dummy. Not a production identifier, not a credential. */
const DUMMY_ACCOUNT_ID = SYNTHETIC_CLOUDFLARE_ACCOUNT_ID;
const DUMMY_WORKER_NAME = "forever-offline-serialization-fixture";
/** Dummy stand-in for the version the mock pretends to create. Never real. */
const DUMMY_CREATED_VERSION = "2b3c4d5e-6f70-4b8c-9d0e-1f2a3b4c5d6e";

/**
 * SYNTHETIC release values, in the shape the contract accepts.
 *
 * `.test` is a reserved TLD and cannot resolve; `r2` is one of the two
 * documented providers. Neither is a production value and neither is a secret.
 */
const SYNTHETIC_VALUES = {
  SUPABASE_URL: "https://serialization-fixture.supabase.test",
  STUDIO_STORAGE_WRITE_PROVIDER: "r2",
} as const;

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
 * The boundary is used to split and then discarded, every part that is not
 * `metadata` is skipped without being turned into a retained value, and nothing
 * about the body is written to disk or logged.
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
      // was talking to, which is the fact a path-only assertion cannot reach.
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
 * loop, so the in-process mock could never accept the connection.
 *
 * The guard is installed as a direct `--require` NODE ARGUMENT rather than
 * through `NODE_OPTIONS`, so the child environment can keep `NODE_OPTIONS`
 * absent entirely.
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
 * its interval. Wrangler exposes no flag for it. The child's temporary directory
 * is ours, so the cache is SEEDED as already-current and the request is never
 * made — and the suite asserts the guard blocked NOTHING, which is only true if
 * the check never fired.
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

const serializedBindings = () => (capture.metadata?.bindings ?? []) as Record<string, unknown>[];

beforeAll(async () => {
  const { server, port } = await startMock(capture);
  listenerPort = port;
  workspace = mkdtempSync(join(tmpdir(), "forever-plain-text-serialization-"));
  isolated = createIsolatedConfigRoot("forever-plain-text-serialization-home-");
  seedWranglerUpdateCheckCache(isolated);
  guardLogPath = join(workspace, "loopback-guard.jsonl");
  writeFileSync(guardLogPath, "", "utf8");

  mkdirSync(join(workspace, "public"), { recursive: true });
  writeFileSync(
    join(workspace, "index.mjs"),
    "export default { fetch() { return new Response('fixture'); } };\n",
  );
  writeFileSync(join(workspace, "public", ".keep"), "");

  // The same shape the release path generates: a build output plus exactly the
  // two explicit `plain_text` records, built by the production function.
  const configuration = {
    name: DUMMY_WORKER_NAME,
    main: "index.mjs",
    compatibility_date: "2026-07-30",
    compatibility_flags: ["nodejs_compat"],
    keep_vars: true,
    unsafe: { bindings: buildExplicitPlainTextBindings(SYNTHETIC_VALUES) },
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
    // destination metadata only — no credential, no path, and NO BINDING VALUE.
    const raw = readFileSync(guardLogPath, "utf8");
    expect(raw).not.toContain(SYNTHETIC_CLOUDFLARE_API_TOKEN);
    expect(raw).not.toContain("authorization");
    expect(raw).not.toContain("/client/v4");
    expect(raw.includes(SYNTHETIC_VALUES.SUPABASE_URL)).toBe(false);
    expect(raw.includes("supabase.test")).toBe(false);
  });

  it("could not have inherited a release input, because the environment is constructed", () => {
    // `buildContainedChildEnv` never spreads the parent environment, so no
    // `FOREVER_RELEASE_*` variable can travel into this child even when one is
    // exported in the shell running the suite.
    const built = buildContainedChildEnv({
      isolated: isolated as IsolatedConfigRoot,
      parentEnv: {
        ...Object.fromEntries(RELEASE_VALUE_ENV_KEYS.map((key) => [key, "must-not-travel"])),
        SystemRoot: process.env.SystemRoot,
      },
    });
    for (const key of RELEASE_VALUE_ENV_KEYS) {
      expect(key in built, key).toBe(false);
    }
  });
});

describe("what Wrangler actually serialized for two explicit plain_text bindings", () => {
  it("emitted multipart metadata carrying a bindings array", () => {
    expect(capture.metadata).not.toBeNull();
    expect(Array.isArray(capture.metadata?.bindings)).toBe(true);
  });

  it("forwarded EXACTLY TWO plain_text records, by name, with the supplied values", () => {
    const bindings = serializedBindings();
    const plainText = bindings.filter(
      (binding) => binding.type === PLAIN_TEXT_BINDING_TYPE && binding.name !== undefined,
    );
    expect(plainText).toHaveLength(EXPLICIT_PLAIN_TEXT_BINDINGS.length);
    expect(plainText.map((binding) => String(binding.name)).sort()).toEqual(
      [...EXPLICIT_PLAIN_TEXT_BINDINGS].sort(),
    );
    for (const name of EXPLICIT_PLAIN_TEXT_BINDINGS) {
      expect(bindings).toContainEqual({
        name,
        type: PLAIN_TEXT_BINDING_TYPE,
        text: SYNTHETIC_VALUES[name],
      });
    }
  });

  it("emitted ZERO inherit records, and no `latest` anywhere in the metadata", () => {
    const bindings = serializedBindings();
    expect(
      bindings.filter((binding) => binding.type === REFUSED_INHERIT_BINDING_TYPE),
    ).toHaveLength(0);
    for (const binding of bindings) {
      expect(binding).not.toHaveProperty("version_id");
    }
    const serialized = JSON.stringify(capture.metadata);
    expect(serialized).not.toContain(`"${REFUSED_INHERIT_BINDING_TYPE}"`);
    expect(serialized).not.toContain(`"${REFUSED_INHERIT_LATEST}"`);
  });

  it("carries no duplicate binding name anywhere in the metadata", () => {
    const names = serializedBindings().map((binding) => String(binding.name));
    expect(new Set(names).size).toBe(names.length);
  });

  it("declares no vars block in the serialized metadata", () => {
    expect(capture.metadata).not.toHaveProperty("vars");
  });

  it("still transmits generic keep_bindings as SECONDARY protection", () => {
    // Retained deliberately for the six secrets and the other supported
    // categories. It is not the mechanism the two plain-text bindings depend on
    // — the explicit records above are.
    expect(capture.metadata?.keep_bindings).toEqual([
      "plain_text",
      "json",
      "secret_text",
      "secret_key",
    ]);
  });

  it("matches the approved specification exactly — names, type and text", () => {
    const approved = buildExplicitPlainTextBindings(SYNTHETIC_VALUES);
    const serialized = serializedBindings()
      .filter((binding) => binding.type === PLAIN_TEXT_BINDING_TYPE)
      .map((binding) => ({ name: binding.name, type: binding.type, text: binding.text }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    expect(serialized).toEqual(
      [...approved].sort((a, b) => a.name.localeCompare(b.name)).map((record) => ({ ...record })),
    );
  });
});
