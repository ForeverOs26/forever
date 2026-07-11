import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { AdvisoryWorkspace } from "../AdvisoryWorkspace";
import { deriveLocationIntelligence } from "../location-intelligence";
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

function locationSection() {
  return screen
    .getByRole("heading", { name: /location intelligence/i })
    .closest("section") as HTMLElement;
}

describe("AdvisoryWorkspace with Location Intelligence", () => {
  function renderWorkspace() {
    const project = makeProject();
    // The verified Modeva seed keeps its canonical slug.
    expect(project.core.slug).toBe("the-modeva-bang-tao");
    const locationIntelligence = deriveLocationIntelligence(project);
    render(<AdvisoryWorkspace session={SESSION} locationIntelligence={locationIntelligence} />);
  }

  it("renders the Location Intelligence section", () => {
    renderWorkspace();
    expect(screen.getByRole("heading", { name: /location intelligence/i })).toBeInTheDocument();
  });

  it("shows the recorded area identity and missing fields as 'Not available'", () => {
    renderWorkspace();
    const section = locationSection();
    expect(within(section).getByText("Bang Tao")).toBeInTheDocument();
    expect(within(section).getAllByText("Not available").length).toBeGreaterThan(0);
  });

  it("shows 'Location score not available' and never a numeric score", () => {
    renderWorkspace();
    const section = locationSection();
    expect(within(section).getByText("Location score not available")).toBeInTheDocument();
    // Trust score (0 in the fixture) must not leak in as a numeric score.
    expect(within(section).queryByText(/location score:?\s*\d/i)).not.toBeInTheDocument();
  });

  it("never renders a fabricated distance or travel-time value", () => {
    renderWorkspace();
    const section = locationSection();
    // The sparse fixture has no recorded beach/airport distance, so the derived
    // evidence values render as "Not available" and no numeric distance or
    // travel-time VALUE may appear. (The static disclaimer copy legitimately
    // mentions travel times; a value is the only place data could be faked.)
    expect(within(section).getAllByText("Not available").length).toBeGreaterThanOrEqual(2);
    expect(within(section).queryByText(/\d+\s*(km|min|minutes|hours)/i)).not.toBeInTheDocument();
    expect(within(section).queryByText(/\bRecorded:/i)).not.toBeInTheDocument();
  });

  it("renders a conservative readiness verdict", () => {
    renderWorkspace();
    expect(within(locationSection()).getByText(/more evidence required/i)).toBeInTheDocument();
  });

  it("surfaces verified location evidence when the record supports it", () => {
    const locationIntelligence = deriveLocationIntelligence(
      makeProject({
        core: { location: "Bang Tao", address: "1 Beach Road" },
        location: {
          area: "Bang Tao",
          latitude: null,
          longitude: null,
          distanceToBeach: "500 m",
          distanceToAirport: "20 km",
          nearbySchools: [],
          nearbyHospitals: [],
          lifestyle: ["Beach club"],
        },
      }),
    );
    render(<AdvisoryWorkspace session={SESSION} locationIntelligence={locationIntelligence} />);
    const section = locationSection();
    expect(within(section).getByText("Recorded: 500 m")).toBeInTheDocument();
    expect(within(section).getByText("Recorded: 20 km")).toBeInTheDocument();
    expect(within(section).getByText(/ready for preliminary review/i)).toBeInTheDocument();
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

  it("does not render the section when no location intelligence is supplied", () => {
    render(<AdvisoryWorkspace session={SESSION} />);
    expect(
      screen.queryByRole("heading", { name: /location intelligence/i }),
    ).not.toBeInTheDocument();
    // Existing sections remain.
    expect(screen.getByRole("heading", { name: /risk panel/i })).toBeInTheDocument();
  });
});
