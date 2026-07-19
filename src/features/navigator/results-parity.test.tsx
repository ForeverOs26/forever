import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Property } from "@/lib/data";

/* One mocked runtime catalogue served to BOTH shells through the same
 * projectListQuery import — exactly how production wires them. Every render
 * gets its own QueryClient, and the whole render lifecycle (drive → read →
 * unmount → clear cache) is owned by a helper, so nothing leaks between the two
 * shells in a test or between tests. Clicks use synchronous `fireEvent` (no
 * userEvent timing), and the single ~900ms Forever Story timer is advanced
 * deterministically with scoped fake timers — so a test never waits on real
 * wall-clock time and a slow first render can never contaminate the next test. */

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
  // Matched for an investment profile: carries a valid quantified rental-yield.
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

/* ---------- deterministic interaction primitives ---------- */

function clickButton(name: RegExp | string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function clickCheckbox(name: RegExp) {
  fireEvent.click(screen.getByRole("checkbox", { name }));
}

/**
 * Advances the ~900ms Forever Story timer deterministically: fake timers are
 * enabled only around the "Continue" click that schedules it, the fake clock is
 * advanced exactly 900ms inside `act`, and real timers are restored in the
 * `finally` — so `findBy*` polling and the async catalogue query that follow
 * run on real timers, unaffected.
 */
async function passForeverStory() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    clickButton("Continue"); // concern screen → starts the story timer
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
  } finally {
    vi.useRealTimers();
  }
}

/** The investment NAV-001 flow (matches The Modeva), then confirm the Story. */
async function answerInvestmentFlow() {
  clickButton("Begin");
  clickCheckbox(/investment & rental yield/i);
  clickButton("Continue");
  clickCheckbox(/steady rental income/i);
  clickButton("Continue");
  clickCheckbox(/\$500k–1M/i);
  clickCheckbox(/ready now/i);
  clickButton("Continue");
  clickCheckbox(/rental returns/i);
  await passForeverStory();
  clickButton(/yes, this describes me/i);
  await screen.findByRole("heading", { name: /projects matching your preferences/i });
  await screen.findByText("The Modeva");
}

/** A lifestyle NAV-001 flow that earns NO reason from this catalogue. */
async function answerLifestyleFlow() {
  clickButton("Begin");
  clickCheckbox(/a slower way of living/i);
  clickButton("Continue");
  clickCheckbox(/peace and privacy/i);
  clickButton("Continue");
  clickCheckbox(/\$500k–1M/i);
  clickCheckbox(/just exploring/i);
  clickButton("Continue");
  clickCheckbox(/choosing the right area/i);
  await passForeverStory();
  clickButton(/yes, this describes me/i);
  await screen.findByText("The Modeva");
}

function shownSlugs(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-project-slug]")).map(
    (el) => el.getAttribute("data-project-slug") as string,
  );
}

/**
 * Renders one shell with its OWN QueryClient, runs a flow, reads default and
 * Browse-all slugs, then fully tears down (unmount + clear the client cache) so
 * no query promise, timer, or DOM survives the call.
 */
async function collectVisibleSlugs(
  ui: React.ReactElement,
  flow: () => Promise<void>,
): Promise<{ def: string[]; all: string[] }> {
  window.sessionStorage.clear();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  const view = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  try {
    await flow();
    const def = shownSlugs(view.container);
    const browseAll = screen.queryByRole("button", { name: /browse all projects/i });
    if (browseAll) fireEvent.click(browseAll);
    const all = shownSlugs(view.container);
    return { def, all };
  } finally {
    view.unmount();
    client.clear();
  }
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  // Return to real timers even if a test threw mid-fake-timer, then drop the
  // DOM, mocks, and any persisted session so no state reaches the next test.
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

describe("website and Booth show identical real project results for identical answers", () => {
  it("default view: same matched slugs; Browse all: same complete catalogue", async () => {
    const website = await collectVisibleSlugs(<NavigatorFlow />, answerInvestmentFlow);
    const booth = await collectVisibleSlugs(<BoothNavigator />, answerInvestmentFlow);

    // Parity: identical answers + identical catalogue ⇒ identical slugs.
    expect(website.def).toEqual(booth.def);
    expect(website.all).toEqual(booth.all);

    // Supported match exists ⇒ matched-only by default, full catalogue on Browse all.
    expect(website.def).toEqual(["the-modeva-bang-tao"]);
    expect(website.all).toEqual(["the-modeva-bang-tao", "coralina"]);
  });

  it("website guest-facing results contain no placeholder cards and use runtime links", async () => {
    window.sessionStorage.clear();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
    });
    const view = render(
      <QueryClientProvider client={client}>
        <NavigatorFlow />
      </QueryClientProvider>,
    );
    try {
      await answerInvestmentFlow();

      // Approved guidance copy is kept…
      expect(screen.getByText(/primary recommendation/i)).toBeInTheDocument();
      expect(screen.getByText(/why it fits/i)).toBeInTheDocument();
      expect(screen.getByText(/investment profile/i)).toBeInTheDocument();
      // …but no placeholder project cards are guest-facing.
      expect(screen.queryByText(/placeholder/i)).toBeNull();
      expect(screen.queryByText(/suggested first projects/i)).toBeNull();

      // Links go through the universal runtime-slug route.
      const link = within(
        view.container.querySelector('[data-project-slug="the-modeva-bang-tao"]') as HTMLElement,
      ).getByRole("link", { name: /view project/i });
      expect(link).toHaveAttribute("href", "/projects/the-modeva-bang-tao");
    } finally {
      view.unmount();
      client.clear();
    }
  });

  it("website shows the honest fallback with the complete catalogue when nothing matches", async () => {
    window.sessionStorage.clear();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
    });
    const view = render(
      <QueryClientProvider client={client}>
        <NavigatorFlow />
      </QueryClientProvider>,
    );
    try {
      await answerLifestyleFlow();

      expect(
        screen.getByText("No exact match found — showing available projects for discussion"),
      ).toBeInTheDocument();
      expect(shownSlugs(view.container)).toEqual(["the-modeva-bang-tao", "coralina"]);
      expect(screen.queryByRole("button", { name: /browse all projects/i })).toBeNull();
    } finally {
      view.unmount();
      client.clear();
    }
  });
});
