/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — the repository-controlled lazy
 * route-component loader (independent-review P1-5).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 *
 * `@tanstack/react-router` 1.170.16 ships its own identity-blind reload inside
 * `lazyRouteComponent`. On a module-not-found it writes
 *
 *     sessionStorage["tanstack_router_reload:<raw error message>"] = "1"
 *
 * and calls `window.location.reload()` on the next render. That mechanism has
 * NO build-identity check, NO write-safety check, NO route deny list and NO
 * success clearing, and its storage key contains the complete failing asset
 * URL. The independent review measured six real error shapes for which
 * `isModuleNotFoundError` is true while the Forever classifier correctly
 * returns `not_stale_asset` — on every one of those, the framework reloads
 * anyway, including while a Studio mutation is in flight and including on
 * `/studio/reset-password`.
 *
 * The reviewed PR chose to COEXIST with that mechanism. Two independent
 * recovery systems is not a design; it is a race. There must be exactly one
 * recovery authority, and it must be the one that checks build identity and
 * write safety.
 *
 * ---------------------------------------------------------------------------
 * WHY REPLACEMENT AND NOT CONFIGURATION
 * ---------------------------------------------------------------------------
 *
 * The pinned version offers no option to disable it: there is no
 * `disableReload`, no `reloadOnModuleNotFound`, no `shouldReload`, and the
 * behaviour is unconditional inside the loader. That was verified against the
 * installed pin, and `tanstack-reload-ownership.test.ts` re-verifies it on
 * every run — so the day upstream adds a supported switch, or changes this
 * code, the suite says so.
 *
 * So the SECOND option in the preference order applies: replace the affected
 * lazy-component loader with a repository-controlled loader that never
 * executes the built-in reload. No dependency patch, no postinstall step, no
 * `patch-package`, nothing to go stale silently — the substitution happens in
 * the Vite build and is asserted by a fingerprint check that fails the build
 * if the upstream module is not the one this file was written against.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PRESERVES, EXACTLY
 * ---------------------------------------------------------------------------
 *
 * Everything except the reload. `preload()` still works, the load promise is
 * still memoised, the error is still recorded during preload and thrown on the
 * render path, `React.use` is still used when available, and the component is
 * still created the same way. A failing chunk therefore surfaces through the
 * ordinary error path, where the Forever capture layer and the root boundary
 * are authoritative — which is the entire point.
 *
 * WHAT IT REMOVES, EXACTLY. The `sessionStorage` write, the reload flag, and
 * the `window.location.reload()` call. Nothing else.
 */

import * as React from "react";

/** `React.use` if available (React 19+), undefined otherwise. */
const reactUse = React["use"];

export function lazyRouteComponent(importer, exportName) {
  let loadPromise;
  let comp;
  let error;

  const load = () => {
    if (!loadPromise) {
      loadPromise = importer()
        .then((res) => {
          loadPromise = undefined;
          comp = res[exportName ?? "default"];
        })
        .catch((err) => {
          // Record the error; the render path throws it. Deliberately NO
          // module-not-found special case, NO storage key, and NO
          // reload: a missing chunk is a stale-asset signal, and the Forever
          // recovery authority is the only thing permitted to act on one.
          error = err;
        });
    }
    return loadPromise;
  };

  const lazyComp = function Lazy(props) {
    if (error) throw error;
    if (!comp) {
      if (reactUse) reactUse(load());
      else throw load();
    }
    return React.createElement(comp, props);
  };

  lazyComp.preload = load;

  return lazyComp;
}
