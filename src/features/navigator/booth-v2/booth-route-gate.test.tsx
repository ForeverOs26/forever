/**
 * Booth Mode 2.0 access-gate tests — AUTHENTICATION AND AUTHORIZATION.
 *
 * Deployment enablement is no longer this component's job and is no longer
 * tested here: it moved to the route's `beforeLoad` boundary so that a disabled
 * deployment produces a server-rendered not-found response rather than a page
 * that hides itself after announcing it exists. That behaviour is proven in
 * booth-route-ssr.test.tsx against a REAL server render.
 *
 * What this suite proves is what remains once the route has already confirmed,
 * on the server, that the pilot is enabled:
 *   • a signed-out visitor sees the staff sign-in form, and there is no sign-up
 *     path;
 *   • a signed-in account is decided by the same gated endpoint every other
 *     Booth call uses, and ANY refusal renders the ordinary not-found boundary,
 *     so an account without the Booth capability cannot tell the pilot exists;
 *   • the Gate asks the browser for a session but never asks for enablement —
 *     a client-side enablement check would be exactly the defect that was
 *     corrected.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAccess: vi.fn(async () => ({ granted: true as const, hostName: "Host Tester" })),
  getRouteAvailability: vi.fn(async () => ({ available: true })),
  getSession: vi.fn(async () => ({ data: { session: null as unknown } })),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
}));

vi.mock("./booth-v2.functions", () => ({
  boothV2GetAccess: mocks.getAccess,
  boothV2GetRouteAvailability: mocks.getRouteAvailability,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
      signInWithPassword: vi.fn(async () => ({ error: null })),
    },
  },
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

const notFound = () => screen.findByText(/404 · Page not found/);
const signInForm = () => screen.queryByText("Forever Booth");

beforeEach(() => {
  mocks.getAccess
    .mockReset()
    .mockResolvedValue({ granted: true as const, hostName: "Host Tester" });
  mocks.getRouteAvailability.mockReset().mockResolvedValue({ available: true });
  mocks.getSession.mockReset().mockResolvedValue({ data: { session: null } });
  mocks.onAuthStateChange
    .mockReset()
    .mockReturnValue({ data: { subscription: { unsubscribe: () => {} } } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("a signed-out visitor", () => {
  it("is offered the staff sign-in form", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });

    render(<BoothV2Gate />);

    await screen.findByText("Forever Booth");
    expect(screen.getByLabelText(/Email/)).toBeInTheDocument();
    // There is no sign-up path: accounts come from the staff roster.
    expect(screen.queryByText(/Create an account|Sign up|Register/i)).toBeNull();
  });

  it("is never sent to a gated endpoint", async () => {
    render(<BoothV2Gate />);

    await screen.findByText("Forever Booth");
    expect(mocks.getAccess).not.toHaveBeenCalled();
  });

  it("is treated as signed out when the session read itself fails", async () => {
    mocks.getSession.mockRejectedValue(new Error("storage unavailable"));

    render(<BoothV2Gate />);

    await screen.findByText("Forever Booth");
    expect(mocks.getAccess).not.toHaveBeenCalled();
  });
});

describe("a signed-in visitor", () => {
  beforeEach(() => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "u" } } } });
  });

  it("reaches Booth V2 when the server grants access", async () => {
    mocks.getAccess.mockResolvedValue({ granted: true as const, hostName: "Host Tester" });

    render(<BoothV2Gate />);

    await waitFor(() => expect(screen.getByText(/Booth V2 shell for/)).toBeInTheDocument());
    expect(screen.getByText(/Host Tester/)).toBeInTheDocument();
  });

  it("gets the ordinary not-found boundary when the server refuses", async () => {
    mocks.getAccess.mockRejectedValue(new Error("booth_access_denied"));

    render(<BoothV2Gate />);

    await notFound();
    expect(signInForm()).toBeNull();
  });

  it("fails closed on any refusal, whatever its shape", async () => {
    for (const refusal of [
      new Error("booth_access_denied"),
      new Error("network"),
      { code: "booth_access_denied" },
      undefined,
    ]) {
      mocks.getAccess.mockReset().mockRejectedValue(refusal);
      const view = render(<BoothV2Gate />);
      await notFound();
      expect(signInForm()).toBeNull();
      view.unmount();
    }
  });
});

describe("the Gate never decides enablement itself", () => {
  it("does not call the availability boundary at all", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "u" } } } });

    render(<BoothV2Gate />);

    await waitFor(() => expect(screen.getByText(/Booth V2 shell for/)).toBeInTheDocument());
    // Enablement is a routing decision taken on the server before this
    // component exists; re-asking here would reintroduce the client-only gate.
    expect(mocks.getRouteAvailability).not.toHaveBeenCalled();
  });

  it("re-decides from scratch when the auth state changes", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    render(<BoothV2Gate />);
    await screen.findByText("Forever Booth");

    const [handler] = mocks.onAuthStateChange.mock.calls[0] as unknown as [() => void];
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "u" } } } });
    await act(async () => {
      handler();
    });

    await waitFor(() => expect(screen.getByText(/Booth V2 shell for/)).toBeInTheDocument());
  });
});
