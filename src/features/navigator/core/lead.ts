/**
 * Booth lead handoff mapping.
 *
 * Maps a confirmed booth session onto the EXISTING lead-service contract
 * (`LeadFormValues` → `submitLead`). No new table, migration, or backend: the
 * booth reuses the same validation and the same `leads` insert as the website.
 *
 * Field mapping (task §12):
 *   source      → "booth"
 *   projectSlug → runtime selected-project slug
 *   budget      → approved NAV-001 budget answer (label)
 *   interest    → selected project + confirmed purchase purpose
 *   message     → deterministic readable session summary
 */

import type { Property } from "@/lib/data";
import type { LeadFormValues } from "@/lib/lead-service";
import {
  budgetLabel,
  concernLabels,
  goalLabels,
  humanizeList,
  motivationLabels,
  timelineLabel,
} from "./questions";
import type { NavigatorAnswers } from "./decision-profile";
import type { ForeverStory } from "./forever-story";
import type { RecommendationPath } from "./recommendation";
import type { MatchReason } from "./matching";

export const BOOTH_LEAD_SOURCE = "booth";

export interface BoothContactDetails {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country?: string;
  staffNote?: string;
}

export interface BoothLeadInput {
  contact: BoothContactDetails;
  answers: NavigatorAnswers;
  story: ForeverStory | null;
  recommendation: RecommendationPath;
  project: Property;
  reasons: MatchReason[];
}

/** The confirmed purchase purpose, derived from the "why Phuket" motivations. */
export function purchasePurpose(answers: NavigatorAnswers): string {
  const labels = motivationLabels(answers.motivations);
  return humanizeList(labels) || "Exploring options";
}

/** Deterministic, human-readable session summary written into `message`. */
export function buildBoothMessageSummary(input: BoothLeadInput): string {
  const { answers, story, recommendation, project, reasons, contact } = input;

  const lines: string[] = [];
  lines.push("FOREVER BOOTH — GUEST SESSION SUMMARY");
  lines.push("");

  lines.push("NAV-001 answers");
  lines.push(`• Why Phuket: ${humanizeList(motivationLabels(answers.motivations)) || "—"}`);
  lines.push(`• Success looks like: ${humanizeList(goalLabels(answers.goals)) || "—"}`);
  lines.push(`• Budget: ${budgetLabel(answers.budget) || "—"}`);
  lines.push(`• Timeline: ${timelineLabel(answers.timeline) || "—"}`);
  lines.push(`• Biggest concern: ${humanizeList(concernLabels(answers.concerns)) || "—"}`);
  if (answers.note.trim()) {
    lines.push(`• Guest note: ${answers.note.trim()}`);
  }
  lines.push("");

  lines.push("Confirmed Forever Story");
  if (story) {
    lines.push(story.reflection);
    for (const facet of story.facets) {
      lines.push(`• ${facet.label}: ${facet.value}`);
    }
    lines.push(`• Archetype: ${story.profileLabel}`);
  } else {
    lines.push("—");
  }
  lines.push("");

  lines.push("Recommendation path");
  lines.push(`• ${recommendation.primaryRecommendation}`);
  lines.push(`• Investment profile: ${recommendation.investmentProfile}`);
  lines.push("");

  lines.push("Selected project");
  lines.push(`• ${project.name}${project.location ? ` — ${project.location}` : ""}`);
  lines.push(`• Slug: ${project.slug}`);
  lines.push("");

  lines.push("Supported matching reasons");
  if (reasons.length > 0) {
    for (const reason of reasons) {
      lines.push(`• ${reason.label}`);
    }
  } else {
    lines.push("• No exact match found — shown for discussion");
  }

  if (contact.staffNote?.trim()) {
    lines.push("");
    lines.push("Staff note");
    lines.push(contact.staffNote.trim());
  }

  return lines.join("\n");
}

/** Map the confirmed booth session onto the existing lead-service contract. */
export function buildBoothLeadPayload(input: BoothLeadInput): LeadFormValues {
  const { contact, answers, project } = input;

  return {
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    phone: contact.phone,
    country: contact.country,
    source: BOOTH_LEAD_SOURCE,
    projectSlug: project.slug,
    budget: budgetLabel(answers.budget),
    interest: `${project.name} · ${purchasePurpose(answers)}`,
    message: buildBoothMessageSummary(input),
  };
}
