/**
 * Forever Advisory Workspace RC1 — Deterministic mock data.
 *
 * DEMO DATA ONLY. Every value here is illustrative and clearly labelled as
 * such. No factual claims about real projects are made beyond names that
 * already exist in the Forever pipeline (Modeva, Coralina). The third project
 * is an explicit placeholder. No network, no randomness, no side effects.
 */

import type { AdvisoryAction, AdvisorySession } from "./types";

/** The five next actions available to an advisor. Order is intentional. */
export const ADVISORY_ACTIONS: readonly AdvisoryAction[] = [
  {
    id: "send-passport",
    label: "Send Project Passport",
    description: "Share the curated project brief with the client.",
  },
  {
    id: "book-viewing",
    label: "Book Viewing",
    description: "Reserve an in-person or virtual project viewing.",
  },
  {
    id: "compare-projects",
    label: "Compare Projects",
    description: "Open a side-by-side comparison of the shortlist.",
  },
  {
    id: "request-missing-info",
    label: "Request Missing Information",
    description: "Ask the client to confirm the outstanding details.",
  },
  {
    id: "schedule-follow-up",
    label: "Schedule Follow-up",
    description: "Set the next touchpoint after the consultation.",
  },
] as const;

/**
 * A single, fully-resolved demo session. Deterministic and self-contained.
 * Consumers may pass their own `AdvisorySession`; this is the default sample.
 */
export const DEMO_SESSION: AdvisorySession = {
  client: {
    clientName: "Client A · Demo",
    buyerType: "Investor",
    primaryGoal: "Rental yield with a clear resale horizon (demo goal).",
    budget: "$450k – $600k (demo range)",
    timeline: "6-12 months",
    riskProfile: "Balanced",
    topPriorities: ["Predictable rental demand", "Completion certainty", "Exit liquidity"],
  },
  recommendations: [
    {
      id: "modeva",
      name: "Modeva",
      matchScore: 88,
      primaryReason: "Aligns with a balanced yield-and-resale profile (demo).",
      tradeOff: "Longer stated timeline than the client's ideal (demo).",
      confidence: "High",
    },
    {
      id: "coralina",
      name: "Coralina",
      matchScore: 81,
      primaryReason: "Strong rental-demand signal in demo dataset.",
      tradeOff: "Upper end of the client's budget band (demo).",
      confidence: "Medium",
    },
    {
      id: "placeholder-project",
      name: "Placeholder Project (Demo)",
      matchScore: 74,
      primaryReason: "Reserved slot for a pipeline project (placeholder).",
      tradeOff: "Details pending integration — do not present as real.",
      confidence: "Low",
      isPlaceholder: true,
    },
  ],
  strategy: {
    discussFirst: "Confirm the client's real exit horizon before discussing yield.",
    avoidLeadingWith: "Don't open with price — it narrows the conversation prematurely.",
    showFirstProjectId: "modeva",
    mustClarify: "Is the stated budget firm, or flexible for a stronger match?",
    consultationSequence: [
      "Reframe the primary goal in the client's own words.",
      "Present Modeva as the anchor recommendation.",
      "Contrast with Coralina on demand vs. budget.",
      "Note the placeholder slot without over-committing.",
      "Close on a single, concrete next action.",
    ],
  },
  risks: [
    {
      id: "risk-budget-fit",
      title: "Budget band under pressure",
      explanation: "Top match sits near the client's budget ceiling (demo).",
      severity: "attention",
      scope: "client",
    },
    {
      id: "risk-timeline-gap",
      title: "Timeline mismatch",
      explanation: "Anchor project's stated completion is later than preferred (demo).",
      severity: "attention",
      scope: "project",
    },
    {
      id: "risk-data-gap",
      title: "Placeholder data incomplete",
      explanation: "Third recommendation is a placeholder pending integration.",
      severity: "critical",
      scope: "data",
    },
  ],
};
