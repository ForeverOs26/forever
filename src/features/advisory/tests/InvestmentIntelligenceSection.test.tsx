import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { AdvisoryWorkspace } from "../AdvisoryWorkspace";
import { deriveInvestmentIntelligence } from "../investment-intelligence";
import type { AdvisorySession } from "../types";
import { makeProject } from "./fixtures";

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

describe("AdvisoryWorkspace with Investment Intelligence", () => {
  function renderWorkspace() {
    const investmentIntelligence = deriveInvestmentIntelligence(makeProject());
    render(<AdvisoryWorkspace session={SESSION} investmentIntelligence={investmentIntelligence} />);
  }

  it("renders the Investment Intelligence section", () => {
    renderWorkspace();
    expect(screen.getByRole("heading", { name: /investment intelligence/i })).toBeInTheDocument();
  });

  it("shows missing investment fields as 'Not available'", () => {
    renderWorkspace();
    const section = screen
      .getByRole("heading", { name: /investment intelligence/i })
      .closest("section") as HTMLElement;
    expect(within(section).getAllByText("Not available").length).toBeGreaterThan(0);
  });

  it("shows 'Investment score not available' and never a numeric score", () => {
    renderWorkspace();
    const section = screen
      .getByRole("heading", { name: /investment intelligence/i })
      .closest("section") as HTMLElement;
    expect(within(section).getByText("Investment score not available")).toBeInTheDocument();
    // Trust score (0 in the fixture) must not leak in as a numeric score.
    expect(within(section).queryByText(/investment score:?\s*\d/i)).not.toBeInTheDocument();
  });

  it("renders a conservative readiness verdict", () => {
    renderWorkspace();
    expect(screen.getByText(/insufficient verified data/i)).toBeInTheDocument();
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

  it("does not render the section when no investment intelligence is supplied", () => {
    render(<AdvisoryWorkspace session={SESSION} />);
    expect(
      screen.queryByRole("heading", { name: /investment intelligence/i }),
    ).not.toBeInTheDocument();
    // Existing sections remain.
    expect(screen.getByRole("heading", { name: /risk panel/i })).toBeInTheDocument();
  });
});

describe("Advisory route project identity", () => {
  it("keeps the loaded Modeva slug as 'the-modeva-bang-tao'", () => {
    const routePath = resolve(process.cwd(), "src/routes/advisory.tsx");
    const source = readFileSync(routePath, "utf8");
    expect(source).toContain('ADVISORY_PROJECT_SLUG = "the-modeva-bang-tao"');
  });
});
