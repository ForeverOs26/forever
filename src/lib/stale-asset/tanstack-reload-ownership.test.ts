/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — exactly one recovery authority
 * (independent-review P1-5).
 *
 * `@tanstack/react-router` 1.170.16 contains its own identity-blind reload for
 * lazy route components. It writes `sessionStorage["tanstack_router_reload:<raw
 * error message>"]` — a key containing the complete failing asset URL — and
 * calls `window.location.reload()`, with no build-identity check, no
 * write-safety check, no route deny list and no success clearing. The review
 * measured six real error shapes for which it fires while the Forever
 * classifier correctly declines.
 *
 * Two independent recovery systems is not a design, it is a race. This suite
 * pins the removal:
 *
 *   1. the upstream module still has the built-in reload in the shape the
 *      replacement was written against — so an upgrade that changes or removes
 *      it FAILS here rather than silently leaving a stale replacement;
 *   2. the pinned version offers no supported way to disable it, which is why
 *      replacement is the correct option and not the first one;
 *   3. the repository-controlled loader never reloads, never writes
 *      sessionStorage and preserves everything else;
 *   4. the substitution is wired into the build;
 *   5. the forbidden runtime key is absent from the built client bundle.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  FORBIDDEN_TANSTACK_RELOAD_KEY,
  TANSTACK_ROUTER_PINNED_VERSION,
  UPSTREAM_DISABLE_OPTIONS,
  UPSTREAM_RELOAD_FINGERPRINT,
  checkTanstackReloadFingerprint,
  stripDocumentation,
  installedTanstackRouterVersion,
  resolveUpstreamLazyModulePath,
} from "../../../scripts/build/tanstack-reload-ownership.mjs";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/** Loads the replacement as a real ES module, by file URL (Windows-safe). */
async function loadReplacement(): Promise<{
  lazyRouteComponent: (
    importer: () => Promise<Record<string, unknown>>,
    exportName?: string,
  ) => { (props: unknown): unknown; preload: () => Promise<unknown> };
}> {
  const url = pathToFileURL(
    resolve(process.cwd(), "scripts/build/forever-lazy-route-component.js"),
  ).href;
  return import(/* @vite-ignore */ url);
}

describe("the upstream built-in reload is exactly what the replacement removes", () => {
  it("the installed router is the pinned version the replacement was written against", () => {
    expect(installedTanstackRouterVersion()).toBe(TANSTACK_ROUTER_PINNED_VERSION);
  });

  it("the upstream loader still contains the built-in reload, in that shape", () => {
    const source = readFileSync(resolveUpstreamLazyModulePath(), "utf8");
    for (const marker of UPSTREAM_RELOAD_FINGERPRINT) {
      expect(source, marker).toContain(marker);
    }
  });

  it("the pinned version offers NO supported way to disable it", () => {
    // This is why option 1 in the preference order — an official configuration
    // — is not available, and option 2 (replace the loader) applies. The day
    // upstream adds one, this fails and the replacement should be deleted.
    const source = readFileSync(resolveUpstreamLazyModulePath(), "utf8");
    for (const option of UPSTREAM_DISABLE_OPTIONS) {
      expect(source, option).not.toContain(option);
    }
  });

  it("the fingerprint check passes right now, and is the build's gate", () => {
    const check = checkTanstackReloadFingerprint();
    expect(check.readable).toBe(true);
    expect(check.pinnedVersionMatches).toBe(true);
    expect(check.missingMarkers).toEqual([]);
    expect(check.newOptions).toEqual([]);
    expect(check.ok).toBe(true);
  });

  it("the plugin REFUSES to build when the fingerprint stops matching", () => {
    const plugin = read("scripts/build/tanstack-reload-ownership.mjs");
    expect(plugin).toContain("REFUSING TO BUILD");
    expect(plugin).toContain("configResolved()");
    // And it states its own removal trigger.
    expect(plugin).toContain("REMOVAL TRIGGER");
  });
});

describe("the repository-controlled loader owns nothing it should not", () => {
  // The CODE, without its documentation. The header legitimately quotes what
  // was removed — explaining a removal requires naming it — so these
  // assertions run against exactly what the build emits.
  const replacement = stripDocumentation(read("scripts/build/forever-lazy-route-component.js"));

  it("never reloads", () => {
    expect(replacement).not.toContain("location.reload");
    expect(replacement).not.toContain("location.replace");
    expect(replacement).not.toContain("location.assign");
  });

  it("never touches sessionStorage, and never writes the forbidden key", () => {
    expect(replacement).not.toContain("sessionStorage");
    expect(replacement).not.toContain("localStorage");
    expect(replacement).not.toContain(FORBIDDEN_TANSTACK_RELOAD_KEY);
  });

  it("does not re-implement a module-not-found special case", () => {
    expect(replacement).not.toContain("isModuleNotFoundError");
  });

  it("preserves preload, memoisation, the recorded error and React.use", () => {
    expect(replacement).toContain("lazyComp.preload = load;");
    expect(replacement).toContain("if (!loadPromise)");
    expect(replacement).toContain("if (error) throw error;");
    expect(replacement).toContain("reactUse");
    expect(replacement).toContain("React.createElement(comp, props)");
  });

  it("is a real module that exports the loader", async () => {
    const mod = await loadReplacement();
    expect(typeof mod.lazyRouteComponent).toBe("function");
    const component = mod.lazyRouteComponent(async () => ({ default: () => null }));
    expect(typeof component.preload).toBe("function");
  });

  it("a failing import records the error and reloads NOTHING", async () => {
    const mod = await loadReplacement();
    const missing = new Error(
      "Failed to fetch dynamically imported module: https://forever.example/assets/StudioDashboard-DDTDlhmi.js",
    );
    const touched: string[] = [];
    const spy = {
      getItem: (key: string) => {
        touched.push(`get:${key}`);
        return null;
      },
      setItem: (key: string) => void touched.push(`set:${key}`),
      removeItem: (key: string) => void touched.push(`remove:${key}`),
    };
    const originalStorage = globalThis.sessionStorage;
    // jsdom's `location.reload` is non-configurable, so the honest way to prove
    // no reload happens is to prove the loader never reaches for `location` at
    // all: the emitted code contains no navigation call, asserted above, and
    // the failing import surfaces as a THROWN error here instead.
    Object.defineProperty(globalThis, "sessionStorage", { value: spy, configurable: true });
    try {
      const component = mod.lazyRouteComponent(async () => {
        throw missing;
      });
      await component.preload();
      expect(() => component({})).toThrow(missing);
    } finally {
      if (originalStorage) {
        Object.defineProperty(globalThis, "sessionStorage", {
          value: originalStorage,
          configurable: true,
        });
      }
    }
    // Nothing was read from or written to session storage, so no reload
    // allowance was recorded and no asset URL was persisted.
    expect(touched).toEqual([]);
  });
});

describe("the substitution is wired into the build", () => {
  it("vite.config.ts installs the ownership plugin before anything else", () => {
    const config = read("vite.config.ts");
    expect(config).toContain("foreverTanstackReloadOwnership()");
    const plugin = read("scripts/build/tanstack-reload-ownership.mjs");
    expect(plugin).toContain('enforce: "pre"');
    expect(plugin).toContain("forever-lazy-route-component.js");
  });

  it("the emitted replacement carries no documentation quoting the forbidden key", () => {
    // The repository file explains what it removed, which requires naming the
    // key. The EMITTED module must not, or the built-output scan could not
    // tell a comment about the removal from the removal not having happened.
    const emitted = stripDocumentation(read("scripts/build/forever-lazy-route-component.js"));
    expect(emitted).not.toContain(FORBIDDEN_TANSTACK_RELOAD_KEY);
    expect(emitted).toContain("lazyComp.preload = load;");
  });

  it("no dependency patch, postinstall step or patch-package is involved", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts.postinstall).toBeUndefined();
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })).not.toContain(
      "patch-package",
    );
    expect(existsSync(resolve(process.cwd(), "patches"))).toBe(false);
  });

  it("the Forever capture layer does not race the framework — it replaced it", () => {
    const capture = stripDocumentation(read("src/lib/stale-asset/global-capture.ts"));
    // No pre-seeding of the framework's key, no racing listeners, no blanket
    // preventDefault. Ownership is structural, not a timing trick.
    expect(capture).not.toContain(FORBIDDEN_TANSTACK_RELOAD_KEY);
    expect(capture).not.toContain("sessionStorage");
    expect(capture).toContain("if (owned && event.cancelable) event.preventDefault();");
  });
});

// ---------------------------------------------------------------------------
// Built-output scan — FAIL-CLOSED, never skipped (independent-review P2-2)
// ---------------------------------------------------------------------------

describe("the forbidden runtime key is absent from the built client bundle", () => {
  const assetsDir = resolve(process.cwd(), ".output/public/assets");

  it("a build exists to scan — a missing build is a FAILURE, never a skip", () => {
    expect(
      existsSync(assetsDir),
      "no .output/public/assets — run `npm run build` before this suite; a missing build " +
        "artifact must fail, not silently skip (independent-review P2-2)",
    ).toBe(true);
  });

  it("no emitted client asset contains tanstack_router_reload", () => {
    const files = readdirSync(assetsDir).filter((name) => /\.(js|css)$/.test(name));
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((name) =>
      readFileSync(resolve(assetsDir, name), "utf8").includes(FORBIDDEN_TANSTACK_RELOAD_KEY),
    );
    expect(offenders, `forbidden key found in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("no emitted client asset calls location.reload", () => {
    const files = readdirSync(assetsDir).filter((name) => name.endsWith(".js"));
    const offenders = files.filter((name) =>
      /location\s*\.\s*reload\s*\(/.test(readFileSync(resolve(assetsDir, name), "utf8")),
    );
    expect(offenders, `location.reload() found in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("no emitted SERVER file contains tanstack_router_reload either", () => {
    const serverDir = resolve(process.cwd(), ".output/server");
    expect(existsSync(serverDir)).toBe(true);
    const offenders: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory)) {
        const full = join(directory, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(mjs|js|cjs|json)$/.test(entry)) continue;
        if (readFileSync(full, "utf8").includes(FORBIDDEN_TANSTACK_RELOAD_KEY)) {
          offenders.push(entry);
        }
      }
    };
    walk(serverDir);
    expect(offenders, `forbidden key found in: ${offenders.join(", ")}`).toEqual([]);
  });
});
