/**
 * Booth stage labels and mini-progress, derived purely from the shared session
 * screen. Presentation-only: the mapping lives in the booth shell, never in the
 * core.
 */

import type { SessionScreen } from "../core";

export interface BoothStage {
  label: string;
  /** 1-based counted-question number, when on a NAV-001 question screen. */
  questionNumber: number | null;
  /** 0–1 progress across the booth journey, for the header mini-bar. */
  progress: number;
}

const STAGE_SEQUENCE: SessionScreen[] = [
  "welcome",
  "why_phuket",
  "success",
  "budget_timeline",
  "concern",
  "forever_story",
  "recommendation",
  "selected",
  "contact",
  "confirmation",
];

const QUESTION_NUMBER: Partial<Record<SessionScreen, number>> = {
  why_phuket: 1,
  success: 2,
  budget_timeline: 3,
  concern: 4,
};

export const BOOTH_TOTAL_QUESTIONS = 4;

export function boothStage(screen: SessionScreen): BoothStage {
  const questionNumber = QUESTION_NUMBER[screen] ?? null;
  const index = Math.max(0, STAGE_SEQUENCE.indexOf(screen));
  const progress = STAGE_SEQUENCE.length > 1 ? index / (STAGE_SEQUENCE.length - 1) : 0;

  let label: string;
  switch (screen) {
    case "welcome":
      label = "Welcome";
      break;
    case "why_phuket":
    case "success":
    case "budget_timeline":
    case "concern":
      label = `Question ${String(questionNumber).padStart(2, "0")} of ${String(
        BOOTH_TOTAL_QUESTIONS,
      ).padStart(2, "0")}`;
      break;
    case "forever_story":
      label = "Forever Story";
      break;
    case "recommendation":
      label = "Matching projects";
      break;
    case "selected":
      label = "Selected project";
      break;
    case "contact":
      label = "Contact details";
      break;
    case "confirmation":
      label = "Complete";
      break;
    default:
      label = "Welcome";
  }

  return { label, questionNumber, progress };
}
