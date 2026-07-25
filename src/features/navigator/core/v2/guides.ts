/**
 * Guide assignment (pilot) — pure suggestion logic over operator-maintained
 * guide records. Guides come exclusively from the database; when none exist
 * or none are on duty, the result is a truthful operational block — a Guide
 * is never invented.
 */

export interface BoothGuide {
  id: string;
  displayName: string;
  languages: string[];
  specializations: string[];
  onDuty: boolean;
  /**
   * True when this Guide has a linked staff account and can therefore confirm
   * their OWN acknowledgement. When false, only a disclosed Host observation
   * is possible — the UI must say so rather than implying the Guide replied.
   */
  hasStaffAccount?: boolean;
}

export type GuideBlockReason = "no_guides_configured" | "no_guides_on_duty";

export interface GuideSuggestion {
  primary: BoothGuide | null;
  reserve: BoothGuide | null;
  /** Set when no assignment is possible — the truthful operational block. */
  blockReason: GuideBlockReason | null;
  /** True when the primary was chosen by preferred-language match. */
  primaryMatchesLanguage: boolean;
}

function speaksLanguage(guide: BoothGuide, language: string): boolean {
  const wanted = language.trim().toLowerCase();
  if (!wanted) return false;
  return guide.languages.some((spoken) => spoken.trim().toLowerCase() === wanted);
}

/**
 * Suggest a primary and reserve Guide. Preference order: on-duty guides
 * speaking the guest's preferred language first (in the stable order the
 * operator's records arrive in), then remaining on-duty guides. The Host may
 * always override manually — this is a suggestion, not an automatic claim.
 */
export function suggestGuides(
  guides: BoothGuide[],
  preferredLanguage: string | null,
): GuideSuggestion {
  if (guides.length === 0) {
    return {
      primary: null,
      reserve: null,
      blockReason: "no_guides_configured",
      primaryMatchesLanguage: false,
    };
  }
  const onDuty = guides.filter((guide) => guide.onDuty);
  if (onDuty.length === 0) {
    return {
      primary: null,
      reserve: null,
      blockReason: "no_guides_on_duty",
      primaryMatchesLanguage: false,
    };
  }

  const languageMatches = preferredLanguage
    ? onDuty.filter((guide) => speaksLanguage(guide, preferredLanguage))
    : [];
  const others = onDuty.filter((guide) => !languageMatches.includes(guide));
  const ordered = [...languageMatches, ...others];

  return {
    primary: ordered[0] ?? null,
    reserve: ordered[1] ?? null,
    blockReason: null,
    primaryMatchesLanguage: languageMatches.length > 0,
  };
}

/** Two-minute acknowledgement target, in seconds. */
export const GUIDE_ACK_TARGET_SECONDS = 120;

/** Five-minute first-contact SLA, in seconds. */
export const GUIDE_CONTACT_SLA_SECONDS = 300;
