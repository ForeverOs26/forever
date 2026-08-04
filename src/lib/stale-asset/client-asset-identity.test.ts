/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — CLIENT ASSET identity.
 *
 * The identity must be bounded, deterministic, different across two builds
 * whose CLIENT output differs, identical for one client asset graph, and unable
 * to become a place to hide anything. The probe must fail closed on every
 * unexpected answer, because "cannot prove a client asset change" has to mean
 * "do not reload".
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT TEST (narrow-re-review RR2-P1-1). That
 * this value identifies a release. It does not, it never did, and the release
 * contract that used to assume it does is pinned in
 * `release-identity-separation.test.ts` instead.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  FOREVER_CLIENT_ASSETS_ENDPOINT,
  FOREVER_CLIENT_ASSET_ID,
  fetchActiveClientAssetId,
  isBoundedClientAssetId,
} from "./client-asset-identity";
import { FOREVER_CLIENT_ASSET_ID_PATTERN } from "./stale-asset-recovery-contract";
import {
  FOREVER_CLIENT_ASSET_ID_DERIVED_ENV,
  FOREVER_CLIENT_ASSET_ID_PATTERN as SCRIPT_PATTERN,
  FOREVER_CLIENT_ASSET_ID_PLACEHOLDER,
  FOREVER_CLIENT_ASSET_ID_PLACEHOLDER_ENV,
  FOREVER_CLIENT_ASSET_DIGEST_EXCLUSIONS,
  FOREVER_CLIENT_ASSET_DIGEST_INCLUDED,
  FOREVER_CLIENT_ASSET_ID_TEST_OVERRIDE_ENV,
  ForeverClientAssetIdError,
  deriveForeverClientAssetId,
  digestEmittedClientAssets,
  isBoundedForeverClientAssetId,
  normalizeEmittedContent,
  normalizeEmittedName,
  pathContributesToClientAssetIdentity,
  resolveForeverClientAssetId,
} from "../../../scripts/build/forever-client-asset-id";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const REPO_ROOT = process.cwd();

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("the identifier is bounded", () => {
  it("uses one pattern in the build and in the browser", () => {
    expect(SCRIPT_PATTERN.source).toBe(FOREVER_CLIENT_ASSET_ID_PATTERN.source);
  });

  it("accepts only lowercase alphanumerics up to 32 characters", () => {
    for (const good of ["a", "aaaaaaaaaaaa", "0123456789ab", "z".repeat(32)]) {
      expect(isBoundedClientAssetId(good)).toBe(true);
      expect(isBoundedForeverClientAssetId(good)).toBe(true);
    }
    for (const bad of [
      "",
      "z".repeat(33),
      "UPPER",
      "has space",
      "has-dash",
      "has_underscore",
      "someone@example.com",
      "https://example.com/x",
      "../../etc/passwd",
      42,
      null,
      undefined,
      {},
    ]) {
      expect(isBoundedClientAssetId(bad)).toBe(false);
    }
  });

  it("the compiled-in identifier is itself bounded", () => {
    expect(FOREVER_CLIENT_ASSET_ID.length).toBeGreaterThan(0);
    // Under vitest there is no `define`, so the documented fallback applies.
    expect(FOREVER_CLIENT_ASSET_ID).toBe("development");
  });
});

describe("resolution is fail-closed and never reuses an identity", () => {
  it("returns the derived identity the orchestrator feeds back in", () => {
    expect(resolveForeverClientAssetId({ [FOREVER_CLIENT_ASSET_ID_DERIVED_ENV]: "0123456789abcdef" })).toBe(
      "0123456789abcdef",
    );
  });

  it("refuses a derived value that is not bounded", () => {
    expect(() =>
      resolveForeverClientAssetId({ [FOREVER_CLIENT_ASSET_ID_DERIVED_ENV]: "not a build id!" }),
    ).toThrow(ForeverClientAssetIdError);
  });

  it("returns the fixed placeholder on the first pass", () => {
    expect(resolveForeverClientAssetId({ [FOREVER_CLIENT_ASSET_ID_PLACEHOLDER_ENV]: "1" })).toBe(
      FOREVER_CLIENT_ASSET_ID_PLACEHOLDER,
    );
    expect(isBoundedForeverClientAssetId(FOREVER_CLIENT_ASSET_ID_PLACEHOLDER)).toBe(true);
  });

  it("REFUSES a manual production override — it could reuse a deployed identity", () => {
    // Independent-review P3-3. Pinning a previously deployed identifier makes
    // every page from that build see `same_client_assets` and refuse recovery, which
    // silently disables the whole mechanism.
    expect(() => resolveForeverClientAssetId({ FOREVER_CLIENT_ASSET_ID: "dcc016953096" })).toThrow(
      /may not be set for a production build/,
    );
  });

  it("permits a manual override ONLY behind the explicit non-production guard", () => {
    expect(
      resolveForeverClientAssetId({
        FOREVER_CLIENT_ASSET_ID: "  AAAAAAAAAAAA ",
        [FOREVER_CLIENT_ASSET_ID_TEST_OVERRIDE_ENV]: "1",
      }),
    ).toBe("aaaaaaaaaaaa");
  });

  it("refuses a malformed override even behind the test guard", () => {
    expect(() =>
      resolveForeverClientAssetId({
        FOREVER_CLIENT_ASSET_ID: "not a build id!",
        [FOREVER_CLIENT_ASSET_ID_TEST_OVERRIDE_ENV]: "1",
      }),
    ).toThrow(ForeverClientAssetIdError);
  });

  it("refuses a bare build with no identity at all rather than shipping a placeholder", () => {
    expect(() => resolveForeverClientAssetId({})).toThrow(/must run through/);
  });

  it("the production orchestrator never sets the test guard", () => {
    const orchestrator = read("scripts/build/build-forever.mjs");
    expect(orchestrator).toContain("FOREVER_ALLOW_TEST_CLIENT_ASSET_ID: undefined");
    expect(orchestrator).toContain("FOREVER_CLIENT_ASSET_ID: undefined");
  });

  it("npm run build IS the two-pass orchestrator, not a bare vite build", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts.build).toBe("node scripts/build/build-forever.mjs");
    expect(pkg.scripts["build:dev"]).toContain("scripts/build/build-forever.mjs");
  });

  it("is not a timestamp and not random", () => {
    const source = read("scripts/build/forever-client-asset-id.ts");
    expect(source).not.toContain("Date.now");
    expect(source).not.toContain("Math.random");
    expect(source).not.toContain("new Date");
    expect(source).not.toContain("randomUUID");
  });

  it("carries no secret, credential or private reference", () => {
    const source = read("scripts/build/forever-client-asset-id.ts");
    for (const forbidden of [
      "SERVICE_ROLE",
      "R2_SECRET",
      "R2_ACCESS_KEY",
      "GITHUB_TOKEN",
      "STUDIO_OWNER",
      "SUPABASE_URL",
      "process.env.SUPABASE",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});

describe("the endpoint is same-origin, unparameterised and safe", () => {
  it("is a fixed same-origin path with no query", () => {
    expect(FOREVER_CLIENT_ASSETS_ENDPOINT).toBe("/forever-client-assets.json");
    expect(FOREVER_CLIENT_ASSETS_ENDPOINT.startsWith("/")).toBe(true);
    expect(FOREVER_CLIENT_ASSETS_ENDPOINT).not.toContain("?");
    expect(FOREVER_CLIENT_ASSETS_ENDPOINT).not.toContain("//");
  });

  it("answers no-store, nosniff, noindex and exposes only the identifier", () => {
    const route = read("src/routes/forever-client-assets[.]json.ts");
    expect(route).toContain('"Cache-Control": "no-store"');
    expect(route).toContain('"X-Content-Type-Options": "nosniff"');
    expect(route).toContain('"X-Robots-Tag": "noindex, nofollow"');
    expect(route).toContain("JSON.stringify({ clientAssetId: FOREVER_CLIENT_ASSET_ID })");
    // The handler takes no argument at all, so it cannot read request state.
    expect(route).toContain("GET: () =>");
    for (const forbidden of [
      "process.env",
      "__env__",
      "R2_",
      "SUPABASE",
      "STUDIO_OWNER",
      "ASSETS",
      "bindings",
      "searchParams",
      "headers.get",
    ]) {
      expect(route).not.toContain(forbidden);
    }
  });
});

describe("the probe fails closed", () => {
  it("returns the identifier for a well-formed answer", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ clientAssetId: "bbbbbbbbbbbb" }));
    await expect(fetchActiveClientAssetId({ fetchImpl })).resolves.toBe("bbbbbbbbbbbb");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/forever-client-assets.json");
    expect(init.cache).toBe("no-store");
    expect(init.credentials).toBe("omit");
    expect(init.body).toBeUndefined();
  });

  it.each([
    ["a non-OK status", async () => jsonResponse({ clientAssetId: "bbbbbbbbbbbb" }, { status: 500 })],
    ["an HTML page", async () => new Response("<!doctype html><html></html>", { status: 200 })],
    ["a malformed body", async () => new Response("{", { status: 200 })],
    ["a missing field", async () => jsonResponse({})],
    ["an unbounded identifier", async () => jsonResponse({ clientAssetId: "not a client asset id" })],
    ["a non-string identifier", async () => jsonResponse({ clientAssetId: 42 })],
    ["an array payload", async () => jsonResponse(["bbbbbbbbbbbb"])],
    ["a null payload", async () => jsonResponse(null)],
    [
      "a network failure",
      async () => {
        throw new Error("network down");
      },
    ],
  ])("returns null for %s", async (_label, impl) => {
    await expect(fetchActiveClientAssetId({ fetchImpl: impl as never })).resolves.toBeNull();
  });

  it("never retries", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    await fetchActiveClientAssetId({ fetchImpl: fetchImpl as never });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// P1-4 — the identity is derived from the EMITTED OUTPUT
// ---------------------------------------------------------------------------

describe("the output digest covers the whole emitted runtime graph", () => {
  let seq = 0;
  function emit(files: Record<string, string>): string {
    seq += 1;
    const root = join(tmpdir(), `forever-client-asset-digest-${process.pid}-${seq}`);
    rmSync(root, { recursive: true, force: true });
    for (const [path, contents] of Object.entries(files)) {
      const full = join(root, path);
      mkdirSync(full.slice(0, full.lastIndexOf(sep)), { recursive: true });
      writeFileSync(full, contents, "utf8");
    }
    return root;
  }

  /** A minimal but representative emitted graph. */
  const BASE: Record<string, string> = {
    "nitro.json": '{"date":"2026-08-04T00:00:00.000Z"}',
    "public/assets/index-AAAAAAAA.js": 'console.log("entry");',
    "public/assets/StudioDashboard-BBBBBBBB.js": "export const dash = 1;",
    "public/assets/styles-CCCCCCCC.css": "body{color:red}",
    "public/favicon.ico": "icon-bytes",
    "public/_headers": "/*\n  X-Frame-Options: DENY",
    "server/index.mjs": "export default {};",
    "server/_ssr/root-DDDDDDDD.mjs": "export const ssr = 1;",
    "server/wrangler.json": '{"name":"forever"}',
  };

  const digestOf = (files: Record<string, string>, identity = FOREVER_CLIENT_ASSET_ID_PLACEHOLDER) =>
    digestEmittedClientAssets(emit(files), identity);

  it("hashes something at all — an empty digest would prove nothing", () => {
    const result = digestOf(BASE);
    // public/** (5) + server/wrangler.json (1). See FOREVER_CLIENT_ASSET_DIGEST_EXCLUSIONS.
    expect(result.fileCount).toBe(6);
    expect(result.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("identical emitted output produces an identical digest and identity", () => {
    const a = digestOf(BASE);
    const b = digestOf(BASE);
    expect(a.digest).toBe(b.digest);
    expect(deriveForeverClientAssetId(a.digest)).toBe(deriveForeverClientAssetId(b.digest));
  });

  it("an application source change changes the identity", () => {
    const changed = { ...BASE, "public/assets/index-AAAAAAAA.js": 'console.log("entry v2");' };
    expect(digestOf(changed).digest).not.toBe(digestOf(BASE).digest);
  });

  it("a lazy Studio route chunk change changes the identity", () => {
    const changed = {
      ...BASE,
      "public/assets/StudioDashboard-BBBBBBBB.js": "export const dash = 2;",
    };
    expect(digestOf(changed).digest).not.toBe(digestOf(BASE).digest);
  });

  it("a CSS change changes the identity", () => {
    const changed = { ...BASE, "public/assets/styles-CCCCCCCC.css": "body{color:blue}" };
    expect(digestOf(changed).digest).not.toBe(digestOf(BASE).digest);
  });

  it("a public static asset change changes the identity", () => {
    const changed = { ...BASE, "public/favicon.ico": "other-icon-bytes" };
    expect(digestOf(changed).digest).not.toBe(digestOf(BASE).digest);
  });

  it("an added or removed emitted file changes the identity", () => {
    const added = { ...BASE, "public/assets/new-EEEEEEEE.js": "export const x = 1;" };
    expect(digestOf(added).digest).not.toBe(digestOf(BASE).digest);
    const removed = { ...BASE } as Record<string, string>;
    delete removed["public/assets/StudioDashboard-BBBBBBBB.js"];
    expect(digestOf(removed).digest).not.toBe(digestOf(BASE).digest);
  });

  it("the generated Worker configuration change changes the identity", () => {
    expect(digestOf({ ...BASE, "server/wrangler.json": '{"name":"forever2"}' }).digest).not.toBe(
      digestOf(BASE).digest,
    );
  });

  it("the server JavaScript bundle is excluded, enumerated, and justified", () => {
    // Independent-review P1-4. This is a DEVIATION from "exclude only generated
    // non-runtime metadata", taken because two builds of identical source
    // measurably emit different server chunks — Rolldown identifier
    // deconfliction plus an mtime-bearing public-asset manifest — while the
    // client graph is byte-identical. An identity computed over
    // non-reproducible bytes is not an identity. `npm run build:determinism`
    // reproduces the measurement.
    expect(digestOf({ ...BASE, "server/index.mjs": "export default { a: 1 };" }).digest).toBe(
      digestOf(BASE).digest,
    );
    expect(FOREVER_CLIENT_ASSET_DIGEST_EXCLUSIONS.map((entry) => entry.path).sort()).toEqual([
      "nitro.json",
      "package-lock.json",
      "package.json",
      "server/**.mjs",
    ]);
    for (const entry of FOREVER_CLIENT_ASSET_DIGEST_EXCLUSIONS) {
      expect(entry.reason.length, entry.path).toBeGreaterThan(30);
    }
    expect([...FOREVER_CLIENT_ASSET_DIGEST_INCLUDED]).toEqual(["public", "server/wrangler.json"]);
  });

  it("the whole client runtime graph contributes, and nothing under public is excluded", () => {
    expect(pathContributesToClientAssetIdentity("public/assets/index-AAAAAAAA.js")).toBe(true);
    expect(pathContributesToClientAssetIdentity("public/assets/styles-CCCCCCCC.css")).toBe(true);
    expect(pathContributesToClientAssetIdentity("public/favicon.ico")).toBe(true);
    expect(pathContributesToClientAssetIdentity("public/_headers")).toBe(true);
    expect(pathContributesToClientAssetIdentity("server/wrangler.json")).toBe(true);
    expect(pathContributesToClientAssetIdentity("server/index.mjs")).toBe(false);
    expect(pathContributesToClientAssetIdentity("nitro.json")).toBe(false);
  });

  it("the generated Worker headers file contributes", () => {
    expect(
      digestOf({ ...BASE, "public/_headers": "/*\n  X-Frame-Options: SAMEORIGIN" }).digest,
    ).not.toBe(digestOf(BASE).digest);
  });

  it("the build DATE metadata cannot change the identity", () => {
    const other = { ...BASE, "nitro.json": '{"date":"2027-01-01T00:00:00.000Z"}' };
    expect(digestOf(other).digest).toBe(digestOf(BASE).digest);
  });

  it("substituting the identity is hash-neutral — the two passes are comparable", () => {
    const identity = "0123456789abcdef0123456789abcdef";
    // The final pass inlines the identity and its chunk hash therefore moves.
    const finalPass: Record<string, string> = {
      ...BASE,
      "public/assets/index-ZZZZZZZZ.js": `console.log("entry");globalThis.b="${identity}";`,
      "server/_ssr/root-YYYYYYYY.mjs": `export const ssr = 1;export const b="${identity}";`,
    };
    delete finalPass["public/assets/index-AAAAAAAA.js"];
    delete finalPass["server/_ssr/root-DDDDDDDD.mjs"];

    const passOne: Record<string, string> = {
      ...BASE,
      "public/assets/index-AAAAAAAA.js": `console.log("entry");globalThis.b="${FOREVER_CLIENT_ASSET_ID_PLACEHOLDER}";`,
      "server/_ssr/root-DDDDDDDD.mjs": `export const ssr = 1;export const b="${FOREVER_CLIENT_ASSET_ID_PLACEHOLDER}";`,
    };

    expect(digestEmittedClientAssets(emit(finalPass), identity).digest).toBe(
      digestEmittedClientAssets(emit(passOne), FOREVER_CLIENT_ASSET_ID_PLACEHOLDER).digest,
    );
  });

  it("but a REAL change alongside the identity substitution is still detected", () => {
    const identity = "0123456789abcdef0123456789abcdef";
    const finalPass: Record<string, string> = {
      ...BASE,
      "public/assets/index-ZZZZZZZZ.js": `console.log("entry CHANGED");globalThis.b="${identity}";`,
    };
    delete finalPass["public/assets/index-AAAAAAAA.js"];
    const passOne: Record<string, string> = {
      ...BASE,
      "public/assets/index-AAAAAAAA.js": `console.log("entry");globalThis.b="${FOREVER_CLIENT_ASSET_ID_PLACEHOLDER}";`,
    };
    expect(digestEmittedClientAssets(emit(finalPass), identity).digest).not.toBe(
      digestEmittedClientAssets(emit(passOne), FOREVER_CLIENT_ASSET_ID_PLACEHOLDER).digest,
    );
  });

  it("normalisation touches only content hashes and the identity", () => {
    expect(normalizeEmittedName("public/assets/index-6PxG9iJc.js")).toBe(
      "public/assets/index-<forever-content-hash>.js",
    );
    expect(normalizeEmittedName("public/favicon.ico")).toBe("public/favicon.ico");
    const identity = "0123456789abcdef0123456789abcdef";
    const normalized = normalizeEmittedContent(
      "x.js",
      Buffer.from(`const b="${identity}";import"./a-AbCdEfGh.js";`),
      identity,
    ).toString("utf8");
    expect(normalized).toContain(FOREVER_CLIENT_ASSET_ID_PLACEHOLDER);
    expect(normalized).not.toContain(identity);
    expect(normalized).toContain("./a-<forever-content-hash>.js");
  });
});

describe("the derived identity is bounded and 128 bits", () => {
  it("is 32 lowercase hex characters", () => {
    const identity = deriveForeverClientAssetId("a".repeat(64));
    expect(identity).toMatch(/^[0-9a-f]{32}$/);
    expect(isBoundedForeverClientAssetId(identity)).toBe(true);
    expect(identity.length * 4).toBe(128);
  });

  it("different digests give different identities", () => {
    expect(deriveForeverClientAssetId("a".repeat(64))).not.toBe(deriveForeverClientAssetId("b".repeat(64)));
  });
});

describe("the final pass verifies itself", () => {
  const orchestrator = read("scripts/build/build-forever.mjs");

  it("recomputes the digest after the final pass and requires exact equality", () => {
    expect(orchestrator).toContain("if (after.digest !== before.digest) {");
    expect(orchestrator).toContain("FINAL OUTPUT DID NOT REPRODUCE THE DERIVED IDENTITY");
    expect(orchestrator).toContain("Refusing to ship.");
  });

  it("refuses to derive an identity from an empty output", () => {
    expect(orchestrator).toContain("refusing to derive an identity from nothing");
  });

  it("compares the emitted file count as well as the digest", () => {
    expect(orchestrator).toContain("after.fileCount !== before.fileCount");
    expect(orchestrator).toContain("the placeholder identity still appears in");
    expect(orchestrator).toContain("was not inlined into any CLIENT asset");
    expect(orchestrator).toContain("was not inlined into any SERVER output");
  });
});

describe("the identity is wired into the build", () => {
  it("vite.config.ts defines the constant for client and server output", () => {
    const config = read("vite.config.ts");
    expect(config).toContain("resolveForeverClientAssetId");
    expect(config).toContain("__FOREVER_CLIENT_ASSET_ID__: JSON.stringify(FOREVER_CLIENT_ASSET_ID)");
  });

  it("the capture layer is installed by a call the bundler cannot drop", () => {
    // A bare side-effect import is removed under `"sideEffects": false`; this
    // repository proved that in a real build, so the install must be a call.
    const router = read("src/router.tsx");
    expect(router).toContain("installStaleAssetCapture();");
    expect(read("package.json")).toContain('"sideEffects": false');
    expect(read("src/routes/__root.tsx")).not.toContain(
      'import "../lib/stale-asset/global-capture"',
    );
  });
});
