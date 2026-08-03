/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — the bounded recovery machine.
 *
 * These tests pin the properties that make an automatic reload defensible:
 * exactly one attempt per proven version transition, never during an unproven
 * write, never on a guess, never a loop, never a replay, and the marker cleared
 * only once the intended route graph has actually loaded.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearRecoveryMarker,
  handleStaleAssetSignal,
  noteStaleAssetRouteGraphLoaded,
  readRecoveryMarker,
  requireManualStaleAssetRecovery,
  resetStaleAssetRecoveryStateForTest,
  getStaleAssetRecoveryState,
  type StaleAssetRecoveryEnvironment,
} from "./stale-asset-recovery";
import {
  parseStaleAssetRecoveryMarker,
  safeRecoveryTarget,
  serializeStaleAssetRecoveryMarker,
  STALE_ASSET_RECOVERY_MARKER_KEY,
  STALE_ASSET_RECOVERY_MARKER_SCHEMA,
  STALE_ASSET_RECOVERY_MARKER_TTL_MS,
  STALE_ASSET_RECOVERY_OUTCOMES,
  type StaleAssetRecoveryMarker,
} from "./stale-asset-recovery-contract";
import { resetConsequentialActionsForTest, beginConsequentialAction } from "./write-safety";

const ORIGIN = "https://forever.example.workers.dev";
const HASHED = `${ORIGIN}/assets/StudioDashboard-DDTDlhmi.js`;
const NOW = 1_800_000_000_000;

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

function environment(
  overrides: Partial<StaleAssetRecoveryEnvironment> = {},
): StaleAssetRecoveryEnvironment & { reload: ReturnType<typeof vi.fn> } {
  const reload = vi.fn();
  return {
    origin: ORIGIN,
    pathname: "/studio",
    search: "",
    reload,
    now: () => NOW,
    storage: memoryStorage(),
    ownBuildId: "aaaaaaaaaaaa",
    readActiveBuildId: async () => "bbbbbbbbbbbb",
    hasUnprovenWrite: () => false,
    ...overrides,
    // The spy must survive an override that did not supply one.
    ...(overrides.reload ? {} : { reload }),
  } as StaleAssetRecoveryEnvironment & { reload: ReturnType<typeof vi.fn> };
}

const staleSignal = {
  kind: "dynamic_import" as const,
  message: `Failed to fetch dynamically imported module: ${HASHED}`,
};

beforeEach(() => {
  resetStaleAssetRecoveryStateForTest();
  resetConsequentialActionsForTest();
});

describe("one automatic attempt, and only when it is provable", () => {
  it("reloads once for a confirmed stale asset on a different active build", async () => {
    const env = environment();
    const decision = await handleStaleAssetSignal(staleSignal, env);
    expect(decision).toEqual({ verdict: "stale_dynamic_import", outcome: "reload_issued" });
    expect(env.reload).toHaveBeenCalledTimes(1);
    expect(env.reload).toHaveBeenCalledWith("/studio");
  });

  it("writes a marker recording exactly the transition, before the reload", async () => {
    const storage = memoryStorage();
    const env = environment({ storage });
    await handleStaleAssetSignal(staleSignal, env);
    const marker = readRecoveryMarker(NOW, storage);
    expect(marker).toEqual({
      v: STALE_ASSET_RECOVERY_MARKER_SCHEMA,
      from: "aaaaaaaaaaaa",
      to: "bbbbbbbbbbbb",
      attempt: 1,
      at: NOW,
    });
  });

  it("REFUSES a second reload for the same transition and shows the recovery screen", async () => {
    const storage = memoryStorage();
    const first = environment({ storage });
    await handleStaleAssetSignal(staleSignal, first);
    expect(first.reload).toHaveBeenCalledTimes(1);

    // The reload replaces the page, so the next failure happens in a NEW page
    // life with fresh module state. Only the sessionStorage marker survives —
    // which is exactly the thing that must bound the second attempt.
    resetStaleAssetRecoveryStateForTest();

    // Same tab, same transition, second classified failure.
    const second = environment({ storage });
    const decision = await handleStaleAssetSignal(staleSignal, second);
    expect(decision.outcome).toBe("attempt_already_used");
    expect(second.reload).not.toHaveBeenCalled();
    expect(getStaleAssetRecoveryState()).toBe("recovery_required");
  });

  it("never loops: N further failures produce N refusals and zero reloads", async () => {
    const storage = memoryStorage();
    await handleStaleAssetSignal(staleSignal, environment({ storage }));
    const reloads: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      resetStaleAssetRecoveryStateForTest();
      const env = environment({ storage });
      const decision = await handleStaleAssetSignal(staleSignal, env);
      expect(decision.outcome).toBe("attempt_already_used");
      reloads.push(env.reload.mock.calls.length);
    }
    expect(reloads).toEqual([0, 0, 0, 0, 0]);
  });

  it("grants a fresh attempt for a genuinely different later transition", async () => {
    const storage = memoryStorage();
    await handleStaleAssetSignal(staleSignal, environment({ storage }));
    // The reload replaces the page, so the next failure happens in a NEW page
    // life with fresh module state. Only the sessionStorage marker survives —
    // which is exactly the thing that must bound the second attempt.
    resetStaleAssetRecoveryStateForTest();
    const later = environment({
      storage,
      ownBuildId: "aaaaaaaaaaaa",
      readActiveBuildId: async () => "cccccccccccc",
    });
    const decision = await handleStaleAssetSignal(staleSignal, later);
    expect(decision.outcome).toBe("reload_issued");
    expect(later.reload).toHaveBeenCalledTimes(1);
  });

  it("refuses when the origin reports the SAME build — a reload would prove nothing", async () => {
    const env = environment({ readActiveBuildId: async () => "aaaaaaaaaaaa" });
    const decision = await handleStaleAssetSignal(staleSignal, env);
    expect(decision.outcome).toBe("same_build");
    expect(env.reload).not.toHaveBeenCalled();
  });

  it("refuses when the active build cannot be read", async () => {
    const env = environment({ readActiveBuildId: async () => null });
    const decision = await handleStaleAssetSignal(staleSignal, env);
    expect(decision.outcome).toBe("active_build_unknown");
    expect(env.reload).not.toHaveBeenCalled();
  });

  it("refuses when there is no storage to bound the attempt with", async () => {
    const env = environment({ storage: null });
    const decision = await handleStaleAssetSignal(staleSignal, env);
    expect(decision.outcome).toBe("storage_unavailable");
    expect(env.reload).not.toHaveBeenCalled();
  });

  it("refuses when the marker cannot be written", async () => {
    const env = environment({
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("quota");
        },
        removeItem: () => undefined,
      },
    });
    const decision = await handleStaleAssetSignal(staleSignal, env);
    expect(decision.outcome).toBe("storage_unavailable");
    expect(env.reload).not.toHaveBeenCalled();
  });
});

describe("non-stale errors never reload", () => {
  it.each([
    ["ordinary render throw", "Cannot read properties of undefined (reading 'map')"],
    ["Supabase failure", "Supabase request failed: JWT expired"],
    ["Studio RPC failure", "studio_publish_project failed"],
    ["permission failure", "permission denied for table projects"],
    [
      "external script failure",
      "Failed to fetch dynamically imported module: https://cdn.invalid/a-DDTDlhmi.js",
    ],
  ])("%s", async (_label, message) => {
    const env = environment();
    const decision = await handleStaleAssetSignal({ kind: "render_error", message }, env);
    expect(decision).toEqual({ verdict: "not_stale_asset", outcome: "not_stale" });
    expect(env.reload).not.toHaveBeenCalled();
    expect(getStaleAssetRecoveryState()).toBe("idle");
  });
});

describe("write-action safety — no automatic resubmission, ever", () => {
  it("refuses to reload while any consequential action is unproven", async () => {
    const release = beginConsequentialAction("owner_retry_submit");
    const env = environment({ hasUnprovenWrite: undefined });
    const decision = await handleStaleAssetSignal(staleSignal, env);
    expect(decision.outcome).toBe("write_in_flight");
    expect(env.reload).not.toHaveBeenCalled();
    expect(getStaleAssetRecoveryState()).toBe("recovery_required");
    release();
  });

  it("allows the bounded reload again once the action has settled", async () => {
    const release = beginConsequentialAction("publication");
    const storage = memoryStorage();
    const blocked = environment({ storage, hasUnprovenWrite: undefined });
    expect((await handleStaleAssetSignal(staleSignal, blocked)).outcome).toBe("write_in_flight");
    release();
    const allowed = environment({ storage, hasUnprovenWrite: undefined });
    expect((await handleStaleAssetSignal(staleSignal, allowed)).outcome).toBe("reload_issued");
  });

  it("issues no request other than the build probe — nothing is resubmitted", async () => {
    const calls: string[] = [];
    const env = environment({
      readActiveBuildId: async () => {
        calls.push("build-probe");
        return "bbbbbbbbbbbb";
      },
    });
    await handleStaleAssetSignal(staleSignal, env);
    expect(calls).toEqual(["build-probe"]);
  });

  it("never reloads on the password-recovery route, whatever the evidence", async () => {
    const env = environment({ pathname: "/studio/reset-password" });
    const decision = await handleStaleAssetSignal(staleSignal, env);
    expect(decision.outcome).toBe("route_denied");
    expect(env.reload).not.toHaveBeenCalled();
  });
});

describe("route and query are preserved; the fragment is not replayed", () => {
  it("returns to the same path and safe query", async () => {
    const env = environment({ pathname: "/studio/project/example", search: "?tab=media" });
    await handleStaleAssetSignal(staleSignal, env);
    expect(env.reload).toHaveBeenCalledWith("/studio/project/example?tab=media");
  });

  it("drops the fragment, which is the only place auth material ever appears", () => {
    expect(safeRecoveryTarget("/studio/reset-password", "")).toBe("/studio/reset-password");
    expect(safeRecoveryTarget("/studio", "?a=1")).toBe("/studio?a=1");
    expect(safeRecoveryTarget("/studio", "")).toBe("/studio");
  });
});

describe("Auth storage is never touched", () => {
  it("never touches the browser's real localStorage, where the Auth session lives", async () => {
    localStorage.clear();
    localStorage.setItem("sb-exampleref-auth-token", '{"access_token":"placeholder"}');
    localStorage.setItem("forever.studio.recovery.deny", "1");
    const before = Object.fromEntries(
      Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)]),
    );

    await handleStaleAssetSignal(staleSignal, environment({ storage: memoryStorage() }));

    expect(Object.keys(localStorage).sort()).toEqual(Object.keys(before).sort());
    for (const [key, value] of Object.entries(before)) {
      expect(localStorage.getItem(key), key).toBe(value);
    }
    localStorage.clear();
  });

  it("leaves every other storage entry exactly as it was", async () => {
    const storage = memoryStorage();
    storage.map.set("sb-exampleref-auth-token", '{"access_token":"x"}');
    storage.map.set("forever.studio.recovery.deny", "1");
    const before = new Map(storage.map);

    await handleStaleAssetSignal(staleSignal, environment({ storage }));

    for (const [key, value] of before) expect(storage.map.get(key)).toBe(value);
    // The only key this machine may add is its own.
    const added = [...storage.map.keys()].filter((key) => !before.has(key));
    expect(added).toEqual([STALE_ASSET_RECOVERY_MARKER_KEY]);
  });
});

describe("success clearing requires proof, not a mount", () => {
  it("the root component mounting alone never clears the marker", async () => {
    const storage = memoryStorage();
    await handleStaleAssetSignal(staleSignal, environment({ storage }));
    expect(readRecoveryMarker(NOW, storage)).not.toBeNull();
    // There is deliberately no API that clears on root mount. The only clearing
    // entry point requires a pathname and a proof.
    expect(
      noteStaleAssetRouteGraphLoaded({ pathname: "/studio", proof: "router_resolved" }, storage),
    ).toBe(false);
    expect(readRecoveryMarker(NOW, storage)).not.toBeNull();
  });

  it("a Studio route is proved ONLY by the Studio shell mounting", async () => {
    const storage = memoryStorage();
    await handleStaleAssetSignal(staleSignal, environment({ storage }));
    resetStaleAssetRecoveryStateForTest();
    expect(
      noteStaleAssetRouteGraphLoaded(
        { pathname: "/studio/upload", proof: "router_resolved" },
        storage,
      ),
    ).toBe(false);
    expect(readRecoveryMarker(NOW, storage)).not.toBeNull();

    expect(
      noteStaleAssetRouteGraphLoaded(
        { pathname: "/studio/upload", proof: "studio_shell_mounted" },
        storage,
      ),
    ).toBe(true);
    expect(readRecoveryMarker(NOW, storage)).toBeNull();
    expect(getStaleAssetRecoveryState()).toBe("idle");
  });

  it("an ordinary route is proved by the router resolving it", async () => {
    const storage = memoryStorage();
    await handleStaleAssetSignal(staleSignal, environment({ storage, pathname: "/about" }));
    expect(
      noteStaleAssetRouteGraphLoaded({ pathname: "/about", proof: "router_resolved" }, storage),
    ).toBe(true);
    expect(readRecoveryMarker(NOW, storage)).toBeNull();
  });
});

describe("marker validation is strict and refuses anything unexpected", () => {
  const valid: StaleAssetRecoveryMarker = {
    v: STALE_ASSET_RECOVERY_MARKER_SCHEMA,
    from: "aaaaaaaaaaaa",
    to: "bbbbbbbbbbbb",
    attempt: 1,
    at: NOW,
  };

  it("accepts the exact serialized shape", () => {
    expect(parseStaleAssetRecoveryMarker(serializeStaleAssetRecoveryMarker(valid), NOW)).toEqual(
      valid,
    );
  });

  it.each([
    ["a wrong schema version", { ...valid, v: 2 }],
    ["an unbounded build id", { ...valid, from: "not a bounded id!" }],
    ["an attempt count above the ceiling", { ...valid, attempt: 2 }],
    ["a zero attempt count", { ...valid, attempt: 0 }],
    ["an extra key that could smuggle data", { ...valid, email: "someone@example.com" }],
    ["a future timestamp", { ...valid, at: NOW + 10 * 60_000 }],
  ])("refuses %s", (_label, candidate) => {
    expect(parseStaleAssetRecoveryMarker(JSON.stringify(candidate), NOW)).toBeNull();
  });

  it("expires an abandoned marker so a long-open tab is not barred forever", () => {
    const raw = serializeStaleAssetRecoveryMarker(valid);
    expect(
      parseStaleAssetRecoveryMarker(raw, NOW + STALE_ASSET_RECOVERY_MARKER_TTL_MS - 1),
    ).not.toBeNull();
    expect(
      parseStaleAssetRecoveryMarker(raw, NOW + STALE_ASSET_RECOVERY_MARKER_TTL_MS + 1),
    ).toBeNull();
  });

  it("refuses non-JSON, oversized and non-object values", () => {
    expect(parseStaleAssetRecoveryMarker("1", NOW)).toBeNull();
    expect(parseStaleAssetRecoveryMarker("[]", NOW)).toBeNull();
    expect(parseStaleAssetRecoveryMarker("not json", NOW)).toBeNull();
    expect(parseStaleAssetRecoveryMarker("x".repeat(300), NOW)).toBeNull();
    expect(parseStaleAssetRecoveryMarker(null, NOW)).toBeNull();
  });

  it("deletes an invalid marker rather than re-parsing it forever", () => {
    const storage = memoryStorage();
    storage.map.set(STALE_ASSET_RECOVERY_MARKER_KEY, '{"v":99}');
    expect(readRecoveryMarker(NOW, storage)).toBeNull();
    expect(storage.map.has(STALE_ASSET_RECOVERY_MARKER_KEY)).toBe(false);
  });
});

describe("nothing sensitive is ever retained", () => {
  it("stores only the five permitted fields and no error material", async () => {
    const storage = memoryStorage();
    await handleStaleAssetSignal(
      {
        kind: "dynamic_import",
        message: `Failed to fetch dynamically imported module: ${HASHED}`,
      },
      environment({ storage, pathname: "/studio/project/private-slug", search: "?job=abc" }),
    );
    const raw = storage.map.get(STALE_ASSET_RECOVERY_MARKER_KEY) ?? "";
    expect(JSON.parse(raw)).toEqual({
      v: 1,
      from: "aaaaaaaaaaaa",
      to: "bbbbbbbbbbbb",
      attempt: 1,
      at: NOW,
    });
    for (const forbidden of [
      "http",
      "/assets/",
      "StudioDashboard",
      "Failed to fetch",
      "private-slug",
      "job",
      "@",
      ".js",
    ]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it("returns only closed enum members", async () => {
    const decision = await handleStaleAssetSignal(staleSignal, environment());
    expect(Object.keys(decision).sort()).toEqual(["outcome", "verdict"]);
    expect(STALE_ASSET_RECOVERY_OUTCOMES as readonly string[]).toContain(decision.outcome);
  });
});

describe("manual recovery state", () => {
  it("can be required without reloading anything", () => {
    requireManualStaleAssetRecovery();
    expect(getStaleAssetRecoveryState()).toBe("recovery_required");
  });

  it("clearRecoveryMarker tolerates an unavailable storage", () => {
    expect(() => clearRecoveryMarker(null)).not.toThrow();
  });
});

describe("one failure, one decision — concurrent channels do not multiply", () => {
  it("a second signal for the same failure neither probes nor reloads again", async () => {
    const storage = memoryStorage();
    let probes = 0;
    const readActiveBuildId = async () => {
      probes += 1;
      return "bbbbbbbbbbbb";
    };
    const first = environment({ storage, readActiveBuildId });
    const second = environment({ storage, readActiveBuildId });

    const [a, b] = await Promise.all([
      handleStaleAssetSignal(staleSignal, first),
      handleStaleAssetSignal({ kind: "module_script", assetUrl: HASHED }, second),
    ]);

    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(["already_handling", "reload_issued"]);
    expect(probes).toBe(1);
    expect(first.reload.mock.calls.length + second.reload.mock.calls.length).toBe(1);
  });

  it("a refusal releases the gate so a later transition can still decide", async () => {
    const storage = memoryStorage();
    const refused = environment({ storage, readActiveBuildId: async () => null });
    expect((await handleStaleAssetSignal(staleSignal, refused)).outcome).toBe(
      "active_build_unknown",
    );
    const later = environment({ storage });
    expect((await handleStaleAssetSignal(staleSignal, later)).outcome).toBe("reload_issued");
  });
});
