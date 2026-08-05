/**
 * FOREVER-PINNED-BINDING-INHERITANCE-IMPLEMENTATION-001 — EMPIRICAL
 * serialization proof.
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
 * CONTAINMENT — this test cannot reach Cloudflare
 * ---------------------------------------------------------------------------
 *
 *   - `CLOUDFLARE_API_BASE_URL` points at a loopback server on 127.0.0.1;
 *   - the token, account id, Worker name and both version UUIDs are DUMMY;
 *   - every request is asserted to have gone to the loopback mock;
 *   - no Worker version is created: the mock returns a synthetic response and
 *     nothing is uploaded anywhere.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS CAPTURED, AND WHAT IS DISCARDED
 * ---------------------------------------------------------------------------
 *
 * ONLY the `metadata` multipart part is parsed. The Worker code bytes, the
 * asset contents, every request header, the credential, the multipart
 * boundaries and all environment values are dropped unread — the body is never
 * retained, logged or asserted against as a whole.
 */

import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  INHERIT_BINDING_TYPE,
  PINNED_INHERITANCE_BINDINGS,
  buildPinnedInheritanceBindings,
} from "./pinned-binding-inheritance";
import { SUPPORTED_WRANGLER_VERSION } from "./worker-variable-preservation";

/** Dummy. Not a production identifier, not a credential. */
const DUMMY_ACCOUNT_ID = "00000000000000000000000000000000";
const DUMMY_WORKER_NAME = "forever-offline-serialization-fixture";
const DUMMY_API_TOKEN = "dummy-token-not-a-credential";
/** Dummy stand-in for the verified 100% live version. */
const DUMMY_LIVE_VERSION = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
/** Dummy stand-in for the version the mock pretends to create. Never real. */
const DUMMY_CREATED_VERSION = "2b3c4d5e-6f70-4b8c-9d0e-1f2a3b4c5d6e";

const REPO = process.cwd();
const WRANGLER_ENTRY = resolve(REPO, "node_modules/wrangler/bin/wrangler.js");
const WRANGLER_MANIFEST = resolve(REPO, "node_modules/wrangler/package.json");

interface Capture {
  readonly requests: string[];
  metadata: Record<string, unknown> | null;
}

/**
 * Extracts ONLY the `metadata` part from a multipart body.
 *
 * The boundary is used to split and then discarded. Every other part — the
 * Worker module, any asset — is skipped without being read into a value that
 * outlives this function.
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
 * Runs the repository-locked Wrangler against the loopback mock.
 *
 * `spawn`, never `spawnSync`: a synchronous spawn blocks this process's event
 * loop, so the in-process mock could never accept the connection and the run
 * would fail with a misleading "connectivity" error.
 */
function runWrangler(configPath: string, port: number): Promise<{ status: number | null }> {
  return new Promise((done) => {
    const child = spawn(
      process.execPath,
      [WRANGLER_ENTRY, "versions", "upload", "--keep-vars", "--config", configPath],
      {
        cwd: REPO,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          CLOUDFLARE_API_BASE_URL: `http://127.0.0.1:${port}/client/v4`,
          CLOUDFLARE_API_TOKEN: DUMMY_API_TOKEN,
          CLOUDFLARE_ACCOUNT_ID: DUMMY_ACCOUNT_ID,
          WRANGLER_SEND_METRICS: "false",
          NO_COLOR: "1",
          FORCE_COLOR: "0",
        },
      },
    );
    // stdout/stderr are drained so the child cannot block on a full pipe, and
    // are then discarded: Wrangler output may quote the request.
    child.stdout.resume();
    child.stderr.resume();
    child.on("close", (status) => done({ status }));
  });
}

const capture: Capture = { requests: [], metadata: null };
let workspace = "";

beforeAll(async () => {
  const { server, port } = await startMock(capture);
  workspace = mkdtempSync(join(tmpdir(), "forever-inherit-serialization-"));
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

  await runWrangler(configPath, port);
  server.close();
}, 240_000);

afterAll(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true });
});

describe("the Wrangler installation under test", () => {
  it("is the one locked by this repository, at exactly the supported version", () => {
    expect(existsSync(WRANGLER_ENTRY)).toBe(true);
    const installed = JSON.parse(readFileSync(WRANGLER_MANIFEST, "utf8")) as { version: string };
    expect(installed.version).toBe(SUPPORTED_WRANGLER_VERSION);
  });

  it("is pinned to an exact version in package.json, not a floating range", () => {
    const manifest = JSON.parse(readFileSync(resolve(REPO, "package.json"), "utf8")) as {
      devDependencies: Record<string, string>;
    };
    expect(manifest.devDependencies.wrangler).toBe(SUPPORTED_WRANGLER_VERSION);
  });
});

describe("containment", () => {
  it("reached the loopback mock and nothing else", () => {
    expect(capture.requests.length).toBeGreaterThan(0);
    for (const request of capture.requests) {
      expect(request).not.toMatch(/api\.cloudflare\.com/);
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
