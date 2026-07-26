/**
 * Human-readable Booth V2 summary.
 *
 * Structured records in `booth_sessions` are AUTHORITATIVE; this deterministic
 * text is a convenience mirror written to `leads.message` so a person reading
 * the leads list still sees the whole picture. It never carries anything the
 * structured record does not.
 */

import {
  concernLabels,
  goalLabels,
  humanizeList,
  motivationLabels,
  timelineLabel,
} from "../questions";
import type { DecisionProfileV2 } from "./profile";
import type { ShortlistV2 } from "./session";

const PURPOSE_LABEL: Record<DecisionProfileV2["purchasePurpose"], string> = {
  lifestyle: "Lifestyle",
  investment: "Investment",
  both: "Lifestyle + investment",
  exploring: "Still exploring",
};

const PREFERENCE_LABEL: Record<string, string> = {
  condominium: "Condominium",
  villa: "Villa",
  both: "Condominium or villa",
  unsure: "Unsure yet",
  studio: "Studio",
  "1": "1 bedroom",
  "2": "2 bedrooms",
  "3": "3 bedrooms",
  "4_plus": "4+ bedrooms",
  ready: "Ready property",
  off_plan: "Off-plan",
};

function formatBudget(profile: DecisionProfileV2): string {
  const { budget } = profile;
  if (budget.state !== "stated" || budget.originalCurrency === null) {
    return "Still exploring";
  }
  const currency = budget.originalCurrency;
  const fmt = (value: number) => `${value.toLocaleString("en-US")} ${currency}`;
  if (budget.minimum !== null && budget.maximum !== null) {
    return `${fmt(budget.minimum)} – ${fmt(budget.maximum)}`;
  }
  if (budget.maximum !== null) return `Up to ${fmt(budget.maximum)}`;
  if (budget.minimum !== null) return `From ${fmt(budget.minimum)}`;
  return "Still exploring";
}

export function buildBoothV2Summary(input: {
  profile: DecisionProfileV2;
  shortlist: ShortlistV2;
  hostNote: string;
}): string {
  const { profile, shortlist, hostNote } = input;
  const lines: string[] = [];

  lines.push("— Forever Booth 2.0 Decision Profile —");
  lines.push(`Flow: ${profile.flowMode === "quick" ? "Quick" : "Full"} profile`);
  lines.push(`Purchase purpose: ${PURPOSE_LABEL[profile.purchasePurpose]}`);
  lines.push(`Budget (original currency): ${formatBudget(profile)}`);
  if (profile.canonicalThb) {
    const { conversion } = profile.canonicalThb;
    lines.push(
      conversion.kind === "identity"
        ? "Budget stated in THB — no conversion applied."
        : `THB comparison via ${conversion.source}, rate effective ${conversion.effectiveDate}.`,
    );
  } else {
    lines.push("No dated verified exchange rate — budget comparison disabled.");
  }
  lines.push(`Timeline: ${timelineLabel(profile.timeline) || "Not stated"}`);

  if (profile.motivations.length > 0) {
    lines.push(`Why Phuket: ${humanizeList(motivationLabels(profile.motivations))}`);
  }
  if (profile.goals.length > 0) {
    lines.push(`Success looks like: ${humanizeList(goalLabels(profile.goals))}`);
  }
  if (profile.concerns.length > 0) {
    lines.push(`Concerns: ${humanizeList(concernLabels(profile.concerns))}`);
  }
  if (profile.note.trim()) lines.push(`Guest note: ${profile.note.trim()}`);

  const { essentials } = profile;
  lines.push(
    `Property type: ${essentials.propertyType ? PREFERENCE_LABEL[essentials.propertyType] : "Not asked"}`,
  );
  lines.push(
    `Bedrooms: ${
      essentials.bedrooms ? (PREFERENCE_LABEL[essentials.bedrooms] ?? "Unsure yet") : "Not asked"
    }`,
  );
  lines.push(
    `Areas: ${
      essentials.helpMeChooseArea
        ? "Guest asked for lifestyle-based area guidance"
        : essentials.preferredAreas.length > 0
          ? essentials.preferredAreas.join(", ")
          : "Not stated"
    }`,
  );
  lines.push(
    `Readiness: ${essentials.readiness ? (PREFERENCE_LABEL[essentials.readiness] ?? "Unsure yet") : "Not asked"}`,
  );
  if (profile.preferredLanguage) lines.push(`Preferred language: ${profile.preferredLanguage}`);

  if (shortlist.guidePrepares) {
    lines.push("Shortlist: guest asked their Guide to prepare it.");
  } else if (shortlist.entries.length > 0) {
    lines.push(
      `Shortlist (${shortlist.entries.length}): ${shortlist.entries
        .map((entry) => entry.slug + (entry.mentionedByGuest ? " (mentioned by guest)" : ""))
        .join(", ")}`,
    );
  } else {
    lines.push("Shortlist: none selected — discussion stayed open.");
  }

  if (hostNote.trim()) lines.push(`Host note: ${hostNote.trim()}`);

  return lines.join("\n");
}
