import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { AdvisoryWorkspace } from "../AdvisoryWorkspace";
import { deriveForeverPassport } from "../forever-passport";
import { deriveInvestmentIntelligence } from "../investment-intelligence";
import { deriveProjectSummary } from "../project-summary";
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

function makeRichProject() {
  return makeProject({
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
}

function summarySection() {
  return screen
    .getByRole("heading", { name: /project summary/i })
    .closest("section") as HTMLElement;
}

function renderWorkspace(project = makeRichProject()) {
  const passport = deriveForeverPassport(project);
  const projectSummary = deriveProjectSummary({ project, passport });
  render(
    <AdvisoryWorkspace session={SESSION} passport={passport} projectSummary={projectSummary} />,
  );
  return { passport, projectSummary };
}

describe("AdvisoryWorkspace with the Project Summary", () => {
  it("renders the Project Summary section", () => {
    renderWorkspace();
    expect(screen.getByRole("heading", { name: /project summary/i })).toBeInTheDocument();
  });

  it("renders all seven required summary sub-sections", () => {
    renderWorkspace();
    const section = summarySection();
    for (const label of [
      /executive overview/i,
      /key project facts/i,
      /principal strengths/i,
      /principal considerations/i,
      /suitable buyer profile/i,
      /decision readiness/i,
      /data limitations/i,
    ]) {
      expect(within(section).getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("shows the controlled executive-summary wording", () => {
    renderWorkspace();
    const section = summarySection();
    expect(
      within(section).getByText(
        "Modeva is a Condominium in Bang Tao by Title, currently Under Construction.",
      ),
    ).toBeInTheDocument();
  });

  it("reuses the Passport readiness verdict verbatim", () => {
    const { passport } = renderWorkspace();
    const section = summarySection();
    expect(
      within(section).getAllByText(new RegExp(passport.overallVerdict.readinessVerdict, "i"))
        .length,
    ).toBeGreaterThan(0);
  });

  it("never renders a numeric aggregate score in the summary", () => {
    renderWorkspace();
    const section = summarySection();
    expect(within(section).queryByText(/\/\s*100/)).not.toBeInTheDocument();
    expect(within(section).queryByText(/overall score/i)).not.toBeInTheDocument();
    // The hidden trust score (88) must never leak into the summary.
    expect(within(section).queryByText(/\b88\b/)).not.toBeInTheDocument();
  });

  it("places the Project Summary after the Passport and before the Intelligence foundations", () => {
    const project = makeRichProject();
    const passport = deriveForeverPassport(project);
    const projectSummary = deriveProjectSummary({ project, passport });
    render(
      <AdvisoryWorkspace
        session={SESSION}
        passport={passport}
        projectSummary={projectSummary}
        investmentIntelligence={deriveInvestmentIntelligence(project)}
      />,
    );

    const headings = screen.getAllByRole("heading");
    const text = headings.map((h) => h.textContent ?? "");
    const passportIdx = text.findIndex((t) => /forever passport/i.test(t));
    const summaryIdx = text.findIndex((t) => /project summary/i.test(t));
    const investmentIdx = text.findIndex((t) => /investment intelligence/i.test(t));

    expect(passportIdx).toBeGreaterThanOrEqual(0);
    expect(summaryIdx).toBeGreaterThan(passportIdx);
    expect(investmentIdx).toBeGreaterThan(summaryIdx);
  });

  it("does not render the section when no summary is supplied", () => {
    const project = makeRichProject();
    const passport = deriveForeverPassport(project);
    render(<AdvisoryWorkspace session={SESSION} passport={passport} />);
    expect(screen.queryByRole("heading", { name: /project summary/i })).not.toBeInTheDocument();
    // Existing sections remain untouched.
    expect(screen.getByRole("heading", { name: /forever passport/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /risk panel/i })).toBeInTheDocument();
  });

  it("keeps every existing Advisory section rendered alongside the summary", () => {
    renderWorkspace();
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

  it("marks the buyer profile unavailable via the shared sentinel when unsupported", () => {
    const project = makeProject({
      core: { name: "Modeva", slug: "the-modeva-bang-tao", ownershipType: "" },
      location: { area: "Bang Tao", lifestyle: [], distanceToBeach: "" },
    });
    const passport = deriveForeverPassport(project);
    const projectSummary = deriveProjectSummary({ project, passport });
    render(
      <AdvisoryWorkspace session={SESSION} passport={passport} projectSummary={projectSummary} />,
    );
    const section = summarySection();
    const profile = within(section)
      .getByText(/suitable buyer profile/i)
      .closest("div") as HTMLElement;
    expect(within(profile).getByText("Not available")).toBeInTheDocument();
  });
});
