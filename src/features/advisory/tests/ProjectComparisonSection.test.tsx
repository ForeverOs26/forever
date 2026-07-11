import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { AdvisoryWorkspace } from "../AdvisoryWorkspace";
import { deriveForeverPassport } from "../forever-passport";
import { deriveInvestmentIntelligence } from "../investment-intelligence";
import { deriveProjectComparison } from "../project-comparison";
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

function comparisonSection() {
  return screen
    .getByRole("heading", { name: /project comparison/i })
    .closest("section") as HTMLElement;
}

function buildComparison() {
  const a = makeRichProject();
  const b = makeSparseProject();
  const passport = deriveForeverPassport(a);
  const projectComparison = deriveProjectComparison({
    a: { project: a, passport },
    b: { project: b },
  });
  return { a, passport, projectComparison };
}

describe("AdvisoryWorkspace with the Project Comparison", () => {
  it("renders the Project Comparison section when a comparison is supplied", () => {
    const { passport, projectComparison } = buildComparison();
    render(
      <AdvisoryWorkspace
        session={SESSION}
        passport={passport}
        projectComparison={projectComparison}
      />,
    );
    expect(screen.getByRole("heading", { name: /project comparison/i })).toBeInTheDocument();
  });

  it("renders all required comparison sub-sections", () => {
    const { passport, projectComparison } = buildComparison();
    render(
      <AdvisoryWorkspace
        session={SESSION}
        passport={passport}
        projectComparison={projectComparison}
      />,
    );
    const section = comparisonSection();
    for (const label of [
      /compared projects/i,
      /trust/i,
      /investment/i,
      /rental/i,
      /location/i,
      /strength comparison/i,
      /consideration comparison/i,
      /buyer profile comparison/i,
      /decision readiness comparison/i,
      /evidence completeness comparison/i,
    ]) {
      expect(within(section).getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("shows both compared project names", () => {
    const { passport, projectComparison } = buildComparison();
    render(
      <AdvisoryWorkspace
        session={SESSION}
        passport={passport}
        projectComparison={projectComparison}
      />,
    );
    const section = comparisonSection();
    expect(within(section).getAllByText(/Modeva/).length).toBeGreaterThan(0);
    expect(within(section).getAllByText(/Coralina/).length).toBeGreaterThan(0);
  });

  it("never renders a numeric aggregate score or the hidden trust score", () => {
    const { passport, projectComparison } = buildComparison();
    render(
      <AdvisoryWorkspace
        session={SESSION}
        passport={passport}
        projectComparison={projectComparison}
      />,
    );
    const section = comparisonSection();
    expect(within(section).queryByText(/\/\s*100/)).not.toBeInTheDocument();
    expect(within(section).queryByText(/overall score/i)).not.toBeInTheDocument();
    expect(within(section).queryByText(/\b88\b/)).not.toBeInTheDocument();
  });

  it("places the Project Comparison after the Project Summary and before the Intelligence foundations", () => {
    const a = makeRichProject();
    const b = makeSparseProject();
    const passport = deriveForeverPassport(a);
    const projectComparison = deriveProjectComparison({
      a: { project: a, passport },
      b: { project: b },
    });
    render(
      <AdvisoryWorkspace
        session={SESSION}
        passport={passport}
        projectComparison={projectComparison}
        investmentIntelligence={deriveInvestmentIntelligence(a)}
      />,
    );

    const headings = screen.getAllByRole("heading");
    const text = headings.map((h) => h.textContent ?? "");
    const passportIdx = text.findIndex((t) => /forever passport/i.test(t));
    const comparisonIdx = text.findIndex((t) => /project comparison/i.test(t));
    const investmentIdx = text.findIndex((t) => /investment intelligence/i.test(t));

    expect(passportIdx).toBeGreaterThanOrEqual(0);
    expect(comparisonIdx).toBeGreaterThan(passportIdx);
    expect(investmentIdx).toBeGreaterThan(comparisonIdx);
  });

  it("does not render the section when no comparison is supplied (optional rendering)", () => {
    const { passport } = buildComparison();
    render(<AdvisoryWorkspace session={SESSION} passport={passport} />);
    expect(screen.queryByRole("heading", { name: /project comparison/i })).not.toBeInTheDocument();
    // Existing sections remain untouched.
    expect(screen.getByRole("heading", { name: /forever passport/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /risk panel/i })).toBeInTheDocument();
  });

  it("keeps every existing Advisory section rendered alongside the comparison (no regression)", () => {
    const { passport, projectComparison } = buildComparison();
    render(
      <AdvisoryWorkspace
        session={SESSION}
        passport={passport}
        projectComparison={projectComparison}
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
