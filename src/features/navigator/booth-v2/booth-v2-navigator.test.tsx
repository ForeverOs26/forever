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

const serverFns = vi.hoisted(() => ({
  getConfig: vi.fn(async () => ({ boothId: "test-booth", whatsappConfigured: true, fx: null })),
  ensureSession: vi.fn(async () => ({ ok: true })),
  recordEvent: vi.fn(async () => ({ ok: true })),
  confirmProfile: vi.fn(async () => ({ ok: true })),
  setShortlist: vi.fn(async () => ({ ok: true })),
  saveContact: vi.fn(async () => ({ ok: true })),
  startWhatsapp: vi.fn(async () => ({
    configured: true,
    waHref: "https://wa.me/000?text=test",
    sessionCode: "TESTCODE",
  })),
  confirmWhatsapp: vi.fn(async () => ({ ok: true, verifiedAt: "2026-07-25T10:00:00.000Z" })),
  listGuides: vi.fn(async () => [
    {
      id: "11111111-1111-1111-1111-111111111111",
      displayName: "Guide Anna",
      languages: ["Русский", "English"],
      specializations: [],
      onDuty: true,
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      displayName: "Guide Ben",
      languages: ["English"],
      specializations: [],
      onDuty: true,
    },
  ]),
  assignGuide: vi.fn(async () => ({ ok: true, assignedAt: "2026-07-25T10:01:00.000Z" })),
  acknowledgeGuide: vi.fn(async () => ({ ok: true, acknowledgedAt: "2026-07-25T10:02:00.000Z" })),
  recordHandoff: vi.fn(async () => ({ ok: true })),
  completeSession: vi.fn(async () => ({ ok: true })),
}));

vi.mock("./booth-v2.functions", () => ({
  boothV2GetConfig: serverFns.getConfig,
  boothV2EnsureSession: serverFns.ensureSession,
  boothV2RecordEvent: serverFns.recordEvent,
  boothV2ConfirmProfile: serverFns.confirmProfile,
  boothV2SetShortlist: serverFns.setShortlist,
  boothV2SaveContact: serverFns.saveContact,
  boothV2StartWhatsappVerification: serverFns.startWhatsapp,
  boothV2ConfirmWhatsappVerification: serverFns.confirmWhatsapp,
  boothV2ListGuides: serverFns.listGuides,
  boothV2AssignGuide: serverFns.assignGuide,
  boothV2AcknowledgeGuide: serverFns.acknowledgeGuide,
  boothV2RecordHandoff: serverFns.recordHandoff,
  boothV2CompleteSession: serverFns.completeSession,
}));

import { BoothV2Navigator } from "./BoothV2Navigator";

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
function walkQuickToSummary() {
  fireEvent.click(button("Begin"));
  fireEvent.click(button(/Yes — let's look together/));
  fireEvent.click(screen.getByText(/Quick — about a minute/).closest("button")!);
  fireEvent.click(screen.getByText("For living & lifestyle"));
  fireEvent.click(button("Continue"));
  fireEvent.click(screen.getByText("$250k–500k"));
  fireEvent.click(button("Continue"));
  fireEvent.click(screen.getByText("Condominium"));
  fireEvent.click(button("Continue"));
  fireEvent.click(screen.getByText("3–6 months"));
  fireEvent.click(button("See my summary"));
}

async function walkToContact() {
  walkQuickToSummary();
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
  fireEvent.change(screen.getByLabelText(/Preferred language/), {
    target: { value: "Русский" },
  });
  fireEvent.click(screen.getByLabelText(/I agree that Forever saves my Decision Profile/));
  fireEvent.click(button("Save and continue"));
  await waitFor(() => expect(serverFns.saveContact).toHaveBeenCalledTimes(1));
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
    walkQuickToSummary();
    expect(screen.getByText(/This is your initial Decision Profile/)).toBeInTheDocument();
    expect(screen.getByText(/It is not a sales recommendation yet/)).toBeInTheDocument();
    // The universal archetype must not appear.
    expect(screen.queryByText(/Considered Retreat-Seeker/)).toBeNull();
    // Editable sections are present.
    expect(screen.getByLabelText("Edit Purchase purpose")).toBeInTheDocument();
  });

  it("shows truthful initial directions — never 'matching your preferences'", async () => {
    renderBooth();
    walkQuickToSummary();
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
    walkQuickToSummary();
    fireEvent.click(button("Back"));
    const calls = serverFns.recordEvent.mock.calls.filter(
      (call) => (call[0] as { data: { event: string } }).data.event === "profile_started",
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
    fireEvent.change(screen.getByLabelText(/Preferred language/), {
      target: { value: "Русский" },
    });
    // No consent yet → blocked, nothing saved.
    fireEvent.click(button("Save and continue"));
    expect(
      await screen.findByText(/We need your permission to save your Decision Profile/),
    ).toBeInTheDocument();
    expect(serverFns.saveContact).not.toHaveBeenCalled();
    // Consent → proceeds without surname or email.
    fireEvent.click(screen.getByLabelText(/I agree that Forever saves my Decision Profile/));
    fireEvent.click(button("Save and continue"));
    await waitFor(() => expect(serverFns.saveContact).toHaveBeenCalledTimes(1));
    const saved = (
      serverFns.saveContact.mock.calls[0][0] as {
        data: { contact: { marketingOptIn: boolean; lastName: string; email: string } };
      }
    ).data.contact;
    expect(saved.marketingOptIn).toBe(false); // separate, default false
    expect(saved.lastName).toBe("");
    expect(saved.email).toBe("");
  });

  it("blocks duplicate submits while saving", async () => {
    let release: () => void = () => undefined;
    serverFns.saveContact.mockImplementationOnce(
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
    fireEvent.change(screen.getByLabelText(/Preferred language/), {
      target: { value: "Русский" },
    });
    fireEvent.click(screen.getByLabelText(/I agree that Forever saves my Decision Profile/));
    fireEvent.click(button("Save and continue"));
    fireEvent.click(button("Saving…"));
    fireEvent.click(button("Saving…"));
    release();
    await waitFor(() => expect(serverFns.saveContact).toHaveBeenCalledTimes(1));
  });

  it("offers a respectful no-contact continuation that stores nothing", async () => {
    renderBooth();
    await walkToContact();
    fireEvent.change(screen.getByLabelText(/First name/), { target: { value: "Anna" } });
    fireEvent.click(button(/I'd rather continue on my own — no contact/));
    await screen.findByText(/Continue in your own time/);
    expect(screen.getByText(/Nothing about you is stored/)).toBeInTheDocument();
    expect(serverFns.saveContact).not.toHaveBeenCalled();
    const qrEvents = serverFns.recordEvent.mock.calls.filter(
      (call) => (call[0] as { data: { event: string } }).data.event === "qr_continuation",
    );
    expect(qrEvents).toHaveLength(1);
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
    fireEvent.click(button(/Host: Guide confirmed — mark acknowledged/));
    await screen.findByText(/Acknowledged ✓/);
    fireEvent.click(button(/Continue — record the next step/));

    // Completion is blocked until a next step AND a time (or live message) exist.
    await screen.findByText(/What happens next\?/);
    expect(button(/Complete the handoff/)).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Next step/), {
      target: { value: "30-minute consultation" },
    });
    fireEvent.change(screen.getByLabelText(/Exact consultation \/ contact time/), {
      target: { value: "Tomorrow 14:00" },
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
    const verifiedEvents = serverFns.recordEvent.mock.calls.filter(
      (call) => (call[0] as { data: { event: string } }).data.event === "whatsapp_verified",
    );
    expect(verifiedEvents).toHaveLength(1);
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
    walkQuickToSummary();
    fireEvent.click(button("Start new guest"));
    await screen.findByText(/Start a new guest session\?/);
    fireEvent.click(button(/Clear and start new/));
    await screen.findByText(/Deciding well takes a moment of clarity/);
    // Walk forward again: previous answers are gone.
    fireEvent.click(button("Begin"));
    fireEvent.click(button(/Yes — let's look together/));
    fireEvent.click(screen.getByText(/Quick — about a minute/).closest("button")!);
    const lifestyleCard = screen.getByText("For living & lifestyle").closest("button")!;
    expect(lifestyleCard).toHaveAttribute("aria-checked", "false");
  });
});
