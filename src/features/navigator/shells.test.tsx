import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { NavigatorFlow } from "./components/NavigatorFlow";
import { WHY_PHUKET_OPTIONS } from "./core";
import { MatchResultCard } from "./booth/MatchResultCard";
import type { Property } from "@/lib/data";

function property(overrides: Partial<Property> = {}): Property {
  return {
    slug: "coralina",
    name: "Coralina",
    developer: "",
    location: "Kamala",
    propertyType: "Residence",
    constructionStatus: "Not available",
    status: "Not available",
    tagline: "A quiet Kamala draft",
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

describe("website shell", () => {
  it("presents the approved NAV-001 welcome and NO staff controls", () => {
    render(<NavigatorFlow />);
    expect(
      screen.getByRole("heading", { name: /a home in phuket begins with a conversation/i }),
    ).toBeInTheDocument();
    // Website mode must not carry booth staff chrome.
    expect(screen.queryByText(/booth mode · staff/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /start new guest/i })).toBeNull();
  });
});

describe("shared question definitions", () => {
  it("the website Why-Phuket screen renders exactly the core option labels", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<NavigatorFlow />);
    await user.click(screen.getByRole("button", { name: "Begin" }));

    for (const option of WHY_PHUKET_OPTIONS) {
      expect(screen.getByRole("checkbox", { name: option.label })).toBeInTheDocument();
    }
  });
});

describe("Coralina dev preview presentation", () => {
  it("shows the unpublished preview badge and neutral placeholder, no Forever Verified", () => {
    render(
      <MatchResultCard project={property()} reasons={[]} onOpen={() => {}} onCopyLink={() => {}} />,
    );
    expect(screen.getByText(/unpublished project preview/i)).toBeInTheDocument();
    expect(screen.getByText(/no media yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/forever verified/i)).toBeNull();
  });

  it("hides the Select action when onSelect is not provided (selected variant)", () => {
    render(
      <MatchResultCard
        project={property({ slug: "priced", name: "Priced", image: "x.jpg" })}
        reasons={[]}
        onOpen={() => {}}
        onCopyLink={() => {}}
        variant="selected"
      />,
    );
    expect(screen.queryByRole("button", { name: /select for guest/i })).toBeNull();
    expect(screen.getByRole("button", { name: /open project/i })).toBeInTheDocument();
  });
});
