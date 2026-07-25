import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Property } from "@/lib/data";

/* ---- Mocks: catalogue + the server boundary; all core logic stays real ---- */

function property(overrides: Partial<Property> = {}): Property {
  return {
    slug: "the-modeva-bang-tao",
    name: "The Modeva",
    developer: "Dev",
    location: "Bang Tao",
    propertyType: "Condominium",
    constructionStatus: "Ready",
    status: "Available",
    tagline: "Coastal residences",
    description: "",
    highlights: [],
    beds: "1-3",
    area: "",
    price: "From ฿20M",
    startingPriceTHB: 20_000_000,
    priceRange: "",
    pricePerSqm: "",
    lastPriceUpdate: "",
    verifiedPrice: "",
    promotion: "",
    foreverVerified: false,
    trustScore: 0,
    trustNote: "",
    investmentValue: 0,
    marketPosition: "Not available",
    verdict: "Not available",
    distanceToBeach: "",
    distanceToAirport: "",
    nearbySchools: [],
    nearbyHospitals: [],
    lifestyle: [],
    rentalYield: "",
    rentalDemand: "Not available",
    capitalGrowthEstimate: "",
    startDate: "",
    completionDate: "",
    lastInspection: "",
    image: "",
    gallery: [],
    floorPlans: [],
    brochures: [],
    videos: [],
    ...overrides,
  };
}

const MOCK_PROJECTS = [property()];

vi.mock("@/lib/project-service", () => ({
  projectListQuery: () => ({
    queryKey: ["projects", "list", "booth-v2-test"],
    queryFn: async () => MOCK_PROJECTS,
  }),
}));

type Call = { data: Record<string, unknown> };

const serverFns = vi.hoisted(() => ({
  getAccess: vi.fn(async () => ({ granted: true as const, hostName: "Host Tester" })),
  getConfig: vi.fn(async () => ({
    boothId: "test-booth",
    whatsappConfigured: true,
    fx: null,
    hostName: "Host Tester",
  })),
  ensureSession: vi.fn(async (_input: { data: Record<string, unknown> }) => ({ ok: true })),
  recordEvent: vi.fn(async (_input: { data: Record<string, unknown> }) => ({ ok: true })),
  markProfileConfirmed: vi.fn(async (_input: { data: Record<string, unknown> }) => ({ ok: true })),
  validateShortlist: vi.fn(async (_input: { data: Record<string, unknown> }) => ({ ok: true })),
  commitConsent: vi.fn(async (_input: { data: Record<string, unknown> }) => ({ ok: true })),
  startWhatsapp: vi.fn(
    async (_input: {
      data: Record<string, unknown>;
    }): Promise<{ configured: boolean; waHref: string | null; sessionCode: string | null }> => ({
      configured: true,
      waHref: "https://wa.me/000?text=test",
      sessionCode: "TESTCODE",
    }),
  ),
  confirmWhatsapp: vi.fn(async (_input: { data: Record<string, unknown> }) => ({
    ok: true,
    verifiedAt: "2026-07-25T10:00:00.000Z",
  })),
  listGuides: vi.fn(async () => [
    {
      id: "11111111-1111-1111-1111-111111111111",
      displayName: "Guide Anna",
      languages: ["Русский", "English"],
      specializations: [],
      onDuty: true,
      hasStaffAccount: false,
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      displayName: "Guide Ben",
      languages: ["English"],
      specializations: [],
      onDuty: true,
      hasStaffAccount: false,
    },
  ]),
  assignGuide: vi.fn(async (_input: { data: Record<string, unknown> }) => ({
    ok: true,
    assignedAt: "2026-07-25T10:01:00.000Z",
  })),
  acknowledgeGuide: vi.fn(async (_input: { data: Record<string, unknown> }) => ({
    ok: true,
    acknowledgedAt: "2026-07-25T10:02:00.000Z",
    method: "host_observed" as const,
  })),
  recordHandoff: vi.fn(
    async (_input: {
      data: Record<string, unknown>;
    }): Promise<{
      ok: true;
      firstContactMethod: "guide_self_confirmed" | "host_observed" | null;
    }> => ({
      ok: true,
      firstContactMethod: null,
    }),
  ),
  completeSession: vi.fn(async (_input: { data: Record<string, unknown> }) => ({ ok: true })),
}));

vi.mock("./booth-v2.functions", () => ({
  boothV2GetAccess: serverFns.getAccess,
  boothV2GetConfig: serverFns.getConfig,
  boothV2EnsureSession: serverFns.ensureSession,
  boothV2RecordEvent: serverFns.recordEvent,
  boothV2MarkProfileConfirmed: serverFns.markProfileConfirmed,
  boothV2ValidateShortlist: serverFns.validateShortlist,
  boothV2CommitConsent: serverFns.commitConsent,
  boothV2StartWhatsappVerification: serverFns.startWhatsapp,
  boothV2ConfirmWhatsappVerification: serverFns.confirmWhatsapp,
  boothV2ListGuides: serverFns.listGuides,
  boothV2AssignGuide: serverFns.assignGuide,
  boothV2AcknowledgeGuide: serverFns.acknowledgeGuide,
  boothV2RecordHandoff: serverFns.recordHandoff,
  boothV2CompleteSession: serverFns.completeSession,
}));

import { BoothV2Navigator } from "./BoothV2Navigator";
import { BOOTH_CLIENT_OBSERVED_EVENTS } from "../core/v2";

function button(name: RegExp | string) {
  return screen.getByText(name, { selector: "button" });
}

function renderBooth() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <BoothV2Navigator />
    </QueryClientProvider>,
  );
}

/** Walk from Welcome through a completed Quick Profile to the Decision Summary. */
async function walkQuickToSummary() {
  fireEvent.click(button("Begin"));
  fireEvent.click(button(/Yes — let's look together/));
  // Language is captured BEFORE the summary so the confirmed profile owns it.
  await screen.findByText(/Which language suits you\?/);
  fireEvent.click(screen.getByText("Русский"));
  fireEvent.click(button("Continue"));
  fireEvent.click(screen.getByText(/Quick — about a minute/).closest("button")!);
  fireEvent.click(screen.getByText("For living & lifestyle"));
  fireEvent.click(button("Continue"));
  // An explicit numeric budget in the guest's own currency — no USD-shaped
  // band is reused for another currency.
  fireEvent.click(button("EUR"));
  fireEvent.change(screen.getByLabelText(/From \(EUR\)/), { target: { value: "250000" } });
  fireEvent.change(screen.getByLabelText(/Up to \(EUR\)/), { target: { value: "500000" } });
  fireEvent.click(button("Continue"));
  fireEvent.click(screen.getByText("Condominium"));
  fireEvent.click(button("Continue"));
  fireEvent.click(screen.getByText("3–6 months"));
  fireEvent.click(button("See my summary"));
  await screen.findByText(/This is your initial Decision Profile/);
}

async function walkToContact() {
  await walkQuickToSummary();
  fireEvent.click(button(/This is right — continue/));
  await screen.findByText(/Initial directions based on what we know/);
  fireEvent.click(button(/Continue — stay in touch/));
  await screen.findByText(/Where should your Guide reach you\?/);
}

async function fillContactAndSubmit() {
  fireEvent.change(screen.getByLabelText(/First name/), { target: { value: "Anna" } });
  fireEvent.change(screen.getByLabelText(/WhatsApp \/ phone/), {
    target: { value: "+79990001122" },
  });
  fireEvent.click(screen.getByLabelText(/I agree that Forever saves my Decision Profile/));
  fireEvent.click(button("Save and continue"));
  await waitFor(() => expect(serverFns.commitConsent).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  window.sessionStorage.clear();
  for (const fn of Object.values(serverFns)) fn.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("BoothV2Navigator — Quick flow", () => {
  it("reaches a factual Decision Summary without concerns, email, or surname", async () => {
    renderBooth();
    await walkQuickToSummary();
    expect(screen.getByText(/This is your initial Decision Profile/)).toBeInTheDocument();
    expect(screen.getByText(/It is not a sales recommendation yet/)).toBeInTheDocument();
    // The universal archetype must not appear.
    expect(screen.queryByText(/Considered Retreat-Seeker/)).toBeNull();
    // Editable sections are present.
    expect(screen.getByLabelText("Edit Purchase purpose")).toBeInTheDocument();
  });

  it("shows truthful initial directions — never 'matching your preferences'", async () => {
    renderBooth();
    await walkQuickToSummary();
    fireEvent.click(button(/This is right — continue/));
    await screen.findByText(/Initial directions based on what we know/);
    expect(screen.queryByText(/matching your preferences/i)).toBeNull();
    // The mocked Condominium project earns a property-type reason.
    await screen.findByText(/Matches your condominium preference/);
    // No verified trade-off exists → the honest absence line renders.
    expect(
      screen.getByText(/No verified trade-off statement yet — Guide review required/),
    ).toBeInTheDocument();
    // Freshness is truthfully absent.
    expect(screen.getByText(/Price freshness not verified/)).toBeInTheDocument();
  });

  it("records profile_started exactly once", async () => {
    renderBooth();
    await walkQuickToSummary();
    fireEvent.click(button("Back"));
    const calls = serverFns.recordEvent.mock.calls.filter(
      (call) => ((call[0] as Call).data.event as string) === "profile_started",
    );
    expect(calls).toHaveLength(1);
  });
});

describe("BoothV2Navigator — contact & consent", () => {
  it("requires the consultation consent and only the three light fields", async () => {
    renderBooth();
    await walkToContact();
    fireEvent.change(screen.getByLabelText(/First name/), { target: { value: "Anna" } });
    fireEvent.change(screen.getByLabelText(/WhatsApp \/ phone/), {
      target: { value: "+79990001122" },
    });
    // The language came from the profile step and is shown, not re-asked.
    expect(screen.getByText("Preferred language").parentElement).toHaveTextContent("Русский");
    // No consent yet → blocked, nothing saved.
    fireEvent.click(button("Save and continue"));
    expect(
      await screen.findByText(/We need your permission to save your Decision Profile/),
    ).toBeInTheDocument();
    expect(serverFns.commitConsent).not.toHaveBeenCalled();
    // Consent → proceeds without surname or email.
    fireEvent.click(screen.getByLabelText(/I agree that Forever saves my Decision Profile/));
    fireEvent.click(button("Save and continue"));
    await waitFor(() => expect(serverFns.commitConsent).toHaveBeenCalledTimes(1));
    const saved = (
      serverFns.commitConsent.mock.calls[0][0] as {
        data: { contact: { marketingOptIn: boolean; lastName: string; email: string } };
      }
    ).data.contact;
    expect(saved.marketingOptIn).toBe(false); // separate, default false
    expect(saved.lastName).toBe("");
    expect(saved.email).toBe("");
  });

  it("blocks duplicate submits while saving", async () => {
    let release: () => void = () => undefined;
    serverFns.commitConsent.mockImplementationOnce(
      () =>
        new Promise<{ ok: true }>((resolveFn) => {
          release = () => resolveFn({ ok: true });
        }),
    );
    renderBooth();
    await walkToContact();
    fireEvent.change(screen.getByLabelText(/First name/), { target: { value: "Anna" } });
    fireEvent.change(screen.getByLabelText(/WhatsApp \/ phone/), {
      target: { value: "+79990001122" },
    });
    fireEvent.click(screen.getByLabelText(/I agree that Forever saves my Decision Profile/));
    fireEvent.click(button("Save and continue"));
    fireEvent.click(button("Saving…"));
    fireEvent.click(button("Saving…"));
    release();
    await waitFor(() => expect(serverFns.commitConsent).toHaveBeenCalledTimes(1));
  });

  it("offers a respectful no-contact continuation that stores nothing", async () => {
    renderBooth();
    await walkToContact();
    fireEvent.change(screen.getByLabelText(/First name/), { target: { value: "Anna" } });
    fireEvent.click(button(/I'd rather continue on my own — no contact/));
    await screen.findByText(/Continue in your own time/);
    expect(screen.getByText(/Nothing about you is stored/)).toBeInTheDocument();
    expect(serverFns.commitConsent).not.toHaveBeenCalled();
    // The no-contact outcome (clearing + lead deletion + qr_continuation) is
    // ONE server transaction, not a best-effort client event.
    await waitFor(() =>
      expect(serverFns.completeSession).toHaveBeenCalledWith({
        data: expect.objectContaining({ outcome: "no_contact_qr" }),
      }),
    );
  });
});

describe("BoothV2Navigator — verified handoff to completion", () => {
  it("verifies WhatsApp, assigns a named Guide, records the next step, and completes truthfully", async () => {
    renderBooth();
    await walkToContact();
    await fillContactAndSubmit();

    // WhatsApp manual verification.
    await screen.findByText(/Let's make sure WhatsApp reaches you/);
    await screen.findByText("TESTCODE");
    fireEvent.click(button(/Host: message received — mark verified/));
    await screen.findByText(/WhatsApp verified ✓/);
    fireEvent.click(button(/Continue to Guide/));

    // Guide assignment prefers the guest's language.
    await screen.findByText("Guide Anna");
    expect(screen.getByText(/they speak Русский/)).toBeInTheDocument();
    expect(screen.getByText(/Reserve Guide if unavailable: Guide Ben/)).toBeInTheDocument();
    fireEvent.click(button(/Assign Guide Anna/));

    // Warm handoff with the 2-minute acknowledgement timer.
    await screen.findByText(/Guide Anna has been notified/);
    expect(screen.getByText(/Acknowledgement target/)).toBeInTheDocument();
    expect(screen.getByText(/First-contact SLA/)).toBeInTheDocument();
    fireEvent.click(button(/Host: record that the Guide acknowledged \(observation\)/));
    await screen.findByText(/Acknowledged ✓/);
    // The screen never implies the Guide replied when the Host observed it.
    expect(screen.getByText(/Observed by the Host — not a Guide confirmation/)).toBeInTheDocument();
    fireEvent.click(button(/Continue — record the next step/));

    // Completion is blocked until a next step AND a time (or live message) exist.
    await screen.findByText(/What happens next\?/);
    expect(button(/Complete the handoff/)).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Next step/), {
      target: { value: "30-minute consultation" },
    });
    // An exact instant, not free text.
    fireEvent.change(screen.getByLabelText(/Exact consultation \/ contact time/), {
      target: { value: "2030-01-01T14:00" },
    });
    fireEvent.click(button("Save next step"));
    await waitFor(() => expect(serverFns.recordHandoff).toHaveBeenCalled());
    await waitFor(() => expect(button(/Complete the handoff/)).not.toBeDisabled());
    fireEvent.click(button(/Complete the handoff/));

    // The completion screen shows the ACTUAL outcome, not "lead saved".
    await screen.findByText(/Here's exactly where things stand/);
    expect(screen.getByText(/Decision Profile saved/)).toBeInTheDocument();
    expect(screen.getByText(/WhatsApp verified/)).toBeInTheDocument();
    expect(screen.getByText(/Guide assigned · Guide Anna/)).toBeInTheDocument();
    expect(screen.getByText(/Next step: 30-minute consultation/)).toBeInTheDocument();
    expect(screen.queryByText(/Lead saved/i)).toBeNull();
    expect(serverFns.completeSession).toHaveBeenCalledWith({
      data: expect.objectContaining({ outcome: "contacted_complete" }),
    });
    // Transition events are emitted server-side by the operation that
    // establishes the fact — the client never posts them separately.
    const clientEvents = serverFns.recordEvent.mock.calls.map(
      (call) => (call[0] as Call).data.event as string,
    );
    expect(clientEvents).not.toContain("whatsapp_verified");
    expect(clientEvents).not.toContain("guide_assigned");
    expect(clientEvents).not.toContain("consultation_booked");
    // Stronger than a denylist: across a COMPLETE run of the real shell, every
    // event the browser posted is inside the client-observed subset. Nothing
    // fact-establishing left the tablet (corrective pass 3, item 3).
    for (const event of clientEvents) {
      expect(
        `${event}:${(BOOTH_CLIENT_OBSERVED_EVENTS as readonly string[]).includes(event)}`,
      ).toBe(`${event}:true`);
    }
    // The consultation time reached the server as an exact ISO instant.
    const handoffWithTime = serverFns.recordHandoff.mock.calls
      .map((call) => (call[0] as Call).data as { consultationScheduledAt?: string | null })
      .find((data) => data.consultationScheduledAt);
    expect(handoffWithTime?.consultationScheduledAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
  });

  it("fails closed when WhatsApp is unconfigured — never claims verification", async () => {
    serverFns.startWhatsapp.mockResolvedValueOnce({
      configured: false,
      waHref: null,
      sessionCode: null,
    });
    renderBooth();
    await walkToContact();
    await fillContactAndSubmit();
    await screen.findByText(/WhatsApp verification is unavailable/);
    expect(screen.queryByText(/WhatsApp verified ✓/)).toBeNull();
    expect(button(/Continue to Guide/)).toBeDisabled();
  });
});

describe("BoothV2Navigator — privacy", () => {
  it("guarded reset leaves no prior guest data for the next guest", async () => {
    renderBooth();
    await walkQuickToSummary();
    fireEvent.click(button("Start new guest"));
    await screen.findByText(/Start a new guest session\?/);
    fireEvent.click(button(/Clear and start new/));
    await screen.findByText(/Deciding well takes a moment of clarity/);
    // Walk forward again: every previous answer is gone, starting with the
    // language the previous guest chose.
    fireEvent.click(button("Begin"));
    fireEvent.click(button(/Yes — let's look together/));
    await screen.findByText(/Which language suits you\?/);
    const previousLanguage = screen.getByText("Русский").closest("button")!;
    expect(previousLanguage).toHaveAttribute("aria-checked", "false");
    fireEvent.click(previousLanguage);
    fireEvent.click(button("Continue"));
    fireEvent.click(screen.getByText(/Quick — about a minute/).closest("button")!);
    const lifestyleCard = screen.getByText("For living & lifestyle").closest("button")!;
    expect(lifestyleCard).toHaveAttribute("aria-checked", "false");
  });
});
