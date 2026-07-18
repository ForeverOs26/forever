/**
 * Forever Story generation — the templated reflection, facets, and archetype.
 *
 * Moved verbatim from NavigatorFlow.tsx so both shells generate the identical
 * Story from an identical answer set. The booth Story ledger reuses these facets;
 * it never regenerates or reinterprets them.
 */

import {
  budgetLabel,
  concernLabels,
  goalLabels,
  humanizeList,
  motivationLabels,
  timelineLabel,
} from "./questions";
import { isProfileComplete, type NavigatorAnswers } from "./decision-profile";

export type StoryStatus = "idle" | "loading" | "resolved" | "error";

export interface StoryFacet {
  label: string;
  value: string;
}

export interface ForeverStory {
  reflection: string;
  facets: StoryFacet[];
  profileLabel: string;
  profileDescription: string;
}

export const DEFAULT_FOREVER_STORY: ForeverStory = {
  reflection:
    "You're not rushing toward Phuket — you're moving toward a certain kind of life. A place by the sea where things slow down, that's genuinely yours and genuinely private. You'd like to feel sure of the decision, which is why the ownership questions matter to you more than the view. There's no hurry. You'll know it when it's right.",
  facets: [
    {
      label: "Why Phuket",
      value: "A second home by the sea, and a slower way of living.",
    },
    {
      label: "What you're hoping for",
      value: "Somewhere that feels like home — with real peace and privacy.",
    },
    {
      label: "What matters most",
      value: "Certainty over yield. You'd rather be right than quick.",
    },
    {
      label: "Where you feel unsure",
      value: "Legal & ownership — the part that feels least familiar.",
    },
    {
      label: "Your horizon",
      value: "Unhurried — six to twelve months, ready when it's right.",
    },
  ],
  profileLabel: "The Considered Retreat-Seeker",
  profileDescription:
    "You'll choose slowly, and once. Guidance matters more to you than options — you want the right decision, not the most choice.",
};

export function buildForeverStory(answers: NavigatorAnswers): ForeverStory {
  if (!isProfileComplete(answers)) {
    return DEFAULT_FOREVER_STORY;
  }

  const { motivations, goals, budget, timeline, concerns } = answers;
  const whyLabels = motivationLabels(motivations);
  const goalLabelList = goalLabels(goals);
  const concernLabelList = concernLabels(concerns);
  const why = humanizeList(whyLabels).toLowerCase();
  const success = humanizeList(goalLabelList).toLowerCase();
  const concern = humanizeList(concernLabelList).toLowerCase();
  const budgetText = budgetLabel(budget).toLowerCase();
  const timelineText = timelineLabel(timeline).toLowerCase();

  return {
    reflection: `You're drawn to Phuket for ${why}. Success, for you, looks like ${success} — and with ${budgetText} over ${timelineText}, the thing that matters most is navigating ${concern}.`,
    facets: [
      { label: "Why Phuket", value: `${humanizeList(whyLabels)}.` },
      {
        label: "What you're hoping for",
        value: `${humanizeList(goalLabelList)}.`,
      },
      {
        label: "What matters most",
        value: concerns.includes("ownership")
          ? "Certainty over yield. You'd rather be right than quick."
          : "A clear decision that fits the life you're trying to build.",
      },
      {
        label: "Where you feel unsure",
        value: `${humanizeList(concernLabelList)}.`,
      },
      {
        label: "Your horizon",
        value: `${timelineLabel(timeline)} — ready when it's right.`,
      },
    ],
    profileLabel: "The Considered Retreat-Seeker",
    profileDescription:
      "You'll choose slowly, and once. Guidance matters more to you than options — you want the right decision, not the most choice.",
  };
}
