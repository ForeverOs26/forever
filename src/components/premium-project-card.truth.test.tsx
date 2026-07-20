import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import { PremiumProjectCard } from "./PremiumProjectCard";
import type { Property } from "@/lib/data";

/**
 * FOREVER-TRUTH-001A: the project card is the widest evidence surface
 * (home, catalogue, discovery). These tests prove that a record with no
 * recorded evidence renders no verification badge, no verdict, no verified
 * price, no score, and no substitute imagery — and that the "Not available"
 * sentinel itself is never displayed as if it were data.
 */

function property(overrides: Partial<Property> = {}): Property {
  return {
    slug: "sparse-project",
    name: "Sparse Project",
    developer: "",
    location: "Kamala",
    propertyType: "Not available",
    constructionStatus: "Not available",
    status: "Not available",
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

async function renderInRouter(ui: ReactNode) {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        {ui}
        <Outlet />
      </>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByText("Sparse Project")).toBeInTheDocument());
}

describe("PremiumProjectCard fail-closed rendering", () => {
  it("renders no positive claims for a record without evidence", async () => {
    await renderInRouter(<PremiumProjectCard project={property()} />);

    expect(screen.queryByText("Forever Verified")).not.toBeInTheDocument();
    expect(screen.queryByText("Forever Verified Price")).not.toBeInTheDocument();
    expect(screen.queryByText("Forever Verdict")).not.toBeInTheDocument();
    expect(screen.queryByText("Strong Buy")).not.toBeInTheDocument();
    expect(screen.queryByText("Forever Score")).not.toBeInTheDocument();
    expect(screen.queryByText(/Inspected/)).not.toBeInTheDocument();
    // The absence sentinel is a display guard, not display content.
    expect(screen.queryByText("Not available")).not.toBeInTheDocument();
    // Missing media degrades to an explicit pending state, not a stock photo.
    expect(screen.getByText("Media preview pending")).toBeInTheDocument();
    expect(screen.getByText("Price on request")).toBeInTheDocument();
  });

  it("renders evidence-backed claims when the record carries them", async () => {
    await renderInRouter(
      <PremiumProjectCard
        project={property({
          foreverVerified: true,
          verifiedPrice: "THB 5,000,000",
          verdict: "Wait for Better Pricing",
          trustScore: 7.2,
          status: "Selling",
          lastInspection: "2026-06-01",
          image: "https://cdn.example.com/photo.jpg",
        })}
      />,
    );

    expect(screen.getByText("Forever Verified")).toBeInTheDocument();
    expect(screen.getAllByText("Forever Verified Price").length).toBeGreaterThan(0);
    expect(screen.getByText("Wait for Better Pricing")).toBeInTheDocument();
    expect(screen.getByText("Forever Score")).toBeInTheDocument();
    expect(screen.getByText("Inspected 2026-06-01")).toBeInTheDocument();
    expect(screen.queryByText("Media preview pending")).not.toBeInTheDocument();
  });
});
