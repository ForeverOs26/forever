/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — one recovery authority
 * (independent-review P1-5).
 *
 * A Vite plugin that substitutes the repository-controlled lazy route-component
 * loader for the upstream one, so `@tanstack/react-router`'s own identity-blind
 * reload never ships.
 *
 * FAIL-CLOSED BY FINGERPRINT. Before substituting anything the plugin reads the
 * upstream module and requires it to be exactly the shape this replacement was
 * written against — the pinned version, and the three markers of the built-in
 * reload. If the pin moves, or upstream rewrites the loader, or upstream
 * removes the reload, the fingerprint stops matching and the BUILD FAILS with
 * the reason and the removal trigger. It never silently keeps substituting a
 * stale replacement, and it never silently stops substituting.
 *
 * REMOVAL TRIGGER, stated once and asserted by the test suite: when
 * `@tanstack/react-router` ships a supported way to disable the built-in reload
 * (or removes it), delete this plugin, delete
 * `scripts/build/forever-lazy-route-component.js`, adopt the supported
 * configuration, and keep the bundle scan.
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** The exact dependency this replacement was written against. */
export const TANSTACK_ROUTER_PINNED_VERSION = "1.170.16";

/** The upstream module that carries the built-in reload. */
export const UPSTREAM_LAZY_MODULE = "@tanstack/react-router/dist/esm/lazyRouteComponent.js";

/** The forbidden runtime key. Must never appear in any emitted bundle. */
export const FORBIDDEN_TANSTACK_RELOAD_KEY = "tanstack_router_reload:";

/**
 * The markers that prove the upstream module is the one this replacement
 * removes. All must be present; any absence is a contract change.
 */
export const UPSTREAM_RELOAD_FINGERPRINT = [
  "tanstack_router_reload:",
  "window.location.reload()",
  "isModuleNotFoundError",
  "sessionStorage.setItem(storageKey",
];

/** Options upstream does NOT offer at the pinned version. Re-checked on every run. */
export const UPSTREAM_DISABLE_OPTIONS = [
  "disableReload",
  "reloadOnModuleNotFound",
  "shouldReload",
  "noReload",
];

export function resolveUpstreamLazyModulePath() {
  return require
    .resolve("@tanstack/react-router/package.json")
    .replace(/package\.json$/, "dist/esm/lazyRouteComponent.js")
    .split("\\")
    .join("/");
}

export function installedTanstackRouterVersion() {
  return require("@tanstack/react-router/package.json").version;
}

/**
 * Verifies the upstream module still matches the fingerprint.
 *
 * Returns a plain result rather than throwing so both the plugin and the test
 * suite can report the same thing in their own way.
 */
export function checkTanstackReloadFingerprint() {
  const version = installedTanstackRouterVersion();
  const path = resolveUpstreamLazyModulePath();
  let source = "";
  let readable = true;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    readable = false;
  }
  const missingMarkers = UPSTREAM_RELOAD_FINGERPRINT.filter((m) => !source.includes(m));
  const newOptions = UPSTREAM_DISABLE_OPTIONS.filter((o) => source.includes(o));
  return {
    version,
    path,
    readable,
    pinnedVersionMatches: version === TANSTACK_ROUTER_PINNED_VERSION,
    missingMarkers,
    newOptions,
    ok:
      readable &&
      version === TANSTACK_ROUTER_PINNED_VERSION &&
      missingMarkers.length === 0 &&
      newOptions.length === 0,
  };
}

function failureMessage(check) {
  if (!check.readable) {
    return `could not read ${check.path}. The Forever lazy-loader replacement cannot verify what it is replacing.`;
  }
  if (!check.pinnedVersionMatches) {
    return (
      `@tanstack/react-router is ${check.version}, but the Forever lazy-loader replacement was ` +
      `written against ${TANSTACK_ROUTER_PINNED_VERSION}. Re-read ` +
      `${UPSTREAM_LAZY_MODULE} in the new version, confirm whether the built-in reload still ` +
      `exists, and either update the replacement or — if upstream now offers a supported way to ` +
      `disable it — remove the replacement and adopt that instead.`
    );
  }
  if (check.newOptions.length > 0) {
    return (
      `${UPSTREAM_LAZY_MODULE} now mentions ${check.newOptions.join(", ")}. Upstream may offer a ` +
      `supported way to disable the built-in reload, which is preferable to replacing the module. ` +
      `Adopt it and delete this plugin.`
    );
  }
  return (
    `${UPSTREAM_LAZY_MODULE} no longer contains ${check.missingMarkers.join(", ")}. The built-in ` +
    `reload this replacement removes is not there in the form it was written against, so the ` +
    `replacement may be removing the wrong thing or nothing at all. Re-verify before shipping.`
  );
}

/**
 * Removes `/** … *\/` documentation before the replacement is emitted.
 *
 * The replacement's own header QUOTES the forbidden key, because explaining
 * what was removed requires naming it. The unminified server bundle keeps
 * comments, so without this the built-output scan would find the literal in a
 * comment describing its own removal and could not tell that from the real
 * thing. Stripping documentation makes the scan exact: any occurrence in the
 * emitted output is executable code.
 */
export function stripDocumentation(source) {
  return source.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/^\s*\n/gm, "");
}

/**
 * The plugin.
 *
 * `enforce: "pre"` so the substitution happens before anything else transforms
 * the module, and the check runs once at config time so a mismatch fails the
 * build immediately rather than after a long bundle.
 */
export function foreverTanstackReloadOwnership() {
  const replacement = resolve(HERE, "forever-lazy-route-component.js");
  let upstreamPath = "";
  return {
    name: "forever-tanstack-reload-ownership",
    enforce: "pre",
    configResolved() {
      const check = checkTanstackReloadFingerprint();
      if (!check.ok) {
        throw new Error(
          `[forever-tanstack-reload-ownership] REFUSING TO BUILD: ${failureMessage(check)}`,
        );
      }
      upstreamPath = check.path;
    },
    load(id) {
      const normalized = id.split("\\").join("/").split("?")[0];
      if (normalized !== upstreamPath) return null;
      return stripDocumentation(readFileSync(replacement, "utf8"));
    },
  };
}
