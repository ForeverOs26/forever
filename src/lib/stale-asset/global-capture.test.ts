/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — global capture.
 *
 * Exactly one listener per event type, no duplicates after a remount, clean
 * teardown, no blanket `preventDefault`, and nothing swallowed that the
 * existing error path still needs to see.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installStaleAssetCapture,
  staleAssetCaptureInstalled,
  uninstallStaleAssetCapture,
} from "./global-capture";
import { resetStaleAssetRecoveryStateForTest } from "./stale-asset-recovery";
import { resetConsequentialActionsForTest } from "./write-safety";

const HASHED = `${window.location.origin}/assets/StudioDashboard-DDTDlhmi.js`;

function countListeners() {
  const added: Record<string, number> = {};
  const removed: Record<string, number> = {};
  const originalAdd = window.addEventListener;
  const originalRemove = window.removeEventListener;
  window.addEventListener = function (this: Window, type: string, ...rest: unknown[]) {
    added[type] = (added[type] ?? 0) + 1;
    return originalAdd.apply(this, [type, ...rest] as never);
  } as typeof window.addEventListener;
  window.removeEventListener = function (this: Window, type: string, ...rest: unknown[]) {
    removed[type] = (removed[type] ?? 0) + 1;
    return originalRemove.apply(this, [type, ...rest] as never);
  } as typeof window.removeEventListener;
  return {
    added,
    removed,
    restore: () => {
      window.addEventListener = originalAdd;
      window.removeEventListener = originalRemove;
    },
  };
}

beforeEach(() => {
  uninstallStaleAssetCapture();
  resetStaleAssetRecoveryStateForTest();
  resetConsequentialActionsForTest();
  sessionStorage.clear();
});

afterEach(() => {
  uninstallStaleAssetCapture();
});

describe("listener registration", () => {
  it("registers exactly one listener per event type", () => {
    const spy = countListeners();
    installStaleAssetCapture();
    spy.restore();
    expect(spy.added["vite:preloadError"]).toBe(1);
    expect(spy.added.error).toBe(1);
    expect(spy.added.unhandledrejection).toBe(1);
  });

  it("does not duplicate listeners when installed again (remount, hot update, re-import)", () => {
    installStaleAssetCapture();
    const spy = countListeners();
    installStaleAssetCapture();
    installStaleAssetCapture();
    installStaleAssetCapture();
    spy.restore();
    expect(spy.added["vite:preloadError"]).toBeUndefined();
    expect(spy.added.error).toBeUndefined();
    expect(spy.added.unhandledrejection).toBeUndefined();
    expect(staleAssetCaptureInstalled()).toBe(true);
  });

  it("removes exactly what it added on teardown, and can be reinstalled", () => {
    installStaleAssetCapture();
    const spy = countListeners();
    uninstallStaleAssetCapture();
    spy.restore();
    expect(spy.removed["vite:preloadError"]).toBe(1);
    expect(spy.removed.error).toBe(1);
    expect(spy.removed.unhandledrejection).toBe(1);
    expect(staleAssetCaptureInstalled()).toBe(false);

    const second = countListeners();
    installStaleAssetCapture();
    second.restore();
    expect(second.added["vite:preloadError"]).toBe(1);
  });
});

describe("cancellation is precise, never blanket", () => {
  it("cancels a CONFIRMED stale preload error so one bounded mechanism owns it", () => {
    installStaleAssetCapture();
    const event = new Event("vite:preloadError", { cancelable: true }) as Event & {
      payload?: unknown;
    };
    event.payload = new Error(`Failed to fetch dynamically imported module: ${HASHED}`);
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("does NOT cancel an ordinary preload error", () => {
    installStaleAssetCapture();
    const event = new Event("vite:preloadError", { cancelable: true }) as Event & {
      payload?: unknown;
    };
    event.payload = new Error(
      "Failed to fetch dynamically imported module: https://cdn.invalid/x-DDTDlhmi.js",
    );
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("never cancels an unhandled rejection, even a stale one", () => {
    installStaleAssetCapture();
    const event = new Event("unhandledrejection", { cancelable: true }) as Event & {
      reason?: unknown;
    };
    event.reason = new Error(`Failed to fetch dynamically imported module: ${HASHED}`);
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("never cancels a resource error", () => {
    installStaleAssetCapture();
    const script = document.createElement("script");
    script.src = HASHED;
    document.body.appendChild(script);
    const event = new Event("error", { cancelable: true, bubbles: false });
    script.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    script.remove();
  });
});

describe("unrelated errors are not swallowed", () => {
  it("leaves a plain window error untouched", () => {
    installStaleAssetCapture();
    const handler = vi.fn();
    window.addEventListener("error", handler);
    const event = new Event("error", { cancelable: true });
    window.dispatchEvent(event);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
    window.removeEventListener("error", handler);
  });

  it("ignores resource errors from elements that are not script or link", () => {
    installStaleAssetCapture();
    const image = document.createElement("img");
    image.src = HASHED;
    document.body.appendChild(image);
    const event = new Event("error", { cancelable: true });
    image.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    image.remove();
  });
});
