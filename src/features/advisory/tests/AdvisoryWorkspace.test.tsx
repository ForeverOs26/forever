import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AdvisoryWorkspace } from "../AdvisoryWorkspace";
import { ADVISORY_ACTIONS } from "../mock";
import type { AdvisoryRisk, AdvisorySession } from "../types";

const PROJECT_SESSION: AdvisorySession = {
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
      id: "modeva",
      name: "Modeva",
      matchScore: 80,
      primaryReason: "Verified project record",
      tradeOff: "Construction status: Under Construction",
      confidence: null,
    },
  ],
  strategy: {
    discussFirst: "Verified project record",
    avoidLeadingWith: null,
    showFirstProjectId: "modeva",
    mustClarify: null,
    consultationSequence: [],
  },
  risks: [],
};

describe("AdvisoryWorkspace", () => {
  it("renders the workspace with its main heading", () => {
    render(<AdvisoryWorkspace session={PROJECT_SESSION} />);
    expect(
      screen.getByRole("heading", { level: 1, name: /advisory workspace/i }),
    ).toBeInTheDocument();
  });

  it("renders the client snapshot section with the client name", () => {
    render(<AdvisoryWorkspace session={PROJECT_SESSION} />);
    expect(screen.getByRole("heading", { name: /client snapshot/i })).toBeInTheDocument();
    expect(screen.getAllByText("Not available").length).toBeGreaterThan(0);
  });

  it("renders recommendations supplied from the project adapter", () => {
    render(<AdvisoryWorkspace session={PROJECT_SESSION} />);
    const region = screen
      .getByRole("heading", { name: /best matches/i })
      .closest("section") as HTMLElement;
    const cards = within(region).getAllByRole("listitem");
    expect(cards).toHaveLength(1);
    expect(screen.getByText("Modeva")).toBeInTheDocument();
  });

  it("renders the advisor strategy section", () => {
    render(<AdvisoryWorkspace session={PROJECT_SESSION} />);
    expect(screen.getByRole("heading", { name: /advisor strategy/i })).toBeInTheDocument();
    expect(screen.getByText(/private — advisor only/i)).toBeInTheDocument();
  });

  it("renders no more than three risks even when more are supplied", () => {
    const extraRisks: AdvisoryRisk[] = [
      ...Array.from({ length: 3 }, (_, index): AdvisoryRisk => ({
        id: `risk-${index}`,
        title: `Risk ${index}`,
        explanation: "Existing project data gap.",
        severity: "info",
        scope: "data",
      })),
      {
        id: "risk-extra",
        title: "Fourth risk (should not render)",
        explanation: "Exceeds the three-risk cap.",
        severity: "info",
        scope: "data",
      },
    ];
    render(<AdvisoryWorkspace session={{ ...PROJECT_SESSION, risks: extraRisks }} />);
    const region = screen
      .getByRole("heading", { name: /risk panel/i })
      .closest("section") as HTMLElement;
    const rows = within(region).getAllByRole("listitem");
    expect(rows.length).toBeLessThanOrEqual(3);
    expect(rows).toHaveLength(3);
    expect(screen.queryByText(/fourth risk/i)).not.toBeInTheDocument();
  });

  it("renders all five next actions", () => {
    render(<AdvisoryWorkspace session={PROJECT_SESSION} />);
    const region = screen
      .getByRole("heading", { name: /next action/i })
      .closest("section") as HTMLElement;
    const buttons = within(region).getAllByRole("button");
    expect(buttons).toHaveLength(5);
    for (const action of ADVISORY_ACTIONS) {
      expect(
        within(region).getByRole("button", { name: new RegExp(action.label, "i") }),
      ).toBeInTheDocument();
    }
  });

  it("emits the correct action id through onAction", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<AdvisoryWorkspace session={PROJECT_SESSION} onAction={onAction} />);
    await user.click(screen.getByRole("button", { name: /send project passport/i }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith("send-passport");
  });

  it("exposes accessible section headings", () => {
    render(<AdvisoryWorkspace session={PROJECT_SESSION} />);
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
});
