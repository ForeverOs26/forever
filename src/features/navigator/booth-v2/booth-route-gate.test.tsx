/**
 * Booth Mode 2.0 route-gate tests (PR #102 corrective item 9).
 *
 * Proves the default-disabled route is TRUTHFUL: while the deployment has not
 * enabled the pilot, /booth-v2 renders the application's ordinary not-found
 * boundary for EVERY visitor — including a signed-out one — and never shows a
 * Forever Booth sign-in form. Only once the server has confirmed enablement
 * does the sign-in surface exist at all, and only an authorized staff account
 * reaches Booth V2.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRouteAvailability: vi.fn(async () => ({ available: false })),
  getAccess: vi.fn(async () => ({ granted: true as const, hostName: "Host Tester" })),
  getSession: vi.fn(async () => ({ data: { session: null as unknown } })),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
}));

vi.mock("./booth-v2.functions", () => ({
  boothV2GetRouteAvailability: mocks.getRouteAvailability,
  boothV2GetAccess: mocks.getAccess,
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
  mocks.getRouteAvailability.mockReset().mockResolvedValue({ available: false });
  mocks.getAccess
    .mockReset()
    .mockResolvedValue({ granted: true as const, hostName: "Host Tester" });
  mocks.getSession.mockReset().mockResolvedValue({ data: { session: null } });
  mocks.onAuthStateChange
    .mockReset()
    .mockReturnValue({ data: { subscription: { unsubscribe: () => {} } } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("while the pilot is NOT enabled on this deployment", () => {
  it("renders the ordinary not-found boundary to a SIGNED-OUT visitor", async () => {
    mocks.getRouteAvailability.mockResolvedValue({ available: false });
    mocks.getSession.mockResolvedValue({ data: { session: null } });

    render(<BoothV2Gate />);

    await notFound();
    // The decisive assertion: no Forever Booth login form is ever rendered.
    expect(signInForm()).toBeNull();
    expect(screen.queryByLabelText(/Password/)).toBeNull();
  });

  it("never asks the browser for a session before the server has spoken", async () => {
    mocks.getRouteAvailability.mockResolvedValue({ available: false });

    render(<BoothV2Gate />);

    await notFound();
    expect(mocks.getRouteAvailability).toHaveBeenCalled();
    // Enablement is decided first; nothing else is even attempted.
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.getAccess).not.toHaveBeenCalled();
  });

  it("renders the same boundary to a SIGNED-IN visitor", async () => {
    mocks.getRouteAvailability.mockResolvedValue({ available: false });
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "u" } } } });

    render(<BoothV2Gate />);

    await notFound();
    expect(mocks.getAccess).not.toHaveBeenCalled();
  });

  it("fails closed when the availability probe itself fails", async () => {
    mocks.getRouteAvailability.mockRejectedValue(new Error("network"));

    render(<BoothV2Gate />);

    await notFound();
    expect(signInForm()).toBeNull();
  });

  it("fails closed on an unexpected probe shape", async () => {
    mocks.getRouteAvailability.mockResolvedValue({} as { available: boolean });

    render(<BoothV2Gate />);

    await notFound();
    expect(signInForm()).toBeNull();
  });
});

describe("once the pilot IS enabled on this deployment", () => {
  beforeEach(() => {
    mocks.getRouteAvailability.mockResolvedValue({ available: true });
  });

  it("offers the staff sign-in form to a signed-out visitor", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });

    render(<BoothV2Gate />);

    await screen.findByText("Forever Booth");
    expect(screen.getByLabelText(/Email/)).toBeInTheDocument();
    // There is no sign-up path: accounts come from the staff roster.
    expect(screen.queryByText(/Create an account|Sign up|Register/i)).toBeNull();
  });

  it("gives an authenticated account WITHOUT Booth access the not-found boundary", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "u" } } } });
    mocks.getAccess.mockRejectedValue(new Error("booth_access_denied"));

    render(<BoothV2Gate />);

    await notFound();
    expect(signInForm()).toBeNull();
  });

  it("renders Booth V2 for an authorized staff account", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "u" } } } });
    mocks.getAccess.mockResolvedValue({ granted: true as const, hostName: "Host Tester" });

    render(<BoothV2Gate />);

    await waitFor(() => expect(screen.getByText(/Booth V2 shell for/)).toBeInTheDocument());
    expect(screen.getByText(/Host Tester/)).toBeInTheDocument();
  });
});
