import { describe, expect, it, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";

import { AdvisorReport } from "../components/AdvisorReport";
import { AdvisoryWorkspace } from "../AdvisoryWorkspace";
import { deriveAdvisorReport } from "../advisor-report";
import { deriveForeverPassport } from "../forever-passport";
import { deriveInvestmentIntelligence } from "../investment-intelligence";
import { deriveLocationIntelligence } from "../location-intelligence";
import { deriveProjectComparison } from "../project-comparison";
import { deriveProjectRecommendations } from "../project-recommendations";
import { deriveProjectSummary } from "../project-summary";
import { deriveRentalIntelligence } from "../rental-intelligence";
import type { AdvisorReport as AdvisorReportData } from "../advisor-report";
import type { ProjectDetail } from "@/features/project-detail/project-detail-types";
import type { AdvisorySession } from "../types";
import { makeInvestmentRow, makeProject, makeUnit } from "./fixtures";

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
    pricing: { startingPriceTHB: 5_000_000, verifiedPrice: "THB 5,000,000" },
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
      rows: [makeInvestmentRow({ expectedMonthlyRent: 40_000, guaranteedRentalPercent: 6 })],
    },
    location: { area: "Bang Tao", distanceToBeach: "500 m", lifestyle: ["Beach club"] },
    units: [makeUnit({ basePriceTHB: 5_000_000 })],
  });
}

function makeSparseProject(): ProjectDetail {
  return makeProject({
    core: { name: "Coralina", slug: "coralina-layan", type: "Villa", location: "Layan" },
    developer: null,
  });
}

function buildReportData(
  opts: { optional?: boolean; generatedAt?: string } = {},
): AdvisorReportData {
  const project = makeRichProject();
  const investment = deriveInvestmentIntelligence(project);
  const rental = deriveRentalIntelligence(project);
  const location = deriveLocationIntelligence(project);
  const passport = deriveForeverPassport(project);
  const summary = deriveProjectSummary({ project, passport, investment, rental, location });
  const other = makeSparseProject();
  return deriveAdvisorReport({
    project,
    passport,
    summary,
    investment,
    rental,
    location,
    comparison: opts.optional
      ? deriveProjectComparison({ a: { project, passport, summary }, b: { project: other } })
      : undefined,
    recommendations: opts.optional
      ? deriveProjectRecommendations({
          candidates: [{ project, passport, summary }, { project: other }],
        })
      : undefined,
    generatedAt: opts.generatedAt,
  });
}

describe("AdvisorReport component", () => {
  it("renders the cover with Forever branding and the project name", () => {
    render(<AdvisorReport data={buildReportData()} />);
    expect(
      screen.getByRole("heading", { level: 1, name: /forever advisor report/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Modeva/).length).toBeGreaterThan(0);
  });

  it("14. exposes a Print / Save as PDF action", () => {
    render(<AdvisorReport data={buildReportData()} />);
    expect(screen.getByRole("button", { name: /print \/ save as pdf/i })).toBeInTheDocument();
  });

  it("14b. invokes the print handler when the action is clicked", () => {
    const onPrint = vi.fn();
    render(<AdvisorReport data={buildReportData()} onPrint={onPrint} />);
    fireEvent.click(screen.getByRole("button", { name: /print \/ save as pdf/i }));
    expect(onPrint).toHaveBeenCalledTimes(1);
  });

  it("15. marks interactive controls as no-print (screen-only)", () => {
    const { container } = render(<AdvisorReport data={buildReportData()} />);
    const button = screen.getByRole("button", { name: /print \/ save as pdf/i });
    // The toolbar wrapping the control carries the no-print class.
    expect(button.closest(".advisor-report__noprint")).not.toBeNull();
    // A print stylesheet is present and hides the no-print controls when printing.
    const style = container.querySelector("style");
    expect(style?.textContent).toContain("@media print");
    expect(style?.textContent).toContain(".advisor-report__noprint");
    expect(style?.textContent).toContain("size: A4");
  });

  it("16. renders sections in report order", () => {
    render(<AdvisorReport data={buildReportData({ optional: true })} />);
    const headings = screen.getAllByRole("heading").map((h) => (h.textContent ?? "").toLowerCase());
    const order = [
      "forever advisor report",
      "executive decision overview",
      "project identity",
      "principal strengths",
      "principal considerations",
      "suitable buyer profile",
      "investment intelligence",
      "rental intelligence",
      "location intelligence",
      "trust & evidence readiness",
      "project comparison",
      "project recommendations",
      "data limitations",
      "advisory disclaimer",
    ];
    const indices = order.map((label) => headings.findIndex((h) => h.includes(label)));
    for (const idx of indices) expect(idx).toBeGreaterThanOrEqual(0);
    const sorted = [...indices].sort((a, b) => a - b);
    expect(indices).toEqual(sorted);
  });

  it("omits the optional comparison / recommendations sections when absent", () => {
    render(<AdvisorReport data={buildReportData()} />);
    expect(screen.queryByRole("heading", { name: /project comparison/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /project recommendations/i }),
    ).not.toBeInTheDocument();
  });

  it("8. never renders the hidden numeric trust score", () => {
    render(<AdvisorReport data={buildReportData({ optional: true })} />);
    expect(screen.queryByText(/\b88\b/)).not.toBeInTheDocument();
    expect(screen.queryByText(/trustscore/i)).not.toBeInTheDocument();
  });

  it("17. contains no promotional wording", () => {
    const { container } = render(<AdvisorReport data={buildReportData({ optional: true })} />);
    const text = (container.textContent ?? "").toLowerCase();
    for (const banned of [
      "best investment",
      "safe investment",
      "guaranteed return",
      "risk-free",
      "unbeatable",
      "must buy",
    ]) {
      expect(text).not.toContain(banned);
    }
  });

  it("12. shows the report date only when supplied", () => {
    const { rerender } = render(<AdvisorReport data={buildReportData()} />);
    expect(screen.queryByText(/report date:/i)).not.toBeInTheDocument();
    rerender(<AdvisorReport data={buildReportData({ generatedAt: "2026-07-11" })} />);
    expect(screen.getByText(/report date: 2026-07-11/i)).toBeInTheDocument();
  });
});

describe("Advisory Workspace regression", () => {
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
    recommendations: [],
    strategy: {
      discussFirst: null,
      avoidLeadingWith: null,
      showFirstProjectId: "the-modeva-bang-tao",
      mustClarify: null,
      consultationSequence: [],
    },
    risks: [],
  };

  it("18. does not inject the Advisor Report into the Advisory Workspace", () => {
    const passport = deriveForeverPassport(makeRichProject());
    render(<AdvisoryWorkspace session={SESSION} passport={passport} />);
    // The report is an isolated view; the Workspace still renders its own sections.
    expect(screen.getByRole("heading", { name: /forever passport/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /risk panel/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 1, name: /forever advisor report/i }),
    ).not.toBeInTheDocument();
  });
});
