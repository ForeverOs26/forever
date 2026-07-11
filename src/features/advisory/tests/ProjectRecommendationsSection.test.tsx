import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { AdvisoryWorkspace } from "../AdvisoryWorkspace";
import { deriveForeverPassport } from "../forever-passport";
import { deriveInvestmentIntelligence } from "../investment-intelligence";
import { deriveProjectComparison } from "../project-comparison";
import { deriveProjectRecommendations } from "../project-recommendations";
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
    developer: null,
  });
}

function recommendationsSection() {
  return screen
    .getByRole("heading", { name: /project recommendations/i })
    .closest("section") as HTMLElement;
}

function buildRecommendations() {
  const a = makeRichProject();
  const b = makeSparseProject();
  const passport = deriveForeverPassport(a);
  const projectRecommendations = deriveProjectRecommendations({
    candidates: [{ project: a, passport }, { project: b }],
  });
  return { a, passport, projectRecommendations };
}

describe("AdvisoryWorkspace with the Project Recommendations", () => {
  it("renders the Project Recommendations section when recommendations are supplied", () => {
    const { passport, projectRecommendations } = buildRecommendations();
    render(
      <AdvisoryWorkspace
        session={SESSION}
        passport={passport}
        projectRecommendations={projectRecommendations}
      />,
    );
    expect(screen.getByRole("heading", { name: /project recommendations/i })).toBeInTheDocument();
  });

  it("renders the ranked candidate names and the leading candidate", () => {
    const { passport, projectRecommendations } = buildRecommendations();
    render(
      <AdvisoryWorkspace
        session={SESSION}
        passport={passport}
        projectRecommendations={projectRecommendations}
      />,
    );
    const section = recommendationsSection();
    expect(within(section).getByText(/leading candidate/i)).toBeInTheDocument();
    expect(within(section).getAllByText(/Modeva/).length).toBeGreaterThan(0);
    expect(within(section).getAllByText(/Coralina/).length).toBeGreaterThan(0);
    expect(within(section).getByText(/Rank 1/)).toBeInTheDocument();
    expect(within(section).getByText(/Rank 2/)).toBeInTheDocument();
  });

  it("never renders a numeric aggregate score or the hidden trust score", () => {
    const { passport, projectRecommendations } = buildRecommendations();
    render(
      <AdvisoryWorkspace
        session={SESSION}
        passport={passport}
        projectRecommendations={projectRecommendations}
      />,
    );
    const section = recommendationsSection();
    expect(within(section).queryByText(/\/\s*100/)).not.toBeInTheDocument();
    expect(within(section).queryByText(/overall score/i)).not.toBeInTheDocument();
    expect(within(section).queryByText(/\b88\b/)).not.toBeInTheDocument();
  });

  it("places the Project Recommendations after the Project Comparison and before the Intelligence foundations", () => {
    const a = makeRichProject();
    const b = makeSparseProject();
    const passport = deriveForeverPassport(a);
    const projectComparison = deriveProjectComparison({
      a: { project: a, passport },
      b: { project: b },
    });
    const projectRecommendations = deriveProjectRecommendations({
      candidates: [{ project: a, passport }, { project: b }],
    });
    render(
      <AdvisoryWorkspace
        session={SESSION}
        passport={passport}
        projectComparison={projectComparison}
        projectRecommendations={projectRecommendations}
        investmentIntelligence={deriveInvestmentIntelligence(a)}
      />,
    );

    const headings = screen.getAllByRole("heading");
    const text = headings.map((h) => h.textContent ?? "");
    const comparisonIdx = text.findIndex((t) => /project comparison/i.test(t));
    const recommendationsIdx = text.findIndex((t) => /project recommendations/i.test(t));
    const investmentIdx = text.findIndex((t) => /investment intelligence/i.test(t));

    expect(comparisonIdx).toBeGreaterThanOrEqual(0);
    expect(recommendationsIdx).toBeGreaterThan(comparisonIdx);
    expect(investmentIdx).toBeGreaterThan(recommendationsIdx);
  });

  it("does not render the section when no recommendations are supplied (optional rendering)", () => {
    const { passport } = buildRecommendations();
    render(<AdvisoryWorkspace session={SESSION} passport={passport} />);
    expect(
      screen.queryByRole("heading", { name: /project recommendations/i }),
    ).not.toBeInTheDocument();
    // Existing sections remain untouched.
    expect(screen.getByRole("heading", { name: /forever passport/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /risk panel/i })).toBeInTheDocument();
  });

  it("keeps every existing Advisory section rendered alongside the recommendations (no regression)", () => {
    const { passport, projectRecommendations } = buildRecommendations();
    render(
      <AdvisoryWorkspace
        session={SESSION}
        passport={passport}
        projectRecommendations={projectRecommendations}
      />,
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
