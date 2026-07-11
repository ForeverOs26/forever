import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { AdvisoryWorkspace } from "../AdvisoryWorkspace";
import { deriveClientStrategy } from "../client-strategy";
import { deriveForeverPassport } from "../forever-passport";
import { deriveInvestmentIntelligence } from "../investment-intelligence";
import { deriveLocationIntelligence } from "../location-intelligence";
import { deriveProjectRecommendations } from "../project-recommendations";
import { deriveProjectSummary } from "../project-summary";
import { deriveRentalIntelligence } from "../rental-intelligence";
import type { ProjectDetail } from "@/features/project-detail/project-detail-types";
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

function makeRichProject(): ProjectDetail {
  return makeProject({
    core: {
      name: "Modeva",
      slug: "the-modeva-bang-tao",
      type: "Condominium",
      location: "Bang Tao",
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
          guaranteedRentalPercent: 6,
          guaranteeYears: 3,
          managementCompany: "Forever Rentals",
        }),
      ],
    },
    location: {
      area: "Bang Tao",
      distanceToBeach: "500 m",
      lifestyle: ["Beach club"],
    },
    units: [makeUnit({ basePriceTHB: 5_000_000, rentalGuarantee: "6% for 3 years" })],
  });
}

function makeSparseProject(): ProjectDetail {
  return makeProject({
    core: { name: "Coralina", slug: "coralina-layan", type: "Villa", location: "Layan" },
    trust: { foreverVerified: false, trustScore: 0 },
    developer: null,
  });
}

function buildStrategy(project: ProjectDetail) {
  const investment = deriveInvestmentIntelligence(project);
  const rental = deriveRentalIntelligence(project);
  const location = deriveLocationIntelligence(project);
  const passport = deriveForeverPassport(project);
  const summary = deriveProjectSummary({ project, passport, investment, rental, location });
  const recommendations = deriveProjectRecommendations({
    candidates: [{ project, passport, summary }, { project: makeSparseProject() }],
  });
  const clientStrategy = deriveClientStrategy({
    passport,
    summary,
    investment,
    rental,
    location,
    recommendations,
  });
  return { passport, clientStrategy, recommendations };
}

function strategySection() {
  return screen
    .getByRole("heading", { name: /^client strategy$/i })
    .closest("section") as HTMLElement;
}

describe("AdvisoryWorkspace with the Client Strategy", () => {
  it("renders the Client Strategy section when a strategy is supplied", () => {
    const { passport, clientStrategy } = buildStrategy(makeRichProject());
    render(
      <AdvisoryWorkspace session={SESSION} passport={passport} clientStrategy={clientStrategy} />,
    );
    expect(screen.getByRole("heading", { name: /^client strategy$/i })).toBeInTheDocument();
  });

  it("renders all six strategy section titles", () => {
    const { passport, clientStrategy } = buildStrategy(makeRichProject());
    render(
      <AdvisoryWorkspace session={SESSION} passport={passport} clientStrategy={clientStrategy} />,
    );
    const section = strategySection();
    for (const title of [
      /investment strategy/i,
      /purchase strategy/i,
      /rental strategy/i,
      /exit strategy/i,
      /risk strategy/i,
      /action plan/i,
    ]) {
      expect(within(section).getByRole("heading", { name: title })).toBeInTheDocument();
    }
  });

  it("does not render the section when no strategy is supplied (optional rendering)", () => {
    const { passport } = buildStrategy(makeRichProject());
    render(<AdvisoryWorkspace session={SESSION} passport={passport} />);
    expect(screen.queryByRole("heading", { name: /^client strategy$/i })).not.toBeInTheDocument();
    // Existing sections remain untouched.
    expect(screen.getByRole("heading", { name: /forever passport/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /risk panel/i })).toBeInTheDocument();
  });

  it("places the Client Strategy after the Project Recommendations and before the Client Snapshot", () => {
    const { passport, clientStrategy, recommendations } = buildStrategy(makeRichProject());
    render(
      <AdvisoryWorkspace
        session={SESSION}
        passport={passport}
        projectRecommendations={recommendations}
        clientStrategy={clientStrategy}
      />,
    );
    const headings = screen.getAllByRole("heading");
    const text = headings.map((h) => h.textContent ?? "");
    const recommendationsIdx = text.findIndex((t) => /project recommendations/i.test(t));
    const strategyIdx = text.findIndex((t) => /^client strategy$/i.test(t.trim()));
    const snapshotIdx = text.findIndex((t) => /client snapshot/i.test(t));

    expect(recommendationsIdx).toBeGreaterThanOrEqual(0);
    expect(strategyIdx).toBeGreaterThan(recommendationsIdx);
    expect(snapshotIdx).toBeGreaterThan(strategyIdx);
  });

  it("never renders a numeric aggregate score or the hidden trust score", () => {
    const { passport, clientStrategy } = buildStrategy(makeRichProject());
    render(
      <AdvisoryWorkspace session={SESSION} passport={passport} clientStrategy={clientStrategy} />,
    );
    const section = strategySection();
    expect(within(section).queryByText(/\/\s*100/)).not.toBeInTheDocument();
    expect(within(section).queryByText(/overall score/i)).not.toBeInTheDocument();
    expect(within(section).queryByText(/\b88\b/)).not.toBeInTheDocument();
  });

  it('shows "Not available" for missing evidence on a sparse project', () => {
    const { passport, clientStrategy } = buildStrategy(makeSparseProject());
    render(
      <AdvisoryWorkspace session={SESSION} passport={passport} clientStrategy={clientStrategy} />,
    );
    const section = strategySection();
    expect(within(section).getAllByText(/not available/i).length).toBeGreaterThan(0);
  });

  it("exposes accessible, labelled strategy sub-sections", () => {
    const { passport, clientStrategy } = buildStrategy(makeRichProject());
    render(
      <AdvisoryWorkspace session={SESSION} passport={passport} clientStrategy={clientStrategy} />,
    );
    const heading = screen.getByRole("heading", { name: /^client strategy$/i });
    const region = heading.closest("section") as HTMLElement;
    expect(region).toHaveAttribute("aria-labelledby", heading.id);
  });

  it("keeps every existing Advisory section rendered alongside the strategy (no regression)", () => {
    const { passport, clientStrategy } = buildStrategy(makeRichProject());
    render(
      <AdvisoryWorkspace session={SESSION} passport={passport} clientStrategy={clientStrategy} />,
    );
    for (const name of [
      /forever passport/i,
      /client snapshot/i,
      /best matches/i,
      /advisor strategy/i,
      /risk panel/i,
      /next action/i,
    ]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
  });
});
