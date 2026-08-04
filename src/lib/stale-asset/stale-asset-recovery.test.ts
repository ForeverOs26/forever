/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — the bounded recovery machine.
 *
 * These tests pin the properties that make an automatic reload defensible:
 * a BOUNDED number of attempts per tab, at most one per proven version
 * transition, never during an unproven write, never on a guess, never a loop,
 * never a replay, and the pending recovery cleared only by an explicit
 * exact-route success attestation that the attempted-transition history
 * survives.
 *
 * The alternating-transition, rollback, ledger-full, expiry, malformed,
 * duplicated-tab, clock-shift and storage-unavailable cases exist because the
 * independent review measured the previous single-slot marker producing an
 * unbounded number of automatic reloads — 12 in its own harness, 40 from 40
 * signals in the reproduction run recorded for this correction.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  attestStaleAssetRecovery,
  currentRecoveryLedger,
  handleStaleAssetSignal,
  readRecoveryLedger,
  requireManualStaleAssetRecovery,
  resetRecoveryLedgerForTest,
  resetStaleAssetRecoveryStateForTest,
  getStaleAssetRecoveryState,
  STALE_ASSET_ATTESTATION_OUTCOMES,
  type StaleAssetRecoveryEnvironment,
} from "./stale-asset-recovery";
import {
  attestationClearsPending,
  outcomeIsDenial,
  parseStaleAssetRecoveryLedger,
  routeKindOf,
  safeRecoveryTarget,
  serializeStaleAssetRecoveryLedger,
  stateRendersRecoveryScreen,
  STALE_ASSET_RECOVERY_HISTORY_TTL_MS,
  STALE_ASSET_RECOVERY_LEDGER_KEY,
  STALE_ASSET_RECOVERY_LEDGER_SCHEMA,
  STALE_ASSET_RECOVERY_MAX_HISTORY,
  STALE_ASSET_RECOVERY_MAX_SERIALIZED_BYTES,
  STALE_ASSET_RECOVERY_MAX_TAB_ATTEMPTS,
  STALE_ASSET_RECOVERY_OUTCOMES,
  STALE_ASSET_RECOVERY_STABILIZATION_MS,
  STALE_ASSET_ROUTE_KINDS,
  STALE_ASSET_RECOVERY_PENDING_TTL_MS,
  type StaleAssetRecoveryLedger,
  type StaleAssetRecoveryOutcome,
  type StaleAssetSuccessAttestation,
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

type Store = ReturnType<typeof memoryStorage>;

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
    ownClientAssetId: "aaaaaaaaaaaa",
    readActiveClientAssetId: async () => "bbbbbbbbbbbb",
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

/** Drives one signal with a fresh in-memory decision gate. */
async function drive(env: StaleAssetRecoveryEnvironment) {
  resetStaleAssetRecoveryStateForTest();
  return handleStaleAssetSignal(staleSignal, env);
}

function ledgerOf(store: Store, now = NOW): StaleAssetRecoveryLedger {
  return currentRecoveryLedger(now, store);
}

beforeEach(() => {
  resetStaleAssetRecoveryStateForTest();
  resetConsequentialActionsForTest();
});

describe("one automatic attempt per transition, and only when it is provable", () => {
  it("reloads once for a confirmed stale asset on a different active build", async () => {
    const env = environment();
    const decision = await handleStaleAssetSignal(staleSignal, env);
    expect(decision.outcome).toBe("reload_issued");
    expect(env.reload).toHaveBeenCalledTimes(1);
    expect(env.reload).toHaveBeenCalledWith("/studio");
  });

  it("records the transition in BOTH the pending slot and the history, before the reload", async () => {
    const storage = memoryStorage();
    let ledgerAtReloadTime: StaleAssetRecoveryLedger | null = null;
    const env = environment({
      storage,
      reload: vi.fn(() => {
        ledgerAtReloadTime = ledgerOf(storage);
      }),
    });
    await handleStaleAssetSignal(staleSignal, env);
    expect(ledgerAtReloadTime).not.toBeNull();
    expect(ledgerAtReloadTime!.pending).toEqual({
      from: "aaaaaaaaaaaa",
      to: "bbbbbbbbbbbb",
      at: NOW,
      route: "studio_dashboard",
    });
    expect(ledgerAtReloadTime!.history).toEqual([
      { from: "aaaaaaaaaaaa", to: "bbbbbbbbbbbb", at: NOW },
    ]);
  });

  it("REFUSES a second reload for the same transition and shows the recovery screen", async () => {
    const storage = memoryStorage();
    const first = environment({ storage });
    await drive(first);
    expect(first.reload).toHaveBeenCalledTimes(1);

    const second = environment({ storage });
    const decision = await drive(second);
    expect(decision.outcome).toBe("attempt_already_used");
    expect(second.reload).not.toHaveBeenCalled();
    expect(getStaleAssetRecoveryState()).toBe("recovery_required");
  });

  it("never loops: N further failures produce N refusals and zero reloads", async () => {
    const storage = memoryStorage();
    await drive(environment({ storage }));
    let reloads = 0;
    for (let i = 0; i < 25; i += 1) {
      const env = environment({ storage, reload: vi.fn(() => void (reloads += 1)) });
      const decision = await drive(env);
      expect(decision.outcome).toBe("attempt_already_used");
    }
    expect(reloads).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// P1-1 — the bound is on the TAB, not only on the transition
// ---------------------------------------------------------------------------

describe("P1-1 — alternating and progressing transitions are bounded", () => {
  /**
   * Drives one tab against an origin that flaps between two builds, exactly as
   * the independent review did. After each reload the tab lands on whichever
   * version the edge routed it to, so the next transition is the reverse pair.
   */
  async function alternate(rounds: number) {
    const storage = memoryStorage();
    let page = "aaaaaaaaaaaa";
    let active = "bbbbbbbbbbbb";
    let reloads = 0;
    const outcomes: StaleAssetRecoveryOutcome[] = [];
    for (let i = 0; i < rounds; i += 1) {
      const env = environment({
        storage,
        now: () => NOW + i * 1000,
        ownClientAssetId: page,
        readActiveClientAssetId: async () => active,
        reload: vi.fn(() => void (reloads += 1)),
      });
      const decision = await drive(env);
      outcomes.push(decision.outcome);
      if (decision.outcome === "reload_issued") {
        const previous = page;
        page = active;
        active = previous;
      }
    }
    return { reloads, outcomes };
  }

  it("A → B → A → B repeated 20 times issues at most two automatic reloads", async () => {
    const { reloads, outcomes } = await alternate(40);
    // One for A→B, one for B→A, and nothing else — ever.
    expect(reloads).toBe(2);
    expect(outcomes.filter((outcome) => outcome === "reload_issued")).toHaveLength(2);
    expect(new Set(outcomes.slice(2))).toEqual(new Set(["attempt_already_used"]));
  });

  it("the reload count is bounded by policy, not by how long the origin flaps", async () => {
    const short = await alternate(6);
    const long = await alternate(400);
    expect(short.reloads).toBe(2);
    expect(long.reloads).toBe(2);
  });

  it("release followed by rollback: the rollback does NOT re-arm the original pair", async () => {
    // This is the runbook's own rollback step (independent-review P2-5).
    const storage = memoryStorage();
    const release = environment({ storage, ownClientAssetId: "aaaaaaaaaaaa" });
    expect((await drive(release)).outcome).toBe("reload_issued");

    // The tab is now running B. The origin rolls back to A.
    const rollback = environment({
      storage,
      now: () => NOW + 1000,
      ownClientAssetId: "bbbbbbbbbbbb",
      readActiveClientAssetId: async () => "aaaaaaaaaaaa",
    });
    expect((await drive(rollback)).outcome).toBe("reload_issued");

    // And now the tab is back on A with the origin on B again — the pair that
    // already spent its attempt. The previous single-slot design re-armed here.
    const back = environment({ storage, now: () => NOW + 2000 });
    expect((await drive(back)).outcome).toBe("attempt_already_used");
    expect(back.reload).not.toHaveBeenCalled();
  });

  it("A → B → C: genuinely later builds each get an attempt, up to the tab ceiling", async () => {
    const storage = memoryStorage();
    const first = environment({ storage, ownClientAssetId: "aaaaaaaaaaaa" });
    expect((await drive(first)).outcome).toBe("reload_issued");

    const second = environment({
      storage,
      now: () => NOW + 1000,
      ownClientAssetId: "bbbbbbbbbbbb",
      readActiveClientAssetId: async () => "cccccccccccc",
    });
    expect((await drive(second)).outcome).toBe("reload_issued");

    const third = environment({
      storage,
      now: () => NOW + 2000,
      ownClientAssetId: "cccccccccccc",
      readActiveClientAssetId: async () => "dddddddddddd",
    });
    expect((await drive(third)).outcome).toBe("reload_issued");

    // The ceiling. A fourth genuinely different transition is refused, which is
    // what makes an endlessly progressing sequence of releases finite.
    const fourth = environment({
      storage,
      now: () => NOW + 3000,
      ownClientAssetId: "dddddddddddd",
      readActiveClientAssetId: async () => "eeeeeeeeeeee",
    });
    expect((await drive(fourth)).outcome).toBe("recovery_budget_spent");
    expect(fourth.reload).not.toHaveBeenCalled();
  });

  it("the tab ceiling is exactly the documented policy", async () => {
    const storage = memoryStorage();
    let reloads = 0;
    const builds = "abcdefghij".split("").map((letter) => letter.repeat(12));
    for (let i = 0; i + 1 < builds.length; i += 1) {
      const env = environment({
        storage,
        now: () => NOW + i * 1000,
        ownClientAssetId: builds[i],
        readActiveClientAssetId: async () => builds[i + 1],
        reload: vi.fn(() => void (reloads += 1)),
      });
      await drive(env);
    }
    expect(reloads).toBe(STALE_ASSET_RECOVERY_MAX_TAB_ATTEMPTS);
  });

  it("ledger full: a ledger already at the ceiling refuses without touching storage", async () => {
    const storage = memoryStorage();
    const full: StaleAssetRecoveryLedger = {
      v: STALE_ASSET_RECOVERY_LEDGER_SCHEMA,
      pending: null,
      history: [
        { from: "111111111111", to: "222222222222", at: NOW },
        { from: "222222222222", to: "333333333333", at: NOW },
        { from: "333333333333", to: "444444444444", at: NOW },
      ],
    };
    storage.map.set(STALE_ASSET_RECOVERY_LEDGER_KEY, serializeStaleAssetRecoveryLedger(full));
    const before = storage.map.get(STALE_ASSET_RECOVERY_LEDGER_KEY);
    const env = environment({ storage });
    expect((await drive(env)).outcome).toBe("recovery_budget_spent");
    expect(env.reload).not.toHaveBeenCalled();
    expect(storage.map.get(STALE_ASSET_RECOVERY_LEDGER_KEY)).toBe(before);
  });

  it("expired entries: a long-open tab is not barred for ever", async () => {
    const storage = memoryStorage();
    await drive(environment({ storage }));
    const later = NOW + STALE_ASSET_RECOVERY_HISTORY_TTL_MS + 1;
    const env = environment({ storage, now: () => later });
    expect((await drive(env)).outcome).toBe("reload_issued");
  });

  it("entries do not expire early", async () => {
    const storage = memoryStorage();
    await drive(environment({ storage }));
    const justInside = NOW + STALE_ASSET_RECOVERY_HISTORY_TTL_MS - 1;
    const env = environment({ storage, now: () => justInside });
    expect((await drive(env)).outcome).toBe("attempt_already_used");
  });

  it("malformed ledger: refuses this signal and never silently grants a budget", async () => {
    const storage = memoryStorage();
    storage.map.set(STALE_ASSET_RECOVERY_LEDGER_KEY, '{"v":2,"pending":null,"history":"nope"}');
    const env = environment({ storage });
    const decision = await drive(env);
    expect(decision.outcome).toBe("malformed_state");
    expect(env.reload).not.toHaveBeenCalled();
    expect(getStaleAssetRecoveryState()).toBe("recovery_required");
  });

  it("duplicated tab: the copy inherits the history and is MORE restricted, never less", async () => {
    const original = memoryStorage();
    await drive(environment({ storage: original }));
    // Chrome copies sessionStorage into a duplicated tab.
    const duplicate = memoryStorage();
    for (const [key, value] of original.map) duplicate.map.set(key, value);

    const env = environment({ storage: duplicate });
    expect((await drive(env)).outcome).toBe("attempt_already_used");
    expect(env.reload).not.toHaveBeenCalled();
  });

  it("clock shift backwards cannot erase history and re-arm a transition", async () => {
    const storage = memoryStorage();
    await drive(environment({ storage }));
    // The clock jumps a day backwards; every entry now reads as future-dated.
    const shifted = NOW - 24 * 60 * 60 * 1000;
    const env = environment({ storage, now: () => shifted });
    expect((await drive(env)).outcome).toBe("attempt_already_used");
    expect(env.reload).not.toHaveBeenCalled();
  });

  it("clock shift forwards past the TTL expires the window, which is the documented bound", async () => {
    const storage = memoryStorage();
    await drive(environment({ storage }));
    const shifted = NOW + STALE_ASSET_RECOVERY_HISTORY_TTL_MS + 60_000;
    const env = environment({ storage, now: () => shifted });
    expect((await drive(env)).outcome).toBe("reload_issued");
  });

  it("storage unavailable: no automatic reload, ever", async () => {
    const env = environment({ storage: null });
    expect((await drive(env)).outcome).toBe("storage_unavailable");
    expect(env.reload).not.toHaveBeenCalled();
  });

  it("storage that throws on write: no automatic reload", async () => {
    const env = environment({
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("quota");
        },
        removeItem: () => undefined,
      },
    });
    expect((await drive(env)).outcome).toBe("storage_unavailable");
    expect(env.reload).not.toHaveBeenCalled();
  });

  it("storage that throws on read: no automatic reload", async () => {
    const env = environment({
      storage: {
        getItem: () => {
          throw new Error("partitioned");
        },
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    });
    expect((await drive(env)).outcome).toBe("storage_unavailable");
    expect(env.reload).not.toHaveBeenCalled();
  });
});

describe("refusals that are not about the ledger", () => {
  it("refuses when the origin reports the SAME build — a reload would prove nothing", async () => {
    const env = environment({ readActiveClientAssetId: async () => "aaaaaaaaaaaa" });
    expect((await drive(env)).outcome).toBe("same_client_assets");
    expect(env.reload).not.toHaveBeenCalled();
  });

  it("refuses when the active build cannot be read", async () => {
    const env = environment({ readActiveClientAssetId: async () => null });
    expect((await drive(env)).outcome).toBe("active_client_assets_unknown");
    expect(env.reload).not.toHaveBeenCalled();
  });

  it("never reloads on the password-recovery route, whatever the evidence", async () => {
    const env = environment({ pathname: "/studio/reset-password" });
    expect((await drive(env)).outcome).toBe("route_denied");
    expect(env.reload).not.toHaveBeenCalled();
  });
});

describe("non-stale errors never reload", () => {
  it("an ordinary application error is not stale and nothing happens", async () => {
    const env = environment();
    const decision = await handleStaleAssetSignal(
      { kind: "render_error", message: "Cannot read properties of undefined (reading 'id')" },
      env,
    );
    expect(decision.outcome).toBe("not_stale");
    expect(env.reload).not.toHaveBeenCalled();
    expect(getStaleAssetRecoveryState()).toBe("idle");
  });

  it("a foreign-origin chunk is not ours", async () => {
    const env = environment();
    const decision = await handleStaleAssetSignal(
      {
        kind: "dynamic_import",
        message:
          "Failed to fetch dynamically imported module: https://cdn.example.net/assets/x-DDTDlhmi.js",
      },
      env,
    );
    expect(decision.outcome).toBe("not_stale");
    expect(env.reload).not.toHaveBeenCalled();
  });
});

describe("write-action safety — no automatic resubmission, ever", () => {
  it("refuses to reload while any consequential action is unproven", async () => {
    const release = beginConsequentialAction("owner_retry_submit");
    const env = environment({ hasUnprovenWrite: undefined });
    expect((await drive(env)).outcome).toBe("write_in_flight");
    expect(env.reload).not.toHaveBeenCalled();
    release();
  });

  it("allows the bounded reload again once the action has settled", async () => {
    const release = beginConsequentialAction("publication");
    release();
    const env = environment({ hasUnprovenWrite: undefined });
    expect((await drive(env)).outcome).toBe("reload_issued");
  });

  it("issues no request other than the build probe — nothing is resubmitted", async () => {
    const calls: string[] = [];
    const env = environment({
      readActiveClientAssetId: async () => {
        calls.push("build-probe");
        return "bbbbbbbbbbbb";
      },
    });
    await drive(env);
    expect(calls).toEqual(["build-probe"]);
  });
});

describe("route and query are preserved; the fragment is not replayed", () => {
  it("returns to the same path and safe query", async () => {
    const env = environment({ pathname: "/studio/upload", search: "?workflow=resale_listing" });
    await drive(env);
    expect(env.reload).toHaveBeenCalledWith("/studio/upload?workflow=resale_listing");
  });

  it("drops the fragment, which is the only place auth material ever appears", () => {
    expect(safeRecoveryTarget("/studio/reset-password", "")).toBe("/studio/reset-password");
    expect(safeRecoveryTarget("/studio", "?a=1")).toBe("/studio?a=1");
  });
});

describe("Auth storage is never touched", () => {
  it("never touches the browser's real localStorage, where the Auth session lives", async () => {
    const touched: string[] = [];
    const spy = {
      getItem: (key: string) => {
        touched.push(`get:${key}`);
        return null;
      },
      setItem: (key: string) => void touched.push(`set:${key}`),
      removeItem: (key: string) => void touched.push(`remove:${key}`),
    };
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { value: spy, configurable: true });
    try {
      await drive(environment());
    } finally {
      if (original) {
        Object.defineProperty(globalThis, "localStorage", {
          value: original,
          configurable: true,
        });
      }
    }
    expect(touched).toEqual([]);
  });

  it("leaves every other storage entry exactly as it was", async () => {
    const storage = memoryStorage();
    storage.map.set("sb-abc-auth-token", "opaque-session-value");
    storage.map.set("forever.other", "untouched");
    await drive(environment({ storage }));
    expect(storage.map.get("sb-abc-auth-token")).toBe("opaque-session-value");
    expect(storage.map.get("forever.other")).toBe("untouched");
  });
});

// ---------------------------------------------------------------------------
// P1-2 — success clearing requires an exact-route attestation
// ---------------------------------------------------------------------------

describe("P1-2 — only an exact-route success attestation clears a pending recovery", () => {
  const fullEvidence = {
    leafRouteLoaded: true,
    nestedModulesLoaded: true,
    errorBoundaryActive: false,
    studioAuthenticatedReady: true,
  };

  /** Runs the scheduled stabilization callback immediately. */
  const runNow = (run: () => void) => run();

  async function withPending(storage: Store) {
    await drive(environment({ storage }));
    return storage;
  }

  it("the recovery screen's own 'Go to site' does NOT clear anything", async () => {
    const storage = await withPending(memoryStorage());
    const result = attestStaleAssetRecovery(
      {
        ...fullEvidence,
        pathname: "/",
        clientAssetId: "bbbbbbbbbbbb",
        studioAuthenticatedReady: false,
      },
      { now: () => NOW + 10, storage, schedule: runNow },
    );
    expect(result.accepted).toBe(false);
    expect(result.outcome).toBe("refused");
    expect(ledgerOf(storage).pending).not.toBeNull();
    expect(ledgerOf(storage).history).toHaveLength(1);
  });

  it("and the same transition is still refused afterwards", async () => {
    const storage = await withPending(memoryStorage());
    attestStaleAssetRecovery(
      {
        ...fullEvidence,
        pathname: "/",
        clientAssetId: "bbbbbbbbbbbb",
        studioAuthenticatedReady: false,
      },
      { now: () => NOW + 10, storage, schedule: runNow },
    );
    const env = environment({ storage, now: () => NOW + 20 });
    expect((await drive(env)).outcome).toBe("attempt_already_used");
    expect(env.reload).not.toHaveBeenCalled();
  });

  it("a Studio shell mount is not proof — the leaf must be ready", async () => {
    const storage = await withPending(memoryStorage());
    const result = attestStaleAssetRecovery(
      {
        ...fullEvidence,
        pathname: "/studio",
        clientAssetId: "bbbbbbbbbbbb",
        studioAuthenticatedReady: false,
      },
      { now: () => NOW + 10, storage, schedule: runNow },
    );
    expect(result).toMatchObject({ accepted: false, refusal: "studio_not_authenticated_ready" });
    expect(ledgerOf(storage).pending).not.toBeNull();
  });

  it("a build that is not the recovery target proves nothing", async () => {
    const storage = await withPending(memoryStorage());
    const result = attestStaleAssetRecovery(
      { ...fullEvidence, pathname: "/studio", clientAssetId: "aaaaaaaaaaaa" },
      { now: () => NOW + 10, storage, schedule: runNow },
    );
    expect(result).toMatchObject({
      accepted: false,
      refusal: "client_assets_are_not_the_recovery_target",
    });
  });

  it("a leaf that did not load proves nothing", async () => {
    const storage = await withPending(memoryStorage());
    const result = attestStaleAssetRecovery(
      {
        ...fullEvidence,
        leafRouteLoaded: false,
        pathname: "/studio",
        clientAssetId: "bbbbbbbbbbbb",
      },
      { now: () => NOW + 10, storage, schedule: runNow },
    );
    expect(result).toMatchObject({ accepted: false, refusal: "leaf_route_not_loaded" });
  });

  it("a nested module that did not load proves nothing", async () => {
    const storage = await withPending(memoryStorage());
    const result = attestStaleAssetRecovery(
      {
        ...fullEvidence,
        nestedModulesLoaded: false,
        pathname: "/studio",
        clientAssetId: "bbbbbbbbbbbb",
      },
      { now: () => NOW + 10, storage, schedule: runNow },
    );
    expect(result).toMatchObject({ accepted: false, refusal: "nested_modules_not_loaded" });
  });

  it("an error boundary mounting proves nothing", async () => {
    const storage = await withPending(memoryStorage());
    const result = attestStaleAssetRecovery(
      {
        ...fullEvidence,
        errorBoundaryActive: true,
        pathname: "/studio",
        clientAssetId: "bbbbbbbbbbbb",
      },
      { now: () => NOW + 10, storage, schedule: runNow },
    );
    expect(result).toMatchObject({ accepted: false, refusal: "error_boundary_active" });
  });

  it("a full attestation on the recovered route DOES clear the pending recovery", async () => {
    const storage = await withPending(memoryStorage());
    const result = attestStaleAssetRecovery(
      { ...fullEvidence, pathname: "/studio", clientAssetId: "bbbbbbbbbbbb" },
      { now: () => NOW + 10, storage, schedule: runNow },
    );
    expect(result.accepted).toBe(true);
    // Reported as CLEARED only because the injected scheduler already ran the
    // stabilization callback (RR2-P3-5).
    expect(result.outcome).toBe("cleared");
    expect(ledgerOf(storage).pending).toBeNull();
  });

  // -------------------------------------------------------------------------
  // RR2-P3-5 — `scheduled` and `cleared` are different answers, and the
  // difference is TIMING, not intent
  // -------------------------------------------------------------------------

  it("reports SCHEDULED, not cleared, while the stabilization window is running", async () => {
    const storage = await withPending(memoryStorage());
    let scheduled: (() => void) | null = null;
    let scheduledMs = -1;
    const result = attestStaleAssetRecovery(
      { ...fullEvidence, pathname: "/studio", clientAssetId: "bbbbbbbbbbbb" },
      {
        now: () => NOW + 10,
        storage,
        schedule: (run, ms) => {
          scheduled = run;
          scheduledMs = ms;
        },
      },
    );
    // The evidence was accepted, and NOTHING has been cleared yet.
    expect(result.accepted).toBe(true);
    expect(result.outcome).toBe("scheduled");
    expect(ledgerOf(storage).pending).not.toBeNull();
    expect(scheduledMs).toBe(STALE_ASSET_RECOVERY_STABILIZATION_MS);

    // Only when the window elapses quietly does the clear actually happen.
    scheduled!();
    expect(ledgerOf(storage).pending).toBeNull();
  });

  it("a scheduled clear that never stabilizes never becomes a clear", async () => {
    const storage = await withPending(memoryStorage());
    let scheduled: (() => void) | null = null;
    const result = attestStaleAssetRecovery(
      { ...fullEvidence, pathname: "/studio", clientAssetId: "bbbbbbbbbbbb" },
      {
        now: () => NOW + 10,
        storage,
        schedule: (run) => {
          scheduled = run;
        },
      },
    );
    expect(result.outcome).toBe("scheduled");
    // Another confirmed stale signal arrives inside the window.
    await handleStaleAssetSignal(staleSignal, environment({ storage, now: () => NOW + 11 }));
    scheduled!();
    expect(ledgerOf(storage).pending).not.toBeNull();
  });

  it("every reported outcome is inside the closed vocabulary, and never a bare boolean", () => {
    const storage = memoryStorage();
    const refused = attestStaleAssetRecovery(
      { ...fullEvidence, pathname: "/studio", clientAssetId: "bbbbbbbbbbbb" },
      { now: () => NOW, storage, schedule: runNow },
    );
    expect(STALE_ASSET_ATTESTATION_OUTCOMES).toContain(refused.outcome);
    expect(refused.outcome).toBe("refused");
    // The old boolean is gone: nothing may report a clear as a bare `true`.
    expect("cleared" in refused).toBe(false);
    expect([...STALE_ASSET_ATTESTATION_OUTCOMES]).toEqual(["refused", "scheduled", "cleared"]);
  });

  it("but the attempted-transition HISTORY survives success", async () => {
    const storage = await withPending(memoryStorage());
    attestStaleAssetRecovery(
      { ...fullEvidence, pathname: "/studio", clientAssetId: "bbbbbbbbbbbb" },
      { now: () => NOW + 10, storage, schedule: runNow },
    );
    expect(ledgerOf(storage).history).toEqual([
      { from: "aaaaaaaaaaaa", to: "bbbbbbbbbbbb", at: NOW },
    ]);
    // Returning through B → A must not re-arm A → B.
    const back = environment({
      storage,
      now: () => NOW + 20,
      ownClientAssetId: "bbbbbbbbbbbb",
      readActiveClientAssetId: async () => "aaaaaaaaaaaa",
    });
    expect((await drive(back)).outcome).toBe("reload_issued");
    const again = environment({ storage, now: () => NOW + 30 });
    expect((await drive(again)).outcome).toBe("attempt_already_used");
  });

  it("a stale signal during the stabilization window cancels the attestation", async () => {
    const storage = await withPending(memoryStorage());
    let scheduled: (() => void) | null = null;
    const result = attestStaleAssetRecovery(
      { ...fullEvidence, pathname: "/studio", clientAssetId: "bbbbbbbbbbbb" },
      {
        now: () => NOW + 10,
        storage,
        schedule: (run) => {
          scheduled = run;
        },
      },
    );
    expect(result.accepted).toBe(true);
    // The recovered page immediately fails on another chunk.
    await handleStaleAssetSignal(staleSignal, environment({ storage, now: () => NOW + 11 }));
    scheduled!();
    expect(ledgerOf(storage).pending).not.toBeNull();
  });

  it("attesting with no pending recovery is a refusal, not an error", () => {
    const storage = memoryStorage();
    const result = attestStaleAssetRecovery(
      { ...fullEvidence, pathname: "/studio", clientAssetId: "bbbbbbbbbbbb" },
      { now: () => NOW, storage, schedule: runNow },
    );
    expect(result).toMatchObject({ accepted: false, refusal: "no_pending_recovery" });
  });

  it("the ONE documented safe redirect is honoured and nothing else is", () => {
    const base: StaleAssetSuccessAttestation = {
      clientAssetId: "bbbbbbbbbbbb",
      pathname: "/studio",
      leafRouteLoaded: true,
      nestedModulesLoaded: true,
      errorBoundaryActive: false,
      studioAuthenticatedReady: true,
      stabilizedWithoutStaleSignal: true,
    };
    const pendingOther = {
      from: "aaaaaaaaaaaa",
      to: "bbbbbbbbbbbb",
      at: NOW,
      route: "studio_other" as const,
    };
    expect(attestationClearsPending(pendingOther, base).accepted).toBe(true);
    expect(attestationClearsPending(pendingOther, { ...base, pathname: "/" }).accepted).toBe(false);
    const pendingUpload = { ...pendingOther, route: "studio_upload" as const };
    expect(attestationClearsPending(pendingUpload, base).accepted).toBe(false);
  });

  it("an expired pending recovery is abandoned, but its history entry is not", async () => {
    const storage = await withPending(memoryStorage());
    const later = NOW + STALE_ASSET_RECOVERY_PENDING_TTL_MS + 1;
    const ledger = ledgerOf(storage, later);
    expect(ledger.pending).toBeNull();
    expect(ledger.history).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Ledger validation
// ---------------------------------------------------------------------------

describe("ledger validation is strict and refuses anything unexpected", () => {
  const valid: StaleAssetRecoveryLedger = {
    v: STALE_ASSET_RECOVERY_LEDGER_SCHEMA,
    pending: { from: "aaaaaaaaaaaa", to: "bbbbbbbbbbbb", at: NOW, route: "studio_dashboard" },
    history: [{ from: "aaaaaaaaaaaa", to: "bbbbbbbbbbbb", at: NOW }],
  };

  it("accepts the exact serialized shape", () => {
    const parsed = parseStaleAssetRecoveryLedger(serializeStaleAssetRecoveryLedger(valid), NOW);
    expect(parsed.status).toBe("ok");
    expect(parsed.ledger).toEqual(valid);
  });

  it("refuses an unknown top-level key", () => {
    expect(
      parseStaleAssetRecoveryLedger(JSON.stringify({ ...valid, extra: "x" }), NOW).status,
    ).toBe("malformed");
  });

  it("refuses an unknown key inside a history entry", () => {
    const raw = JSON.stringify({
      ...valid,
      history: [{ from: "aaaaaaaaaaaa", to: "bbbbbbbbbbbb", at: NOW, url: "/assets/x.js" }],
    });
    expect(parseStaleAssetRecoveryLedger(raw, NOW).status).toBe("malformed");
  });

  it("refuses an unknown key inside the pending record", () => {
    const raw = JSON.stringify({ ...valid, pending: { ...valid.pending, error: "boom" } });
    expect(parseStaleAssetRecoveryLedger(raw, NOW).status).toBe("malformed");
  });

  it("refuses a route outside the closed vocabulary", () => {
    const raw = JSON.stringify({
      ...valid,
      pending: { ...valid.pending, route: "/studio/project/riviera-monaco" },
    });
    expect(parseStaleAssetRecoveryLedger(raw, NOW).status).toBe("malformed");
  });

  it("refuses an unbounded build identifier", () => {
    const raw = JSON.stringify({
      ...valid,
      history: [{ from: "a".repeat(64), to: "bbbbbbbbbbbb", at: NOW }],
    });
    expect(parseStaleAssetRecoveryLedger(raw, NOW).status).toBe("malformed");
  });

  it("refuses a wrong schema version", () => {
    expect(parseStaleAssetRecoveryLedger(JSON.stringify({ ...valid, v: 1 }), NOW).status).toBe(
      "malformed",
    );
  });

  it("refuses a history longer than the strict maximum", () => {
    const history = Array.from({ length: STALE_ASSET_RECOVERY_MAX_HISTORY + 1 }, (_, index) => ({
      from: `${index}`.repeat(4),
      to: "bbbbbbbbbbbb",
      at: NOW,
    }));
    expect(parseStaleAssetRecoveryLedger(JSON.stringify({ ...valid, history }), NOW).status).toBe(
      "malformed",
    );
  });

  it("refuses non-JSON, oversized and non-object values", () => {
    expect(parseStaleAssetRecoveryLedger("not json", NOW).status).toBe("malformed");
    expect(parseStaleAssetRecoveryLedger("[]", NOW).status).toBe("malformed");
    expect(
      parseStaleAssetRecoveryLedger("x".repeat(STALE_ASSET_RECOVERY_MAX_SERIALIZED_BYTES + 1), NOW)
        .status,
    ).toBe("malformed");
  });

  // -------------------------------------------------------------------------
  // RR2-P3-4 — the declared maximum history is REACHABLE under the byte cap
  // -------------------------------------------------------------------------

  it("a FULL history at production identifier length fits inside the byte cap", () => {
    // The exact worst case: MAX_HISTORY entries plus a pending record, every
    // identifier at the maximum bounded length (32) and every timestamp at 13
    // digits, on the longest route kind in the vocabulary. Before the cap was
    // reconciled this serialized to 983 bytes against a 512-byte limit, so the
    // documented maximum of 8 was unreachable and the real limit was 4.
    const identifier = "f".repeat(32);
    const at = 9_999_999_999_999;
    const longestRoute = [...STALE_ASSET_ROUTE_KINDS].sort((a, b) => b.length - a.length)[0];
    const worstCase = {
      v: STALE_ASSET_RECOVERY_LEDGER_SCHEMA,
      pending: { from: identifier, to: identifier, at, route: longestRoute },
      history: Array.from({ length: STALE_ASSET_RECOVERY_MAX_HISTORY }, () => ({
        from: identifier,
        to: identifier,
        at,
      })),
    };
    const raw = JSON.stringify(worstCase);
    expect(raw.length).toBeLessThanOrEqual(STALE_ASSET_RECOVERY_MAX_SERIALIZED_BYTES);

    const parsed = parseStaleAssetRecoveryLedger(raw, at);
    expect(parsed.status).toBe("ok");
    expect(parsed.ledger.history).toHaveLength(STALE_ASSET_RECOVERY_MAX_HISTORY);
    expect(parsed.ledger.pending).not.toBeNull();
  });

  it("and the byte cap is still a hard bound one byte further out", () => {
    const identifier = "f".repeat(32);
    const at = 9_999_999_999_999;
    const base = {
      v: STALE_ASSET_RECOVERY_LEDGER_SCHEMA,
      pending: { from: identifier, to: identifier, at, route: "studio_reset_password" },
      history: Array.from({ length: STALE_ASSET_RECOVERY_MAX_HISTORY }, () => ({
        from: identifier,
        to: identifier,
        at,
      })),
    };
    const raw = JSON.stringify(base);
    const padded = `${" ".repeat(STALE_ASSET_RECOVERY_MAX_SERIALIZED_BYTES + 1 - raw.length)}${raw}`;
    expect(padded.length).toBe(STALE_ASSET_RECOVERY_MAX_SERIALIZED_BYTES + 1);
    expect(parseStaleAssetRecoveryLedger(padded, at).status).toBe("malformed");
  });

  it("the serializer never writes more than the cap allows", () => {
    const identifier = "f".repeat(32);
    const at = 9_999_999_999_999;
    const serialized = serializeStaleAssetRecoveryLedger({
      v: STALE_ASSET_RECOVERY_LEDGER_SCHEMA,
      pending: { from: identifier, to: identifier, at, route: "studio_reset_password" },
      history: Array.from({ length: STALE_ASSET_RECOVERY_MAX_HISTORY + 4 }, () => ({
        from: identifier,
        to: identifier,
        at,
      })),
    });
    expect(serialized.length).toBeLessThanOrEqual(STALE_ASSET_RECOVERY_MAX_SERIALIZED_BYTES);
    expect(parseStaleAssetRecoveryLedger(serialized, at).status).toBe("ok");
  });

  it("treats an absent value as absent, not malformed", () => {
    expect(parseStaleAssetRecoveryLedger(null, NOW).status).toBe("absent");
    expect(parseStaleAssetRecoveryLedger("", NOW).status).toBe("absent");
  });

  it("deletes an invalid value rather than re-parsing it forever", () => {
    const storage = memoryStorage();
    storage.map.set(STALE_ASSET_RECOVERY_LEDGER_KEY, "{{{");
    expect(readRecoveryLedger(NOW, storage).status).toBe("malformed");
    expect(storage.map.has(STALE_ASSET_RECOVERY_LEDGER_KEY)).toBe(false);
  });

  it("clamps a future timestamp instead of dropping the entry", () => {
    const raw = JSON.stringify({
      v: STALE_ASSET_RECOVERY_LEDGER_SCHEMA,
      pending: null,
      history: [{ from: "aaaaaaaaaaaa", to: "bbbbbbbbbbbb", at: NOW + 999_999_999 }],
    });
    const parsed = parseStaleAssetRecoveryLedger(raw, NOW);
    expect(parsed.status).toBe("ok");
    expect(parsed.ledger.history).toHaveLength(1);
    expect(parsed.ledger.history[0].at).toBe(NOW);
  });
});

describe("nothing sensitive is ever retained", () => {
  it("stores only the permitted fields and no error material", async () => {
    const storage = memoryStorage();
    await drive(
      environment({
        storage,
        pathname: "/studio/project/riviera-monaco",
        search: "?tab=facts&job=8f0d1c2e",
      }),
    );
    const raw = storage.map.get(STALE_ASSET_RECOVERY_LEDGER_KEY) ?? "";
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["history", "pending", "v"]);
    expect(Object.keys(parsed.pending as object).sort()).toEqual(["at", "from", "route", "to"]);
    for (const forbidden of [
      "riviera-monaco",
      "StudioDashboard",
      "DDTDlhmi",
      "assets",
      "http",
      "?",
      "tab=",
      "8f0d1c2e",
      "Failed to fetch",
      ".js",
      "@",
    ]) {
      expect(raw, forbidden).not.toContain(forbidden);
    }
    // The route is a closed-vocabulary kind, never the pathname.
    expect((parsed.pending as { route: string }).route).toBe("studio_project");
  });

  it("returns only closed enum members", async () => {
    const decision = await drive(environment());
    expect(STALE_ASSET_RECOVERY_OUTCOMES).toContain(decision.outcome);
    expect(Object.keys(decision).sort()).toEqual(["outcome", "verdict"]);
  });
});

describe("route kinds are bounded and carry no identifier", () => {
  it("maps every Studio surface to a closed kind", () => {
    expect(routeKindOf("/")).toBe("public");
    expect(routeKindOf("/projects/riviera-monaco")).toBe("public");
    expect(routeKindOf("/studio")).toBe("studio_dashboard");
    expect(routeKindOf("/studio/")).toBe("studio_dashboard");
    expect(routeKindOf("/studio/upload")).toBe("studio_upload");
    expect(routeKindOf("/studio/members")).toBe("studio_members");
    expect(routeKindOf("/studio/project/riviera-monaco")).toBe("studio_project");
    expect(routeKindOf("/studio/resale/8f0d1c2e")).toBe("studio_resale");
    expect(routeKindOf("/studio/reset-password")).toBe("studio_reset_password");
    expect(routeKindOf("/studio/forgot-password")).toBe("studio_forgot_password");
    expect(routeKindOf("/studio/something-new")).toBe("studio_other");
  });
});

describe("manual recovery state", () => {
  it("can be required without reloading anything", () => {
    requireManualStaleAssetRecovery();
    expect(getStaleAssetRecoveryState()).toBe("recovery_required");
  });

  it("resetRecoveryLedgerForTest tolerates an unavailable storage", () => {
    expect(() => resetRecoveryLedgerForTest(null)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// P2-1 — every denial renders the specific screen
// ---------------------------------------------------------------------------

describe("P2-1 — a confirmed stale failure never falls through to the generic screen", () => {
  it("the machine reports a screen-rendering state for every denial reason", async () => {
    const cases: Array<[StaleAssetRecoveryOutcome, () => Promise<StaleAssetRecoveryOutcome>]> = [
      [
        "attempt_already_used",
        async () => {
          const storage = memoryStorage();
          await drive(environment({ storage }));
          return (await drive(environment({ storage }))).outcome;
        },
      ],
      [
        "recovery_budget_spent",
        async () => {
          const storage = memoryStorage();
          const builds = "abcde".split("").map((letter) => letter.repeat(12));
          let last: StaleAssetRecoveryOutcome = "not_stale";
          for (let i = 0; i + 1 < builds.length; i += 1) {
            last = (
              await drive(
                environment({
                  storage,
                  now: () => NOW + i,
                  ownClientAssetId: builds[i],
                  readActiveClientAssetId: async () => builds[i + 1],
                }),
              )
            ).outcome;
          }
          return last;
        },
      ],
      [
        "write_in_flight",
        async () => (await drive(environment({ hasUnprovenWrite: () => true }))).outcome,
      ],
      ["storage_unavailable", async () => (await drive(environment({ storage: null }))).outcome],
      [
        "active_client_assets_unknown",
        async () =>
          (await drive(environment({ readActiveClientAssetId: async () => null }))).outcome,
      ],
      [
        "same_client_assets",
        async () =>
          (await drive(environment({ readActiveClientAssetId: async () => "aaaaaaaaaaaa" })))
            .outcome,
      ],
      [
        "route_denied",
        async () => (await drive(environment({ pathname: "/studio/reset-password" }))).outcome,
      ],
      [
        "malformed_state",
        async () => {
          const storage = memoryStorage();
          storage.map.set(STALE_ASSET_RECOVERY_LEDGER_KEY, "{{{");
          return (await drive(environment({ storage }))).outcome;
        },
      ],
    ];

    for (const [expected, run] of cases) {
      const outcome = await run();
      expect(outcome, expected).toBe(expected);
      expect(outcomeIsDenial(outcome), expected).toBe(true);
      expect(stateRendersRecoveryScreen(getStaleAssetRecoveryState()), expected).toBe(true);
    }
    // Every declared denial reason is covered by this table.
    expect(cases.map(([name]) => name).sort()).toEqual(
      [
        "active_client_assets_unknown",
        "attempt_already_used",
        "malformed_state",
        "recovery_budget_spent",
        "route_denied",
        "same_client_assets",
        "storage_unavailable",
        "write_in_flight",
      ].sort(),
    );
  });

  it("ownership is visible to the boundary BEFORE the asynchronous decision resolves", async () => {
    let release!: (value: string | null) => void;
    const probe = new Promise<string | null>((resolve) => {
      release = resolve;
    });
    const env = environment({ readActiveClientAssetId: () => probe });
    resetStaleAssetRecoveryStateForTest();
    const pendingDecision = handleStaleAssetSignal(staleSignal, env);
    // The decision has not resolved, but the boundary already knows.
    expect(getStaleAssetRecoveryState()).toBe("deciding");
    expect(stateRendersRecoveryScreen(getStaleAssetRecoveryState())).toBe(true);
    release("bbbbbbbbbbbb");
    await pendingDecision;
  });
});

describe("one failure, one decision — concurrent channels do not multiply", () => {
  it("a second signal for the same failure neither probes nor reloads again", async () => {
    let probes = 0;
    let release!: (value: string | null) => void;
    const gate = new Promise<string | null>((resolve) => {
      release = resolve;
    });
    const env = environment({
      readActiveClientAssetId: () => {
        probes += 1;
        return gate;
      },
    });
    resetStaleAssetRecoveryStateForTest();
    const first = handleStaleAssetSignal(staleSignal, env);
    const second = await handleStaleAssetSignal(staleSignal, env);
    expect(second.outcome).toBe("already_handling");
    release("bbbbbbbbbbbb");
    expect((await first).outcome).toBe("reload_issued");
    expect(probes).toBe(1);
    expect(env.reload).toHaveBeenCalledTimes(1);
  });

  it("a refusal releases the gate so a later transition can still decide", async () => {
    const storage = memoryStorage();
    const refused = environment({ storage, readActiveClientAssetId: async () => null });
    expect((await drive(refused)).outcome).toBe("active_client_assets_unknown");
    const later = environment({ storage, now: () => NOW + 1 });
    expect((await drive(later)).outcome).toBe("reload_issued");
  });
});
