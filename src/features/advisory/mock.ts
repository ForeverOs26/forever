import type { AdvisoryAction } from "./types";

/** The five deterministic next actions available to an advisor. */
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
