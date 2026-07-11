import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from "@tanstack/react-router";

import { AdvisorReport } from "../components/AdvisorReport";
import { deriveAdvisorReport } from "../advisor-report";
import { deriveForeverPassport } from "../forever-passport";
import { deriveInvestmentIntelligence } from "../investment-intelligence";
import { deriveLocationIntelligence } from "../location-intelligence";
import { deriveProjectComparison } from "../project-comparison";
import { deriveProjectRecommendations } from "../project-recommendations";
import { deriveProjectSummary } from "../project-summary";
import { deriveRentalIntelligence } from "../rental-intelligence";
import type { AdvisorReport as AdvisorReportData } from "../advisor-report";
import { makeInvestmentRow, makeProject, makeUnit } from "./fixtures";

/**
 * Router-level integration test for RC2.8.
 *
 * The original wiring placed `/advisory/report` as a child of `/advisory`, whose
 * component renders no `<Outlet />`; navigating to the report URL therefore
 * rendered the Advisory Workspace instead of the report. The fix escapes the
 * layout nesting (`advisory_.report.tsx`) so `/advisory/report` is a flat route
 * parented at the root. These tests prove the report is reachable and that the
 * Workspace route is unaffected.
 */

function buildReportData(): AdvisorReportData {
  const project = makeProject({
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
  const other = makeProject({
    core: { name: "Coralina", slug: "coralina-layan", type: "Villa", location: "Layan" },
    developer: null,
  });
  const investment = deriveInvestmentIntelligence(project);
  const rental = deriveRentalIntelligence(project);
  const location = deriveLocationIntelligence(project);
  const passport = deriveForeverPassport(project);
  const summary = deriveProjectSummary({ project, passport, investment, rental, location });
  return deriveAdvisorReport({
    project,
    passport,
    summary,
    investment,
    rental,
    location,
    comparison: deriveProjectComparison({
      a: { project, passport, summary },
      b: { project: other },
    }),
    recommendations: deriveProjectRecommendations({
      candidates: [{ project, passport, summary }, { project: other }],
    }),
  });
}

/**
 * Build a router that mirrors the FIXED route structure: `/advisory` and
 * `/advisory/report` are both flat routes parented at the root, and the
 * `/advisory` component renders no `<Outlet />` (exactly like the real
 * `advisory.tsx`). If the report route were re-nested under `/advisory`, the
 * report component would never mount and these assertions would fail.
 */
function makeRouter(initial: string) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const advisoryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/advisory",
    // No <Outlet /> — this is the condition that broke the original nesting.
    component: () => <h2>Risk Panel</h2>,
  });
  const reportData = buildReportData();
  const reportRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/advisory/report",
    component: () => <AdvisorReport data={reportData} />,
  });
  const routeTree = rootRoute.addChildren([advisoryRoute, reportRoute]);
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initial] }),
  });
}

describe("Advisor Report route wiring (RC2.8 fix)", () => {
  it("renders AdvisorReport at /advisory/report (not the Workspace)", async () => {
    render(<RouterProvider router={makeRouter("/advisory/report")} />);
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: /forever advisor report/i }),
      ).toBeInTheDocument();
    });
    // The Workspace-only "Risk Panel" heading must NOT appear on the report route.
    expect(screen.queryByRole("heading", { name: /risk panel/i })).not.toBeInTheDocument();
    // Report sections are reachable through the route.
    expect(
      screen.getByRole("heading", { name: /executive decision overview/i }),
    ).toBeInTheDocument();
  });

  it("still renders the Advisory Workspace at /advisory (no regression)", async () => {
    render(<RouterProvider router={makeRouter("/advisory")} />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /risk panel/i })).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("heading", { level: 1, name: /forever advisor report/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps the report parented at the root in the generated route tree", () => {
    // Structural guard against re-introducing the nesting bug: the generated tree
    // must parent /advisory/report at the root, never at the /advisory route.
    const gen = readFileSync(resolve(process.cwd(), "src/routeTree.gen.ts"), "utf8");
    const match = gen.match(/'\/advisory_\/report':\s*\{[^}]*\}/);
    expect(match, "expected a /advisory_/report route block in routeTree.gen.ts").not.toBeNull();
    expect(match?.[0]).toContain("parentRoute: typeof rootRouteImport");
    expect(match?.[0]).not.toContain("parentRoute: typeof AdvisoryRoute");
  });
});
