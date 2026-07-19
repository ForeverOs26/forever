import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

function button(name: RegExp | string) {
  return screen.getByText(name, { selector: "button" });
}

function checkbox(name: RegExp) {
  return screen.getByText(name).closest("button") as HTMLButtonElement;
}

function renderBooth() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <BoothNavigator />
    </QueryClientProvider>,
  );
  let disposed = false;

  return {
    client,
    view,
    async dispose() {
      if (disposed) return;
      disposed = true;
      await act(async () => {
        await client.cancelQueries();
      });
      view.unmount();
      client.clear();
      cleanup();
    },
  };
}

async function withBooth(run: () => Promise<void> | void) {
  const booth = renderBooth();
  try {
    await run();
  } finally {
    await booth.dispose();
  }
}

/**
 * Deterministically resolves the ~900ms Forever Story timer instead of waiting
 * on real wall-clock time: fake timers are enabled only around the "Continue"
 * click that starts the timer (so the effect schedules a FAKE setTimeout), the
 * fake clock is advanced exactly 900ms inside `act`, and real timers are
 * restored immediately after — leaving the rest of the test's async flow
 * (React Query resolution, user-event interactions, `waitFor`/`findBy*`) on
 * real timers, unaffected.
 *
 * The surrounding integration flow also uses `fireEvent`: realistic keyboard
 * timing is not under test, and synchronous events keep every state transition
 * inside this test's lifecycle instead of adding user-event timer work.
 */
async function resolveForeverStory(continueButton: HTMLElement) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    act(() => {
      fireEvent.click(continueButton);
    });
    act(() => {
      vi.advanceTimersByTime(900);
    });
    await act(async () => {
      await Promise.resolve();
    });
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
}

async function drivenToResults() {
  fireEvent.click(button("Begin"));
  fireEvent.click(checkbox(/investment & rental yield/i));
  fireEvent.click(button("Continue"));
  fireEvent.click(checkbox(/steady rental income/i));
  fireEvent.click(button("Continue"));
  fireEvent.click(checkbox(/\$500k–1M/i));
  fireEvent.click(checkbox(/ready now/i));
  fireEvent.click(button("Continue"));
  fireEvent.click(checkbox(/rental returns/i));

  await resolveForeverStory(button("Continue"));

  fireEvent.click(button(/yes, this describes me/i));
  // Wait for the mocked catalogue query (a plain resolved promise, no timer) to
  // settle and render the card.
  await screen.findByText("The Modeva");
}

function setClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");

function restoreClipboard() {
  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
  } else {
    Reflect.deleteProperty(navigator, "clipboard");
  }
}

beforeEach(() => {
  submitLead.mockReset();
  window.sessionStorage.clear();
  setClipboard(vi.fn().mockResolvedValue(undefined));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  window.sessionStorage.clear();
  restoreClipboard();
  vi.restoreAllMocks();
});

describe("booth shell chrome", () => {
  it("shows the required staff controls", async () => {
    await withBooth(() => {
      expect(screen.getByText(/booth mode · staff/i)).toBeInTheDocument();
      expect(screen.getAllByText("Forever").length).toBeGreaterThan(0);
      expect(button(/start new guest/i)).toBeInTheDocument();
    });
  });
});

describe("booth project actions", () => {
  it("opens the project in a new tab via the runtime slug", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    await withBooth(async () => {
      await drivenToResults();

      const card = screen.getByText("The Modeva").closest("article") as HTMLElement;
      fireEvent.click(within(card).getByText(/open project/i, { selector: "button" }));

      expect(openSpy).toHaveBeenCalledWith(
        "/projects/the-modeva-bang-tao",
        "_blank",
        "noopener,noreferrer",
      );
    });
  });

  it("copies the guest link and announces success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    await withBooth(async () => {
      await drivenToResults();

      const card = screen.getByText("The Modeva").closest("article") as HTMLElement;
      fireEvent.click(within(card).getByText(/copy guest link/i, { selector: "button" }));

      expect(await screen.findByText(/guest link copied/i)).toBeInTheDocument();
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("/projects/the-modeva-bang-tao"),
      );
    });
  });

  it("announces a failure when the clipboard write rejects", async () => {
    setClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    await withBooth(async () => {
      await drivenToResults();

      const card = screen.getByText("The Modeva").closest("article") as HTMLElement;
      fireEvent.click(within(card).getByText(/copy guest link/i, { selector: "button" }));

      expect(await screen.findByText(/couldn't copy the link/i)).toBeInTheDocument();
    });
  });
});

describe("booth lead capture", () => {
  it("submits a mocked lead and reaches the completion screen", async () => {
    submitLead.mockResolvedValue(undefined);
    await withBooth(async () => {
      await drivenToResults();

      const card = screen.getByText("The Modeva").closest("article") as HTMLElement;
      fireEvent.click(within(card).getByText(/select for guest/i, { selector: "button" }));
      fireEvent.click(button(/continue to contact details/i));

      fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: "Ada" } });
      fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: "Lovelace" } });
      fireEvent.change(screen.getByLabelText(/email/i), {
        target: { value: "ada@example.com" },
      });
      fireEvent.change(screen.getByLabelText(/phone/i), {
        target: { value: "+66 81 234 5678" },
      });
      fireEvent.click(button(/save lead/i));

      expect(await screen.findByText(/lead saved/i, { selector: "h1" })).toBeInTheDocument();
      expect(submitLead).toHaveBeenCalledTimes(1);
      const payload = submitLead.mock.calls[0][0];
      expect(payload).toMatchObject({
        source: "booth",
        projectSlug: "the-modeva-bang-tao",
        firstName: "Ada",
      });
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
    await withBooth(async () => {
      try {
        await drivenToResults();

        const card = screen.getByText("The Modeva").closest("article") as HTMLElement;
        fireEvent.click(within(card).getByText(/select for guest/i, { selector: "button" }));
        fireEvent.click(button(/continue to contact details/i));

        fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: "Ada" } });
        fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: "Lovelace" } });
        fireEvent.change(screen.getByLabelText(/email/i), {
          target: { value: "ada@example.com" },
        });
        fireEvent.change(screen.getByLabelText(/phone/i), {
          target: { value: "+66 81 234 5678" },
        });

        const saveButton = button(/save lead/i);
        fireEvent.click(saveButton);
        expect(button(/saving…/i)).toBeDisabled();
        fireEvent.click(button(/saving…/i));

        expect(submitLead).toHaveBeenCalledTimes(1);
      } finally {
        if (resolveSubmit) {
          await act(async () => {
            resolveSubmit?.();
            await Promise.resolve();
          });
          expect(await screen.findByText(/lead saved/i, { selector: "h1" })).toBeInTheDocument();
        }
      }
    });
  });
});

describe("Start new guest clears the session", () => {
  it("guards with a confirm dialog then returns to Welcome", async () => {
    await withBooth(async () => {
      fireEvent.click(button("Begin"));
      fireEvent.click(checkbox(/a base in asia/i));

      fireEvent.click(button(/start new guest/i));
      // Guarded dialog appears because guest data exists.
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      fireEvent.click(button(/clear and start new/i));

      // Back to a pristine welcome screen.
      expect(
        await screen.findByText(/a home in phuket begins with a conversation/i, {
          selector: "h1",
        }),
      ).toBeInTheDocument();
      expect(window.sessionStorage.getItem("forever.booth.session.v1")).not.toContain("asia_base");
    });
  });
});
