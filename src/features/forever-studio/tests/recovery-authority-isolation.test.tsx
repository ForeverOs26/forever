/**
 * FOREVER-PR131-RECOVERY-BROADCAST-AUTHORITY-ISOLATION-CORRECTION-001.
 *
 * The previous correction made the origin-wide DENIAL correct. It left
 * AUTHORITY wrong: any `PASSWORD_RECOVERY` callback set `recoveryConfirmed`,
 * and with the pinned `@supabase/auth-js` 2.110.0 that callback also fires in
 * tabs that never opened the link.
 *
 *   `_getSessionFromURL()`
 *     → `_notifyAllSubscribers('PASSWORD_RECOVERY', session)`   (broadcast = true)
 *     → `this.broadcastChannel.postMessage({ event, session })`
 *     → every OTHER same-origin tab's channel listener
 *     → `_notifyAllSubscribers(event.data.event, event.data.session, false)`
 *     → that tab's `onAuthStateChange(event, session)` — byte-identical.
 *
 * The first describe block proves that against the REAL library: real clients,
 * real `BroadcastChannel`, no stub anywhere near the broadcast path. Only the
 * network is local.
 *
 * The correction splits one flag into two facts:
 *
 *   DENY OBSERVED       — establishable by the ordinary client's event
 *                         (local or broadcast), the origin-wide marker, an
 *                         unterminated recovery, or the URL landing hint.
 *                         It can only REFUSE.
 *   LOCAL AUTHORITY     — establishable ONLY by a `PASSWORD_RECOVERY` from the
 *                         dedicated, non-persistent recovery client, which
 *                         auth-js never gives a BroadcastChannel and never lets
 *                         touch localStorage. It alone may show the form and
 *                         call `updateUser`.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  STUDIO_LOGIN_PATH,
  STUDIO_RECOVERY_CLIENT_STORAGE_KEY,
  STUDIO_RECOVERY_GENERIC_NOTICE,
  STUDIO_RECOVERY_INCOMPLETE_MARKER_KEY,
  STUDIO_RECOVERY_SHARED_DENY_KEY,
  STUDIO_RECOVERY_SHARED_DENY_VALUE,
  STUDIO_RESET_PASSWORD_PATH,
  studioResetPasswordRedirectUrl,
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

const MODE = "src/features/forever-studio/components/studio-recovery-mode.ts";
const RESET = "src/features/forever-studio/components/StudioResetPassword.tsx";
const RECOVERY_CLIENT = "src/features/forever-studio/components/studio-recovery-client.ts";
const GENERATED_CLIENT = "src/integrations/supabase/client.ts";

// ===========================================================================
// PART 1 — the REAL @supabase/auth-js, real BroadcastChannel, no event stubs
// ===========================================================================

describe("1, 13. real @supabase/auth-js 2.110.0 cross-tab behaviour", () => {
  const SUPABASE_URL = "http://127.0.0.1:54329";
  const SUPABASE_KEY = "sb_publishable_localtestonly";
  const SHARED_STORAGE_KEY = "sb-127-auth-token";

  const USER = {
    id: "00000000-0000-4000-8000-00000000abcd",
    aud: "authenticated",
    role: "authenticated",
    email: "harness-local@example.invalid",
    app_metadata: {},
    user_metadata: {},
    created_at: "2020-01-01T00:00:00.000Z",
  };

  /** Local transport only. The BroadcastChannel path is NOT replaced. */
  const localFetch: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/auth/v1/user")) {
      return new Response(JSON.stringify(USER), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  function recoveryHash(): string {
    const now = Math.floor(Date.now() / 1000);
    return (
      `#access_token=header.payload.signature` +
      `&refresh_token=local-refresh` +
      `&expires_in=3600&expires_at=${now + 3600}` +
      `&token_type=bearer&type=recovery`
    );
  }

  /**
   * auth-js reads `window.location.href`, not `.hash`. The file-level beforeEach
   * replaces `window.location` with a plain object, so the whole object has to
   * be rewritten here or the library would see a URL with no fragment and parse
   * nothing — which would make every assertion below vacuously "safe".
   */
  function landOnRecoveryLink(hash = recoveryHash()) {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: {
        origin: "http://localhost:3000",
        href: "http://localhost:3000" + STUDIO_RESET_PASSWORD_PATH + hash,
        hash,
        search: "",
        pathname: STUDIO_RESET_PASSWORD_PATH,
      },
    });
  }

  const created: { auth: { stopAutoRefresh?: () => void } }[] = [];

  function makeClient(auth: Record<string, unknown>) {
    const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      global: { fetch: localFetch },
      auth: { autoRefreshToken: false, detectSessionInUrl: false, ...auth },
    });
    created.push(client as unknown as { auth: { stopAutoRefresh?: () => void } });
    return client;
  }

  const settle = () => new Promise((r) => setTimeout(r, 60));

  beforeEach(() => {
    // This block must exercise the REAL BroadcastChannel; the application-level
    // block below replaces it with an inspectable double. Nested hooks run
    // after the root hook, so this restores it for these tests only.
    vi.unstubAllGlobals();
    localStorage.clear();
    window.location.hash = "";
  });

  afterEach(() => {
    created.length = 0;
    localStorage.clear();
    window.location.hash = "";
  });

  it("BroadcastChannel exists in this environment, so the test is not vacuous", () => {
    expect(typeof globalThis.BroadcastChannel).toBe("function");
  });

  it("1. a PERSISTING client broadcasts PASSWORD_RECOVERY to an already-open tab", async () => {
    // Tab B: already open, ordinary persisting client, same storage key.
    const tabB = makeClient({ persistSession: true, storageKey: SHARED_STORAGE_KEY });
    const seenByB: string[] = [];
    tabB.auth.onAuthStateChange((event) => {
      seenByB.push(event);
    });
    await settle();
    expect(seenByB).toContain("INITIAL_SESSION");

    // Tab A: opens the recovery link. Real URL parse, real emission.
    landOnRecoveryLink();
    makeClient({
      persistSession: true,
      storageKey: SHARED_STORAGE_KEY,
      detectSessionInUrl: true,
    });
    await settle();
    await settle();

    // THE DEFECT'S PREMISE, proved against the real library: tab B, which never
    // opened a link, received PASSWORD_RECOVERY over the auth-js channel.
    expect(seenByB).toContain("PASSWORD_RECOVERY");
  });

  it("1b. a NON-PERSISTENT client is never given a channel, so it cannot receive one", async () => {
    // Tab B', the isolation design: memory-only, distinct storage key.
    const isolated = makeClient({
      persistSession: false,
      storageKey: STUDIO_RECOVERY_CLIENT_STORAGE_KEY,
    });
    const seenByIsolated: string[] = [];
    isolated.auth.onAuthStateChange((event) => {
      seenByIsolated.push(event);
    });
    await settle();

    // Another tab consumes a link and broadcasts, exactly as in the test above.
    landOnRecoveryLink();
    makeClient({
      persistSession: true,
      storageKey: SHARED_STORAGE_KEY,
      detectSessionInUrl: true,
    });
    await settle();
    await settle();

    // No channel was ever constructed for it (auth-js gates construction on
    // `this.persistSession`), so the broadcast cannot reach it.
    expect(seenByIsolated).not.toContain("PASSWORD_RECOVERY");
  });

  it("13. a NON-PERSISTENT client consuming the link writes NOTHING to localStorage", async () => {
    landOnRecoveryLink();
    const recovery = makeClient({
      persistSession: false,
      storageKey: STUDIO_RECOVERY_CLIENT_STORAGE_KEY,
      detectSessionInUrl: true,
    });
    const seen: string[] = [];
    recovery.auth.onAuthStateChange((event) => {
      seen.push(event);
    });
    await settle();
    await settle();

    // It really did consume the link — otherwise "nothing stored" is trivial.
    expect(seen).toContain("PASSWORD_RECOVERY");
    const { data } = await recovery.auth.getSession();
    expect(data.session).toBeTruthy();

    // ...and yet the shared slot, and localStorage as a whole, stay empty.
    expect(localStorage.getItem(SHARED_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(STUDIO_RECOVERY_CLIENT_STORAGE_KEY)).toBeNull();
    expect(Object.keys(localStorage)).toHaveLength(0);
  });

  it("13b. a PERSISTING client consuming the same link DOES fill the shared slot", async () => {
    // The control for the test above: same link, same realm, only
    // `persistSession` differs. Proves the isolation is doing the work.
    landOnRecoveryLink();
    makeClient({
      persistSession: true,
      storageKey: SHARED_STORAGE_KEY,
      detectSessionInUrl: true,
    });
    await settle();
    await settle();
    expect(localStorage.getItem(SHARED_STORAGE_KEY)).toBeTruthy();
  });
});

// ===========================================================================
// PART 2 — the application's decision logic, with the two clients separated
// ===========================================================================

type AuthListener = (event: string, session: unknown) => void;

/** The ORDINARY, session-persisting client. Broadcast-reachable. */
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

/** The DEDICATED recovery client. Never broadcast-reachable. */
const recoveryAuth = vi.hoisted(() => {
  let current: AuthListener[] = [];
  return {
    present: { value: true },
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
  };
});

const navigation = vi.hoisted(() => ({ navigate: vi.fn() }));

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

vi.mock("../components/studio-recovery-client", () => ({
  getStudioRecoveryClient: () =>
    recoveryAuth.present.value
      ? {
          auth: {
            getSession: (...args: unknown[]) => recoveryAuth.getSession(...args),
            onAuthStateChange: (listener: AuthListener) => {
              recoveryAuth.register(listener);
              return { data: { subscription: { unsubscribe: () => void 0 } } };
            },
            updateUser: (...args: unknown[]) => recoveryAuth.updateUser(...args),
            signOut: (...args: unknown[]) => recoveryAuth.signOut(...args),
          },
        }
      : null,
  studioRecoveryClientExists: () => recoveryAuth.present.value,
  discardStudioRecoveryClient: () => {
    recoveryAuth.present.value = false;
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

/**
 * Inspectable BroadcastChannel double for the application-level block.
 *
 * Closing every channel between tests is what models "the previous tabs are
 * gone". Without it, a module registry from an earlier test would still be
 * holding a recovery claim and would answer the liveness probe, so a
 * self-heal test could never observe silence.
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

type Tab = {
  events: AuthListener[];
  recoveryEvents: AuthListener[];
  mode: typeof import("../components/studio-recovery-mode");
  session: typeof import("../components/useStudioSession");
};

/** A tab: its own module registry over the realm's shared localStorage. */
async function openTab(href = ORIGIN + "/studio"): Promise<Tab> {
  setLocation(href);
  const events = auth.openBucket();
  const recoveryEvents = recoveryAuth.openBucket();
  vi.resetModules();
  const mode = await import("../components/studio-recovery-mode");
  const session = await import("../components/useStudioSession");
  // Given to EVERY tab, which makes the tests stricter: the broadcast-receiving
  // tab has the same machinery available and still never reaches authority.
  mode.installStudioRecoveryAuthority();
  return { events, recoveryEvents, mode, session };
}

function probe(tab: Tab): string[] {
  const seen: string[] = [];
  function Probe() {
    seen.push(tab.session.useStudioSession().status);
    return null;
  }
  render(<Probe />);
  return seen;
}

async function renderReset() {
  const { StudioResetPassword } = await import("../components/StudioResetPassword");
  render(<StudioResetPassword />);
}

beforeEach(() => {
  vi.clearAllMocks();
  recoveryAuth.present.value = true;
  posted.length = 0;
  for (const channel of [...openChannels]) channel.close();
  openChannels.clear();
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  localStorage.clear();
  sessionStorage.clear();
  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.signOut.mockResolvedValue({ error: null });
  auth.updateUser.mockResolvedValue({ error: null });
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  auth.signInWithPassword.mockResolvedValue({ error: null });
  recoveryAuth.getSession.mockResolvedValue({ data: { session: null } });
  recoveryAuth.signOut.mockResolvedValue({ error: null });
  recoveryAuth.updateUser.mockResolvedValue({ error: null });
  setLocation(ORIGIN + "/studio");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
});

// ---------------------------------------------------------------------------
// 2, 3, 8, 9, 10 — what may and may not become authority
// ---------------------------------------------------------------------------

describe("authority provenance", () => {
  it("3. the link-consuming tab DOES gain local authority", async () => {
    const tabA = await openTab(RESET_URL);
    expect(tabA.mode.isStudioLocalRecoveryAuthority()).toBe(false);
    recoveryAuth.emitTo(tabA.recoveryEvents, "PASSWORD_RECOVERY", SESSION);
    expect(tabA.mode.isStudioLocalRecoveryAuthority()).toBe(true);
  });

  it("2. a broadcast-receiving tab is DENIED but gains NO authority", async () => {
    const tabB = await openTab(ORIGIN + "/studio");
    // Exactly what auth-js re-dispatches into an already-open tab.
    auth.emitTo(tabB.events, "PASSWORD_RECOVERY", SESSION);

    expect(tabB.mode.isStudioRecoveryBlocked()).toBe(true);
    expect(tabB.mode.isStudioRecoveryDenyObserved()).toBe(true);
    expect(tabB.mode.isStudioLocalRecoveryAuthority()).toBe(false);
  });

  it("8, 9, 10. INITIAL_SESSION, SIGNED_IN and TOKEN_REFRESHED never grant authority", async () => {
    for (const event of ["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED"]) {
      localStorage.clear();
      const tab = await openTab();
      // On the ordinary client...
      auth.emitTo(tab.events, event, SESSION);
      expect(tab.mode.isStudioLocalRecoveryAuthority(), `ordinary:${event}`).toBe(false);
      // ...and on the dedicated one, where only the NAME PASSWORD_RECOVERY counts.
      recoveryAuth.emitTo(tab.recoveryEvents, event, SESSION);
      expect(tab.mode.isStudioLocalRecoveryAuthority(), `dedicated:${event}`).toBe(false);
    }
  });

  it("the ordinary client's listener is deny-only in source", () => {
    const source = readCode(MODE);
    // The ORDINARY listener lives in installStudioRecoveryCapture; slice exactly
    // that function so the dedicated installer below cannot satisfy the check.
    const start = source.indexOf("export function installStudioRecoveryCapture");
    const end = source.indexOf("export function installStudioRecoveryAuthority");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const ordinaryBlock = source.slice(start, end);

    expect(ordinaryBlock).toMatch(/supabase\.auth\.onAuthStateChange/);
    expect(ordinaryBlock).toMatch(/PASSWORD_RECOVERY"\) noteStudioRecoveryDenyObserved\(\)/);
    // It must not be able to reach the authority writer at all.
    expect(ordinaryBlock).not.toMatch(/grantLocalRecoveryAuthority/);
  });

  it("only the dedicated client's listener may grant authority", () => {
    const source = readCode(MODE);
    const authorityBlock = source.slice(
      source.indexOf("export function installStudioRecoveryAuthority"),
    );
    expect(authorityBlock).toMatch(/recoveryClient\.auth\.onAuthStateChange/);
    expect(authorityBlock).toMatch(/PASSWORD_RECOVERY"\) grantLocalRecoveryAuthority\(\)/);

    // Exactly ONE call site in the whole module (the `();` form excludes the
    // function's own declaration, which ends `(): void {`).
    expect(source.match(/grantLocalRecoveryAuthority\(\);/g)?.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4, 5, 6, 7, 21 — authority cannot be acquired any other way
// ---------------------------------------------------------------------------

describe("authority cannot be forged, inherited or navigated into", () => {
  it("4. a tab opened after the recovery began inherits denial, never authority", async () => {
    const tabA = await openTab(RESET_URL);
    recoveryAuth.emitTo(tabA.recoveryEvents, "PASSWORD_RECOVERY", SESSION);
    expect(localStorage.getItem(STUDIO_RECOVERY_SHARED_DENY_KEY)).toBe(
      STUDIO_RECOVERY_SHARED_DENY_VALUE,
    );

    const tabC = await openTab(ORIGIN + "/studio");
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    auth.emitTo(tabC.events, "INITIAL_SESSION", SESSION);

    expect(tabC.mode.isStudioRecoveryBlocked()).toBe(true);
    expect(tabC.mode.isStudioLocalRecoveryAuthority()).toBe(false);
  });

  it("5. navigating a DENIED tab to the reset route does not create authority", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const tabB = await openTab(ORIGIN + "/studio");
    // The broadcast arrives, exactly as auth-js delivers it.
    auth.emitTo(tabB.events, "PASSWORD_RECOVERY", SESSION);
    expect(tabB.mode.isStudioLocalRecoveryAuthority()).toBe(false);

    // The user now navigates this same tab to the reset screen. Module state
    // survives a client-side navigation, so this is the exact path that showed
    // a live password form before the correction.
    setLocation(RESET_URL);
    await renderReset();
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    recoveryAuth.getSession.mockResolvedValue({ data: { session: null } });
    await vi.advanceTimersByTimeAsync(15000);

    expect(screen.queryByLabelText(/^new password$/i)).toBeNull();
    expect(await screen.findByRole("heading", { name: /reset link expired/i })).toBeTruthy();
    expect(recoveryAuth.updateUser).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(tabB.mode.isStudioLocalRecoveryAuthority()).toBe(false);
    for (const fn of Object.values(serverFns)) expect(fn).not.toHaveBeenCalled();
  });

  it("6. forged URL parameters cannot establish authority", async () => {
    for (const href of [
      RESET_URL + "?type=recovery",
      RESET_URL + "#type=recovery",
      RESET_URL + "#access_token=forged&type=recovery",
      RESET_URL + "?type=recovery&access_token=forged",
    ]) {
      localStorage.clear();
      const tab = await openTab(href);
      expect(tab.mode.isStudioLocalRecoveryAuthority(), href).toBe(false);
      // The hint may deny; that is all it may do.
      expect(tab.mode.isStudioRecoveryBlocked(), href).toBe(true);
    }
  });

  it("7. a forged shared deny marker cannot establish authority", async () => {
    localStorage.setItem(STUDIO_RECOVERY_SHARED_DENY_KEY, STUDIO_RECOVERY_SHARED_DENY_VALUE);
    const tab = await openTab(RESET_URL);
    expect(tab.mode.isStudioRecoverySharedBlocked()).toBe(true);
    expect(tab.mode.isStudioLocalRecoveryAuthority()).toBe(false);
  });

  it("21. closing the authoritative tab does not transfer authority to another", async () => {
    const tabA = await openTab(RESET_URL);
    recoveryAuth.emitTo(tabA.recoveryEvents, "PASSWORD_RECOVERY", SESSION);
    expect(tabA.mode.isStudioLocalRecoveryAuthority()).toBe(true);

    // Tab A closes: its module registry and its memory-only recovery session
    // both vanish. The origin-wide marker persists in localStorage.
    cleanup();
    const tabD = await openTab(ORIGIN + "/studio");
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });

    expect(tabD.mode.isStudioRecoveryBlocked()).toBe(true);
    expect(tabD.mode.isStudioLocalRecoveryAuthority()).toBe(false);

    // ...and it still cannot become authoritative by opening the reset route.
    setLocation(RESET_URL);
    await renderReset();
    expect(tabD.mode.isStudioLocalRecoveryAuthority()).toBe(false);
    expect(screen.queryByLabelText(/^new password$/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 11, 12 — the form and updateUser belong to the dedicated client alone
// ---------------------------------------------------------------------------

describe("form and updateUser", () => {
  async function authoritativeReset() {
    const tabA = await openTab(RESET_URL);
    recoveryAuth.getSession.mockResolvedValue({ data: { session: SESSION } });
    await renderReset();
    recoveryAuth.emitTo(tabA.recoveryEvents, "PASSWORD_RECOVERY", SESSION);
    await screen.findByLabelText(/^new password$/i);
    return tabA;
  }

  function fillAndSubmit(value = FIXTURE_PASSWORD) {
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value } });
    fireEvent.change(screen.getByLabelText(/^confirm new password$/i), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: /save new password/i }));
  }

  it("11. only a locally validated recovery displays the form", async () => {
    await authoritativeReset();
    expect(screen.getByLabelText(/^new password$/i)).toBeTruthy();
    expect(screen.getByLabelText(/^confirm new password$/i)).toBeTruthy();
  });

  it("11b. the form stays hidden when the DEDICATED client holds no session", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const tabA = await openTab(RESET_URL);
    // Authority granted, but only the ORDINARY client has a session — which is
    // precisely the state a broadcast-receiving tab would be in.
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    recoveryAuth.getSession.mockResolvedValue({ data: { session: null } });
    await renderReset();
    recoveryAuth.emitTo(tabA.recoveryEvents, "PASSWORD_RECOVERY", SESSION);
    await vi.advanceTimersByTimeAsync(15000);
    expect(screen.queryByLabelText(/^new password$/i)).toBeNull();
  });

  it("11c. a LIVE dedicated session without local authority still shows no form", async () => {
    // The sharpest form of the question. Test 11b withholds the session, so it
    // cannot tell whether the screen is gated on authority or merely on having
    // a session. Here the dedicated client reports a live session and authority
    // was never granted — only the authority gate can refuse this, and if that
    // gate is removed the form appears.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const tabB = await openTab(ORIGIN + "/studio");
    // Broadcast arrives: denial, never authority.
    auth.emitTo(tabB.events, "PASSWORD_RECOVERY", SESSION);
    recoveryAuth.getSession.mockResolvedValue({ data: { session: SESSION } });
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });

    setLocation(RESET_URL);
    await renderReset();
    await vi.advanceTimersByTimeAsync(15000);

    expect(tabB.mode.isStudioLocalRecoveryAuthority()).toBe(false);
    expect(screen.queryByLabelText(/^new password$/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /save new password/i })).toBeNull();
    expect(recoveryAuth.updateUser).not.toHaveBeenCalled();
  });

  it("12. updateUser is called on the DEDICATED client and never on the ordinary one", async () => {
    await authoritativeReset();
    recoveryAuth.getSession.mockResolvedValue({ data: { session: null } });
    auth.getSession.mockResolvedValue({ data: { session: null } });
    fillAndSubmit();

    await waitFor(() => expect(recoveryAuth.updateUser).toHaveBeenCalledTimes(1));
    expect(recoveryAuth.updateUser.mock.calls[0][0]).toEqual({ password: FIXTURE_PASSWORD });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("12b. the reset screen never reaches updateUser through the shared client, in source", () => {
    const source = readCode(RESET);
    expect(source).toMatch(/recoveryClient\.auth\.updateUser\(\{ password \}\)/);
    expect(source).not.toMatch(/supabase\.auth\.updateUser/);
  });
});

// ---------------------------------------------------------------------------
// 15, 16, 17, 18, 19, 20 — sessions and termination
// ---------------------------------------------------------------------------

describe("sessions and termination", () => {
  async function authoritativeReset() {
    const tabA = await openTab(RESET_URL);
    recoveryAuth.getSession.mockResolvedValue({ data: { session: SESSION } });
    await renderReset();
    recoveryAuth.emitTo(tabA.recoveryEvents, "PASSWORD_RECOVERY", SESSION);
    await screen.findByLabelText(/^new password$/i);
    return tabA;
  }

  function fillAndSubmit(value = FIXTURE_PASSWORD) {
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value } });
    fireEvent.change(screen.getByLabelText(/^confirm new password$/i), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: /save new password/i }));
  }

  it("15. an existing ORDINARY session is blocked in every other tab during recovery", async () => {
    const tabA = await openTab(RESET_URL);
    recoveryAuth.emitTo(tabA.recoveryEvents, "PASSWORD_RECOVERY", SESSION);

    const tabB = await openTab(ORIGIN + "/studio");
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    const seen = probe(tabB);
    auth.emitTo(tabB.events, "SIGNED_IN", SESSION);

    await waitFor(() => expect(seen).toContain("recovery"));
    expect(seen).not.toContain("signed_in");
    for (const fn of Object.values(serverFns)) expect(fn).not.toHaveBeenCalled();
  });

  it("16. a successful reset terminates BOTH the recovery and the ordinary session", async () => {
    await authoritativeReset();
    recoveryAuth.getSession.mockResolvedValue({ data: { session: null } });
    auth.getSession.mockResolvedValue({ data: { session: null } });
    fillAndSubmit();

    await waitFor(() => expect(recoveryAuth.signOut).toHaveBeenCalled());
    // The ordinary, shared session is signed out too — it is the one another
    // tab could otherwise keep using once denial is released.
    expect(auth.signOut).toHaveBeenCalled();
    await waitFor(() => expect(localStorage.getItem(STUDIO_RECOVERY_SHARED_DENY_KEY)).toBeNull());
    await waitFor(() =>
      expect(navigation.navigate).toHaveBeenCalledWith({ to: STUDIO_LOGIN_PATH }),
    );
  });

  it("20. denial is NOT cleared while the ORDINARY session survives", async () => {
    await authoritativeReset();
    // The recovery session is gone, but a normal session is still alive.
    recoveryAuth.getSession.mockResolvedValue({ data: { session: null } });
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    fillAndSubmit();

    expect(await screen.findByRole("heading", { name: /finish signing out/i })).toBeTruthy();
    expect(localStorage.getItem(STUDIO_RECOVERY_SHARED_DENY_KEY)).toBe(
      STUDIO_RECOVERY_SHARED_DENY_VALUE,
    );
    expect(sessionStorage.getItem(STUDIO_RECOVERY_INCOMPLETE_MARKER_KEY)).toBe("1");
  });

  it("20b. denial is NOT cleared while the RECOVERY session survives", async () => {
    await authoritativeReset();
    recoveryAuth.getSession.mockResolvedValue({ data: { session: SESSION } });
    auth.getSession.mockResolvedValue({ data: { session: null } });
    fillAndSubmit();

    expect(await screen.findByRole("heading", { name: /finish signing out/i })).toBeTruthy();
    expect(localStorage.getItem(STUDIO_RECOVERY_SHARED_DENY_KEY)).toBe(
      STUDIO_RECOVERY_SHARED_DENY_VALUE,
    );
  });

  it("17. a failed termination keeps EVERY tab blocked", async () => {
    await authoritativeReset();
    recoveryAuth.signOut.mockResolvedValue({ error: new Error("nope") });
    recoveryAuth.getSession.mockResolvedValue({ data: { session: SESSION } });
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    fillAndSubmit();
    await screen.findByRole("heading", { name: /finish signing out/i });
    cleanup();

    const tabB = await openTab(ORIGIN + "/studio");
    const seen = probe(tabB);
    auth.emitTo(tabB.events, "INITIAL_SESSION", SESSION);
    await waitFor(() => expect(seen).toContain("recovery"));
    expect(seen).not.toContain("signed_in");
  });

  it("18. retry secure sign-out never repeats updateUser", async () => {
    await authoritativeReset();
    recoveryAuth.signOut.mockResolvedValue({ error: new Error("nope") });
    recoveryAuth.getSession.mockResolvedValue({ data: { session: SESSION } });
    fillAndSubmit();
    await screen.findByRole("heading", { name: /finish signing out/i });
    expect(recoveryAuth.updateUser).toHaveBeenCalledTimes(1);

    const before = recoveryAuth.signOut.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /retry secure sign-out/i }));
    await waitFor(() => expect(recoveryAuth.signOut.mock.calls.length).toBeGreaterThan(before));
    expect(recoveryAuth.updateUser).toHaveBeenCalledTimes(1);
  });

  it("19. a broadcast-denied tab is offered no retry control at all", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const tabB = await openTab(ORIGIN + "/studio");
    auth.emitTo(tabB.events, "PASSWORD_RECOVERY", SESSION);
    // The incomplete-termination marker is sessionStorage, which is per-tab, so
    // this tab has none of it however loudly the origin is denied.
    expect(sessionStorage.getItem(STUDIO_RECOVERY_INCOMPLETE_MARKER_KEY)).toBeNull();

    setLocation(RESET_URL);
    await renderReset();

    // Checked IMMEDIATELY, before any timer runs. Asserting only after the
    // backstop would be satisfied by the expired-link screen and would miss a
    // retry control that was offered on first paint and then replaced.
    expect(screen.queryByRole("button", { name: /retry secure sign-out/i })).toBeNull();
    expect(screen.queryByText(/finish signing out/i)).toBeNull();

    await vi.advanceTimersByTimeAsync(15000);

    expect(screen.queryByRole("button", { name: /retry secure sign-out/i })).toBeNull();
    expect(screen.queryByLabelText(/^new password$/i)).toBeNull();
    expect(recoveryAuth.signOut).not.toHaveBeenCalled();
  });

  it("22a. a bystander tab must NOT retire the denial while a tab is mid-recovery", async () => {
    // REGRESSION GUARD. Isolating the recovery session into the dedicated
    // client's memory means every OTHER tab's ordinary getSession() truthfully
    // resolves null during a perfectly healthy reset — which is exactly the
    // condition the stale-marker self-heal used to treat as "nothing to
    // protect". Without the liveness claim, tab B deletes the origin-wide
    // denial the instant it is raised and walks into the dashboard.
    const tabA = await openTab(RESET_URL);
    recoveryAuth.emitTo(tabA.recoveryEvents, "PASSWORD_RECOVERY", SESSION);
    expect(localStorage.getItem(STUDIO_RECOVERY_SHARED_DENY_KEY)).toBe(
      STUDIO_RECOVERY_SHARED_DENY_VALUE,
    );

    const tabB = await openTab(ORIGIN + "/studio");
    // Tab B sees no session at all — the recovery session is not shared.
    auth.getSession.mockResolvedValue({ data: { session: null } });
    const seen = probe(tabB);

    // Wait past the probe window, so "still denied" is a real answer.
    await new Promise((r) => setTimeout(r, 700));

    expect(localStorage.getItem(STUDIO_RECOVERY_SHARED_DENY_KEY)).toBe(
      STUDIO_RECOVERY_SHARED_DENY_VALUE,
    );
    expect(tabB.mode.isStudioRecoveryBlocked()).toBe(true);
    expect(seen).not.toContain("signed_in");
    expect(tabB.mode.isStudioLocalRecoveryAuthority()).toBe(false);
  });

  it("22. a stale denial self-heals only on positively absent sessions", async () => {
    localStorage.setItem(STUDIO_RECOVERY_SHARED_DENY_KEY, STUDIO_RECOVERY_SHARED_DENY_VALUE);
    const tab = await openTab(ORIGIN + "/studio");

    // A REJECTED getSession is not absence and heals nothing.
    auth.getSession.mockRejectedValue(new Error("offline"));
    probe(tab);
    await waitFor(() =>
      expect(localStorage.getItem(STUDIO_RECOVERY_SHARED_DENY_KEY)).toBe(
        STUDIO_RECOVERY_SHARED_DENY_VALUE,
      ),
    );
    cleanup();

    // A RESOLVED null session is absence, and only then does it heal.
    auth.getSession.mockResolvedValue({ data: { session: null } });
    const healed = await openTab(ORIGIN + "/studio");
    probe(healed);
    await waitFor(() => expect(localStorage.getItem(STUDIO_RECOVERY_SHARED_DENY_KEY)).toBeNull());
  });
});

// ---------------------------------------------------------------------------
// 14, 23–30 — surrounding contract that must survive this correction
// ---------------------------------------------------------------------------

describe("contract preserved", () => {
  it("30. the existing cross-tab dashboard denial still works end to end", async () => {
    const tabA = await openTab(RESET_URL);
    recoveryAuth.emitTo(tabA.recoveryEvents, "PASSWORD_RECOVERY", SESSION);

    const tabB = await openTab(ORIGIN + "/studio");
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    const { Route } = await import("@/routes/studio");
    const StudioRoute = (Route as unknown as { component: () => React.ReactNode }).component;
    render(<StudioRoute />);
    auth.emitTo(tabB.events, "INITIAL_SESSION", SESSION);

    expect(
      await screen.findByRole("heading", { name: /finish resetting your password/i }),
    ).toBeTruthy();
    for (const fn of Object.values(serverFns)) expect(fn).not.toHaveBeenCalled();
  });

  it("24, 25. recovery runs no Studio server function and the reset route loads no dashboard data", async () => {
    const tabA = await openTab(RESET_URL);
    recoveryAuth.getSession.mockResolvedValue({ data: { session: SESSION } });
    await renderReset();
    recoveryAuth.emitTo(tabA.recoveryEvents, "PASSWORD_RECOVERY", SESSION);
    await screen.findByLabelText(/^new password$/i);
    for (const fn of Object.values(serverFns)) expect(fn).not.toHaveBeenCalled();

    const source = readCode(RESET);
    expect(source).not.toMatch(/studio\.functions|studioGetOverview|maybeBootstrapOwner/);
  });

  it("23. fresh normal sign-in still goes through the ordinary client and the canonical path", () => {
    const login = readCode("src/features/forever-studio/components/StudioLogin.tsx");
    expect(login).toMatch(/supabase\.auth\.signInWithPassword/);
    // Sign-in must NOT be routed through the recovery client.
    expect(login).not.toMatch(/studio-recovery-client|getStudioRecoveryClient/);
  });

  it("26. the recovery redirect is still the fixed same-origin reset path", () => {
    expect(studioResetPasswordRedirectUrl(ORIGIN)).toBe(ORIGIN + STUDIO_RESET_PASSWORD_PATH);
    expect(() => studioResetPasswordRedirectUrl("http://evil.example")).toThrow();
  });

  it("27. the request screen still answers identically for any address", async () => {
    await openTab(ORIGIN + "/studio/forgot-password");
    const { StudioForgotPassword } = await import("../components/StudioForgotPassword");
    const seen: string[] = [];
    for (const address of ["known@example.test", "unknown@example.test"]) {
      cleanup();
      auth.resetPasswordForEmail.mockResolvedValue({ error: null });
      render(<StudioForgotPassword />);
      fireEvent.change(screen.getByLabelText(/email/i), { target: { value: address } });
      fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
      const notice = await screen.findByText(STUDIO_RECOVERY_GENERIC_NOTICE);
      seen.push(notice.textContent ?? "");
    }
    expect(seen[0]).toBe(seen[1]);
  });

  it("28. no sign-up, OTP, OAuth or magic-link surface is introduced", () => {
    for (const path of [MODE, RESET, RECOVERY_CLIENT]) {
      const source = readCode(path);
      expect(source, path).not.toMatch(/signUp\(|signInWithOtp|signInWithOAuth|verifyOtp/);
    }
  });

  it("14, 29. no token, session, password or identity is stored or logged", () => {
    for (const path of [MODE, RESET, RECOVERY_CLIENT]) {
      const source = readCode(path);
      expect(source, path).not.toMatch(/console\.(log|info|warn|error|debug)/);
      expect(source, path).not.toMatch(/access_token|refresh_token/);
    }
    // The only persisted values are the two literal "1" deny markers.
    const mode = readCode(MODE);
    const setItems = mode.match(/setItem\([^)]*\)/g) ?? [];
    for (const call of setItems) {
      expect(call).toMatch(/MARKER_KEY,\s*STUDIO_RECOVERY_INCOMPLETE_MARKER_VALUE/);
    }
  });
});

// ---------------------------------------------------------------------------
// Client configuration — the two switches the isolation rests on
// ---------------------------------------------------------------------------

describe("client configuration guards", () => {
  it("the ORDINARY client must not detect sessions in the URL", () => {
    const source = readCode(GENERATED_CLIENT);
    expect(source).toMatch(/detectSessionInUrl:\s*false/);
    expect(source).not.toMatch(/detectSessionInUrl:\s*true/);
  });

  it("the DEDICATED client must be non-persistent, URL-detecting and separately keyed", () => {
    const source = readCode(RECOVERY_CLIENT);
    expect(source).toMatch(/persistSession:\s*false/);
    expect(source).toMatch(/detectSessionInUrl:\s*true/);
    expect(source).toMatch(/storageKey:\s*STUDIO_RECOVERY_CLIENT_STORAGE_KEY/);
    expect(source).not.toMatch(/persistSession:\s*true/);
    // It must never be handed localStorage, nor the shared auth key.
    expect(source).not.toMatch(/localStorage/);
    expect(source).not.toMatch(/sb-.*-auth-token/);
  });

  it("the dedicated storage key is not the ordinary shared auth key", () => {
    expect(STUDIO_RECOVERY_CLIENT_STORAGE_KEY).not.toMatch(/^sb-/);
    expect(STUDIO_RECOVERY_CLIENT_STORAGE_KEY).not.toContain("auth-token");
  });
});
