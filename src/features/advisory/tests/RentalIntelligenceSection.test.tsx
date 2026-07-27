import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { AdvisoryWorkspace } from "../AdvisoryWorkspace";
import { deriveRentalIntelligence } from "../rental-intelligence";
import type { AdvisorySession } from "../types";
import { makeInvestmentRow, makeProject } from "./fixtures";

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

function rentalSection() {
  return screen
    .getByRole("heading", { name: /rental intelligence/i })
    .closest("section") as HTMLElement;
}

describe("AdvisoryWorkspace with Rental Intelligence", () => {
  function renderWorkspace() {
    const rentalIntelligence = deriveRentalIntelligence(makeProject());
    render(<AdvisoryWorkspace session={SESSION} rentalIntelligence={rentalIntelligence} />);
  }

  it("renders the Rental Intelligence section", () => {
    renderWorkspace();
    expect(screen.getByRole("heading", { name: /rental intelligence/i })).toBeInTheDocument();
  });

  it("shows missing rental fields as 'Not available'", () => {
    renderWorkspace();
    expect(within(rentalSection()).getAllByText("Not available").length).toBeGreaterThan(0);
  });

  it("shows 'Rental score not available' and never a numeric score", () => {
    renderWorkspace();
    const section = rentalSection();
    expect(within(section).getByText("Rental score not available")).toBeInTheDocument();
    // Trust score (0 in the fixture) must not leak in as a numeric score.
    expect(within(section).queryByText(/rental score:?\s*\d/i)).not.toBeInTheDocument();
  });

  it("renders a conservative readiness verdict", () => {
    renderWorkspace();
    expect(screen.getByText(/insufficient verified data/i)).toBeInTheDocument();
  });

  it("surfaces verified evidence when the record supports it", () => {
    const rentalIntelligence = deriveRentalIntelligence(
      makeProject({
        investment: {
          rentalDemand: "High",
          rows: [
            makeInvestmentRow({
              expectedMonthlyRent: 40_000,
              occupancyRate: 80,
              annualRoiPercent: 6,
              managementCompany: "Acme Rentals",
            }),
          ],
        },
      }),
    );
    render(<AdvisoryWorkspace session={SESSION} rentalIntelligence={rentalIntelligence} />);
    const section = rentalSection();
    expect(within(section).getByText("Recorded rental demand: High")).toBeInTheDocument();
    expect(within(section).getByText("Managed by Acme Rentals")).toBeInTheDocument();
    expect(within(section).getByText(/ready for preliminary review/i)).toBeInTheDocument();
    // No raw occupancy / ROI / rent figures leak into the DOM.
    expect(within(section).queryByText(/80|40,?000|\b6\b|%/)).not.toBeInTheDocument();
  });

  it("keeps every existing Advisory section rendered alongside the new one", () => {
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

  it("does not render the section when no rental intelligence is supplied", () => {
    render(<AdvisoryWorkspace session={SESSION} />);
    expect(
      screen.queryByRole("heading", { name: /rental intelligence/i }),
    ).not.toBeInTheDocument();
    // Existing sections remain.
    expect(screen.getByRole("heading", { name: /risk panel/i })).toBeInTheDocument();
  });
});
