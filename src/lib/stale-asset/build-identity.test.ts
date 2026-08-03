/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — build/release identity.
 *
 * The identity must be bounded, deterministic, different across two builds that
 * differ, identical for one immutable build, and unable to become a place to
 * hide anything. The probe must fail closed on every unexpected answer, because
 * "cannot prove a version change" has to mean "do not reload".
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  FOREVER_BUILD_ENDPOINT,
  FOREVER_BUILD_ID,
  fetchActiveBuildId,
  isBoundedBuildId,
} from "./build-identity";
import { FOREVER_BUILD_ID_PATTERN } from "./stale-asset-recovery-contract";
import {
  FOREVER_BUILD_ID_PATTERN as SCRIPT_PATTERN,
  isBoundedForeverBuildId,
  resolveForeverBuildId,
} from "../../../scripts/build/forever-build-id";

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
    expect(SCRIPT_PATTERN.source).toBe(FOREVER_BUILD_ID_PATTERN.source);
  });

  it("accepts only lowercase alphanumerics up to 32 characters", () => {
    for (const good of ["a", "aaaaaaaaaaaa", "0123456789ab", "z".repeat(32)]) {
      expect(isBoundedBuildId(good)).toBe(true);
      expect(isBoundedForeverBuildId(good)).toBe(true);
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
      expect(isBoundedBuildId(bad)).toBe(false);
    }
  });

  it("the compiled-in identifier is itself bounded", () => {
    expect(FOREVER_BUILD_ID.length).toBeGreaterThan(0);
    // Under vitest there is no `define`, so the documented fallback applies.
    expect(FOREVER_BUILD_ID).toBe("development");
  });
});

describe("resolution is deterministic and reproducible", () => {
  it("returns the same value for the same tree", () => {
    const first = resolveForeverBuildId(REPO_ROOT, {});
    const second = resolveForeverBuildId(REPO_ROOT, {});
    expect(first).toBe(second);
    expect(isBoundedForeverBuildId(first)).toBe(true);
    expect(first).toHaveLength(12);
  });

  it("honours an explicit, bounded FOREVER_BUILD_ID", () => {
    expect(resolveForeverBuildId(REPO_ROOT, { FOREVER_BUILD_ID: "aaaaaaaaaaaa" })).toBe(
      "aaaaaaaaaaaa",
    );
    expect(resolveForeverBuildId(REPO_ROOT, { FOREVER_BUILD_ID: "  BBBBBBBBBBBB " })).toBe(
      "bbbbbbbbbbbb",
    );
  });

  it("ignores a malformed override rather than shipping it", () => {
    const derived = resolveForeverBuildId(REPO_ROOT, {});
    expect(resolveForeverBuildId(REPO_ROOT, { FOREVER_BUILD_ID: "not a build id!" })).toBe(derived);
    expect(resolveForeverBuildId(REPO_ROOT, { FOREVER_BUILD_ID: "" })).toBe(derived);
  });

  it("is not a timestamp and not random", () => {
    const source = read("scripts/build/forever-build-id.ts");
    expect(source).not.toContain("Date.now");
    expect(source).not.toContain("Math.random");
    expect(source).not.toContain("new Date");
    expect(source).not.toContain("randomUUID");
  });

  it("carries no secret, credential or private reference", () => {
    const source = read("scripts/build/forever-build-id.ts");
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
    expect(FOREVER_BUILD_ENDPOINT).toBe("/forever-build.json");
    expect(FOREVER_BUILD_ENDPOINT.startsWith("/")).toBe(true);
    expect(FOREVER_BUILD_ENDPOINT).not.toContain("?");
    expect(FOREVER_BUILD_ENDPOINT).not.toContain("//");
  });

  it("answers no-store, nosniff, noindex and exposes only the identifier", () => {
    const route = read("src/routes/forever-build[.]json.ts");
    expect(route).toContain('"Cache-Control": "no-store"');
    expect(route).toContain('"X-Content-Type-Options": "nosniff"');
    expect(route).toContain('"X-Robots-Tag": "noindex, nofollow"');
    expect(route).toContain("JSON.stringify({ build: FOREVER_BUILD_ID })");
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
    const fetchImpl = vi.fn(async () => jsonResponse({ build: "bbbbbbbbbbbb" }));
    await expect(fetchActiveBuildId({ fetchImpl })).resolves.toBe("bbbbbbbbbbbb");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/forever-build.json");
    expect(init.cache).toBe("no-store");
    expect(init.credentials).toBe("omit");
    expect(init.body).toBeUndefined();
  });

  it.each([
    ["a non-OK status", async () => jsonResponse({ build: "bbbbbbbbbbbb" }, { status: 500 })],
    ["an HTML page", async () => new Response("<!doctype html><html></html>", { status: 200 })],
    ["a malformed body", async () => new Response("{", { status: 200 })],
    ["a missing field", async () => jsonResponse({})],
    ["an unbounded identifier", async () => jsonResponse({ build: "not a build id" })],
    ["a non-string identifier", async () => jsonResponse({ build: 42 })],
    ["an array payload", async () => jsonResponse(["bbbbbbbbbbbb"])],
    ["a null payload", async () => jsonResponse(null)],
    [
      "a network failure",
      async () => {
        throw new Error("network down");
      },
    ],
  ])("returns null for %s", async (_label, impl) => {
    await expect(fetchActiveBuildId({ fetchImpl: impl as never })).resolves.toBeNull();
  });

  it("never retries", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    await fetchActiveBuildId({ fetchImpl: fetchImpl as never });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("the identity is wired into the build", () => {
  it("vite.config.ts defines the constant for client and server output", () => {
    const config = read("vite.config.ts");
    expect(config).toContain("resolveForeverBuildId");
    expect(config).toContain("__FOREVER_BUILD_ID__: JSON.stringify(FOREVER_BUILD_ID)");
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
