/**
 * Booth Mode 2.0 — SUPABASE AUTH-EVENT LIFECYCLE regression
 * (PR #102 corrective pass 4).
 *
 * WHAT WAS WRONG. The Gate's `onAuthStateChange` subscriber re-ran the whole
 * access check, and that check opened with `supabase.auth.getSession()`.
 * supabase-js holds an internal lock while it emits an auth event and awaits its
 * subscribers, so a Supabase API call made from inside that callback — directly,
 * or indirectly through a Booth server function whose client middleware calls
 * `getSession()` to attach the Host's token — can deadlock the shared client.
 * The tablet symptom is a page stuck on "Loading…" with every subsequent
 * Supabase call hanging behind it, reachable from SIGNED_IN, TOKEN_REFRESHED on
 * an idle tablet, and SIGNED_OUT followed by a rapid re-login.
 *
 * WHY THE OLD SUITE COULD NOT CATCH IT. booth-route-gate.test.tsx invoked the
 * subscriber with no arguments and let `getSession` resolve normally, so the
 * re-entrant call looked like an ordinary await. The defect is not in what the
 * Gate decides — it is in WHEN it asks. So this suite asserts on the call
 * timeline, not only on the rendered outcome:
 *
 *   • every Supabase auth method and the gated Booth function are instrumented
 *     with a "was the auth callback on the stack?" flag;
 *   • the subscriber is driven with the REAL supabase-js callback shape,
 *     `(event, session)`, including the session object the fix depends on;
 *   • the callback's synchronous return value is asserted to be a non-thenable,
 *     because supabase-js awaits what a subscriber returns — an async callback
 *     would put the continuation right back inside the lock window;
 *   • timers are faked, so "nothing ran during the callback" and "the probe ran
 *     after it" are two separately observable moments rather than one race.
 *
 * The credential transport itself is unchanged and is proven elsewhere, over a
 * real HTTP hop with real ES256 JWTs, in booth-auth-transport.test.ts.
 */

import { readFileSync } from "node:fs";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* ---------------------------------------------------------------------------
 * Instrumented doubles. Everything the Gate could possibly call is recorded,
 * together with whether the auth callback was executing at the time.
 * ------------------------------------------------------------------------- */

type AuthCallback = (event: string, session: unknown) => unknown;

interface PendingProbe {
  resolve: (value: { granted: true; hostName: string | null }) => void;
  reject: (reason: unknown) => void;
}

const harness = vi.hoisted(() => {
  const state = {
    /** True only while the Gate's auth subscriber is on the stack. */
    insideAuthCallback: false,
    /** Anything called during that window — the defect, if it is non-empty. */
    reentrant: [] as string[],
    /** Every Supabase auth method the Gate called, in order. */
    supabaseCalls: [] as string[],
    /** Every gated access probe the Gate started. */
    probeCalls: 0,
    /** What `getSession()` reports on mount. */
    initialSession: null as unknown,
    /** How the gated probe behaves: settle now, or wait to be settled by hand. */
    probeMode: "grant" as "grant" | "deny" | "manual",
    hostName: "Host Tester" as string | null,
    pendingProbes: [] as PendingProbe[],
    signInError: null as { message: string } | null,
    authCallback: null as AuthCallback | null,
    unsubscribes: 0,
  };

  function record(name: string) {
    state.supabaseCalls.push(name);
    if (state.insideAuthCallback) state.reentrant.push(name);
  }

  return { state, record };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => {
        harness.record("auth.getSession");
        return { data: { session: harness.state.initialSession } };
      },
      getUser: async () => {
        harness.record("auth.getUser");
        return { data: { user: null } };
      },
      refreshSession: async () => {
        harness.record("auth.refreshSession");
        return { data: { session: null } };
      },
      signInWithPassword: async () => {
        harness.record("auth.signInWithPassword");
        return { error: harness.state.signInError };
      },
      signOut: async () => {
        harness.record("auth.signOut");
        return { error: null };
      },
      onAuthStateChange: (callback: AuthCallback) => {
        harness.record("auth.onAuthStateChange");
        harness.state.authCallback = callback;
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                harness.state.unsubscribes += 1;
              },
            },
          },
        };
      },
    },
  },
}));

vi.mock("./booth-v2.functions", () => ({
  boothV2GetAccess: () => {
    const state = harness.state;
    state.probeCalls += 1;
    if (state.insideAuthCallback) state.reentrant.push("boothV2GetAccess");
    if (state.probeMode === "manual") {
      return new Promise<{ granted: true; hostName: string | null }>((resolve, reject) => {
        state.pendingProbes.push({ resolve, reject });
      });
    }
    if (state.probeMode === "deny") return Promise.reject(new Error("booth_access_denied"));
    return Promise.resolve({ granted: true as const, hostName: state.hostName });
  },
  boothV2GetRouteAvailability: async () => ({ available: true }),
}));

vi.mock("@/routes/__root", () => ({
  NotFoundComponent: () => <div>404 · Page not found</div>,
}));

vi.mock("./BoothV2Navigator", () => ({
  BoothV2Navigator: ({ hostName }: { hostName?: string | null }) => (
    <div>Booth V2 shell for {hostName}</div>
  ),
}));

import { BoothV2Gate } from "./BoothV2Gate";

/* ---------------------------------------------------------------------------
 * Driving the lifecycle
 * ------------------------------------------------------------------------- */

/** A session shaped like the one supabase-js hands the subscriber. */
function sessionFor(userId: string, accessToken = "token-1") {
  return {
    access_token: accessToken,
    refresh_token: `refresh-${accessToken}`,
    expires_at: 4_102_444_800,
    token_type: "bearer",
    user: { id: userId, email: `${userId}@example.test` },
  };
}

/**
 * Let the deferred macrotask and every promise chain behind it run, inside
 * act(). Timers are faked, so nothing here happens by accident: a probe that
 * appears after `settle()` was scheduled, not racing.
 */
async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    // The probe awaits the gated call, which awaits its result; drain those.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * Fire a real-shaped auth event. Returns what the subscriber returned
 * synchronously — supabase-js awaits it, so it must not be a promise.
 */
async function emit(event: string, session: unknown): Promise<unknown> {
  const callback = harness.state.authCallback;
  if (!callback) throw new Error("the Gate never subscribed to auth state changes");
  let returned: unknown;
  await act(async () => {
    harness.state.insideAuthCallback = true;
    try {
      returned = callback(event, session);
    } finally {
      // Flipped back the instant the callback returns: everything recorded
      // while it was true happened inside the lock window.
      harness.state.insideAuthCallback = false;
    }
  });
  return returned;
}

const isThenable = (value: unknown) =>
  typeof (value as { then?: unknown } | null | undefined)?.then === "function";

const booth = () => screen.queryByText(/Booth V2 shell for/);
const notFound = () => screen.queryByText(/404 · Page not found/);
const signInForm = () => screen.queryByText("Forever Booth");
const loading = () => screen.queryByText("Loading…");

const HOST = "c0ffee00-0000-4000-8000-000000000001";
const OTHER_HOST = "c0ffee00-0000-4000-8000-0000000000ff";

/** Render signed out and let the initial session discovery settle. */
async function renderSignedOut() {
  const view = render(<BoothV2Gate />);
  await settle();
  expect(signInForm()).not.toBeNull();
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  const state = harness.state;
  state.insideAuthCallback = false;
  state.reentrant.length = 0;
  state.supabaseCalls.length = 0;
  state.probeCalls = 0;
  state.initialSession = null;
  state.probeMode = "grant";
  state.hostName = "Host Tester";
  state.pendingProbes.length = 0;
  state.signInError = null;
  state.authCallback = null;
  state.unsubscribes = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

/* ---------------------------------------------------------------------------
 * 1. THE DEFECT ITSELF: the callback must not re-enter Supabase.
 * ------------------------------------------------------------------------- */

describe("the auth callback never re-enters the Supabase client", () => {
  it("calls no Supabase method and no Booth function while it is executing", async () => {
    await renderSignedOut();
    const supabaseCallsBefore = harness.state.supabaseCalls.length;

    const returned = await emit("SIGNED_IN", sessionFor(HOST));

    // The heart of corrective pass 4: nothing at all ran inside the window
    // supabase-js holds its lock open for.
    expect(harness.state.reentrant).toEqual([]);
    expect(harness.state.supabaseCalls.length).toBe(supabaseCallsBefore);
    // supabase-js awaits whatever a subscriber returns. An async callback would
    // therefore resume inside the same window; this one cannot.
    expect(isThenable(returned)).toBe(false);
  });

  it("keeps that true for every event supabase-js emits at a booth", async () => {
    harness.state.initialSession = sessionFor(HOST);
    render(<BoothV2Gate />);
    await settle();

    for (const [event, session] of [
      ["INITIAL_SESSION", sessionFor(HOST)],
      ["TOKEN_REFRESHED", sessionFor(HOST, "token-2")],
      ["USER_UPDATED", sessionFor(HOST, "token-3")],
      ["SIGNED_OUT", null],
      ["SIGNED_IN", sessionFor(HOST, "token-4")],
      ["PASSWORD_RECOVERY", sessionFor(HOST, "token-5")],
    ] as Array<[string, unknown]>) {
      const returned = await emit(event, session);
      expect(`${event}:${JSON.stringify(harness.state.reentrant)}`).toBe(`${event}:[]`);
      expect(`${event}:${isThenable(returned)}`).toBe(`${event}:false`);
      await settle();
    }
  });

  it("reads the supplied session instead of asking Supabase for it again", async () => {
    await renderSignedOut();
    // Exactly one getSession: the initial discovery on mount, outside any
    // callback. Nothing the auth events do adds another.
    const initialReads = harness.state.supabaseCalls.filter((c) => c === "auth.getSession").length;
    expect(initialReads).toBe(1);

    await emit("SIGNED_IN", sessionFor(HOST));
    await settle();
    await emit("TOKEN_REFRESHED", sessionFor(HOST, "token-2"));
    await settle();
    await emit("SIGNED_OUT", null);
    await settle();

    expect(harness.state.supabaseCalls.filter((c) => c === "auth.getSession")).toHaveLength(1);
    expect(harness.state.supabaseCalls).not.toContain("auth.getUser");
    expect(harness.state.supabaseCalls).not.toContain("auth.refreshSession");
    expect(harness.state.supabaseCalls).not.toContain("auth.signOut");
  });

  /**
   * A shape guard behind the behavioural proof above, not a substitute for it.
   * Textual absence of `getSession` in the callback proves nothing on its own —
   * the original defect called a helper that called it. So this asserts the
   * stronger property that made the fix work: the subscriber delegates to
   * exactly one function, and that function is synchronous and Supabase-free.
   */
  it("delegates from the subscriber to one synchronous, Supabase-free decision", () => {
    const source = readFileSync("src/features/navigator/booth-v2/BoothV2Gate.tsx", "utf8");

    const start = source.indexOf("supabase.auth.onAuthStateChange(");
    expect(start).toBeGreaterThan(-1);
    const callback = source.slice(start, source.indexOf("});", start) + 3);
    const called = [...callback.matchAll(/(\w+)\s*\(/g)]
      .map((match) => match[1])
      .filter((name) => name !== "onAuthStateChange");
    expect(called).toEqual(["applyObservedSession"]);

    const decisionStart = source.indexOf("function applyObservedSession(");
    expect(decisionStart).toBeGreaterThan(-1);
    const decision = source.slice(decisionStart, source.indexOf("\n    }", decisionStart));
    expect(decision).not.toMatch(/\bawait\b|\basync\b|supabase\./);
  });
});

/* ---------------------------------------------------------------------------
 * 2. THE PROBE IS DEFERRED, NOT ABANDONED.
 * ------------------------------------------------------------------------- */

describe("the authorized-access probe runs after the callback returns", () => {
  it("has not started when the callback returns, and has started once timers run", async () => {
    await renderSignedOut();
    harness.state.probeMode = "manual";

    await emit("SIGNED_IN", sessionFor(HOST));

    // Deferred: the callback returned without touching the gated endpoint...
    expect(harness.state.probeCalls).toBe(0);
    expect(loading()).not.toBeNull();

    await settle();

    // ...and the probe is what runs next, outside the callback stack.
    expect(harness.state.probeCalls).toBe(1);
  });

  it("moves the Gate signed_out → checking → Booth with no manual reload", async () => {
    await renderSignedOut();
    harness.state.probeMode = "manual";

    await emit("SIGNED_IN", sessionFor(HOST));
    expect(signInForm()).toBeNull();
    expect(loading()).not.toBeNull();

    await settle();
    await act(async () => {
      harness.state.pendingProbes[0].resolve({ granted: true, hostName: "Host Tester" });
    });

    expect(booth()).not.toBeNull();
    expect(screen.getByText(/Host Tester/)).toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------------------
 * 3. THE SIGN-IN FLOW, END TO END.
 * ------------------------------------------------------------------------- */

describe("a Host signing in at the booth", () => {
  async function submitSignIn() {
    fireEvent.change(screen.getByLabelText(/Email/), {
      target: { value: "booth-host@example.test" },
    });
    fireEvent.change(screen.getByLabelText(/Password/), {
      target: { value: "disposable-local-password" },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: /Sign in/ }).closest("form") as Element);
    });
    await settle();
  }

  it("reaches Booth V2 when the account is authorized", async () => {
    await renderSignedOut();

    await submitSignIn();
    // supabase-js emits the event; the Gate is not allowed to poll for it.
    await emit("SIGNED_IN", sessionFor(HOST));
    await settle();

    expect(booth()).not.toBeNull();
    expect(harness.state.reentrant).toEqual([]);
  });

  it("reaches the ordinary not-found boundary without the Booth capability", async () => {
    await renderSignedOut();
    harness.state.probeMode = "deny";

    await submitSignIn();
    await emit("SIGNED_IN", sessionFor(HOST));
    await settle();

    expect(notFound()).not.toBeNull();
    // Still opaque: no reason surfaces, and the sign-in form does not reappear
    // to hint that the account itself was fine.
    expect(signInForm()).toBeNull();
    expect(booth()).toBeNull();
  });

  it("stays on the form with the generic error when sign-in fails", async () => {
    await renderSignedOut();
    harness.state.signInError = { message: "Invalid login credentials" };

    await submitSignIn();

    expect(screen.getByText("Sign-in failed. Check the email and password.")).toBeInTheDocument();
    expect(signInForm()).not.toBeNull();
    expect(harness.state.probeCalls).toBe(0);
    // The underlying Supabase message never reaches the screen.
    expect(screen.queryByText(/Invalid login credentials/)).toBeNull();
  });
});

/* ---------------------------------------------------------------------------
 * 4. TOKEN ROTATION ON AN IDLE TABLET.
 * ------------------------------------------------------------------------- */

describe("TOKEN_REFRESHED", () => {
  it("neither deadlocks nor starts an uncontrolled probe loop", async () => {
    harness.state.initialSession = sessionFor(HOST);
    render(<BoothV2Gate />);
    await settle();
    expect(booth()).not.toBeNull();
    expect(harness.state.probeCalls).toBe(1);

    // A tablet left on overnight rotates its token again and again.
    for (let rotation = 2; rotation <= 8; rotation += 1) {
      const returned = await emit("TOKEN_REFRESHED", sessionFor(HOST, `token-${rotation}`));
      expect(isThenable(returned)).toBe(false);
      await settle(60_000);
    }

    // One decision per identity, not one per rotation — and the Host is never
    // bounced back to a Loading screen mid-session.
    expect(harness.state.probeCalls).toBe(1);
    expect(harness.state.reentrant).toEqual([]);
    expect(booth()).not.toBeNull();
    expect(loading()).toBeNull();
  });

  it("does re-decide when the refreshed session belongs to a different account", async () => {
    harness.state.initialSession = sessionFor(HOST);
    render(<BoothV2Gate />);
    await settle();
    expect(harness.state.probeCalls).toBe(1);

    await emit("SIGNED_IN", sessionFor(OTHER_HOST));
    await settle();

    expect(harness.state.probeCalls).toBe(2);
  });
});

/* ---------------------------------------------------------------------------
 * 5. STALE RESULTS CAN NEVER APPLY.
 * ------------------------------------------------------------------------- */

describe("an access result that the auth state has outrun", () => {
  it("is discarded when the Host signs out while the probe is in flight", async () => {
    harness.state.initialSession = sessionFor(HOST);
    harness.state.probeMode = "manual";
    render(<BoothV2Gate />);
    await settle();
    expect(harness.state.probeCalls).toBe(1);

    await emit("SIGNED_OUT", null);
    expect(signInForm()).not.toBeNull();

    // The grant arrives late, for a session that no longer exists.
    await act(async () => {
      harness.state.pendingProbes[0].resolve({ granted: true, hostName: "Host Tester" });
    });
    await settle();

    expect(booth()).toBeNull();
    expect(signInForm()).not.toBeNull();
  });

  it("cannot apply a stale grant after SIGNED_IN → SIGNED_OUT → SIGNED_IN", async () => {
    await renderSignedOut();
    harness.state.probeMode = "manual";

    await emit("SIGNED_IN", sessionFor(HOST));
    await settle();
    await emit("SIGNED_OUT", null);
    await emit("SIGNED_IN", sessionFor(HOST, "token-2"));
    await settle();

    expect(harness.state.probeCalls).toBe(2);
    const [stale, fresh] = harness.state.pendingProbes;

    await act(async () => {
      fresh.resolve({ granted: true, hostName: "Fresh Host" });
    });
    expect(screen.getByText(/Fresh Host/)).toBeInTheDocument();

    await act(async () => {
      stale.resolve({ granted: true, hostName: "Stale Host" });
    });
    await settle();

    expect(screen.queryByText(/Stale Host/)).toBeNull();
    expect(screen.getByText(/Fresh Host/)).toBeInTheDocument();
  });

  it("cannot let a stale refusal close a Booth the newer probe opened", async () => {
    await renderSignedOut();
    harness.state.probeMode = "manual";

    await emit("SIGNED_IN", sessionFor(HOST));
    await settle();
    await emit("SIGNED_OUT", null);
    await emit("SIGNED_IN", sessionFor(HOST, "token-2"));
    await settle();

    const [stale, fresh] = harness.state.pendingProbes;
    await act(async () => {
      fresh.resolve({ granted: true, hostName: "Fresh Host" });
    });
    await act(async () => {
      stale.reject(new Error("booth_access_denied"));
    });
    await settle();

    expect(notFound()).toBeNull();
    expect(screen.getByText(/Fresh Host/)).toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------------------
 * 6. UNMOUNT.
 * ------------------------------------------------------------------------- */

describe("unmounting the Gate", () => {
  it("cancels a deferred probe that has not run yet, and unsubscribes", async () => {
    const view = await renderSignedOut();
    harness.state.probeMode = "manual";

    await emit("SIGNED_IN", sessionFor(HOST));
    expect(harness.state.probeCalls).toBe(0);
    expect(loading()).not.toBeNull();

    view.unmount();
    await settle(60_000);

    // The scheduled macrotask was cleared: a tablet that navigated away never
    // touches the gated endpoint at all.
    expect(harness.state.probeCalls).toBe(0);
    expect(harness.state.unsubscribes).toBe(1);
  });

  it("applies nothing, and logs nothing, when an in-flight probe settles later", async () => {
    harness.state.initialSession = sessionFor(HOST);
    harness.state.probeMode = "manual";
    const view = render(<BoothV2Gate />);
    await settle();
    expect(harness.state.probeCalls).toBe(1);

    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });

    view.unmount();
    await act(async () => {
      harness.state.pendingProbes[0].resolve({ granted: true, hostName: "Host Tester" });
    });
    await settle();

    expect(booth()).toBeNull();
    // No "update on an unmounted component", and nothing else either.
    expect(errors).toEqual([]);
    expect(harness.state.unsubscribes).toBe(1);
    spy.mockRestore();
  });

  it("still unsubscribes when the Host was never signed in", async () => {
    const view = await renderSignedOut();

    view.unmount();
    await settle();

    expect(harness.state.unsubscribes).toBe(1);
    expect(harness.state.probeCalls).toBe(0);
  });
});
