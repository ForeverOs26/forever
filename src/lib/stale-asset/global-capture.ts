/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — early global capture.
 *
 * WHERE THE FAILURE ACTUALLY SURFACES, measured against the real production
 * bundle rather than assumed:
 *
 *   - `vite:preloadError` — dispatched on `window` by the build's own preload
 *     helper for EVERY failed route chunk import and every failed module
 *     preload. It is `cancelable`, and it fires BEFORE the rejection reaches
 *     the router. This is the authoritative point.
 *   - `error` in the capture phase — a `<script type="module">` or
 *     `<link rel="modulepreload">` element that failed to load. Resource errors
 *     do not bubble, so capture is required.
 *   - `unhandledrejection` — the backstop for a dynamic import rejection that
 *     no one else handled.
 *
 * EXACTLY ONE RECOVERY AUTHORITY (independent-review P1-5).
 *
 * An earlier revision of this layer COEXISTED with the router's own built-in
 * one-shot reload for lazy route components — an unconditional mechanism with
 * no build-identity check, no write-action safety, no route deny list and no
 * success clearing, whose storage key contained the complete failing asset URL.
 * Coexistence meant that wherever the classifier declined, the framework
 * reloaded anyway: identity-blind, write-unsafe, and including on
 * `/studio/reset-password`. Six real error shapes were measured doing exactly
 * that.
 *
 * That mechanism no longer ships. `scripts/build/tanstack-reload-ownership.mjs`
 * substitutes a repository-controlled loader at build time, verified by a
 * fingerprint that fails the build if upstream changes, and a built-output scan
 * asserts the forbidden key is absent from every emitted file. This layer is
 * therefore the ONLY thing in the application that can reload a page.
 *
 * WHY CANCELLING IS STILL CORRECT HERE, AND ONLY HERE. For a CONFIRMED stale
 * asset — and only then — this layer calls `preventDefault()` and takes
 * ownership: it either performs one identity-checked, write-safe, bounded
 * reload, or it shows the recovery screen. For every other error nothing is
 * cancelled, nothing is swallowed, and the existing root error boundary remains
 * authoritative. There is no blanket `preventDefault`, no pre-seeded storage
 * key, and no listener racing another listener.
 *
 * IDEMPOTENCE. Exactly one listener per event type, ever. Re-invocation — a
 * remount, a hot update, a second import of this module — is a no-op, and
 * `uninstallStaleAssetCapture` removes precisely what was added.
 */

import type { StaleAssetSignal } from "./stale-asset-contract";
import { classifyStaleAssetError, verdictIsStale } from "./stale-asset-contract";
import { handleStaleAssetSignal } from "./stale-asset-recovery";

type PreloadErrorEvent = Event & { payload?: unknown };

let installed = false;
let onPreloadError: ((event: Event) => void) | null = null;
let onWindowError: ((event: Event) => void) | null = null;
let onRejection: ((event: Event) => void) | null = null;

function currentEnvironment() {
  return {
    origin: window.location.origin,
    pathname: window.location.pathname,
    search: window.location.search,
    reload: (target: string) => {
      // `replace`, not `assign`: the failed attempt must not become a history
      // entry the visitor can walk back into. Path and query are preserved; the
      // fragment is deliberately dropped (see `safeRecoveryTarget`).
      window.location.replace(target);
    },
  };
}

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  return "";
}

/**
 * Handles one candidate. Returns true when the signal was CONFIRMED stale and
 * this layer has taken ownership of it.
 *
 * The classification runs synchronously so the decision to cancel is made
 * before the event finishes dispatching; the recovery itself is asynchronous
 * because it must ask the origin which build it is serving.
 */
function takeOwnership(signal: StaleAssetSignal): boolean {
  const environment = currentEnvironment();
  const verdict = classifyStaleAssetError(signal, { origin: environment.origin });
  if (!verdictIsStale(verdict)) return false;
  void handleStaleAssetSignal(signal, environment);
  return true;
}

export function installStaleAssetCapture(): void {
  if (installed) return;
  if (typeof window === "undefined") return;
  installed = true;

  onPreloadError = (event: Event) => {
    const payload = (event as PreloadErrorEvent).payload;
    const owned = takeOwnership({ kind: "dynamic_import", message: messageOf(payload) });
    // Cancelled ONLY for a confirmed stale asset, because this layer is now
    // responsible for the outcome. An ordinary preload failure is left to
    // throw exactly as it does today.
    if (owned && event.cancelable) event.preventDefault();
  };

  onWindowError = (event: Event) => {
    const target = event.target as (Element & { src?: string; href?: string }) | null;
    if (!target || target === (window as unknown as Element)) return;
    const tag = typeof target.tagName === "string" ? target.tagName.toUpperCase() : "";
    if (tag !== "SCRIPT" && tag !== "LINK") return;
    const url = typeof target.src === "string" && target.src ? target.src : target.href;
    if (typeof url !== "string" || url.length === 0) return;
    // Never cancelled: a resource error carries no behaviour to suppress, and
    // suppressing it could hide an unrelated failure from the existing paths.
    takeOwnership({ kind: "module_script", assetUrl: url });
  };

  onRejection = (event: Event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    takeOwnership({ kind: "dynamic_import", message: messageOf(reason) });
    // Deliberately NOT prevented. Swallowing rejections here would hide
    // unrelated application failures from the console and from the existing
    // error boundary, which stays authoritative for everything non-stale.
  };

  window.addEventListener("vite:preloadError", onPreloadError);
  // Capture phase: resource load errors do not bubble.
  window.addEventListener("error", onWindowError, true);
  window.addEventListener("unhandledrejection", onRejection);
}

export function uninstallStaleAssetCapture(): void {
  if (!installed) return;
  installed = false;
  if (typeof window === "undefined") return;
  if (onPreloadError) window.removeEventListener("vite:preloadError", onPreloadError);
  if (onWindowError) window.removeEventListener("error", onWindowError, true);
  if (onRejection) window.removeEventListener("unhandledrejection", onRejection);
  onPreloadError = null;
  onWindowError = null;
  onRejection = null;
}

/** Test-only: whether the single listener set is currently registered. */
export function staleAssetCaptureInstalled(): boolean {
  return installed;
}

// NO module-scope self-install here, and that is deliberate. This package
// declares `"sideEffects": false`, so a bare `import "./global-capture"` is
// dropped by the bundler as a pure side-effect import — measured against the
// real production build, where exactly that happened and the listeners never
// shipped. The install is therefore an explicit CALL from `getRouter()` in
// src/router.tsx, which the client entry always executes before the first route
// is resolved, and which the bundler cannot prove pure.
