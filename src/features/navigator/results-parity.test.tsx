import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Property } from "@/lib/data";

/* One mocked runtime catalogue served to BOTH shells through the same
 * projectListQuery import — exactly how production wires them. */

function property(overrides: Partial<Property>): Property {
  return {
    slug: "x",
    name: "X",
    developer: "",
    location: "",
    propertyType: "Residence",
    constructionStatus: "Ready",
    status: "Available",
    tagline: "",
    description: "",
    highlights: [],
    beds: "",
    area: "",
    price: "",
    startingPriceTHB: 0,
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

const CATALOGUE: Property[] = [
  // Matched for an investment profile: carries a rental-yield fact.
  property({
    slug: "the-modeva-bang-tao",
    name: "The Modeva",
    location: "Bang Tao",
    rentalYield: "6%",
    image: "modeva.jpg",
  }),
  // Unmatched: sparse record (no yield, no price) — the Coralina dev preview.
  property({ slug: "coralina", name: "Coralina", location: "Kamala" }),
];

vi.mock("@/lib/project-service", () => ({
  projectListQuery: () => ({
    queryKey: ["projects", "list", "parity-test"],
    queryFn: async () => CATALOGUE,
  }),
}));

vi.mock("@/lib/lead-service", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/lead-service")>();
  return { ...actual, submitLead: vi.fn() }; // never a real write in tests
});

import { NavigatorFlow } from "./components/NavigatorFlow";
import { BoothNavigator } from "./booth/BoothNavigator";

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/**
 * Deterministically resolves the ~900ms Forever Story timer instead of waiting
 * on real wall-clock time: fake timers are enabled only around the "Continue"
 * click that starts the timer, the fake clock is advanced exactly 900ms inside
 * `act`, and real timers are restored immediately after — the rest of each
 * test's async flow (React Query resolution, user-event interactions,
 * `findBy*`) stays on real timers, unaffected.
 *
 * Uses `fireEvent.click` (not `userEvent.click`) for this one click only:
 * `userEvent` schedules internal work that never resolves once `setTimeout` is
 * faked, even with `delay: null` (confirmed by isolating the hang). A plain
 * `fireEvent.click` wrapped in `act` triggers the identical onClick handler
 * synchronously with no such dependency.
 */
async function resolveForeverStory(continueButton: HTMLElement) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    act(() => {
      fireEvent.click(continueButton);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
  } finally {
    vi.useRealTimers();
  }
}

/** The identical NAV-001 answer set, applied through each shell's own UI. */
async function answerIdentically(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Begin" }));
  await user.click(screen.getByRole("checkbox", { name: /investment & rental yield/i }));
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.click(screen.getByRole("checkbox", { name: /steady rental income/i }));
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.click(screen.getByRole("checkbox", { name: /\$500k–1M/i }));
  await user.click(screen.getByRole("checkbox", { name: /ready now/i }));
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.click(screen.getByRole("checkbox", { name: /rental returns/i }));

  await resolveForeverStory(screen.getByRole("button", { name: "Continue" }));

  const confirm = screen.getByRole("button", { name: /yes, this describes me/i });
  await user.click(confirm);
  await screen.findByRole("heading", { name: /projects matching your preferences/i });
  await screen.findByText("The Modeva");
}

function shownSlugs(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-project-slug]")).map(
    (el) => el.getAttribute("data-project-slug") as string,
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("website and Booth show identical real project results for identical answers", () => {
  it("default view: same matched slugs; Browse all: same complete catalogue", async () => {
    const user = userEvent.setup({ delay: null });

    // Website shell.
    const website = renderWithQuery(<NavigatorFlow />);
    await answerIdentically(user);
    const websiteDefault = shownSlugs(website.container);
    await user.click(screen.getByRole("button", { name: /browse all projects/i }));
    const websiteAll = shownSlugs(website.container);
    website.unmount();

    // Booth shell, identical answers through its own UI.
    const booth = renderWithQuery(<BoothNavigator />);
    await answerIdentically(user);
    const boothDefault = shownSlugs(booth.container);
    await user.click(screen.getByRole("button", { name: /browse all projects/i }));
    const boothAll = shownSlugs(booth.container);
    booth.unmount();

    // Parity: identical answers + identical catalogue ⇒ identical slugs.
    expect(websiteDefault).toEqual(boothDefault);
    expect(websiteAll).toEqual(boothAll);

    // Supported match exists ⇒ matched-only by default, full catalogue on Browse all.
    expect(websiteDefault).toEqual(["the-modeva-bang-tao"]);
    expect(websiteAll).toEqual(["the-modeva-bang-tao", "coralina"]);
  });

  it("website guest-facing results contain no placeholder cards and use runtime links", async () => {
    const user = userEvent.setup({ delay: null });
    const { container } = renderWithQuery(<NavigatorFlow />);
    await answerIdentically(user);

    // Approved guidance copy is kept…
    expect(screen.getByText(/primary recommendation/i)).toBeInTheDocument();
    expect(screen.getByText(/why it fits/i)).toBeInTheDocument();
    expect(screen.getByText(/investment profile/i)).toBeInTheDocument();
    // …but no placeholder project cards are guest-facing.
    expect(screen.queryByText(/placeholder/i)).toBeNull();
    expect(screen.queryByText(/suggested first projects/i)).toBeNull();

    // Links go through the universal runtime-slug route.
    const link = within(
      container.querySelector('[data-project-slug="the-modeva-bang-tao"]') as HTMLElement,
    ).getByRole("link", { name: /view project/i });
    expect(link).toHaveAttribute("href", "/projects/the-modeva-bang-tao");
  });

  it("website shows the honest fallback with the complete catalogue when nothing matches", async () => {
    const user = userEvent.setup({ delay: null });
    // A profile with no investment intent earns no reason from this catalogue.
    const { container } = renderWithQuery(<NavigatorFlow />);
    await user.click(screen.getByRole("button", { name: "Begin" }));
    await user.click(screen.getByRole("checkbox", { name: /a slower way of living/i }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("checkbox", { name: /peace and privacy/i }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("checkbox", { name: /\$500k–1M/i }));
    await user.click(screen.getByRole("checkbox", { name: /just exploring/i }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("checkbox", { name: /choosing the right area/i }));

    await resolveForeverStory(screen.getByRole("button", { name: "Continue" }));

    const confirm = screen.getByRole("button", { name: /yes, this describes me/i });
    await user.click(confirm);
    await screen.findByText("The Modeva");

    expect(
      screen.getByText("No exact match found — showing available projects for discussion"),
    ).toBeInTheDocument();
    expect(shownSlugs(container)).toEqual(["the-modeva-bang-tao", "coralina"]);
    expect(screen.queryByRole("button", { name: /browse all projects/i })).toBeNull();
  });
});
