import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { AdvisoryWorkspace } from "../AdvisoryWorkspace";
import { deriveForeverPassport } from "../forever-passport";
import type { AdvisorySession } from "../types";
import { makeInvestmentRow, makeProject, makeUnit } from "./fixtures";

const SESSION: AdvisorySession = {
  client: {
    clientName: null,
    buyerType: null,
    primaryGoal: null,
    budget: null,
    timeline: null,
    riskProfile: null,
    topPriorities: [],
  },
  recommendations: [
    {
      id: "the-modeva-bang-tao",
      name: "Modeva",
      matchScore: null,
      primaryReason: "Verified project record",
      tradeOff: null,
      confidence: null,
    },
  ],
  strategy: {
    discussFirst: "Verified project record",
    avoidLeadingWith: null,
    showFirstProjectId: "the-modeva-bang-tao",
    mustClarify: null,
    consultationSequence: [],
  },
  risks: [],
};

function passportSection() {
  return screen
    .getByRole("heading", { name: /forever passport/i })
    .closest("section") as HTMLElement;
}

describe("AdvisoryWorkspace with the Forever Passport", () => {
  function renderWorkspace() {
    const project = makeProject();
    expect(project.core.slug).toBe("the-modeva-bang-tao");
    const passport = deriveForeverPassport(project);
    render(<AdvisoryWorkspace session={SESSION} passport={passport} />);
  }

  it("renders the Forever Passport section", () => {
    renderWorkspace();
    expect(screen.getByRole("heading", { name: /forever passport/i })).toBeInTheDocument();
  });

  it("renders all ten required passport sub-sections", () => {
    renderWorkspace();
    const section = passportSection();
    for (const label of [
      /project identity/i,
      /trust intelligence/i,
      /investment/i,
      /rental/i,
      /location/i,
      /overall data completeness/i,
      /combined key data gaps/i,
      /overall advisory readiness/i,
      /evidence coverage/i,
      /passport metadata/i,
    ]) {
      expect(within(section).getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("shows verified identity and marks missing evidence as 'Not available'", () => {
    renderWorkspace();
    const section = passportSection();
    expect(within(section).getByText("the-modeva-bang-tao")).toBeInTheDocument();
    expect(within(section).getAllByText("Not available").length).toBeGreaterThan(0);
  });

  it("never renders a numeric aggregate score", () => {
    renderWorkspace();
    const section = passportSection();
    // No "/100" style score, and the passport advertises no invented score.
    expect(within(section).queryByText(/\/\s*100/)).not.toBeInTheDocument();
    expect(within(section).queryByText(/overall score/i)).not.toBeInTheDocument();
  });

  it("shows the deterministic overall readiness verdict", () => {
    renderWorkspace();
    const section = passportSection();
    // Sparse fixture → most conservative verdict.
    expect(within(section).getAllByText(/insufficient verified data/i).length).toBeGreaterThan(0);
  });

  it("keeps every existing Advisory section rendered alongside the passport", () => {
    renderWorkspace();
    for (const name of [
      /client snapshot/i,
      /best matches/i,
      /advisor strategy/i,
      /risk panel/i,
      /next action/i,
    ]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
  });

  it("does not render the section when no passport is supplied", () => {
    render(<AdvisoryWorkspace session={SESSION} />);
    expect(screen.queryByRole("heading", { name: /forever passport/i })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /risk panel/i })).toBeInTheDocument();
  });

  it("surfaces a ready overall verdict when the record supports every foundation", () => {
    const project = makeProject({
      core: {
        name: "Modeva",
        slug: "the-modeva-bang-tao",
        type: "Condominium",
        location: "Bang Tao",
        address: "1 Beach Road, Bang Tao, Phuket",
        constructionStatus: "Under Construction",
        ownershipType: "Freehold",
      },
      pricing: {
        startingPriceTHB: 5_000_000,
        verifiedPrice: "THB 5,000,000",
        lastPriceUpdate: "2026-01-15",
      },
      trust: {
        foreverVerified: true,
        trustScore: 88,
        trustNote: "Independently inspected on site.",
        marketPosition: "Upper-mid segment",
        verdict: "Forever Verified — strong record",
        lastInspection: "2026-02-01",
      },
      investment: {
        rentalDemand: "Strong",
        rows: [
          makeInvestmentRow({
            expectedMonthlyRent: 40_000,
            occupancyRate: 75,
            annualRoiPercent: 6.5,
            guaranteedRentalPercent: 6,
            guaranteeYears: 3,
            managementCompany: "Forever Rentals",
          }),
        ],
      },
      location: {
        area: "Bang Tao",
        distanceToBeach: "500 m",
        distanceToAirport: "20 km",
        nearbySchools: ["Intl School"],
        nearbyHospitals: ["Clinic"],
        lifestyle: ["Beach club"],
      },
      units: [makeUnit({ basePriceTHB: 5_000_000, rentalGuarantee: "6% for 3 years" })],
    });
    const passport = deriveForeverPassport(project);
    render(<AdvisoryWorkspace session={SESSION} passport={passport} />);
    expect(
      within(passportSection()).getAllByText(/ready for preliminary review/i).length,
    ).toBeGreaterThan(0);
  });
});
