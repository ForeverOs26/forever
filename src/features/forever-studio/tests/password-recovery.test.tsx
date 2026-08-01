/**
 * FOREVER-STUDIO-PASSWORD-RECOVERY-001 — secure Owner password recovery,
 * corrected by FOREVER-PR131-RECOVERY-FAIL-CLOSED-CORRECTION-001.
 *
 * Studio had sign-in and nothing else, so an invited publisher who forgot a
 * password was permanently locked out. Recovery closes that gap WITHOUT
 * opening a second way in.
 *
 * Two properties carry the security of this feature, and both were wrong in
 * the first implementation:
 *
 *  AUTHORITY (F2). `type=recovery` is user-controlled text. Treating its
 *  presence as recovery let anyone holding an ordinary session append it to a
 *  URL and be handled as though they had proved control of the mailbox. Only
 *  the Supabase PASSWORD_RECOVERY event may confirm recovery; the URL is a
 *  deny-only landing hint accepted on the exact reset path and nowhere else.
 *
 *  TERMINATION (F1). Sign-out was fire-and-forget: recovery protection was
 *  dropped BEFORE sign-out, the returned error and thrown exception were both
 *  ignored, and the surviving session was never checked. Any of those states
 *  turned the recovery session into a working Studio session, which the
 *  dashboard would have carried into maybeBootstrapOwner. Termination now
 *  fails closed and is released only once getSession() is positively null.
 *
 * These tests exercise real behaviour. The mutation controls that prove they
 * are non-vacuous live OUTSIDE this file: `mutate.mjs` in the task's research
 * directory edits the actual source, runs the targeted test, requires a
 * semantically correct failure, and restores byte-for-byte. Synthetic
 * `expect(() => expect(0).toBe(1)).toThrow()` controls were removed — they
 * asserted nothing about this implementation.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isStudioRecoveryRateLimited,
  STUDIO_FORGOT_PASSWORD_PATH,
  STUDIO_LOGIN_PATH,
  STUDIO_PASSWORD_MIN_LENGTH,
  STUDIO_RECOVERY_GENERIC_NOTICE,
  STUDIO_RECOVERY_INCOMPLETE_MARKER_KEY,
  STUDIO_RESET_PASSWORD_PATH,
  studioPasswordProblemMessage,
  studioRecoveryErrorMessage,
  studioResetPasswordRedirectUrl,
  urlIsStudioRecoveryLanding,
  validateStudioPassword,
} from "../studio-recovery-contract";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/**
 * Source with comments removed.
 *
 * A scan that claims "this module never touches localStorage" must inspect the
 * CODE — otherwise a doc comment saying "never written to localStorage" fails
 * the test, and, worse, prose could satisfy a check the implementation does not.
 */
const readCode = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");

/** A password used only as test input. Never a real or production secret. */
const FIXTURE_PASSWORD = "correct-horse-battery";

// ---------------------------------------------------------------------------
// Supabase auth double
// ---------------------------------------------------------------------------

type AuthListener = (event: string, session: unknown) => void;

const auth = vi.hoisted(() => {
  const listeners: AuthListener[] = [];
  return {
    listeners,
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    signInWithPassword: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
    emit(event: string, session: unknown) {
      for (const listener of [...listeners]) listener(event, session);
    },
    reset() {
      listeners.length = 0;
    },
  };
});

const navigation = vi.hoisted(() => ({ navigate: vi.fn() }));

/** Every Studio server function, so "was any of them called?" is answerable. */
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
        auth.listeners.push(listener);
        auth.onAuthStateChange(listener);
        return { data: { subscription: { unsubscribe: () => void 0 } } };
      },
      signInWithPassword: (...args: unknown[]) => auth.signInWithPassword(...args),
      resetPasswordForEmail: (...args: unknown[]) => auth.resetPasswordForEmail(...args),
      updateUser: (...args: unknown[]) => auth.updateUser(...args),
      signOut: (...args: unknown[]) => auth.signOut(...args),
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

const SESSION = { user: { id: "user-fixture", email: "publisher@example.test" } };

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

const RESET_URL = "https://forever.phuketre22.workers.dev" + STUDIO_RESET_PASSWORD_PATH;

/** Fresh module instance, so the module-scope recovery capture re-installs. */
async function loadRecoveryModule() {
  vi.resetModules();
  return import("../components/studio-recovery-mode");
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.reset();
  sessionStorage.clear();
  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  auth.updateUser.mockResolvedValue({ error: null });
  auth.signOut.mockResolvedValue({ error: null });
  auth.signInWithPassword.mockResolvedValue({ error: null });
  setLocation("https://forever.phuketre22.workers.dev/studio");
});

afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
});

/**
 * Renders the reset screen with a genuine, authoritative recovery: the
 * PASSWORD_RECOVERY event is emitted and a live session exists.
 */
async function renderConfirmedRecovery(options?: { hash?: boolean }) {
  setLocation(RESET_URL + (options?.hash === false ? "" : "#access_token=fixture&type=recovery"));
  auth.getSession.mockResolvedValue({ data: { session: SESSION } });
  vi.resetModules();
  const mod = await import("../components/studio-recovery-mode");
  const { StudioResetPassword } = await import("../components/StudioResetPassword");
  render(<StudioResetPassword />);
  auth.emit("PASSWORD_RECOVERY", SESSION);
  await screen.findByLabelText(/^new password$/i);
  return mod;
}

async function submitNewPassword(value = FIXTURE_PASSWORD) {
  fireEvent.change(await screen.findByLabelText(/^new password$/i), { target: { value } });
  fireEvent.change(screen.getByLabelText(/^confirm new password$/i), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: /save new password/i }));
}

// ---------------------------------------------------------------------------
// F2 — authority: only PASSWORD_RECOVERY confirms recovery
// ---------------------------------------------------------------------------

describe("recovery authority (F2)", () => {
  it("13. only PASSWORD_RECOVERY confirms recovery", async () => {
    const mod = await loadRecoveryModule();
    expect(mod.isStudioRecoveryConfirmed()).toBe(false);
    auth.emit("PASSWORD_RECOVERY", SESSION);
    expect(mod.isStudioRecoveryConfirmed()).toBe(true);
  });

  it("15. SIGNED_IN, INITIAL_SESSION and TOKEN_REFRESHED never confirm recovery", async () => {
    const mod = await loadRecoveryModule();
    for (const event of ["SIGNED_IN", "INITIAL_SESSION", "TOKEN_REFRESHED", "USER_UPDATED"]) {
      auth.emit(event, SESSION);
      expect(mod.isStudioRecoveryConfirmed(), event).toBe(false);
    }
  });

  it("11/12. a forged URL hint plus a NORMAL session never shows the form or authorizes updateUser", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // 1. an ordinary signed-in session exists
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    // 2. the visitor navigates to the reset route with a forged type parameter
    setLocation(RESET_URL + "?type=recovery");
    vi.resetModules();
    const mod = await import("../components/studio-recovery-mode");
    const { StudioResetPassword } = await import("../components/StudioResetPassword");
    render(<StudioResetPassword />);

    // 3. no PASSWORD_RECOVERY occurs — only ordinary session events
    auth.emit("INITIAL_SESSION", SESSION);
    auth.emit("SIGNED_IN", SESSION);
    await vi.advanceTimersByTimeAsync(15000);

    // 4. the form never becomes ready
    expect(screen.queryByLabelText(/^new password$/i)).toBeNull();
    expect(await screen.findByRole("heading", { name: /reset link expired/i })).toBeTruthy();
    // 5. updateUser cannot be called
    expect(auth.updateUser).not.toHaveBeenCalled();
    // 6. Studio bootstrap cannot run
    for (const fn of Object.values(serverFns)) expect(fn).not.toHaveBeenCalled();

    expect(mod.isStudioRecoveryConfirmed()).toBe(false);
    // The hint is deny-only: it withholds the dashboard, it grants nothing.
    expect(mod.isStudioRecoveryLandingHinted()).toBe(true);
    expect(mod.isStudioRecoveryBlocked()).toBe(true);
  });

  it("16. the URL hint is accepted only on the exact reset route", async () => {
    for (const href of [
      "https://forever.phuketre22.workers.dev/studio?type=recovery",
      "https://forever.phuketre22.workers.dev/studio#type=recovery",
      "https://forever.phuketre22.workers.dev/studio/upload?type=recovery",
      "https://forever.phuketre22.workers.dev/projects/coralina?type=recovery",
      "https://forever.phuketre22.workers.dev/?type=recovery",
      "https://forever.phuketre22.workers.dev/studio/reset-password-evil?type=recovery",
    ]) {
      setLocation(href);
      const mod = await loadRecoveryModule();
      expect(mod.isStudioRecoveryLandingHinted(), href).toBe(false);
      expect(mod.isStudioRecoveryConfirmed(), href).toBe(false);
      expect(mod.isStudioRecoveryBlocked(), href).toBe(false);
    }
    // ...and IS accepted on the exact path, still without granting authority.
    setLocation(RESET_URL + "#type=recovery");
    const mod = await loadRecoveryModule();
    expect(mod.isStudioRecoveryLandingHinted()).toBe(true);
    expect(mod.isStudioRecoveryConfirmed()).toBe(false);
  });

  it("urlIsStudioRecoveryLanding requires the exact path and reads only `type`", () => {
    expect(urlIsStudioRecoveryLanding(STUDIO_RESET_PASSWORD_PATH, "#type=recovery", "")).toBe(true);
    expect(urlIsStudioRecoveryLanding(STUDIO_RESET_PASSWORD_PATH, "", "?type=recovery")).toBe(true);
    expect(urlIsStudioRecoveryLanding(STUDIO_RESET_PASSWORD_PATH + "/", "#type=recovery", "")).toBe(
      true,
    );
    expect(urlIsStudioRecoveryLanding("/studio", "#type=recovery", "")).toBe(false);
    expect(urlIsStudioRecoveryLanding("/studio/upload", "", "?type=recovery")).toBe(false);
    expect(urlIsStudioRecoveryLanding(STUDIO_RESET_PASSWORD_PATH, "#type=signup", "")).toBe(false);
    expect(urlIsStudioRecoveryLanding(STUDIO_RESET_PASSWORD_PATH, "", "")).toBe(false);
  });

  it("14. an authoritative event emitted before the route mounts is retained", async () => {
    setLocation(RESET_URL + "#access_token=fixture&type=recovery");
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    vi.resetModules();
    // Module scope installs the listener; the event fires during start-up,
    // BEFORE the component is rendered.
    const mod = await import("../components/studio-recovery-mode");
    auth.emit("PASSWORD_RECOVERY", SESSION);
    expect(mod.isStudioRecoveryConfirmed()).toBe(true);

    const { StudioResetPassword } = await import("../components/StudioResetPassword");
    render(<StudioResetPassword />);
    expect(await screen.findByLabelText(/^new password$/i)).toBeTruthy();
  });

  it("19. a genuine recovery event plus a live session displays the form", async () => {
    await renderConfirmedRecovery();
    expect(screen.getByLabelText(/^new password$/i)).toBeTruthy();
    expect(screen.getByLabelText(/^confirm new password$/i)).toBeTruthy();
  });

  it("18. without an authoritative event the screen ends invalid/expired and safe", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setLocation(RESET_URL);
    auth.getSession.mockResolvedValue({ data: { session: null } });
    vi.resetModules();
    const { StudioResetPassword } = await import("../components/StudioResetPassword");
    render(<StudioResetPassword />);
    auth.emit("INITIAL_SESSION", null);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await screen.findByRole("heading", { name: /reset link expired/i })).toBeTruthy();
    expect(screen.queryByLabelText(/^new password$/i)).toBeNull();
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /request a new link/i })).toHaveAttribute(
      "href",
      STUDIO_FORGOT_PASSWORD_PATH,
    );
  });

  it("a slow auth start-up does not produce a false 'expired' verdict", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setLocation(RESET_URL);
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    vi.resetModules();
    const { StudioResetPassword } = await import("../components/StudioResetPassword");
    render(<StudioResetPassword />);
    await vi.advanceTimersByTimeAsync(6000);
    expect(screen.queryByRole("heading", { name: /reset link expired/i })).toBeNull();
    expect(screen.getByText(/checking the reset link/i)).toBeTruthy();
    auth.emit("PASSWORD_RECOVERY", SESSION);
    expect(await screen.findByRole("heading", { name: /set a new password/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// F1 — termination fails closed
// ---------------------------------------------------------------------------

describe("session termination fails closed (F1)", () => {
  it("1. signOut returning { error } blocks navigation and keeps the guard active", async () => {
    const mod = await renderConfirmedRecovery();
    auth.signOut.mockResolvedValue({ error: new Error("sign out rejected") });
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    await submitNewPassword();

    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { name: /finish signing out/i })).toBeTruthy();
    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(mod.isStudioRecoveryBlocked()).toBe(true);
    expect(mod.isStudioRecoveryTerminationIncomplete()).toBe(true);
  });

  it("2. signOut throwing blocks navigation and keeps the guard active", async () => {
    const mod = await renderConfirmedRecovery();
    auth.signOut.mockRejectedValue(new Error("network down"));
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    await submitNewPassword();

    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { name: /finish signing out/i })).toBeTruthy();
    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(mod.isStudioRecoveryBlocked()).toBe(true);
  });

  it("3. signOut resolving cleanly but leaving a session still blocks navigation", async () => {
    const mod = await renderConfirmedRecovery();
    // The provider reports success — but the session survives. The surviving
    // session is the verdict, not the returned value.
    auth.signOut.mockResolvedValue({ error: null });
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    await submitNewPassword();

    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { name: /finish signing out/i })).toBeTruthy();
    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(mod.isStudioRecoveryBlocked()).toBe(true);
  });

  // The two tests above are also satisfied by a surviving session, so on their
  // own they do not prove the RETURNED ERROR and the THROWN EXCEPTION are
  // inspected at all. These isolate exactly that: the local session is already
  // gone, so only the sign-out outcome can produce the fail-closed result.
  it("1b. a returned { error } blocks even when the local session is already gone", async () => {
    const mod = await renderConfirmedRecovery();
    auth.signOut.mockResolvedValue({ error: new Error("revocation refused") });
    auth.getSession.mockResolvedValue({ data: { session: null } });
    await submitNewPassword();

    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { name: /finish signing out/i })).toBeTruthy();
    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(mod.isStudioRecoveryBlocked()).toBe(true);
  });

  it("2b. a thrown exception blocks even when the local session is already gone", async () => {
    const mod = await renderConfirmedRecovery();
    auth.signOut.mockRejectedValue(new Error("network down"));
    auth.getSession.mockResolvedValue({ data: { session: null } });
    await submitNewPassword();

    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { name: /finish signing out/i })).toBeTruthy();
    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(mod.isStudioRecoveryBlocked()).toBe(true);
  });

  it("4. the recovery guard remains active after all three failure shapes", async () => {
    for (const failure of [
      () => auth.signOut.mockResolvedValue({ error: new Error("nope") }),
      () => auth.signOut.mockRejectedValue(new Error("boom")),
      () => auth.signOut.mockResolvedValue({ error: null }),
    ]) {
      cleanup();
      const mod = await renderConfirmedRecovery();
      failure();
      auth.getSession.mockResolvedValue({ data: { session: SESSION } });
      await submitNewPassword();
      await screen.findByRole("heading", { name: /finish signing out/i });
      expect(mod.isStudioRecoveryBlocked()).toBe(true);
      expect(mod.isStudioRecoveryTerminationIncomplete()).toBe(true);
      sessionStorage.clear();
    }
  });

  it("5. retry secure sign-out does NOT resubmit the password", async () => {
    await renderConfirmedRecovery();
    auth.signOut.mockResolvedValue({ error: new Error("nope") });
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    await submitNewPassword();
    await screen.findByRole("heading", { name: /finish signing out/i });
    expect(auth.updateUser).toHaveBeenCalledTimes(1);

    const signOutCallsBefore = auth.signOut.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /retry secure sign-out/i }));
    await waitFor(() => expect(auth.signOut.mock.calls.length).toBeGreaterThan(signOutCallsBefore));
    // The password was NOT sent again.
    expect(auth.updateUser).toHaveBeenCalledTimes(1);
    // No password field is offered on the retry state either.
    expect(screen.queryByLabelText(/^new password$/i)).toBeNull();
  });

  it("6. a successful retry with a null session clears recovery and navigates", async () => {
    const mod = await renderConfirmedRecovery();
    auth.signOut.mockResolvedValue({ error: new Error("nope") });
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    await submitNewPassword();
    await screen.findByRole("heading", { name: /finish signing out/i });
    expect(navigation.navigate).not.toHaveBeenCalled();

    // Now sign-out succeeds and the session is genuinely gone.
    auth.signOut.mockResolvedValue({ error: null });
    auth.getSession.mockResolvedValue({ data: { session: null } });
    fireEvent.click(screen.getByRole("button", { name: /retry secure sign-out/i }));

    await waitFor(() =>
      expect(navigation.navigate).toHaveBeenCalledWith({ to: STUDIO_LOGIN_PATH }),
    );
    expect(mod.isStudioRecoveryBlocked()).toBe(false);
    expect(mod.isStudioRecoveryTerminationIncomplete()).toBe(false);
    expect(sessionStorage.getItem(STUDIO_RECOVERY_INCOMPLETE_MARKER_KEY)).toBeNull();
    expect(auth.updateUser).toHaveBeenCalledTimes(1);
  });

  it("20. password update followed by confirmed sign-out returns to normal sign-in", async () => {
    const mod = await renderConfirmedRecovery();
    auth.signOut.mockResolvedValue({ error: null });
    auth.getSession.mockResolvedValue({ data: { session: null } });
    await submitNewPassword();

    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
    await waitFor(() =>
      expect(navigation.navigate).toHaveBeenCalledWith({ to: STUDIO_LOGIN_PATH }),
    );
    expect(mod.isStudioRecoveryBlocked()).toBe(false);

    // The one-shot notice is available to the sign-in screen exactly once.
    expect(mod.consumeStudioPasswordUpdatedNotice()).toBe(true);
    expect(mod.consumeStudioPasswordUpdatedNotice()).toBe(false);
  });

  it("recovery protection is never released before absence is confirmed", async () => {
    const mod = await renderConfirmedRecovery();
    let released = false;
    auth.signOut.mockImplementation(async () => {
      // At the moment sign-out runs, protection must still be in force.
      released = !mod.isStudioRecoveryBlocked();
      return { error: null };
    });
    auth.getSession.mockResolvedValue({ data: { session: null } });
    await submitNewPassword();
    await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
    expect(released).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reload / direct-navigation safety and the bootstrap boundary
// ---------------------------------------------------------------------------

describe("fail-closed across reload and navigation", () => {
  it("9. a failed termination stays blocked after remount", async () => {
    await renderConfirmedRecovery();
    auth.signOut.mockResolvedValue({ error: new Error("nope") });
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    await submitNewPassword();
    await screen.findByRole("heading", { name: /finish signing out/i });

    cleanup();
    const { StudioResetPassword } = await import("../components/StudioResetPassword");
    render(<StudioResetPassword />);
    expect(await screen.findByRole("heading", { name: /finish signing out/i })).toBeTruthy();
    expect(screen.queryByLabelText(/^new password$/i)).toBeNull();
  });

  it("10. a failed termination stays blocked after a full page reload", async () => {
    await renderConfirmedRecovery();
    auth.signOut.mockResolvedValue({ error: new Error("nope") });
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    await submitNewPassword();
    await screen.findByRole("heading", { name: /finish signing out/i });
    expect(sessionStorage.getItem(STUDIO_RECOVERY_INCOMPLETE_MARKER_KEY)).toBe("1");

    // Simulate a reload: every module is re-evaluated, in-memory state is lost,
    // and the visitor lands directly on /studio with a live session.
    cleanup();
    setLocation("https://forever.phuketre22.workers.dev/studio");
    vi.resetModules();
    const mod = await import("../components/studio-recovery-mode");
    expect(mod.isStudioRecoveryTerminationIncomplete()).toBe(true);
    expect(mod.isStudioRecoveryBlocked()).toBe(true);
    // Still no authority — the marker denies, it never grants.
    expect(mod.isStudioRecoveryConfirmed()).toBe(false);
  });

  it("7/8. a failed termination cannot mount StudioShell or call a Studio server function", async () => {
    await renderConfirmedRecovery();
    auth.signOut.mockResolvedValue({ error: new Error("nope") });
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    await submitNewPassword();
    await screen.findByRole("heading", { name: /finish signing out/i });

    // The session hook reports `recovery` even though a real session exists,
    // which is what makes the Studio layout refuse the shell.
    cleanup();
    const { useStudioSession } = await import("../components/useStudioSession");
    const seen: string[] = [];
    function Probe() {
      seen.push(useStudioSession().status);
      return null;
    }
    render(<Probe />);
    await waitFor(() => expect(seen).toContain("recovery"));
    expect(seen).not.toContain("signed_in");
    for (const fn of Object.values(serverFns)) expect(fn).not.toHaveBeenCalled();
  });

  it("23. the deny-only marker cannot authorize a password update", async () => {
    // Forge the marker without any recovery event at all.
    sessionStorage.setItem(STUDIO_RECOVERY_INCOMPLETE_MARKER_KEY, "1");
    setLocation(RESET_URL + "#type=recovery");
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    vi.resetModules();
    const mod = await import("../components/studio-recovery-mode");
    const { StudioResetPassword } = await import("../components/StudioResetPassword");
    render(<StudioResetPassword />);

    // It denies — a harmless block screen — and never offers the form.
    expect(mod.isStudioRecoveryBlocked()).toBe(true);
    expect(mod.isStudioRecoveryConfirmed()).toBe(false);
    expect(screen.queryByLabelText(/^new password$/i)).toBeNull();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("the marker holds no token, session, email, id or password", () => {
    sessionStorage.setItem(STUDIO_RECOVERY_INCOMPLETE_MARKER_KEY, "1");
    const value = sessionStorage.getItem(STUDIO_RECOVERY_INCOMPLETE_MARKER_KEY) ?? "";
    expect(value).toBe("1");
    expect(value).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
    expect(value).not.toMatch(/@/);
    expect(value).not.toMatch(/eyJ/);
    expect(value.length).toBeLessThan(4);
  });
});

describe("bootstrap boundary", () => {
  it("16/17/18. a full recovery calls no Studio server function", async () => {
    await renderConfirmedRecovery();
    auth.signOut.mockResolvedValue({ error: null });
    auth.getSession.mockResolvedValue({ data: { session: null } });
    await submitNewPassword();
    await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
    for (const fn of Object.values(serverFns)) expect(fn).not.toHaveBeenCalled();
  });

  it("the reset screen imports no Studio server function or bootstrap symbol", () => {
    const source = readCode("src/features/forever-studio/components/StudioResetPassword.tsx");
    expect(source).not.toMatch(/studio\.functions/);
    expect(source).not.toMatch(/maybeBootstrapOwner/);
    expect(source).not.toMatch(/studio_bootstrap_owner/);
    expect(source).not.toMatch(/resolveStudioActor/);
    expect(source).not.toMatch(/StudioDashboard/);
    expect(source).not.toMatch(/StudioShell/);

    const request = readCode("src/features/forever-studio/components/StudioForgotPassword.tsx");
    expect(request).not.toMatch(/studio\.functions/);
    expect(request).not.toMatch(/maybeBootstrapOwner/);
  });

  it("the recovery routes sit outside the membership-protected boundary", () => {
    const reset = readCode("src/routes/studio_.reset-password.tsx");
    const forgot = readCode("src/routes/studio_.forgot-password.tsx");
    expect(reset).toContain('createFileRoute("/studio_/reset-password")');
    expect(forgot).toContain('createFileRoute("/studio_/forgot-password")');
    expect(reset).not.toMatch(/StudioShell/);
    expect(forgot).not.toMatch(/StudioShell/);
    expect(reset).not.toMatch(/beforeLoad/);
    expect(reset).not.toMatch(/requireMembership|assertOwner|assertMember/);
  });

  it("21. the Studio layout blocks recovery but a normal session still reaches the shell", async () => {
    const source = readCode("src/routes/studio.tsx");
    expect(source).toMatch(/session\.status === "recovery"/);
    expect(source).toMatch(/StudioRecoveryInterstitial/);
    expect(source).toMatch(/<StudioShell email=\{session\.email\}>/);
    expect(source).toMatch(/<Outlet \/>/);

    // Behaviourally: with no recovery of any kind, an ordinary session is
    // reported as signed_in, which is the path that mounts the dashboard and
    // lets the existing canonical bootstrap run on a fresh sign-in.
    setLocation("https://forever.phuketre22.workers.dev/studio");
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    vi.resetModules();
    const { useStudioSession } = await import("../components/useStudioSession");
    const seen: string[] = [];
    function Probe() {
      seen.push(useStudioSession().status);
      return null;
    }
    render(<Probe />);
    await waitFor(() => expect(seen).toContain("signed_in"));
    expect(seen).not.toContain("recovery");
  });
});

// ---------------------------------------------------------------------------
// Request surface, redirect, and the rest of the original contract
// ---------------------------------------------------------------------------

describe("password request", () => {
  async function renderRequest() {
    vi.resetModules();
    const { StudioForgotPassword } = await import("../components/StudioForgotPassword");
    render(<StudioForgotPassword />);
  }
  async function submitEmail(value: string) {
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
    await waitFor(() => expect(auth.resetPasswordForEmail).toHaveBeenCalled());
  }

  it("calls resetPasswordForEmail with the entered address", async () => {
    await renderRequest();
    await submitEmail("publisher@example.test");
    expect(auth.resetPasswordForEmail).toHaveBeenCalledTimes(1);
    expect(auth.resetPasswordForEmail.mock.calls[0][0]).toBe("publisher@example.test");
  });

  it("17. query parameters cannot control redirectTo", async () => {
    setLocation(
      "https://forever.phuketre22.workers.dev/studio/forgot-password" +
        "?redirectTo=https://evil.example/steal&next=https://evil.example&redirect_to=//evil.example",
    );
    await renderRequest();
    await submitEmail("publisher@example.test");
    const options = auth.resetPasswordForEmail.mock.calls[0][1] as { redirectTo: string };
    expect(options.redirectTo).toBe(RESET_URL);
    expect(options.redirectTo).not.toContain("evil.example");
    const parsed = new URL(options.redirectTo);
    expect(parsed.origin).toBe("https://forever.phuketre22.workers.dev");
    expect(parsed.pathname).toBe(STUDIO_RESET_PASSWORD_PATH);
    expect(parsed.search).toBe("");
    expect(parsed.hash).toBe("");
  });

  it("unknown and known addresses produce the identical generic result", async () => {
    auth.resetPasswordForEmail.mockResolvedValueOnce({ error: null });
    await renderRequest();
    await submitEmail("publisher@example.test");
    const knownText = (await screen.findByRole("status")).textContent ?? "";
    cleanup();

    auth.resetPasswordForEmail.mockResolvedValueOnce({
      error: new Error("User not found for email"),
    });
    await renderRequest();
    await submitEmail("nobody@example.test");
    const unknownText = (await screen.findByRole("status")).textContent ?? "";

    expect(unknownText).toBe(knownText);
    expect(knownText).toBe(STUDIO_RECOVERY_GENERIC_NOTICE);
    expect(knownText).not.toMatch(/not found|no account|does not exist|owner|member|confirmed/i);
  });

  it("rate limiting and transport failure stay safe", async () => {
    auth.resetPasswordForEmail.mockResolvedValueOnce({
      error: new Error("Request rate limit reached (429)"),
    });
    await renderRequest();
    await submitEmail("publisher@example.test");
    let alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/too many attempts/i);
    expect(alert.textContent).not.toMatch(/account|exists|owner|member/i);
    cleanup();

    auth.resetPasswordForEmail.mockRejectedValueOnce(new Error("network unreachable"));
    await renderRequest();
    await submitEmail("publisher@example.test");
    alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/account|exists|supabase|abtvsrcnfwlbawvrjeed/i);
    expect(isStudioRecoveryRateLimited(new Error("429 Too Many Requests"))).toBe(true);
  });
});

describe("password handling", () => {
  it("13b. mismatched passwords block updateUser entirely", async () => {
    await renderConfirmedRecovery();
    fireEvent.change(await screen.findByLabelText(/^new password$/i), {
      target: { value: FIXTURE_PASSWORD },
    });
    fireEvent.change(screen.getByLabelText(/^confirm new password$/i), {
      target: { value: FIXTURE_PASSWORD + "-different" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save new password/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/do not match/i);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("a too-short password blocks updateUser", async () => {
    await renderConfirmedRecovery();
    await submitNewPassword("short");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(new RegExp(`at least ${STUDIO_PASSWORD_MIN_LENGTH}`, "i"));
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("a valid matching password calls updateUser exactly once", async () => {
    await renderConfirmedRecovery();
    auth.getSession.mockResolvedValue({ data: { session: null } });
    await submitNewPassword();
    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledTimes(1));
    expect(auth.updateUser.mock.calls[0][0]).toEqual({ password: FIXTURE_PASSWORD });
  });

  it("22. no password, token or session is logged or left in the document", async () => {
    const spies = (["log", "error", "warn", "info", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => void 0),
    );
    await renderConfirmedRecovery();
    auth.updateUser.mockResolvedValueOnce({ error: new Error("Password is too weak") });
    await submitNewPassword();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain(FIXTURE_PASSWORD);
    // The value stays in the password FIELD so the publisher can correct a
    // server-rejected password without retyping — that is the field's job. What
    // must never happen is the value being echoed into rendered text, an error
    // message, or a log.
    expect(document.body.textContent ?? "").not.toContain(FIXTURE_PASSWORD);
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        const text = JSON.stringify(call);
        expect(text).not.toContain(FIXTURE_PASSWORD);
        expect(text).not.toContain("access_token");
        expect(text).not.toContain("user-fixture");
      }
      spy.mockRestore();
    }
    expect(studioRecoveryErrorMessage(new Error(FIXTURE_PASSWORD))).not.toContain(FIXTURE_PASSWORD);
  });

  it("no password value survives in the document after a confirmed success", async () => {
    await renderConfirmedRecovery();
    auth.signOut.mockResolvedValue({ error: null });
    auth.getSession.mockResolvedValue({ data: { session: null } });
    await submitNewPassword();
    await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByLabelText(/^new password$/i)).toBeNull());
    for (const input of Array.from(document.querySelectorAll("input"))) {
      expect(input.value).not.toBe(FIXTURE_PASSWORD);
    }
    expect(document.body.innerHTML).not.toContain(FIXTURE_PASSWORD);
  });
});

describe("sign-in surface", () => {
  it("StudioLogin offers Forgot password, pointing at the request screen", async () => {
    vi.resetModules();
    const { StudioLogin } = await import("../components/StudioLogin");
    render(<StudioLogin />);
    expect(screen.getByRole("link", { name: /forgot password/i })).toHaveAttribute(
      "href",
      STUDIO_FORGOT_PASSWORD_PATH,
    );
  });

  it("24. no sign-up, OTP, OAuth or alternative login is introduced", async () => {
    for (const path of [
      "src/features/forever-studio/components/StudioLogin.tsx",
      "src/features/forever-studio/components/StudioForgotPassword.tsx",
      "src/features/forever-studio/components/StudioResetPassword.tsx",
    ]) {
      const code = readCode(path);
      expect(code, path).not.toMatch(/signUp\s*\(/);
      expect(code, path).not.toMatch(
        /signInWithOtp|signInWithOAuth|signInWithIdToken|signInWithSSO/,
      );
      expect(code, path).not.toMatch(/\bverifyOtp\b/);
      expect(code, path).not.toMatch(/admin\./);
    }
    const signUpish = /sign ?up|create account|create an account|register/i;
    vi.resetModules();
    const { StudioLogin } = await import("../components/StudioLogin");
    render(<StudioLogin />);
    expect(screen.queryByRole("button", { name: signUpish })).toBeNull();
    expect(screen.queryByRole("link", { name: signUpish })).toBeNull();
  });

  it("25. existing password sign-in remains functional", async () => {
    vi.resetModules();
    const { StudioLogin } = await import("../components/StudioLogin");
    render(<StudioLogin />);
    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: "publisher@example.test" },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: FIXTURE_PASSWORD } });
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    await waitFor(() => expect(auth.signInWithPassword).toHaveBeenCalledTimes(1));
    expect(auth.signInWithPassword.mock.calls[0][0]).toEqual({
      email: "publisher@example.test",
      password: FIXTURE_PASSWORD,
    });
  });
});

describe("exposure boundary", () => {
  it("both recovery routes are noindex, nofollow", () => {
    for (const path of [
      "src/routes/studio_.reset-password.tsx",
      "src/routes/studio_.forgot-password.tsx",
    ]) {
      expect(readCode(path)).toMatch(/name: "robots", content: "noindex, nofollow"/);
    }
  });

  it("recovery routes are absent from the sitemap and public navigation", async () => {
    const sitemap = readCode("src/lib/sitemap.ts");
    expect(sitemap).not.toMatch(/forgot-password|reset-password/);
    expect(sitemap).not.toMatch(/\/studio/);
    const { SITEMAP_STATIC_ENTRIES } = await import("@/lib/sitemap");
    for (const entry of SITEMAP_STATIC_ENTRIES) {
      expect(entry.path).not.toMatch(/studio|password/);
    }
    for (const path of ["src/components/layout/Header.tsx", "src/components/layout/Footer.tsx"]) {
      expect(readCode(path)).not.toMatch(/forgot-password|reset-password/);
    }
  });

  it("recovery sources carry no Owner email, UUID, service-role key or persisted token", () => {
    for (const path of [
      "src/features/forever-studio/studio-recovery-contract.ts",
      "src/features/forever-studio/components/studio-recovery-mode.ts",
      "src/features/forever-studio/components/StudioForgotPassword.tsx",
      "src/features/forever-studio/components/StudioResetPassword.tsx",
      "src/features/forever-studio/components/StudioLogin.tsx",
      "src/routes/studio_.forgot-password.tsx",
      "src/routes/studio_.reset-password.tsx",
    ]) {
      const source = readCode(path);
      expect(source, path).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
      expect(source, path).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      );
      expect(source, path).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|sb_secret_|service_role/);
      expect(source, path).not.toMatch(/abtvsrcnfwlbawvrjeed|garjibjhlzeljsnpzisu/);
      expect(source, path).not.toMatch(/localStorage|document\.cookie/);
      expect(source, path).not.toMatch(/access_token|refresh_token/);
      expect(source, path).not.toMatch(/console\.(log|info|debug|warn|error)/);
    }
  });

  it("the only persisted value is the deny-only marker", () => {
    const mode = readCode("src/features/forever-studio/components/studio-recovery-mode.ts");
    expect(mode).toMatch(/sessionStorage/);
    expect(mode).not.toMatch(/localStorage/);
    expect(mode).not.toMatch(/get\(["']access_token["']\)|get\(["']token["']\)/);
    // Only the marker constants are ever written.
    const writes = mode.match(/sessionStorage\.setItem\([^)]*\)/g) ?? [];
    expect(writes.length).toBe(1);
    expect(writes[0]).toContain("STUDIO_RECOVERY_INCOMPLETE_MARKER_KEY");
    expect(writes[0]).toContain("STUDIO_RECOVERY_INCOMPLETE_MARKER_VALUE");
  });
});

describe("recovery contract", () => {
  it("builds the redirect from an origin and discards everything else", () => {
    expect(
      studioResetPasswordRedirectUrl("https://forever.phuketre22.workers.dev/anything?a=1#b"),
    ).toBe(RESET_URL);
    expect(studioResetPasswordRedirectUrl("http://localhost:3000")).toBe(
      "http://localhost:3000" + STUDIO_RESET_PASSWORD_PATH,
    );
  });

  it("refuses an insecure or unparseable origin", () => {
    expect(() => studioResetPasswordRedirectUrl("http://evil.example")).toThrow(/insecure_origin/);
    expect(() => studioResetPasswordRedirectUrl("not a url")).toThrow(/origin_invalid/);
  });

  it("validates passwords without echoing them", () => {
    expect(validateStudioPassword("", "")).toBe("empty");
    expect(validateStudioPassword("short", "short")).toBe("too_short");
    expect(validateStudioPassword(FIXTURE_PASSWORD, "other-value-entirely")).toBe("mismatch");
    expect(validateStudioPassword(FIXTURE_PASSWORD, FIXTURE_PASSWORD)).toBeNull();
    for (const problem of ["empty", "too_short", "mismatch"] as const) {
      expect(studioPasswordProblemMessage(problem)).not.toContain(FIXTURE_PASSWORD);
    }
  });

  it("maps provider failures to safe messages that leak no infrastructure", () => {
    for (const raw of [
      new Error("JWT expired"),
      new Error("Token has expired or is invalid"),
      new Error("rate limit"),
      new Error("fetch failed"),
      new Error('relation "studio_members" does not exist'),
      new Error("project abtvsrcnfwlbawvrjeed unavailable"),
    ]) {
      const message = studioRecoveryErrorMessage(raw);
      expect(message).not.toMatch(/abtvsrcnfwlbawvrjeed|studio_members|relation|jwt|token/i);
      expect(message.length).toBeGreaterThan(0);
    }
  });
});
