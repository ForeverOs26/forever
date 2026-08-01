/**
 * FOREVER-PR131-CROSS-TAB-RECOVERY-GUARD-CORRECTION-001.
 *
 * The fail-closed correction protected ONE tab. `recoveryConfirmed` is an
 * in-memory boolean and the incomplete-termination marker is in sessionStorage,
 * which is per-tab — but the Supabase session is not. Verified against the
 * pinned `@supabase/auth-js` 2.110.0:
 *
 *   - the session is persisted in localStorage under `sb-<ref>-auth-token`, so
 *     every same-origin tab reads the same live session;
 *   - `PASSWORD_RECOVERY` is broadcast (`_notifyAllSubscribers(..., broadcast =
 *     true)`) and so reaches tabs that ALREADY hold a client;
 *   - a tab opened AFTERWARDS gets `INITIAL_SESSION` from
 *     `_emitInitialSession`, delivered to that single new subscriber and never
 *     broadcast, carrying the live recovery session.
 *
 * So the second tab saw an ordinary `signed_in` session, mounted StudioShell,
 * and would have reached `maybeBootstrapOwner` mid-reset. These tests pin the
 * origin-wide, DENY-ONLY marker that closes it, and — just as importantly —
 * that the marker grants nothing: it can never confirm recovery, reveal the
 * password form or authorize `updateUser`.
 *
 * A "tab" here is a fresh module registry (`vi.resetModules()`) with its own
 * auth-listener bucket, over the ONE shared localStorage of the realm. That is
 * the honest unit-level model: per-tab memory, shared origin storage. The real
 * two-context browser run lives outside this file, in the task's research
 * directory.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  STUDIO_RECOVERY_INCOMPLETE_MARKER_KEY,
  STUDIO_RECOVERY_SHARED_DENY_CHANNEL,
  STUDIO_RECOVERY_SHARED_DENY_KEY,
  STUDIO_RECOVERY_SHARED_DENY_SIGNAL,
  STUDIO_RECOVERY_SHARED_DENY_VALUE,
  STUDIO_RECOVERY_SHARED_RELEASE_SIGNAL,
  STUDIO_RESET_PASSWORD_PATH,
} from "../studio-recovery-contract";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/** Source with comments stripped: a claim about CODE must inspect code. */
const readCode = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");

/** Test input only. Never a real or production secret. */
const FIXTURE_PASSWORD = "correct-horse-battery";

// ---------------------------------------------------------------------------
// Supabase auth double, with a listener bucket per simulated tab
// ---------------------------------------------------------------------------

type AuthListener = (event: string, session: unknown) => void;

const auth = vi.hoisted(() => {
  let current: AuthListener[] = [];
  return {
    get current() {
      return current;
    },
    openBucket(): AuthListener[] {
      current = [];
      return current;
    },
    register(listener: AuthListener) {
      current.push(listener);
    },
    emitTo(bucket: AuthListener[], event: string, session: unknown) {
      for (const listener of [...bucket]) listener(event, session);
    },
    getSession: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
    signInWithPassword: vi.fn(),
    resetPasswordForEmail: vi.fn(),
  };
});

/**
 * The DEDICATED recovery client, with its OWN per-tab listener bucket.
 *
 * Two buckets is the entire point. auth-js re-dispatches a broadcast
 * `PASSWORD_RECOVERY` into the ORDINARY client's listeners of every other tab;
 * it cannot reach the dedicated client's listeners at all, because a client
 * created with `persistSession: false` never constructs a BroadcastChannel.
 */
const recoveryAuth = vi.hoisted(() => {
  let current: ((event: string, session: unknown) => void)[] = [];
  return {
    present: { value: true },
    openBucket() {
      current = [];
      return current;
    },
    register(listener: (event: string, session: unknown) => void) {
      current.push(listener);
    },
    emitTo(bucket: ((event: string, session: unknown) => void)[], event: string, session: unknown) {
      for (const listener of [...bucket]) listener(event, session);
    },
  };
});

vi.mock("../components/studio-recovery-client", () => ({
  getStudioRecoveryClient: () =>
    recoveryAuth.present.value
      ? {
          auth: {
            getSession: (...args: unknown[]) => auth.getSession(...args),
            onAuthStateChange: (listener: AuthListener) => {
              recoveryAuth.register(listener);
              return { data: { subscription: { unsubscribe: () => void 0 } } };
            },
            updateUser: (...args: unknown[]) => auth.updateUser(...args),
            signOut: (...args: unknown[]) => auth.signOut(...args),
          },
        }
      : null,
  studioRecoveryClientExists: () => recoveryAuth.present.value,
  discardStudioRecoveryClient: () => void 0,
}));

const navigation = vi.hoisted(() => ({ navigate: vi.fn() }));

/** Every Studio server function, so "did any of them run?" is answerable. */
const serverFns = vi.hoisted(() => ({
  getOverview: vi.fn(),
  startJob: vi.fn(),
  resumePending: vi.fn(),
  inviteMember: vi.fn(),
  setMemberActive: vi.fn(),
  getProjectDetail: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => auth.getSession(...args),
      onAuthStateChange: (listener: AuthListener) => {
        auth.register(listener);
        return { data: { subscription: { unsubscribe: () => void 0 } } };
      },
      updateUser: (...args: unknown[]) => auth.updateUser(...args),
      signOut: (...args: unknown[]) => auth.signOut(...args),
      signInWithPassword: (...args: unknown[]) => auth.signInWithPassword(...args),
      resetPasswordForEmail: (...args: unknown[]) => auth.resetPasswordForEmail(...args),
    },
  },
}));

vi.mock("@tanstack/react-router", async () => {
  const React = await import("react");
  return {
    useNavigate: () => navigation.navigate,
    Link: (props: { to: string; children: React.ReactNode; className?: string }) =>
      React.createElement("a", { href: props.to, className: props.className }, props.children),
    Outlet: () => null,
    createFileRoute: () => (config: unknown) => config,
  };
});

vi.mock("../studio.functions", () => ({
  studioGetOverview: serverFns.getOverview,
  studioStartJob: serverFns.startJob,
  studioResumePending: serverFns.resumePending,
  studioInviteMember: serverFns.inviteMember,
  studioSetMemberActive: serverFns.setMemberActive,
  studioGetProjectDetail: serverFns.getProjectDetail,
}));

// ---------------------------------------------------------------------------
// A BroadcastChannel that is synchronous and inspectable
// ---------------------------------------------------------------------------

/**
 * Faithful to the browser contract in the one way that matters here: a message
 * is delivered to every OTHER open channel of the same name and never back to
 * the poster. Being synchronous removes scheduling noise, and recording every
 * payload lets a test assert that nothing sensitive is ever put on the wire.
 */
const posted: { channel: string; data: unknown }[] = [];
const openChannels = new Set<FakeBroadcastChannel>();

class FakeBroadcastChannel {
  name: string;
  private handlers = new Set<(event: MessageEvent) => void>();
  private closed = false;

  constructor(name: string) {
    this.name = name;
    openChannels.add(this);
  }
  addEventListener(type: string, handler: (event: MessageEvent) => void) {
    if (type === "message") this.handlers.add(handler);
  }
  removeEventListener(_type: string, handler: (event: MessageEvent) => void) {
    this.handlers.delete(handler);
  }
  postMessage(data: unknown) {
    posted.push({ channel: this.name, data });
    for (const other of openChannels) {
      if (other === this || other.closed || other.name !== this.name) continue;
      for (const handler of other.handlers) handler({ data } as MessageEvent);
    }
  }
  close() {
    this.closed = true;
    openChannels.delete(this);
  }
}

const SESSION = { user: { id: "user-fixture", email: "publisher@example.test" } };
const ORIGIN = "https://forever.phuketre22.workers.dev";
const RESET_URL = ORIGIN + STUDIO_RESET_PASSWORD_PATH;

function setLocation(href: string) {
  const url = new URL(href);
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: {
      origin: url.origin,
      href: url.href,
      hash: url.hash,
      search: url.search,
      pathname: url.pathname,
    },
  });
}

function sharedMarker(): string | null {
  return localStorage.getItem(STUDIO_RECOVERY_SHARED_DENY_KEY);
}

// ---------------------------------------------------------------------------
// Tab helpers
// ---------------------------------------------------------------------------

type Tab = {
  /** The ORDINARY, session-persisting client's listeners — broadcast-reachable. */
  events: AuthListener[];
  /** The DEDICATED recovery client's listeners — reachable only from this tab. */
  recoveryEvents: AuthListener[];
  mode: typeof import("../components/studio-recovery-mode");
  session: typeof import("../components/useStudioSession");
};

/**
 * Opens a tab: a fresh module registry (its own in-memory recovery state and
 * its own sessionStorage semantics) sharing the realm's localStorage, exactly
 * as a second browser tab shares the origin's storage.
 */
async function openTab(href = ORIGIN + "/studio"): Promise<Tab> {
  setLocation(href);
  const events = auth.openBucket();
  const recoveryEvents = recoveryAuth.openBucket();
  vi.resetModules();
  const mode = await import("../components/studio-recovery-mode");
  const session = await import("../components/useStudioSession");
  // Every tab is given a dedicated-client listener, which makes the tests
  // STRICTER: tab B has the same machinery available as tab A and still never
  // reaches authority, because the broadcast lands on the ordinary client.
  mode.installStudioRecoveryAuthority();
  return { events, recoveryEvents, mode, session };
}

/** Reads a tab's reported session status through the real hook. */
function probe(tab: Tab): string[] {
  const seen: string[] = [];
  function Probe() {
    seen.push(tab.session.useStudioSession().status);
    return null;
  }
  render(<Probe />);
  return seen;
}

/** The genuine, authoritative recovery: the Supabase event plus a live session. */
/**
 * This tab genuinely consumed the recovery link: its DEDICATED client parsed
 * the URL and emitted PASSWORD_RECOVERY locally. That is the only route to
 * authority, and it also raises the origin-wide denial for every other tab.
 */
async function enterRecovery(tab: Tab) {
  auth.getSession.mockResolvedValue({ data: { session: SESSION } });
  recoveryAuth.emitTo(tab.recoveryEvents, "PASSWORD_RECOVERY", SESSION);
}

beforeEach(() => {
  vi.clearAllMocks();
  posted.length = 0;
  for (const channel of [...openChannels]) channel.close();
  openChannels.clear();
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  localStorage.clear();
  sessionStorage.clear();
  auth.openBucket();
  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.updateUser.mockResolvedValue({ error: null });
  auth.signOut.mockResolvedValue({ error: null });
  auth.signInWithPassword.mockResolvedValue({ error: null });
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  setLocation(ORIGIN + "/studio");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

// ---------------------------------------------------------------------------
// 1–4, 21. What may and may not establish the origin-wide denial
// ---------------------------------------------------------------------------

describe("marker establishment", () => {
  it("1. PASSWORD_RECOVERY writes the origin-wide deny marker, synchronously", async () => {
    const tabA = await openTab(RESET_URL);
    expect(sharedMarker()).toBeNull();

    // Even on the ORDINARY client — where the event may have been broadcast in
    // from another tab — denial is raised. No await between the event and the
    // marker: the shared session is already live at this instant, so every
    // other tab is refused from this instant.
    auth.emitTo(tabA.events, "PASSWORD_RECOVERY", SESSION);
    expect(sharedMarker()).toBe(STUDIO_RECOVERY_SHARED_DENY_VALUE);
    expect(tabA.mode.isStudioRecoveryBlocked()).toBe(true);

    // ...but denial is ALL it does. Authority still requires this tab's own
    // dedicated client to have parsed the link.
    expect(tabA.mode.isStudioLocalRecoveryAuthority()).toBe(false);
  });

  it("1b. the DEDICATED client's PASSWORD_RECOVERY writes the marker AND grants authority", async () => {
    const tabA = await openTab(RESET_URL);
    expect(sharedMarker()).toBeNull();

    recoveryAuth.emitTo(tabA.recoveryEvents, "PASSWORD_RECOVERY", SESSION);

    expect(sharedMarker()).toBe(STUDIO_RECOVERY_SHARED_DENY_VALUE);
    expect(tabA.mode.isStudioLocalRecoveryAuthority()).toBe(true);
  });

  it("2/3/4. SIGNED_IN, INITIAL_SESSION and TOKEN_REFRESHED never write it", async () => {
    for (const event of ["SIGNED_IN", "INITIAL_SESSION", "TOKEN_REFRESHED", "USER_UPDATED"]) {
      localStorage.clear();
      const tab = await openTab();
      auth.emitTo(tab.events, event, SESSION);
      expect(sharedMarker(), event).toBeNull();
      expect(tab.mode.isStudioRecoveryBlocked(), event).toBe(false);
      expect(tab.mode.isStudioLocalRecoveryAuthority(), event).toBe(false);
    }
  });

  it("21. a URL landing hint is deny-only and stays TAB-LOCAL", async () => {
    // `type=recovery` is user-controlled text. If it wrote an origin-wide
    // marker, any link mailed to the Owner would deny Studio across the origin.
    const tab = await openTab(RESET_URL + "#type=recovery");
    expect(tab.mode.isStudioRecoveryLandingHinted()).toBe(true);
    expect(tab.mode.isStudioRecoveryBlocked()).toBe(true);
    expect(tab.mode.isStudioLocalRecoveryAuthority()).toBe(false);
    expect(sharedMarker()).toBeNull();
  });

  it("22. the hint is still refused outside the exact reset path", async () => {
    for (const href of [
      ORIGIN + "/studio?type=recovery",
      ORIGIN + "/studio/upload#type=recovery",
      ORIGIN + "/studio/reset-password-evil?type=recovery",
      ORIGIN + "/?type=recovery",
    ]) {
      localStorage.clear();
      const tab = await openTab(href);
      expect(tab.mode.isStudioRecoveryBlocked(), href).toBe(false);
      expect(sharedMarker(), href).toBeNull();
    }
  });

  it("the marker is established on PASSWORD_RECOVERY, not deferred to updateUser", () => {
    const source = readCode("src/features/forever-studio/components/studio-recovery-mode.ts");
    // The call sits inside the function the PASSWORD_RECOVERY event drives.
    expect(source).toMatch(
      /function grantLocalRecoveryAuthority\(\): void \{\s*holdStudioRecoveryClaim\(\);\s*setStudioRecoverySharedDeny\(\);/,
    );
    // ...and the deny-only path raises it too, so an event observed on the
    // ordinary client still refuses every tab.
    expect(source).toMatch(
      /function noteStudioRecoveryDenyObserved\(\): void \{\s*setStudioRecoverySharedDeny\(\);/,
    );
    const reset = readCode("src/features/forever-studio/components/StudioResetPassword.tsx");
    expect(reset).not.toMatch(/setStudioRecoverySharedDeny/);
  });
});

// ---------------------------------------------------------------------------
// 5, 6. The shared marker grants nothing
// ---------------------------------------------------------------------------

describe("deny-only: the shared marker is not authority", () => {
  it("5. a shared marker never sets recoveryConfirmed", async () => {
    localStorage.setItem(STUDIO_RECOVERY_SHARED_DENY_KEY, STUDIO_RECOVERY_SHARED_DENY_VALUE);
    const tab = await openTab(RESET_URL);
    expect(tab.mode.isStudioRecoverySharedBlocked()).toBe(true);
    expect(tab.mode.isStudioRecoveryBlocked()).toBe(true);
    // The only thing that may grant is the event, which never happened here.
    expect(tab.mode.isStudioLocalRecoveryAuthority()).toBe(false);
  });

  it("6. a FORGED marker cannot show the reset form or authorize updateUser", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // The attacker writes the marker by hand and holds a live session.
    localStorage.setItem(STUDIO_RECOVERY_SHARED_DENY_KEY, STUDIO_RECOVERY_SHARED_DENY_VALUE);
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    const tab = await openTab(RESET_URL + "?type=recovery");
    const { StudioResetPassword } = await import("../components/StudioResetPassword");
    render(<StudioResetPassword />);

    // Ordinary session events only — no PASSWORD_RECOVERY anywhere.
    auth.emitTo(tab.events, "INITIAL_SESSION", SESSION);
    auth.emitTo(tab.events, "SIGNED_IN", SESSION);
    await vi.advanceTimersByTimeAsync(15000);

    expect(screen.queryByLabelText(/^new password$/i)).toBeNull();
    expect(await screen.findByRole("heading", { name: /reset link expired/i })).toBeTruthy();
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(tab.mode.isStudioLocalRecoveryAuthority()).toBe(false);
    for (const fn of Object.values(serverFns)) expect(fn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("the reset form is gated on recoveryConfirmed + live session, never on the marker", () => {
    const source = readCode("src/features/forever-studio/components/StudioResetPassword.tsx");
    expect(source).toMatch(/if \(!isStudioLocalRecoveryAuthority\(\)\) return;/);
    // The screen must not consult the deny-only guard to decide readiness.
    expect(source).not.toMatch(/isStudioRecoveryBlocked/);
    expect(source).not.toMatch(/isStudioRecoverySharedBlocked/);
  });
});

// ---------------------------------------------------------------------------
// 7, 8, 10, 11. The new-tab contract
// ---------------------------------------------------------------------------

describe("new tab opened after recovery began", () => {
  async function recoveryInTabAThenOpenTabB() {
    const tabA = await openTab(RESET_URL);
    await enterRecovery(tabA);
    expect(sharedMarker()).toBe(STUDIO_RECOVERY_SHARED_DENY_VALUE);
    // Tab B is opened afterwards. It gets no PASSWORD_RECOVERY — auth-js
    // delivers INITIAL_SESSION to the new subscriber only — and it has none of
    // tab A's in-memory state and none of its sessionStorage.
    const tabB = await openTab(ORIGIN + "/studio");
    expect(tabB.mode.isStudioLocalRecoveryAuthority()).toBe(false);
    expect(tabB.mode.isStudioRecoveryTerminationIncomplete()).toBe(false);
    return { tabA, tabB };
  }

  it("7/8. reports blocked, never signed_in, on INITIAL_SESSION with a live session", async () => {
    const { tabB } = await recoveryInTabAThenOpenTabB();
    const seen = probe(tabB);
    auth.emitTo(tabB.events, "INITIAL_SESSION", SESSION);

    await waitFor(() => expect(seen).toContain("recovery"));
    expect(seen).not.toContain("signed_in");
    expect(tabB.mode.isStudioRecoveryBlocked()).toBe(true);
    // Blocked WITHOUT gaining authority — deny-only, in the tab that never
    // proved control of the mailbox.
    expect(tabB.mode.isStudioLocalRecoveryAuthority()).toBe(false);
  });

  it("10. the Studio layout refuses StudioShell and shows the interstitial", async () => {
    const { tabB } = await recoveryInTabAThenOpenTabB();
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    const { Route } = await import("@/routes/studio");
    const StudioRoute = (Route as unknown as { component: () => React.ReactNode }).component;
    render(<StudioRoute />);
    auth.emitTo(tabB.events, "INITIAL_SESSION", SESSION);

    expect(
      await screen.findByRole("heading", { name: /finish resetting your password/i }),
    ).toBeTruthy();
    // The shell's own chrome is absent.
    expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull();
    expect(screen.queryByText(/^Forever Studio$/)).toBeNull();
  });

  it("11. no Studio server function runs in the blocked tab", async () => {
    const { tabB } = await recoveryInTabAThenOpenTabB();
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    const seen = probe(tabB);
    auth.emitTo(tabB.events, "INITIAL_SESSION", SESSION);
    auth.emitTo(tabB.events, "SIGNED_IN", SESSION);
    auth.emitTo(tabB.events, "TOKEN_REFRESHED", SESSION);
    await waitFor(() => expect(seen).toContain("recovery"));
    expect(seen).not.toContain("signed_in");
    for (const fn of Object.values(serverFns)) expect(fn).not.toHaveBeenCalled();
  });

  it("11. the dashboard itself issues no server call while the marker stands", async () => {
    const { tabB } = await recoveryInTabAThenOpenTabB();
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });

    // Mounted directly, bypassing the layout, so this proves the dashboard's
    // OWN gate holds and not merely that the shell refused to render it.
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { StudioDashboard } = await import("../components/StudioDashboard");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <StudioDashboard />
      </QueryClientProvider>,
    );
    auth.emitTo(tabB.events, "INITIAL_SESSION", SESSION);
    await waitFor(() => expect(tabB.mode.isStudioRecoveryBlocked()).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));

    for (const fn of Object.values(serverFns)) expect(fn).not.toHaveBeenCalled();
  });

  it("a RELOAD of the blocked tab stays blocked", async () => {
    await recoveryInTabAThenOpenTabB();
    // Reload: every module re-evaluated, all in-memory state lost, only the
    // origin-wide marker survives — which is the point of putting it there.
    const reloaded = await openTab(ORIGIN + "/studio");
    expect(reloaded.mode.isStudioRecoveryBlocked()).toBe(true);
    expect(reloaded.mode.isStudioLocalRecoveryAuthority()).toBe(false);
  });

  it("direct navigation to a protected Studio route is refused", async () => {
    await recoveryInTabAThenOpenTabB();
    for (const href of [
      ORIGIN + "/studio",
      ORIGIN + "/studio/upload",
      ORIGIN + "/studio/members",
      ORIGIN + "/studio/project/coralina",
    ]) {
      const tab = await openTab(href);
      expect(tab.mode.isStudioRecoveryBlocked(), href).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 9. The existing-tab contract
// ---------------------------------------------------------------------------

describe("tab already open when recovery begins", () => {
  it("9. reacts to the cross-tab storage notification without a reload", async () => {
    const tabB = await openTab(ORIGIN + "/studio");
    auth.getSession.mockResolvedValue({ data: { session: null } });
    const seen = probe(tabB);
    auth.emitTo(tabB.events, "INITIAL_SESSION", null);
    await waitFor(() => expect(seen).toContain("signed_out"));

    // Another tab enters recovery. In a browser that write raises `storage`
    // here; the value read back is the live one, not a start-up snapshot.
    localStorage.setItem(STUDIO_RECOVERY_SHARED_DENY_KEY, STUDIO_RECOVERY_SHARED_DENY_VALUE);
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: STUDIO_RECOVERY_SHARED_DENY_KEY,
        newValue: STUDIO_RECOVERY_SHARED_DENY_VALUE,
        oldValue: null,
      }),
    );

    await waitFor(() => expect(seen[seen.length - 1]).toBe("recovery"));
    expect(seen).not.toContain("signed_in");
  });

  it("9. reacts to the BroadcastChannel notification", async () => {
    const tabB = await openTab(ORIGIN + "/studio");
    const seen = probe(tabB);
    auth.emitTo(tabB.events, "INITIAL_SESSION", null);
    await waitFor(() => expect(seen).toContain("signed_out"));

    // A separate channel stands in for the recovery tab's client.
    const other = new FakeBroadcastChannel(STUDIO_RECOVERY_SHARED_DENY_CHANNEL);
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    other.postMessage({ signal: STUDIO_RECOVERY_SHARED_DENY_SIGNAL });

    await waitFor(() => expect(seen[seen.length - 1]).toBe("recovery"));
    expect(seen).not.toContain("signed_in");
    expect(tabB.mode.isStudioLocalRecoveryAuthority()).toBe(false);
  });

  it("9. denial survives a channel signal even when localStorage is unwritable", async () => {
    const tabB = await openTab(ORIGIN + "/studio");
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      const other = new FakeBroadcastChannel(STUDIO_RECOVERY_SHARED_DENY_CHANNEL);
      other.postMessage({ signal: STUDIO_RECOVERY_SHARED_DENY_SIGNAL });
      // Nothing was persisted, yet the tab is blocked for this page's lifetime.
      expect(sharedMarker()).toBeNull();
      expect(tabB.mode.isStudioRecoveryBlocked()).toBe(true);
    } finally {
      setItem.mockRestore();
    }
  });

  it("a blocked tab cannot be un-blocked by an ordinary auth event", async () => {
    const tabA = await openTab(RESET_URL);
    await enterRecovery(tabA);
    const tabB = await openTab(ORIGIN + "/studio");
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    const seen = probe(tabB);
    for (const event of ["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED"]) {
      auth.emitTo(tabB.events, event, SESSION);
    }
    await waitFor(() => expect(seen).toContain("recovery"));
    expect(seen).not.toContain("signed_in");
  });
});

// ---------------------------------------------------------------------------
// 12, 13. Failed termination, across tabs
// ---------------------------------------------------------------------------

describe("failed termination", () => {
  async function failingRecovery() {
    const tabA = await openTab(RESET_URL + "#type=recovery");
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    const { StudioResetPassword } = await import("../components/StudioResetPassword");
    render(<StudioResetPassword />);
    // The reset screen installed the DEDICATED client's listener during render;
    // this is that client's own event, i.e. genuine local link consumption.
    recoveryAuth.emitTo(tabA.recoveryEvents, "PASSWORD_RECOVERY", SESSION);
    await screen.findByLabelText(/^new password$/i);

    // Sign-out fails and the session survives.
    auth.signOut.mockResolvedValue({ error: new Error("nope") });
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(screen.getByLabelText(/^new password$/i), {
      target: { value: FIXTURE_PASSWORD },
    });
    fireEvent.change(screen.getByLabelText(/^confirm new password$/i), {
      target: { value: FIXTURE_PASSWORD },
    });
    fireEvent.click(screen.getByRole("button", { name: /save new password/i }));
    await screen.findByRole("heading", { name: /finish signing out/i });
    return tabA;
  }

  it("12. the shared marker stays set when sign-out fails", async () => {
    await failingRecovery();
    expect(sharedMarker()).toBe(STUDIO_RECOVERY_SHARED_DENY_VALUE);
    expect(sessionStorage.getItem(STUDIO_RECOVERY_INCOMPLETE_MARKER_KEY)).toBe("1");
    expect(posted.some((m) => (m.data as { signal: string }).signal === "release")).toBe(false);
  });

  it("12. every other tab stays blocked while termination is unproved", async () => {
    await failingRecovery();
    cleanup();
    const tabB = await openTab(ORIGIN + "/studio");
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    const seen = probe(tabB);
    auth.emitTo(tabB.events, "INITIAL_SESSION", SESSION);
    await waitFor(() => expect(seen).toContain("recovery"));
    expect(seen).not.toContain("signed_in");
    for (const fn of Object.values(serverFns)) expect(fn).not.toHaveBeenCalled();
  });

  it("13. retrying secure sign-out never calls updateUser again", async () => {
    await failingRecovery();
    expect(auth.updateUser).toHaveBeenCalledTimes(1);

    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByRole("button", { name: /retry secure sign-out/i }));
    await waitFor(() => expect(auth.signOut.mock.calls.length).toBeGreaterThan(2));

    expect(auth.updateUser).toHaveBeenCalledTimes(1);
    expect(sharedMarker()).toBe(STUDIO_RECOVERY_SHARED_DENY_VALUE);
  });
});

// ---------------------------------------------------------------------------
// 14, 17, 18, 19, 20. Release — and only on positive absence
// ---------------------------------------------------------------------------

describe("release", () => {
  it("18/19. a successful termination clears the marker and notifies other tabs", async () => {
    const tabA = await openTab(RESET_URL + "#type=recovery");
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    const { StudioResetPassword } = await import("../components/StudioResetPassword");
    render(<StudioResetPassword />);
    recoveryAuth.emitTo(tabA.recoveryEvents, "PASSWORD_RECOVERY", SESSION);
    await screen.findByLabelText(/^new password$/i);
    expect(sharedMarker()).toBe(STUDIO_RECOVERY_SHARED_DENY_VALUE);

    // Sign-out succeeds and the session is positively gone.
    auth.signOut.mockResolvedValue({ error: null });
    auth.getSession.mockResolvedValue({ data: { session: null } });
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(screen.getByLabelText(/^new password$/i), {
      target: { value: FIXTURE_PASSWORD },
    });
    fireEvent.change(screen.getByLabelText(/^confirm new password$/i), {
      target: { value: FIXTURE_PASSWORD },
    });
    fireEvent.click(screen.getByRole("button", { name: /save new password/i }));

    await waitFor(() => expect(sharedMarker()).toBeNull());
    expect(
      posted.some(
        (m) => (m.data as { signal: string }).signal === STUDIO_RECOVERY_SHARED_RELEASE_SIGNAL,
      ),
    ).toBe(true);

    // 19. the other tab settles SIGNED OUT — never straight into Studio.
    cleanup();
    const tabB = await openTab(ORIGIN + "/studio");
    const seen = probe(tabB);
    auth.emitTo(tabB.events, "SIGNED_OUT", null);
    await waitFor(() => expect(seen).toContain("signed_out"));
    expect(seen).not.toContain("signed_in");
    for (const fn of Object.values(serverFns)) expect(fn).not.toHaveBeenCalled();
  });

  it("14/17. a stale marker with a positively absent session self-heals", async () => {
    // A browser killed mid-recovery: marker persisted, no session survives.
    localStorage.setItem(STUDIO_RECOVERY_SHARED_DENY_KEY, STUDIO_RECOVERY_SHARED_DENY_VALUE);
    const tab = await openTab(ORIGIN + "/studio");
    expect(tab.mode.isStudioRecoveryBlocked()).toBe(true);

    auth.getSession.mockResolvedValue({ data: { session: null } });
    const seen = probe(tab);

    await waitFor(() => expect(sharedMarker()).toBeNull());
    await waitFor(() => expect(seen[seen.length - 1]).toBe("signed_out"));
    // Healed to the ORDINARY sign-in screen. No membership action, no bootstrap.
    expect(seen).not.toContain("signed_in");
    for (const fn of Object.values(serverFns)) expect(fn).not.toHaveBeenCalled();
  });

  it("a stale marker with a LIVE session stays blocked", async () => {
    localStorage.setItem(STUDIO_RECOVERY_SHARED_DENY_KEY, STUDIO_RECOVERY_SHARED_DENY_VALUE);
    const tab = await openTab(ORIGIN + "/studio");
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    const seen = probe(tab);
    await waitFor(() => expect(seen).toContain("recovery"));
    expect(sharedMarker()).toBe(STUDIO_RECOVERY_SHARED_DENY_VALUE);
    expect(seen).not.toContain("signed_in");
  });

  it("15. a THROWN getSession never clears the marker", async () => {
    localStorage.setItem(STUDIO_RECOVERY_SHARED_DENY_KEY, STUDIO_RECOVERY_SHARED_DENY_VALUE);
    const tab = await openTab(ORIGIN + "/studio");
    auth.getSession.mockImplementation(() => {
      throw new Error("auth client exploded");
    });
    const seen = probe(tab);
    await waitFor(() => expect(seen[seen.length - 1]).toBe("recovery"));
    expect(sharedMarker()).toBe(STUDIO_RECOVERY_SHARED_DENY_VALUE);
    expect(seen).not.toContain("signed_out");
    expect(seen).not.toContain("signed_in");
  });

  it("16. a REJECTED getSession (network failure, timeout) never clears the marker", async () => {
    localStorage.setItem(STUDIO_RECOVERY_SHARED_DENY_KEY, STUDIO_RECOVERY_SHARED_DENY_VALUE);
    const tab = await openTab(ORIGIN + "/studio");
    for (const failure of [
      new TypeError("Failed to fetch"),
      new Error("network timeout"),
      new Error("AbortError"),
    ]) {
      auth.getSession.mockRejectedValue(failure);
      const seen = probe(tab);
      await waitFor(() => expect(seen[seen.length - 1]).toBe("recovery"));
      expect(sharedMarker(), String(failure)).toBe(STUDIO_RECOVERY_SHARED_DENY_VALUE);
      cleanup();
    }
  });

  it("a recovery tab never self-heals its own guard away", async () => {
    const tabA = await openTab(RESET_URL);
    await enterRecovery(tabA);
    // Even asked with a null session, the tab holding recovery authority keeps
    // the origin-wide denial: releasing is the reset screen's decision, taken
    // only after IT has proved the session gone.
    auth.getSession.mockResolvedValue({ data: { session: null } });
    tabA.mode.noteStudioSessionPositivelyAbsent();
    expect(sharedMarker()).toBe(STUDIO_RECOVERY_SHARED_DENY_VALUE);
    expect(tabA.mode.isStudioLocalRecoveryAuthority()).toBe(true);
  });

  it("20. with no marker at all, an ordinary session still reaches signed_in", async () => {
    const tab = await openTab(ORIGIN + "/studio");
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    const seen = probe(tab);
    auth.emitTo(tab.events, "SIGNED_IN", SESSION);
    await waitFor(() => expect(seen).toContain("signed_in"));
    expect(seen).not.toContain("recovery");
    expect(sharedMarker()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 23–26. What the correction must not have changed or leaked
// ---------------------------------------------------------------------------

describe("contract preserved", () => {
  it("26. the marker value carries no token, session, email, id or password", async () => {
    const tab = await openTab(RESET_URL);
    await enterRecovery(tab);

    const value = sharedMarker() ?? "";
    expect(value).toBe("1");
    expect(value.length).toBeLessThan(4);

    // Nothing else was written to shared storage either.
    const keys = Object.keys(localStorage);
    expect(keys).toEqual([STUDIO_RECOVERY_SHARED_DENY_KEY]);

    // And nothing sensitive went onto the wire.
    for (const message of posted) {
      const json = JSON.stringify(message.data);
      expect(json).toMatch(/^\{"signal":"(deny|release)"\}$/);
      expect(json).not.toMatch(/eyJ/);
      expect(json).not.toMatch(/@/);
      expect(json).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
      expect(json).not.toContain(FIXTURE_PASSWORD);
      expect(json).not.toContain(SESSION.user.id);
    }
  });

  it("26. the shared-deny module never reads or writes session material", () => {
    const source = readCode(
      "src/features/forever-studio/components/studio-recovery-shared-deny.ts",
    );
    for (const forbidden of [
      "access_token",
      "refresh_token",
      "getSession",
      "updateUser",
      "sessionStorage",
      "document.cookie",
      "indexedDB",
      "console.log",
      "recoveryConfirmed",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
    // Exactly one localStorage key, and it is the constant one.
    expect(source).toMatch(/localStorage\.setItem\(\s*STUDIO_RECOVERY_SHARED_DENY_KEY/);
    expect(source).toMatch(/localStorage\.removeItem\(STUDIO_RECOVERY_SHARED_DENY_KEY\)/);
  });

  it("23. the recovery redirect is still the fixed same-origin reset path", async () => {
    const { studioResetPasswordRedirectUrl } = await import("../studio-recovery-contract");
    expect(studioResetPasswordRedirectUrl(ORIGIN)).toBe(ORIGIN + STUDIO_RESET_PASSWORD_PATH);
    expect(() => studioResetPasswordRedirectUrl("http://evil.example.com")).toThrow();
    // The redirect is assigned from the fixed builder and from nothing else —
    // no query parameter, form field, storage entry or remote value.
    const forgot = readCode("src/features/forever-studio/components/StudioForgotPassword.tsx");
    const assignments = forgot.match(/redirectTo\s*=\s*[^;]+;/g) ?? [];
    expect(assignments).toEqual([
      "redirectTo = studioResetPasswordRedirectUrl(window.location.origin);",
    ]);
    expect(forgot).toMatch(/resetPasswordForEmail\(email\.trim\(\), \{ redirectTo \}\)/);
  });

  it("24. the request screen still answers identically for any address", async () => {
    const { STUDIO_RECOVERY_GENERIC_NOTICE } = await import("../studio-recovery-contract");
    const { fireEvent } = await import("@testing-library/react");
    for (const [address, outcome] of [
      ["known@example.test", { error: null }],
      ["unknown@example.test", { error: new Error("User not found") }],
    ] as const) {
      vi.resetModules();
      auth.resetPasswordForEmail.mockResolvedValue(outcome);
      const { StudioForgotPassword } = await import("../components/StudioForgotPassword");
      render(<StudioForgotPassword />);
      fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: address } });
      fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
      expect(await screen.findByText(STUDIO_RECOVERY_GENERIC_NOTICE)).toBeTruthy();
      cleanup();
    }
  });

  it("25. no sign-up, OTP or OAuth surface was introduced", () => {
    for (const file of [
      "src/features/forever-studio/components/studio-recovery-shared-deny.ts",
      "src/features/forever-studio/components/studio-recovery-mode.ts",
      "src/features/forever-studio/components/useStudioSession.ts",
      "src/features/forever-studio/components/StudioResetPassword.tsx",
      "src/features/forever-studio/components/StudioForgotPassword.tsx",
      "src/features/forever-studio/studio-recovery-contract.ts",
    ]) {
      const source = readCode(file);
      for (const forbidden of [
        "signUp",
        "signInWithOtp",
        "signInWithOAuth",
        "verifyOtp",
        "signInWithIdToken",
      ]) {
        expect(source, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("the guard is re-read on every resolution, never captured once", () => {
    const source = readCode("src/features/forever-studio/components/useStudioSession.ts");
    // Called inside resolveState, which every path funnels through.
    expect(source).toMatch(/function resolveState\([\s\S]*?isStudioRecoveryBlocked\(\)/);
    // No module-level snapshot of the guard.
    expect(source).not.toMatch(/^const \w+ = isStudioRecoveryBlocked\(\);/m);
    const mode = readCode("src/features/forever-studio/components/studio-recovery-mode.ts");
    expect(mode).toMatch(/isStudioRecoverySharedDenyActive\(\)/);
    expect(mode).not.toMatch(/^const shared\w* = isStudioRecoverySharedDenyActive\(\);/m);
  });

  it("the cross-tab listener is installed, not left to rerender timing", () => {
    const shared = readCode(
      "src/features/forever-studio/components/studio-recovery-shared-deny.ts",
    );
    expect(shared).toMatch(/window\.addEventListener\("storage"/);
    expect(shared).toMatch(/new BroadcastChannel\(STUDIO_RECOVERY_SHARED_DENY_CHANNEL\)/);
    const mode = readCode("src/features/forever-studio/components/studio-recovery-mode.ts");
    expect(mode).toMatch(/subscribeStudioRecoverySharedDeny\(\(\) => emit\(\)\)/);
  });
});
