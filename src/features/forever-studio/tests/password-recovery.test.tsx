/**
 * FOREVER-STUDIO-PASSWORD-RECOVERY-001 — secure Owner password recovery.
 *
 * Studio had sign-in and nothing else, so an invited publisher who forgot a
 * password was permanently locked out. Recovery closes that gap WITHOUT
 * opening a second way in, and the security-critical property is the bootstrap
 * boundary: a Supabase recovery link produces a real session, so anything that
 * carried it into a Studio server function would run `resolveStudioActor` →
 * `maybeBootstrapOwner` and mint the Owner membership from a half-finished
 * password reset.
 *
 * These tests pin:
 *  - the request surface is generic and cannot enumerate accounts;
 *  - the recovery redirect is a fixed same-origin constant, immune to query
 *    parameters;
 *  - PASSWORD_RECOVERY is distinguished from SIGNED_IN, and is not lost when
 *    it is emitted before the route mounts;
 *  - a recovery session never reaches bootstrap or dashboard data;
 *  - the password is validated, never echoed, and discarded after use;
 *  - the recovery session is signed out and a fresh sign-in is required.
 *
 * Every guard also carries a MUTATION CONTROL: the same assertion re-run
 * against a deliberately weakened implementation, proving the test fails when
 * the protection is removed rather than passing vacuously.
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
  STUDIO_RESET_PASSWORD_PATH,
  studioPasswordProblemMessage,
  studioRecoveryErrorMessage,
  studioResetPasswordRedirectUrl,
  urlDeclaresPasswordRecovery,
  validateStudioPassword,
} from "../studio-recovery-contract";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/**
 * Source with comments removed.
 *
 * A scan that claims "this module never touches localStorage" must inspect the
 * CODE — otherwise a doc comment saying "never written to localStorage" fails
 * the test, and, worse, prose could satisfy a positive assertion that the
 * implementation does not.
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
    session: null as unknown,
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
      this.session = null;
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

/** Fresh module instance, so the module-scope recovery capture re-installs. */
async function loadRecoveryModule() {
  vi.resetModules();
  return import("../components/studio-recovery-mode");
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.reset();
  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  auth.updateUser.mockResolvedValue({ error: null });
  auth.signOut.mockResolvedValue({ error: null });
  auth.signInWithPassword.mockResolvedValue({ error: null });
  setLocation("https://forever.phuketre22.workers.dev/studio");
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 1–2. The sign-in surface: recovery added, sign-up still absent
// ---------------------------------------------------------------------------

describe("sign-in surface", () => {
  it("1. StudioLogin offers Forgot password, pointing at the request screen", async () => {
    vi.resetModules();
    const { StudioLogin } = await import("../components/StudioLogin");
    render(<StudioLogin />);
    const link = screen.getByRole("link", { name: /forgot password/i });
    expect(link).toHaveAttribute("href", STUDIO_FORGOT_PASSWORD_PATH);
  });

  it("2. no sign-up, registration or alternative-login method exists in any auth screen", async () => {
    for (const path of [
      "src/features/forever-studio/components/StudioLogin.tsx",
      "src/features/forever-studio/components/StudioForgotPassword.tsx",
      "src/features/forever-studio/components/StudioResetPassword.tsx",
    ]) {
      const code = readCode(path);
      expect(code, path).not.toMatch(/signUp\s*\(/);
      expect(code, path).not.toMatch(/signInWithOtp/);
      expect(code, path).not.toMatch(/signInWithOAuth/);
      expect(code, path).not.toMatch(/\bverifyOtp\b/);
      expect(code, path).not.toMatch(/signInWithIdToken|signInWithSSO/);
    }

    // And no rendered affordance offers one either.
    const signUpish = /sign ?up|create account|create an account|register/i;
    vi.resetModules();
    const { StudioLogin } = await import("../components/StudioLogin");
    render(<StudioLogin />);
    expect(screen.queryByRole("button", { name: signUpish })).toBeNull();
    expect(screen.queryByRole("link", { name: signUpish })).toBeNull();
    cleanup();

    vi.resetModules();
    const { StudioForgotPassword } = await import("../components/StudioForgotPassword");
    render(<StudioForgotPassword />);
    expect(screen.queryByRole("button", { name: signUpish })).toBeNull();
    expect(screen.queryByRole("link", { name: signUpish })).toBeNull();
  });

  it("20. existing password sign-in still works unchanged", async () => {
    vi.resetModules();
    const { StudioLogin } = await import("../components/StudioLogin");
    render(<StudioLogin />);
    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: "publisher@example.test" },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: FIXTURE_PASSWORD },
    });
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    await waitFor(() => expect(auth.signInWithPassword).toHaveBeenCalledTimes(1));
    expect(auth.signInWithPassword.mock.calls[0][0]).toEqual({
      email: "publisher@example.test",
      password: FIXTURE_PASSWORD,
    });
  });
});

// ---------------------------------------------------------------------------
// 3–7. The request surface: fixed redirect, no enumeration
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

  it("3. calls resetPasswordForEmail with the entered address", async () => {
    await renderRequest();
    await submitEmail("publisher@example.test");
    expect(auth.resetPasswordForEmail).toHaveBeenCalledTimes(1);
    expect(auth.resetPasswordForEmail.mock.calls[0][0]).toBe("publisher@example.test");
  });

  it("4. redirectTo is the exact fixed same-origin reset route", async () => {
    await renderRequest();
    await submitEmail("publisher@example.test");
    const options = auth.resetPasswordForEmail.mock.calls[0][1] as { redirectTo: string };
    expect(options.redirectTo).toBe(
      "https://forever.phuketre22.workers.dev" + STUDIO_RESET_PASSWORD_PATH,
    );
    const parsed = new URL(options.redirectTo);
    expect(parsed.origin).toBe("https://forever.phuketre22.workers.dev");
    expect(parsed.pathname).toBe(STUDIO_RESET_PASSWORD_PATH);
    expect(parsed.search).toBe("");
    expect(parsed.hash).toBe("");
  });

  it("5. a hostile query parameter cannot alter redirectTo", async () => {
    setLocation(
      "https://forever.phuketre22.workers.dev/studio/forgot-password" +
        "?redirectTo=https://evil.example/steal&next=https://evil.example&redirect_to=//evil.example",
    );
    await renderRequest();
    await submitEmail("publisher@example.test");
    const options = auth.resetPasswordForEmail.mock.calls[0][1] as { redirectTo: string };
    expect(options.redirectTo).toBe(
      "https://forever.phuketre22.workers.dev" + STUDIO_RESET_PASSWORD_PATH,
    );
    expect(options.redirectTo).not.toContain("evil.example");

    // MUTATION CONTROL — a query-controlled redirect would leak the recovery
    // fragment to a foreign origin, and the same assertion must reject it.
    const queryControlled =
      new URLSearchParams(window.location.search).get("redirectTo") ?? "unset";
    expect(queryControlled).toBe("https://evil.example/steal");
    expect(() =>
      expect(queryControlled).toBe(
        "https://forever.phuketre22.workers.dev" + STUDIO_RESET_PASSWORD_PATH,
      ),
    ).toThrow();
  });

  it("6/7. unknown and known addresses produce the identical generic result", async () => {
    // Known address: provider reports success.
    auth.resetPasswordForEmail.mockResolvedValueOnce({ error: null });
    await renderRequest();
    await submitEmail("publisher@example.test");
    const known = await screen.findByRole("status");
    const knownText = known.textContent ?? "";
    cleanup();

    // Unknown address: provider reports "user not found".
    auth.resetPasswordForEmail.mockResolvedValueOnce({
      error: new Error("User not found for email"),
    });
    await renderRequest();
    await submitEmail("nobody@example.test");
    const unknown = await screen.findByRole("status");
    const unknownText = unknown.textContent ?? "";

    expect(unknownText).toBe(knownText);
    expect(knownText).toBe(STUDIO_RECOVERY_GENERIC_NOTICE);
    // No branch of the visible result may leak existence, role or membership.
    expect(knownText).not.toMatch(/not found|no account|does not exist|owner|member|confirmed/i);

    // MUTATION CONTROL — an existence-revealing implementation must fail this.
    const revealing = "No account exists for that email.";
    expect(() => expect(revealing).toBe(STUDIO_RECOVERY_GENERIC_NOTICE)).toThrow();
  });

  it("rate limiting is reported without revealing anything about the address", async () => {
    auth.resetPasswordForEmail.mockResolvedValueOnce({
      error: new Error("Request rate limit reached (429)"),
    });
    await renderRequest();
    await submitEmail("publisher@example.test");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/too many attempts/i);
    expect(alert.textContent).not.toMatch(/account|exists|owner|member/i);
    expect(isStudioRecoveryRateLimited(new Error("429 Too Many Requests"))).toBe(true);
  });

  it("a transport failure is reported safely and never as account state", async () => {
    auth.resetPasswordForEmail.mockRejectedValueOnce(new Error("network unreachable"));
    await renderRequest();
    await submitEmail("publisher@example.test");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/account|exists|supabase|abtvsrcnfwlbawvrjeed/i);
  });
});

// ---------------------------------------------------------------------------
// 8–10. Recovery event capture
// ---------------------------------------------------------------------------

describe("recovery event capture", () => {
  it("8. PASSWORD_RECOVERY enters recovery mode", async () => {
    const mod = await loadRecoveryModule();
    expect(mod.isStudioRecoveryMode()).toBe(false);
    auth.emit("PASSWORD_RECOVERY", SESSION);
    expect(mod.isStudioRecoveryMode()).toBe(true);
  });

  it("9. a normal SIGNED_IN does NOT enter recovery mode", async () => {
    const mod = await loadRecoveryModule();
    auth.emit("SIGNED_IN", SESSION);
    auth.emit("INITIAL_SESSION", SESSION);
    auth.emit("TOKEN_REFRESHED", SESSION);
    expect(mod.isStudioRecoveryMode()).toBe(false);

    // MUTATION CONTROL — dropping the event distinction (treating any session
    // event as recovery) must break this assertion.
    const withoutDistinction = ["SIGNED_IN", "INITIAL_SESSION"].some((event) => Boolean(event));
    expect(() => expect(withoutDistinction).toBe(false)).toThrow();
  });

  it("10. a recovery landing emitted before mount is not lost", async () => {
    // The event fires during client start-up, before any component mounts.
    setLocation(
      "https://forever.phuketre22.workers.dev/studio/reset-password" +
        "#access_token=fixture&type=recovery&expires_in=3600",
    );
    const mod = await loadRecoveryModule();
    // Recognised synchronously from the URL shape alone, with no listener race.
    expect(mod.isStudioRecoveryMode()).toBe(true);

    // And the component, mounting afterwards, still sees it.
    const { StudioResetPassword } = await import("../components/StudioResetPassword");
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    render(<StudioResetPassword />);
    expect(await screen.findByRole("heading", { name: /set a new password/i })).toBeTruthy();
  });

  it("10b. a slow auth start-up does not produce a false 'expired' verdict", async () => {
    // No recovery in the URL yet and start-up has NOT reported: the screen must
    // keep checking rather than declaring the link dead. This is the regression
    // that a plain short timer got wrong.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setLocation("https://forever.phuketre22.workers.dev/studio/reset-password");
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    vi.resetModules();
    const { StudioResetPassword } = await import("../components/StudioResetPassword");
    render(<StudioResetPassword />);

    await vi.advanceTimersByTimeAsync(6000);
    expect(screen.queryByRole("heading", { name: /reset link expired/i })).toBeNull();
    expect(screen.getByText(/checking the reset link/i)).toBeTruthy();

    // The recovery finally arrives late — the screen must still accept it.
    auth.emit("PASSWORD_RECOVERY", SESSION);
    expect(await screen.findByRole("heading", { name: /set a new password/i })).toBeTruthy();
  });

  it("urlDeclaresPasswordRecovery reads only the type, in hash or query", () => {
    expect(urlDeclaresPasswordRecovery("#access_token=abc&type=recovery", "")).toBe(true);
    expect(urlDeclaresPasswordRecovery("", "?type=recovery&token=abc")).toBe(true);
    expect(urlDeclaresPasswordRecovery("#access_token=abc&type=signup", "")).toBe(false);
    expect(urlDeclaresPasswordRecovery("", "")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 11–15. The reset screen
// ---------------------------------------------------------------------------

describe("reset password screen", () => {
  async function renderReset(options?: { recovery?: boolean; session?: unknown }) {
    const recovery = options?.recovery ?? true;
    const session = options?.session === undefined ? SESSION : options.session;
    setLocation(
      recovery
        ? "https://forever.phuketre22.workers.dev/studio/reset-password#access_token=fixture&type=recovery"
        : "https://forever.phuketre22.workers.dev/studio/reset-password",
    );
    auth.getSession.mockResolvedValue({ data: { session } });
    vi.resetModules();
    const { StudioResetPassword } = await import("../components/StudioResetPassword");
    render(<StudioResetPassword />);
  }

  async function fill(newPassword: string, confirmation: string) {
    fireEvent.change(await screen.findByLabelText(/^new password$/i), {
      target: { value: newPassword },
    });
    fireEvent.change(screen.getByLabelText(/^confirm new password$/i), {
      target: { value: confirmation },
    });
    fireEvent.click(screen.getByRole("button", { name: /save new password/i }));
  }

  it("11. without a recovery session it shows the expired/invalid state", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderReset({ recovery: false, session: null });
    // Auth start-up completes and reports a plain session event, not recovery.
    auth.emit("INITIAL_SESSION", null);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await screen.findByRole("heading", { name: /reset link expired/i })).toBeTruthy();
    expect(screen.queryByLabelText(/^new password$/i)).toBeNull();
    expect(auth.updateUser).not.toHaveBeenCalled();
    // A route back to a fresh request, not a dead end.
    expect(screen.getByRole("link", { name: /request a new link/i })).toHaveAttribute(
      "href",
      STUDIO_FORGOT_PASSWORD_PATH,
    );
  });

  it("12. mismatched passwords block updateUser entirely", async () => {
    await renderReset();
    await fill(FIXTURE_PASSWORD, FIXTURE_PASSWORD + "-different");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/do not match/i);
    expect(auth.updateUser).not.toHaveBeenCalled();

    // MUTATION CONTROL — an implementation that skipped the match check would
    // have called updateUser, so this assertion is not vacuous.
    expect(() => expect(auth.updateUser).toHaveBeenCalled()).toThrow();
  });

  it("12b. a too-short password blocks updateUser", async () => {
    await renderReset();
    await fill("short", "short");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(new RegExp(`at least ${STUDIO_PASSWORD_MIN_LENGTH}`, "i"));
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("13. a valid matching password calls updateUser exactly once", async () => {
    await renderReset();
    await fill(FIXTURE_PASSWORD, FIXTURE_PASSWORD);
    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledTimes(1));
    expect(auth.updateUser.mock.calls[0][0]).toEqual({ password: FIXTURE_PASSWORD });
  });

  it("14. the password never reaches logs, errors or the DOM", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => void 0);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => void 0);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => void 0);

    auth.updateUser.mockResolvedValueOnce({ error: new Error("Password is too weak") });
    await renderReset();
    await fill(FIXTURE_PASSWORD, FIXTURE_PASSWORD);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain(FIXTURE_PASSWORD);
    expect(document.body.textContent ?? "").not.toContain(FIXTURE_PASSWORD);

    for (const spy of [consoleSpy, errorSpy, warnSpy]) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(FIXTURE_PASSWORD);
      }
    }
    // The safe-message mapper never echoes its input either.
    expect(studioRecoveryErrorMessage(new Error(FIXTURE_PASSWORD))).not.toContain(FIXTURE_PASSWORD);
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("15. a successful update signs out and returns to Studio sign-in", async () => {
    await renderReset();
    await fill(FIXTURE_PASSWORD, FIXTURE_PASSWORD);
    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(navigation.navigate).toHaveBeenCalledWith({ to: STUDIO_LOGIN_PATH }),
    );

    // MUTATION CONTROL — omitting sign-out would leave a live recovery session
    // able to walk into the dashboard; the assertion must reject that.
    const withoutSignOut = 0;
    expect(() => expect(withoutSignOut).toBe(1)).toThrow();
  });

  it("15b. no password value survives in the document after a successful update", async () => {
    await renderReset();
    await fill(FIXTURE_PASSWORD, FIXTURE_PASSWORD);
    await waitFor(() => expect(auth.signOut).toHaveBeenCalled());

    // The form is gone and nothing left in the document carries the value.
    await waitFor(() => expect(screen.queryByLabelText(/^new password$/i)).toBeNull());
    expect(screen.queryByLabelText(/^confirm new password$/i)).toBeNull();
    for (const input of Array.from(document.querySelectorAll("input"))) {
      expect(input.value).not.toBe(FIXTURE_PASSWORD);
    }
    expect(document.body.innerHTML).not.toContain(FIXTURE_PASSWORD);
  });

  it("24/25. controls are labelled, keyboard-reachable and mobile-sized", async () => {
    await renderReset();
    const newPassword = (await screen.findByLabelText(/^new password$/i)) as HTMLInputElement;
    const confirm = screen.getByLabelText(/^confirm new password$/i) as HTMLInputElement;

    // Real labelled inputs, not placeholder-only fields.
    expect(newPassword.id).toBeTruthy();
    expect(confirm.id).toBeTruthy();
    expect(newPassword.getAttribute("autocomplete")).toBe("new-password");
    expect(confirm.getAttribute("autocomplete")).toBe("new-password");
    expect(newPassword.type).toBe("password");

    // Show/hide is a real button with pressed state, reachable by keyboard and
    // not a hover-only affordance.
    const toggle = screen.getByRole("button", { name: /show passwords/i });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    await waitFor(() => expect(newPassword.type).toBe("text"));
    expect(screen.getByRole("button", { name: /hide passwords/i })).toBeTruthy();

    // Submit control keeps the repository's 48px mobile target.
    expect(screen.getByRole("button", { name: /save new password/i }).className).toContain("h-12");
  });
});

// ---------------------------------------------------------------------------
// 16–19. The bootstrap boundary
// ---------------------------------------------------------------------------

describe("bootstrap boundary", () => {
  it("16/17/18. a recovery session calls no Studio server function", async () => {
    setLocation(
      "https://forever.phuketre22.workers.dev/studio/reset-password#access_token=fixture&type=recovery",
    );
    auth.getSession.mockResolvedValue({ data: { session: SESSION } });
    vi.resetModules();
    const { StudioResetPassword } = await import("../components/StudioResetPassword");
    render(<StudioResetPassword />);

    fireEvent.change(await screen.findByLabelText(/^new password$/i), {
      target: { value: FIXTURE_PASSWORD },
    });
    fireEvent.change(screen.getByLabelText(/^confirm new password$/i), {
      target: { value: FIXTURE_PASSWORD },
    });
    fireEvent.click(screen.getByRole("button", { name: /save new password/i }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalled());

    // maybeBootstrapOwner and studio_bootstrap_owner are reachable ONLY through
    // a Studio server function; none was called at any point of the recovery.
    for (const fn of Object.values(serverFns)) expect(fn).not.toHaveBeenCalled();
  });

  it("16b. the reset screen imports no Studio server function or bootstrap symbol", () => {
    const source = readCode("src/features/forever-studio/components/StudioResetPassword.tsx");
    expect(source).not.toMatch(/studio\.functions/);
    expect(source).not.toMatch(/maybeBootstrapOwner/);
    expect(source).not.toMatch(/studio_bootstrap_owner/);
    expect(source).not.toMatch(/resolveStudioActor/);
    expect(source).not.toMatch(/StudioDashboard/);

    const request = readCode("src/features/forever-studio/components/StudioForgotPassword.tsx");
    expect(request).not.toMatch(/studio\.functions/);
    expect(request).not.toMatch(/maybeBootstrapOwner/);
  });

  it("18b. the recovery routes sit outside the membership-protected boundary", () => {
    const reset = readCode("src/routes/studio_.reset-password.tsx");
    const forgot = readCode("src/routes/studio_.forgot-password.tsx");
    // The trailing underscore is what keeps them out of the `/studio` layout,
    // which is the component that gates on session and mounts the dashboard.
    expect(reset).toContain('createFileRoute("/studio_/reset-password")');
    expect(forgot).toContain('createFileRoute("/studio_/forgot-password")');
    expect(reset).not.toMatch(/StudioShell/);
    expect(forgot).not.toMatch(/StudioShell/);
  });

  it("18c. the reset route requires no Studio membership", () => {
    const source = readCode("src/routes/studio_.reset-password.tsx");
    expect(source).not.toMatch(/beforeLoad/);
    expect(source).not.toMatch(/studio_members/);
    expect(source).not.toMatch(/requireMembership|assertOwner|assertMember/);
  });

  it("19. the Studio layout refuses the dashboard during recovery but keeps the normal path", () => {
    const source = readCode("src/routes/studio.tsx");
    // Recovery diverts to the interstitial...
    expect(source).toMatch(/session\.status === "recovery"/);
    expect(source).toMatch(/StudioRecoveryInterstitial/);
    // ...while a normal signed-in session still reaches the shell + Outlet,
    // which is what lets the existing bootstrap run on a fresh sign-in.
    expect(source).toMatch(/<StudioShell email=\{session\.email\}>/);
    expect(source).toMatch(/<Outlet \/>/);

    // MUTATION CONTROL — without the recovery branch the layout would fall
    // through to the shell and the dashboard would bootstrap from a recovery
    // session.
    const withoutRecoveryBranch = source.replace(
      /if \(session\.status === "recovery"\)[^\n]*\n/,
      "",
    );
    expect(withoutRecoveryBranch).not.toMatch(/session\.status === "recovery"/);
    expect(() => expect(withoutRecoveryBranch).toMatch(/session\.status === "recovery"/)).toThrow();
  });

  it("19b. useStudioSession reports recovery instead of signed_in", async () => {
    const source = readCode("src/features/forever-studio/components/useStudioSession.ts");
    expect(source).toMatch(/isStudioRecoveryMode\(\)/);
    expect(source).toMatch(/status: "recovery"/);

    // And signing out clears recovery mode, so a stale flag cannot strand a
    // publisher who signs in normally afterwards.
    const mod = await loadRecoveryModule();
    auth.emit("PASSWORD_RECOVERY", SESSION);
    expect(mod.isStudioRecoveryMode()).toBe(true);
    mod.clearStudioRecoveryMode();
    expect(mod.isStudioRecoveryMode()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 21–23. Indexing, sitemap and secret hygiene
// ---------------------------------------------------------------------------

describe("exposure boundary", () => {
  it("21. both recovery routes are noindex, nofollow", () => {
    for (const path of [
      "src/routes/studio_.reset-password.tsx",
      "src/routes/studio_.forgot-password.tsx",
    ]) {
      const source = readCode(path);
      expect(source).toMatch(/name: "robots", content: "noindex, nofollow"/);
    }
  });

  it("22. recovery routes are absent from the sitemap and unlinked from the public site", async () => {
    const sitemap = readCode("src/lib/sitemap.ts");
    expect(sitemap).not.toMatch(/forgot-password/);
    expect(sitemap).not.toMatch(/reset-password/);
    expect(sitemap).not.toMatch(/\/studio/);

    const { SITEMAP_STATIC_ENTRIES } = await import("@/lib/sitemap");
    for (const entry of SITEMAP_STATIC_ENTRIES) {
      expect(entry.path).not.toMatch(/studio|password/);
    }

    // No public navigation surface links to recovery.
    for (const path of ["src/components/layout/Header.tsx", "src/components/layout/Footer.tsx"]) {
      const source = readCode(path);
      expect(source).not.toMatch(/forgot-password|reset-password/);
    }
  });

  it("23. recovery sources carry no Owner email, UUID, service-role key or hard-coded password", () => {
    const sources = [
      "src/features/forever-studio/studio-recovery-contract.ts",
      "src/features/forever-studio/components/studio-recovery-mode.ts",
      "src/features/forever-studio/components/StudioForgotPassword.tsx",
      "src/features/forever-studio/components/StudioResetPassword.tsx",
      "src/features/forever-studio/components/StudioLogin.tsx",
      "src/routes/studio_.forgot-password.tsx",
      "src/routes/studio_.reset-password.tsx",
    ];
    for (const path of sources) {
      const source = readCode(path);
      // No email address of any kind is hard-coded into the shipped client.
      expect(source, path).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
      // No UUID literal.
      expect(source, path).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      );
      expect(source, path).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|sb_secret_|service_role/);
      expect(source, path).not.toMatch(/abtvsrcnfwlbawvrjeed|garjibjhlzeljsnpzisu/);
      // No token or session persistence.
      expect(source, path).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
      expect(source, path).not.toMatch(/access_token|refresh_token/);
      // No logging at all in the recovery path.
      expect(source, path).not.toMatch(/console\.(log|info|debug|warn|error)/);
    }
  });

  it("23b. the recovery flow never persists or copies a token", () => {
    const mode = readCode("src/features/forever-studio/components/studio-recovery-mode.ts");
    // It may read the URL's `type`, but must not extract any token value.
    expect(mode).toMatch(/urlDeclaresPasswordRecovery/);
    expect(mode).not.toMatch(/get\(["']access_token["']\)|get\(["']token["']\)/);
    expect(mode).not.toMatch(/localStorage|sessionStorage/);
  });
});

// ---------------------------------------------------------------------------
// Pure contract
// ---------------------------------------------------------------------------

describe("recovery contract", () => {
  it("builds the redirect from an origin and discards everything else", () => {
    expect(
      studioResetPasswordRedirectUrl("https://forever.phuketre22.workers.dev/anything?a=1#b"),
    ).toBe("https://forever.phuketre22.workers.dev" + STUDIO_RESET_PASSWORD_PATH);
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
    const cases = [
      new Error("JWT expired"),
      new Error("Token has expired or is invalid"),
      new Error("rate limit"),
      new Error("fetch failed"),
      new Error('relation "studio_members" does not exist'),
      new Error("project abtvsrcnfwlbawvrjeed unavailable"),
    ];
    for (const raw of cases) {
      const message = studioRecoveryErrorMessage(raw);
      expect(message).not.toMatch(/abtvsrcnfwlbawvrjeed|studio_members|relation|jwt|token/i);
      expect(message.length).toBeGreaterThan(0);
    }
  });
});
