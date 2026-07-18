import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Property } from "@/lib/data";

/* ---- Mocks: real catalogue + lead service replaced, validation kept real ---- */

const submitLead = vi.fn();

function property(overrides: Partial<Property> = {}): Property {
  return {
    slug: "the-modeva-bang-tao",
    name: "The Modeva",
    developer: "Dev",
    location: "Bang Tao",
    propertyType: "Residence",
    constructionStatus: "Ready",
    status: "Available",
    tagline: "Coastal residences",
    description: "",
    highlights: [],
    beds: "",
    area: "",
    price: "From ฿20M",
    startingPriceTHB: 20_000_000,
    priceRange: "",
    pricePerSqm: "",
    lastPriceUpdate: "",
    verifiedPrice: "",
    promotion: "",
    foreverVerified: true,
    trustScore: 0,
    trustNote: "",
    investmentValue: 0,
    marketPosition: "In line with market",
    verdict: "Strong Buy",
    distanceToBeach: "",
    distanceToAirport: "",
    nearbySchools: [],
    nearbyHospitals: [],
    lifestyle: [],
    rentalYield: "6%",
    rentalDemand: "High",
    capitalGrowthEstimate: "",
    startDate: "",
    completionDate: "",
    lastInspection: "",
    image: "modeva.jpg",
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
    queryKey: ["projects", "list", "test"],
    queryFn: async () => MOCK_PROJECTS,
  }),
}));

vi.mock("@/lib/lead-service", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/lead-service")>();
  return { ...actual, submitLead: (...args: unknown[]) => submitLead(...args) };
});

import { BoothNavigator } from "./BoothNavigator";

function renderBooth() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BoothNavigator />
    </QueryClientProvider>,
  );
}

async function drivenToResults(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Begin" }));
  await user.click(screen.getByRole("checkbox", { name: /investment & rental yield/i }));
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.click(screen.getByRole("checkbox", { name: /steady rental income/i }));
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.click(screen.getByRole("checkbox", { name: /\$500k–1M/i }));
  await user.click(screen.getByRole("checkbox", { name: /ready now/i }));
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.click(screen.getByRole("checkbox", { name: /rental returns/i }));
  await user.click(screen.getByRole("button", { name: "Continue" }));
  // Forever Story (~900ms templated reflection).
  const confirm = await screen.findByRole("button", { name: /yes, this describes me/i }, { timeout: 3000 });
  await user.click(confirm);
  await screen.findByRole("heading", { name: /projects matching your preferences/i });
  // Wait for the mocked catalogue query to resolve the card.
  await screen.findByText("The Modeva");
}

function setClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

beforeEach(() => {
  submitLead.mockReset();
  window.sessionStorage.clear();
  setClipboard(vi.fn().mockResolvedValue(undefined));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("booth shell chrome", () => {
  it("shows the required staff controls", () => {
    renderBooth();
    expect(screen.getByText(/booth mode · staff/i)).toBeInTheDocument();
    expect(screen.getAllByText("Forever").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /start new guest/i })).toBeInTheDocument();
  });
});

describe("booth project actions", () => {
  it("opens the project in a new tab via the runtime slug", async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    renderBooth();
    await drivenToResults(user);

    const card = screen.getByText("The Modeva").closest("article") as HTMLElement;
    await user.click(within(card).getByRole("button", { name: /open project/i }));

    expect(openSpy).toHaveBeenCalledWith(
      "/projects/the-modeva-bang-tao",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("copies the guest link and announces success", async () => {
    const user = userEvent.setup();
    // Override after setup() so the component's writeText hits our spy, not
    // userEvent's internal clipboard stub.
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    renderBooth();
    await drivenToResults(user);

    const card = screen.getByText("The Modeva").closest("article") as HTMLElement;
    await user.click(within(card).getByRole("button", { name: /copy guest link/i }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("/projects/the-modeva-bang-tao"),
      ),
    );
    expect(await screen.findByText(/guest link copied/i)).toBeInTheDocument();
  });

  it("announces a failure when the clipboard write rejects", async () => {
    const user = userEvent.setup();
    setClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    renderBooth();
    await drivenToResults(user);

    const card = screen.getByText("The Modeva").closest("article") as HTMLElement;
    await user.click(within(card).getByRole("button", { name: /copy guest link/i }));

    expect(await screen.findByText(/couldn't copy the link/i)).toBeInTheDocument();
  });
});

describe("booth lead capture", () => {
  it("submits a mocked lead and reaches the completion screen", async () => {
    submitLead.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderBooth();
    await drivenToResults(user);

    const card = screen.getByText("The Modeva").closest("article") as HTMLElement;
    await user.click(within(card).getByRole("button", { name: /select for guest/i }));
    await user.click(await screen.findByRole("button", { name: /continue to contact details/i }));

    await user.type(screen.getByLabelText(/first name/i), "Ada");
    await user.type(screen.getByLabelText(/last name/i), "Lovelace");
    await user.type(screen.getByLabelText(/email/i), "ada@example.com");
    await user.type(screen.getByLabelText(/phone/i), "+66 81 234 5678");
    await user.click(screen.getByRole("button", { name: /save lead/i }));

    expect(await screen.findByRole("heading", { name: /lead saved/i })).toBeInTheDocument();
    expect(submitLead).toHaveBeenCalledTimes(1);
    const payload = submitLead.mock.calls[0][0];
    expect(payload).toMatchObject({
      source: "booth",
      projectSlug: "the-modeva-bang-tao",
      firstName: "Ada",
    });
  });

  it("prevents duplicate submission while a save is in flight", async () => {
    let resolveSubmit: (() => void) | undefined;
    submitLead.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    const user = userEvent.setup();
    renderBooth();
    await drivenToResults(user);

    const card = screen.getByText("The Modeva").closest("article") as HTMLElement;
    await user.click(within(card).getByRole("button", { name: /select for guest/i }));
    await user.click(await screen.findByRole("button", { name: /continue to contact details/i }));

    await user.type(screen.getByLabelText(/first name/i), "Ada");
    await user.type(screen.getByLabelText(/last name/i), "Lovelace");
    await user.type(screen.getByLabelText(/email/i), "ada@example.com");
    await user.type(screen.getByLabelText(/phone/i), "+66 81 234 5678");

    const saveButton = screen.getByRole("button", { name: /save lead/i });
    await user.click(saveButton); // now "Saving…", disabled
    await user.click(screen.getByRole("button", { name: /saving…/i }));

    expect(submitLead).toHaveBeenCalledTimes(1);
    resolveSubmit?.();
  });
});

describe("Start new guest clears the session", () => {
  it("guards with a confirm dialog then returns to Welcome", async () => {
    const user = userEvent.setup();
    renderBooth();
    await user.click(screen.getByRole("button", { name: "Begin" }));
    await user.click(screen.getByRole("checkbox", { name: /a base in asia/i }));

    await user.click(screen.getByRole("button", { name: /start new guest/i }));
    // Guarded dialog appears because guest data exists.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /clear and start new/i }));

    // Back to a pristine welcome screen.
    expect(
      await screen.findByRole("heading", { name: /a home in phuket begins with a conversation/i }),
    ).toBeInTheDocument();
    expect(window.sessionStorage.getItem("forever.booth.session.v1")).not.toContain("asia_base");
  });
});
