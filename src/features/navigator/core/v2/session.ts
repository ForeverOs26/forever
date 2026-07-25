/**
 * Booth Mode 2.0 session state machine.
 *
 * Booth V2 owns its own explicit state machine — it deliberately does NOT
 * share a fixed screen order with the website Navigator. The website keeps its
 * NAV-001 flow untouched; this machine covers the Assisted Decision Concierge
 * journey: permission → Quick/Full profile → factual Decision Summary →
 * initial directions → light contact + consent → manual WhatsApp verification
 * → named Guide handoff → truthful completion (or respectful no-contact QR).
 *
 * Privacy rules built into the model:
 *   • the session carries only what the flow needs — no device metadata,
 *     no tracking identifiers, no staff credentials;
 *   • persisted payloads are versioned and parsed fail-closed;
 *   • a persisted session that is completed, abandoned, or stale is NEVER
 *     rehydrated — the next guest can never see the previous guest's data;
 *   • declining contact clears every personal field before the QR screen.
 */

import { toggleMaxThree, toggleSingle } from "../questions";
import type { ConcernKey, GoalKey, MotivationKey, TimelineKey } from "../questions";
import { emptyAnswers, type NavigatorAnswers } from "../decision-profile";
import {
  canonicalThbBudget,
  DECISION_PROFILE_VERSION,
  derivePurchasePurpose,
  exploringBudget,
  parseStoredProfileV2,
  statedBudget,
  validateBudgetRange,
  type BedroomPreference,
  type BoothBudgetCurrency,
  type BudgetRangeV2,
  type DecisionProfileV2,
  type FlowMode,
  type FxRateConfig,
  type PropertyTypePreference,
  type PurchasePurpose,
  type ReadinessPreference,
} from "./profile";
import { emptyBoothContact, type BoothContactV2 } from "./contact";
import type { WhatsappVerificationMethod, WhatsappVerificationState } from "./whatsapp";
import type { BoothFunnelEvent } from "./funnel";

/* ---------- Screens ---------- */

export const BOOTH_V2_SCREENS = [
  "welcome",
  "permission",
  // The guest's language is captured BEFORE the Decision Summary, so the
  // confirmed profile carries it and the contact step can never introduce a
  // language the persisted profile disagrees with.
  "language",
  "mode_selection",
  "quick_profile",
  "full_nav_questions",
  "property_fit",
  "location_fit",
  "readiness",
  "decision_summary",
  "initial_directions",
  "contact",
  "whatsapp_verification",
  "guide_assignment",
  "handoff_waiting",
  "next_step",
  "completion",
  "respectful_no_contact_qr",
] as const;

export type BoothV2Screen = (typeof BOOTH_V2_SCREENS)[number];

/** Quick Profile sub-questions, in order. */
export const QUICK_STEPS = ["purpose", "budget", "property_type", "timeline"] as const;

/** Full-flow NAV-001 sub-questions, in order (preserved from NAV-001). */
export const FULL_NAV_STEPS = ["why_phuket", "success", "budget_timeline", "concern"] as const;

/* ---------- Draft (pre-confirmation answers) ---------- */

export interface BoothV2Draft {
  /** Asked explicitly in Quick; DERIVED from NAV-001 answers in Full. */
  purchasePurpose: PurchasePurpose | null;
  /** NAV-001 psychological answers — collected by the Full flow only. */
  nav: NavigatorAnswers;
  /**
   * The guest's own numeric budget statement. The approved NAV-001 USD bands
   * are never reused as amounts in another currency — the booth asks for
   * explicit numbers instead, and "still exploring" is a first-class answer.
   */
  budgetExploring: boolean;
  budgetMinimum: number | null;
  budgetMaximum: number | null;
  budgetCurrency: BoothBudgetCurrency;
  propertyType: PropertyTypePreference | null;
  bedrooms: BedroomPreference | null;
  preferredAreas: string[];
  helpMeChooseArea: boolean;
  readiness: ReadinessPreference | null;
  /** Captured before the Decision Summary; part of the confirmed profile. */
  preferredLanguage: string | null;
}

export function emptyDraft(): BoothV2Draft {
  return {
    purchasePurpose: null,
    nav: emptyAnswers(),
    budgetExploring: false,
    budgetMinimum: null,
    budgetMaximum: null,
    budgetCurrency: "USD",
    propertyType: null,
    bedrooms: null,
    preferredAreas: [],
    helpMeChooseArea: false,
    readiness: null,
    preferredLanguage: null,
  };
}

/** The guest's stated budget as the shared V2 contract sees it. */
export function draftBudget(draft: BoothV2Draft): BudgetRangeV2 {
  if (draft.budgetExploring) return exploringBudget();
  if (draft.budgetMinimum === null && draft.budgetMaximum === null) return exploringBudget();
  return statedBudget(draft.budgetMinimum, draft.budgetMaximum, draft.budgetCurrency);
}

/** True when the budget answer is usable (explicitly exploring, or coherent). */
export function draftBudgetAnswered(draft: BoothV2Draft): boolean {
  if (draft.budgetExploring) return true;
  if (draft.budgetMinimum === null && draft.budgetMaximum === null) return false;
  return validateBudgetRange(draftBudget(draft)) === null;
}

/* ---------- Shortlist (zero to four) ---------- */

export const MAX_SHORTLIST = 4;

export interface ShortlistEntry {
  slug: string;
  /** Marked when the guest brought the project up themselves. */
  mentionedByGuest: boolean;
}

export interface ShortlistV2 {
  entries: ShortlistEntry[];
  /** "Let my Guide prepare the shortlist." */
  guidePrepares: boolean;
}

export function emptyShortlist(): ShortlistV2 {
  return { entries: [], guidePrepares: false };
}

export const MAX_SLUG_LENGTH = 200;

export type ShortlistValidationError =
  | "not_an_array"
  | "too_many"
  | "blank_slug"
  | "slug_too_long"
  | "duplicate_slug"
  | "guide_prepares_conflict";

/**
 * Strict shortlist identity. A malformed shortlist is REJECTED whole — never
 * silently truncated or de-duplicated — so a replay that disagrees with the
 * stored one fails loudly instead of half-applying. Membership of each slug in
 * the real catalogue is checked separately at the server boundary, where the
 * project records live.
 */
export function validateShortlist(shortlist: ShortlistV2): ShortlistValidationError | null {
  if (!Array.isArray(shortlist.entries)) return "not_an_array";
  if (shortlist.entries.length > MAX_SHORTLIST) return "too_many";
  if (shortlist.guidePrepares && shortlist.entries.length > 0) return "guide_prepares_conflict";
  const seen = new Set<string>();
  for (const entry of shortlist.entries) {
    const slug = entry?.slug;
    if (typeof slug !== "string" || slug.trim().length === 0) return "blank_slug";
    if (slug.length > MAX_SLUG_LENGTH) return "slug_too_long";
    // A duplicate slug is rejected even when the two entries disagree about
    // mentionedByGuest — one project cannot be in the shortlist twice.
    if (seen.has(slug)) return "duplicate_slug";
    seen.add(slug);
  }
  return null;
}

/** The database's shortlist_mode for a given shortlist state. */
export function shortlistMode(
  shortlist: ShortlistV2,
): "none" | "guest_selected" | "guide_prepares" {
  if (shortlist.guidePrepares) return "guide_prepares";
  return shortlist.entries.length > 0 ? "guest_selected" : "none";
}

/* ---------- Handoff ---------- */

export interface AssignedGuideRef {
  id: string;
  displayName: string;
  languages: string[];
  /** True when this Guide can confirm their OWN acknowledgement. */
  hasStaffAccount?: boolean;
}

export interface HandoffState {
  contactSavedAt: string | null;
  whatsapp: {
    state: WhatsappVerificationState;
    verifiedAt: string | null;
    method: WhatsappVerificationMethod | null;
  };
  guide: {
    assigned: AssignedGuideRef | null;
    reserve: AssignedGuideRef | null;
    assignedAt: string | null;
    acknowledgedAt: string | null;
    /** How the acknowledgement was established — always disclosed in the UI. */
    acknowledgedMethod: HandoffAttributionMethod | null;
    fallbackReason: string | null;
  };
  /** The Guide's live message to the guest, confirmed at the server boundary. */
  firstContactConfirmedAt: string | null;
  firstContactMethod: HandoffAttributionMethod | null;
  /** Exact agreed consultation instant (ISO) — structured, never free text. */
  consultationScheduledAt: string | null;
  /** The timezone the instant was agreed in, for display context only. */
  consultationTimezone: string | null;
  nextStep: string | null;
}

/**
 * Who established a handoff fact, and how. A Host pressing a button is
 * recorded as an OBSERVATION ("host_observed"), never as the Guide's own
 * confirmation; "guide_self_confirmed" is only possible when the assigned
 * Guide's own authenticated staff account performs it (enforced in the RPC).
 */
export type HandoffAttributionMethod = "guide_self_confirmed" | "host_observed";

export function emptyHandoff(): HandoffState {
  return {
    contactSavedAt: null,
    whatsapp: { state: "unverified", verifiedAt: null, method: null },
    guide: {
      assigned: null,
      reserve: null,
      assignedAt: null,
      acknowledgedAt: null,
      acknowledgedMethod: null,
      fallbackReason: null,
    },
    firstContactConfirmedAt: null,
    firstContactMethod: null,
    consultationScheduledAt: null,
    consultationTimezone: null,
    nextStep: null,
  };
}

/* ---------- Session ---------- */

export type BoothV2Outcome = "active" | "contacted_complete" | "no_contact_qr" | "abandoned";

export const BOOTH_V2_SESSION_VERSION = 1 as const;

export interface BoothV2Session {
  sessionVersion: typeof BOOTH_V2_SESSION_VERSION;
  /**
   * The SERVER-ISSUED client reference, or `null` before the server has issued
   * one (PR #102 corrective pass 5). The browser never generates, proposes or
   * guesses it: it is minted by `booth_create_session` and arrives through the
   * `sessionCreated` action. The `null` is deliberate and load-bearing — it is
   * what makes it impossible to run an operational RPC for a session the server
   * has not created, because every call site has to narrow it first.
   */
  clientRef: string | null;
  screen: BoothV2Screen;
  quickStep: number;
  fullStep: number;
  permissionGranted: boolean;
  flowMode: FlowMode | null;
  draft: BoothV2Draft;
  contact: BoothContactV2;
  confirmedProfile: DecisionProfileV2 | null;
  shortlist: ShortlistV2;
  handoff: HandoffState;
  outcome: BoothV2Outcome;
  /** Client-side once-only funnel event dedupe. */
  recordedEvents: BoothFunnelEvent[];
}

/**
 * A fresh local session. It starts WITHOUT a server reference: local temporary
 * state may exist before the session is created, but nothing operational can
 * happen until `sessionCreated` carries the server-issued reference in.
 */
export function createBoothV2Session(clientRef: string | null = null): BoothV2Session {
  return {
    sessionVersion: BOOTH_V2_SESSION_VERSION,
    clientRef,
    screen: "welcome",
    quickStep: 0,
    fullStep: 0,
    permissionGranted: false,
    flowMode: null,
    draft: emptyDraft(),
    contact: emptyBoothContact(),
    confirmedProfile: null,
    shortlist: emptyShortlist(),
    handoff: emptyHandoff(),
    outcome: "active",
    recordedEvents: [],
  };
}

/** True when the session holds any guest answer or detail — drives guarded reset. */
export function hasGuestDataV2(session: BoothV2Session): boolean {
  const { draft, contact } = session;
  return (
    session.screen !== "welcome" ||
    draft.purchasePurpose !== null ||
    draft.nav.motivations.length > 0 ||
    draft.nav.goals.length > 0 ||
    draft.nav.concerns.length > 0 ||
    draft.nav.note.trim().length > 0 ||
    draft.nav.timeline !== null ||
    draft.budgetExploring ||
    draft.budgetMinimum !== null ||
    draft.budgetMaximum !== null ||
    draft.preferredLanguage !== null ||
    draft.propertyType !== null ||
    draft.bedrooms !== null ||
    draft.preferredAreas.length > 0 ||
    draft.helpMeChooseArea ||
    draft.readiness !== null ||
    contactHasPersonalData(contact) ||
    session.confirmedProfile !== null ||
    session.shortlist.entries.length > 0 ||
    session.shortlist.guidePrepares
  );
}

function contactHasPersonalData(contact: BoothContactV2): boolean {
  return (
    contact.firstName.trim().length > 0 ||
    contact.whatsapp.trim().length > 0 ||
    contact.lastName.trim().length > 0 ||
    contact.email.trim().length > 0 ||
    contact.country.trim().length > 0 ||
    contact.preferredContactTime.trim().length > 0 ||
    contact.hostNote.trim().length > 0
  );
}

/* ---------- Profile construction ---------- */

/**
 * Build the confirmed DecisionProfileV2 from the current draft. The canonical
 * THB budget is computed here and only when a dated, source-identified rate
 * (or a THB original) makes it truthful.
 */
export function buildProfileFromDraft(
  session: BoothV2Session,
  fx: FxRateConfig | null,
  confirmedAt: string,
): DecisionProfileV2 | null {
  if (session.flowMode === null) return null;
  const { draft } = session;
  const budget = draftBudget(draft);
  return {
    profileVersion: DECISION_PROFILE_VERSION,
    flowMode: session.flowMode,
    // Quick asks the purpose outright; Full DERIVES it from the confirmed
    // NAV-001 answers, so a completed Full profile never silently reads
    // "exploring" while the answers establish investment or lifestyle.
    purchasePurpose:
      session.flowMode === "full"
        ? derivePurchasePurpose(draft.nav)
        : (draft.purchasePurpose ?? "exploring"),
    motivations: [...draft.nav.motivations],
    goals: [...draft.nav.goals],
    concerns: [...draft.nav.concerns],
    note: draft.nav.note,
    budget,
    canonicalThb: canonicalThbBudget(budget, fx),
    timeline: draft.nav.timeline,
    essentials: {
      propertyType: draft.propertyType,
      bedrooms: draft.bedrooms,
      preferredAreas: [...draft.preferredAreas],
      helpMeChooseArea: draft.helpMeChooseArea,
      readiness: draft.readiness,
    },
    preferredLanguage: draft.preferredLanguage?.trim() || null,
    confirmedAt,
  };
}

/** Quick Profile is complete when its four required questions are answered. */
export function quickProfileComplete(draft: BoothV2Draft): boolean {
  return (
    draft.purchasePurpose !== null &&
    draftBudgetAnswered(draft) &&
    draft.propertyType !== null &&
    draft.nav.timeline !== null
  );
}

/** Full flow completeness: NAV-001 questions + the Search Essentials. */
export function fullProfileComplete(draft: BoothV2Draft): boolean {
  return (
    draft.nav.motivations.length > 0 &&
    draft.nav.goals.length > 0 &&
    draftBudgetAnswered(draft) &&
    draft.nav.timeline !== null &&
    draft.nav.concerns.length > 0 &&
    draft.propertyType !== null &&
    draft.bedrooms !== null &&
    (draft.preferredAreas.length > 0 || draft.helpMeChooseArea) &&
    draft.readiness !== null
  );
}

/* ---------- Completion gates ---------- */

/**
 * The truthful contacted-completion gate. A contacted session is complete only
 * when every one of these holds; anything missing is a named blocker.
 */
export function contactedCompletionBlockers(session: BoothV2Session): string[] {
  const blockers: string[] = [];
  if (session.confirmedProfile === null) blockers.push("Decision Profile not confirmed");
  if (session.handoff.whatsapp.state !== "verified") blockers.push("WhatsApp not verified");
  if (session.handoff.guide.assigned === null) blockers.push("No named Guide assigned");
  if (!session.handoff.nextStep || session.handoff.nextStep.trim().length === 0) {
    blockers.push("Next step not recorded");
  }
  if (
    session.handoff.consultationScheduledAt === null &&
    session.handoff.firstContactConfirmedAt === null
  ) {
    blockers.push(
      "No exact consultation/contact time recorded and no live Guide message confirmed",
    );
  }
  return blockers;
}

export function canCompleteContacted(session: BoothV2Session): boolean {
  return contactedCompletionBlockers(session).length === 0;
}

/** A no-contact completion must not retain any personal contact data. */
export function canCompleteNoContact(session: BoothV2Session): boolean {
  return !contactHasPersonalData(session.contact);
}

/* ---------- Actions ---------- */

export type EditTarget =
  | "purpose"
  | "language"
  | "why_phuket"
  | "success"
  | "budget_timeline"
  | "concern"
  | "property_fit"
  | "location_fit"
  | "readiness";

export type BoothV2Action =
  | { type: "begin" }
  | { type: "grantPermission" }
  | { type: "declinePermission" }
  | { type: "setPreferredLanguage"; value: string }
  | { type: "continueToModeSelection" }
  | { type: "chooseMode"; mode: FlowMode }
  | { type: "back" }
  | { type: "quickNext" }
  | { type: "fullNext" }
  | { type: "setPurchasePurpose"; value: PurchasePurpose }
  | { type: "toggleMotivation"; value: MotivationKey }
  | { type: "toggleGoal"; value: GoalKey }
  | { type: "toggleConcern"; value: ConcernKey }
  | { type: "setNote"; value: string }
  | { type: "setBudgetAmounts"; minimum: number | null; maximum: number | null }
  | { type: "setBudgetExploring"; value: boolean }
  | { type: "setBudgetCurrency"; value: BoothBudgetCurrency }
  | { type: "setTimeline"; value: TimelineKey }
  | { type: "setPropertyType"; value: PropertyTypePreference }
  | { type: "setBedrooms"; value: BedroomPreference }
  | { type: "toggleArea"; value: string }
  | { type: "setHelpMeChooseArea"; value: boolean }
  | { type: "setReadiness"; value: ReadinessPreference }
  | { type: "editSection"; target: EditTarget }
  | { type: "continueToLocationFit" }
  | { type: "continueToReadiness" }
  | { type: "continueToSummary" }
  | { type: "confirmProfile"; profile: DecisionProfileV2 }
  | { type: "toggleShortlist"; slug: string }
  | { type: "setMentionedByGuest"; slug: string; value: boolean }
  | { type: "setGuidePrepares"; value: boolean }
  | { type: "continueToContact" }
  | { type: "declineContact" }
  | { type: "setContactField"; field: ContactTextField; value: string }
  | { type: "setConsultationConsent"; value: boolean }
  | { type: "setMarketingOptIn"; value: boolean }
  | { type: "contactSaved"; at: string }
  | { type: "whatsappUnavailable" }
  | { type: "whatsappPending" }
  | { type: "whatsappVerified"; at: string; method: WhatsappVerificationMethod }
  | { type: "continueToGuideAssignment" }
  | {
      type: "guideAssigned";
      at: string;
      guide: AssignedGuideRef;
      reserve: AssignedGuideRef | null;
      fallbackReason: string | null;
    }
  | { type: "guideAcknowledged"; at: string; method: HandoffAttributionMethod }
  | { type: "continueToNextStep" }
  | { type: "recordFirstContact"; at: string; method: HandoffAttributionMethod }
  | { type: "setConsultationTime"; at: string | null; timezone: string | null }
  | { type: "setNextStep"; value: string }
  | { type: "completeContacted" }
  | { type: "completeNoContact" }
  | { type: "markAbandoned" }
  | { type: "markEventRecorded"; event: BoothFunnelEvent }
  | { type: "replace"; session: BoothV2Session }
  /** The server issued this session's reference — the ONLY way one arrives. */
  | { type: "sessionCreated"; clientRef: string }
  /** A reset carries no reference: the next guest's is issued by the server. */
  | { type: "reset" };

export type ContactTextField =
  | "firstName"
  | "whatsapp"
  | "preferredLanguage"
  | "lastName"
  | "email"
  | "country"
  | "preferredContactTime"
  | "hostNote";

/* ---------- Back navigation (explicit, tested) ---------- */

function backFrom(session: BoothV2Session): BoothV2Session {
  const { screen } = session;
  switch (screen) {
    case "welcome":
      return session;
    case "permission":
      return { ...session, screen: "welcome" };
    case "language":
      return { ...session, screen: "permission" };
    case "mode_selection":
      return { ...session, screen: "language" };
    case "quick_profile":
      return session.quickStep > 0
        ? { ...session, quickStep: session.quickStep - 1 }
        : { ...session, screen: "mode_selection" };
    case "full_nav_questions":
      return session.fullStep > 0
        ? { ...session, fullStep: session.fullStep - 1 }
        : { ...session, screen: "mode_selection" };
    case "property_fit":
      return { ...session, screen: "full_nav_questions", fullStep: FULL_NAV_STEPS.length - 1 };
    case "location_fit":
      return { ...session, screen: "property_fit" };
    case "readiness":
      return { ...session, screen: "location_fit" };
    case "decision_summary":
      return session.flowMode === "quick"
        ? { ...session, screen: "quick_profile", quickStep: QUICK_STEPS.length - 1 }
        : { ...session, screen: "readiness" };
    case "initial_directions":
      return { ...session, screen: "decision_summary" };
    case "contact":
      return { ...session, screen: "initial_directions" };
    case "whatsapp_verification":
      return { ...session, screen: "contact" };
    case "guide_assignment":
      return { ...session, screen: "whatsapp_verification" };
    case "handoff_waiting":
      return { ...session, screen: "guide_assignment" };
    case "next_step":
      return { ...session, screen: "handoff_waiting" };
    case "respectful_no_contact_qr":
      // A guest may change their mind before the session is closed out.
      return session.outcome === "active" ? { ...session, screen: "contact" } : session;
    case "completion":
      return session; // terminal
    default:
      return session;
  }
}

const EDIT_TARGET_LOCATION: Record<
  EditTarget,
  {
    quick: { screen: BoothV2Screen; step?: number } | null;
    full: { screen: BoothV2Screen; step?: number };
  }
> = {
  // The Full flow derives the purpose from its NAV-001 answers, so editing it
  // there means editing those answers (Why Phuket).
  purpose: {
    quick: { screen: "quick_profile", step: 0 },
    full: { screen: "full_nav_questions", step: 0 },
  },
  language: { quick: { screen: "language" }, full: { screen: "language" } },
  why_phuket: { quick: null, full: { screen: "full_nav_questions", step: 0 } },
  success: { quick: null, full: { screen: "full_nav_questions", step: 1 } },
  budget_timeline: {
    quick: { screen: "quick_profile", step: 1 },
    full: { screen: "full_nav_questions", step: 2 },
  },
  concern: { quick: null, full: { screen: "full_nav_questions", step: 3 } },
  property_fit: { quick: { screen: "quick_profile", step: 2 }, full: { screen: "property_fit" } },
  location_fit: { quick: null, full: { screen: "location_fit" } },
  readiness: { quick: null, full: { screen: "readiness" } },
};

/**
 * Editing any section of a confirmed profile invalidates everything derived
 * from it: the confirmation itself, the shortlist, and all handoff progress.
 * Typed contact text stays (it is the guest's own unrelated input), but saved/
 * verified/assigned handoff facts are no longer true for the edited profile.
 */
function invalidateDownstream(session: BoothV2Session): BoothV2Session {
  return {
    ...session,
    confirmedProfile: null,
    shortlist: emptyShortlist(),
    handoff: emptyHandoff(),
    outcome: "active",
  };
}

/* ---------- Reducer ---------- */

export function boothV2Reducer(session: BoothV2Session, action: BoothV2Action): BoothV2Session {
  switch (action.type) {
    case "begin":
      return { ...session, screen: "permission" };
    case "grantPermission":
      return { ...session, permissionGranted: true, screen: "language" };
    case "declinePermission":
      // Respectful exit: nothing personal was collected yet; show the QR path.
      return { ...session, permissionGranted: false, screen: "respectful_no_contact_qr" };
    case "setPreferredLanguage":
      return withDraft(session, { preferredLanguage: action.value.trim() || null });
    case "continueToModeSelection":
      return session.draft.preferredLanguage ? { ...session, screen: "mode_selection" } : session;
    case "chooseMode":
      return {
        ...session,
        flowMode: action.mode,
        screen: action.mode === "quick" ? "quick_profile" : "full_nav_questions",
        quickStep: 0,
        fullStep: 0,
      };
    case "back":
      return backFrom(session);
    case "quickNext": {
      if (session.quickStep < QUICK_STEPS.length - 1) {
        return { ...session, quickStep: session.quickStep + 1 };
      }
      return quickProfileComplete(session.draft)
        ? { ...session, screen: "decision_summary" }
        : session;
    }
    case "fullNext": {
      if (session.fullStep < FULL_NAV_STEPS.length - 1) {
        return { ...session, fullStep: session.fullStep + 1 };
      }
      return { ...session, screen: "property_fit" };
    }
    case "setPurchasePurpose":
      return withDraft(session, { purchasePurpose: action.value });
    case "toggleMotivation":
      return withNav(session, {
        motivations: toggleMaxThree(action.value, session.draft.nav.motivations),
      });
    case "toggleGoal":
      return withNav(session, { goals: toggleMaxThree(action.value, session.draft.nav.goals) });
    case "toggleConcern":
      return withNav(session, {
        concerns: toggleMaxThree(action.value, session.draft.nav.concerns),
      });
    case "setNote":
      return withNav(session, { note: action.value });
    case "setBudgetAmounts":
      // Stating an amount is itself the answer to "still exploring?".
      return withDraft(session, {
        budgetMinimum: action.minimum,
        budgetMaximum: action.maximum,
        budgetExploring:
          action.minimum === null && action.maximum === null
            ? session.draft.budgetExploring
            : false,
      });
    case "setBudgetExploring":
      return withDraft(session, {
        budgetExploring: action.value,
        budgetMinimum: action.value ? null : session.draft.budgetMinimum,
        budgetMaximum: action.value ? null : session.draft.budgetMaximum,
      });
    case "setBudgetCurrency":
      return withDraft(session, { budgetCurrency: action.value });
    case "setTimeline":
      return withNav(session, { timeline: toggleSingle(action.value, session.draft.nav.timeline) });
    case "setPropertyType":
      return withDraft(session, { propertyType: action.value });
    case "setBedrooms":
      return withDraft(session, { bedrooms: action.value });
    case "toggleArea": {
      const current = session.draft.preferredAreas;
      const next = current.includes(action.value)
        ? current.filter((area) => area !== action.value)
        : [...current, action.value];
      return withDraft(session, { preferredAreas: next, helpMeChooseArea: false });
    }
    case "setHelpMeChooseArea":
      return withDraft(session, {
        helpMeChooseArea: action.value,
        preferredAreas: action.value ? [] : session.draft.preferredAreas,
      });
    case "setReadiness":
      return withDraft(session, { readiness: action.value });
    case "editSection": {
      const location =
        EDIT_TARGET_LOCATION[action.target][session.flowMode === "quick" ? "quick" : "full"];
      if (!location) return session;
      const invalidated =
        session.confirmedProfile !== null ? invalidateDownstream(session) : session;
      return {
        ...invalidated,
        screen: location.screen,
        quickStep:
          location.screen === "quick_profile" ? (location.step ?? 0) : invalidated.quickStep,
        fullStep:
          location.screen === "full_nav_questions" ? (location.step ?? 0) : invalidated.fullStep,
      };
    }
    case "continueToLocationFit":
      return session.screen === "property_fit" &&
        session.draft.propertyType !== null &&
        session.draft.bedrooms !== null
        ? { ...session, screen: "location_fit" }
        : session;
    case "continueToReadiness":
      return session.screen === "location_fit" &&
        (session.draft.preferredAreas.length > 0 || session.draft.helpMeChooseArea)
        ? { ...session, screen: "readiness" }
        : session;
    case "continueToSummary": {
      if (session.flowMode === "quick") {
        return quickProfileComplete(session.draft)
          ? { ...session, screen: "decision_summary" }
          : session;
      }
      return session.screen === "readiness" && fullProfileComplete(session.draft)
        ? { ...session, screen: "decision_summary" }
        : session;
    }
    case "confirmProfile":
      return { ...session, confirmedProfile: action.profile, screen: "initial_directions" };
    case "toggleShortlist": {
      const { entries } = session.shortlist;
      const existing = entries.find((entry) => entry.slug === action.slug);
      if (existing) {
        return withShortlist(session, {
          entries: entries.filter((entry) => entry.slug !== action.slug),
        });
      }
      // The maximum of four is enforced in the state model, not only the UI.
      if (entries.length >= MAX_SHORTLIST) return session;
      return withShortlist(session, {
        entries: [...entries, { slug: action.slug, mentionedByGuest: false }],
        guidePrepares: false,
      });
    }
    case "setMentionedByGuest":
      return withShortlist(session, {
        entries: session.shortlist.entries.map((entry) =>
          entry.slug === action.slug ? { ...entry, mentionedByGuest: action.value } : entry,
        ),
      });
    case "setGuidePrepares":
      return withShortlist(session, {
        guidePrepares: action.value,
        entries: action.value ? [] : session.shortlist.entries,
      });
    case "continueToContact":
      return session.confirmedProfile !== null ? { ...session, screen: "contact" } : session;
    case "declineContact":
      // Respectful no-contact continuation stores no unnecessary contact data.
      return { ...session, contact: emptyBoothContact(), screen: "respectful_no_contact_qr" };
    case "setContactField":
      return { ...session, contact: { ...session.contact, [action.field]: action.value } };
    case "setConsultationConsent":
      return { ...session, contact: { ...session.contact, consultationConsent: action.value } };
    case "setMarketingOptIn":
      return { ...session, contact: { ...session.contact, marketingOptIn: action.value } };
    case "contactSaved":
      return {
        ...session,
        handoff: { ...session.handoff, contactSavedAt: action.at },
        screen: "whatsapp_verification",
      };
    case "whatsappUnavailable":
      return {
        ...session,
        handoff: {
          ...session.handoff,
          whatsapp: { state: "unavailable", verifiedAt: null, method: null },
        },
      };
    case "whatsappPending":
      return {
        ...session,
        handoff: {
          ...session.handoff,
          whatsapp: { state: "pending", verifiedAt: null, method: null },
        },
      };
    case "whatsappVerified":
      return {
        ...session,
        handoff: {
          ...session.handoff,
          whatsapp: { state: "verified", verifiedAt: action.at, method: action.method },
        },
      };
    case "continueToGuideAssignment":
      return session.handoff.whatsapp.state === "verified"
        ? { ...session, screen: "guide_assignment" }
        : session;
    case "guideAssigned":
      return {
        ...session,
        handoff: {
          ...session.handoff,
          guide: {
            assigned: action.guide,
            reserve: action.reserve,
            assignedAt: action.at,
            // A new assignment resets the acknowledgement: the newly assigned
            // Guide has not confirmed anything yet.
            acknowledgedAt: null,
            acknowledgedMethod: null,
            fallbackReason: action.fallbackReason,
          },
        },
        screen: "handoff_waiting",
      };
    case "guideAcknowledged":
      return {
        ...session,
        handoff: {
          ...session.handoff,
          guide: {
            ...session.handoff.guide,
            acknowledgedAt: action.at,
            acknowledgedMethod: action.method,
          },
        },
      };
    case "continueToNextStep":
      return { ...session, screen: "next_step" };
    case "recordFirstContact":
      return {
        ...session,
        handoff: {
          ...session.handoff,
          firstContactConfirmedAt: action.at,
          firstContactMethod: action.method,
        },
      };
    case "setConsultationTime":
      return {
        ...session,
        handoff: {
          ...session.handoff,
          consultationScheduledAt: action.at,
          consultationTimezone: action.timezone,
        },
      };
    case "setNextStep":
      return { ...session, handoff: { ...session.handoff, nextStep: action.value } };
    case "completeContacted":
      // Fail closed: an incomplete handoff can never be declared complete.
      if (!canCompleteContacted(session)) return session;
      return { ...session, outcome: "contacted_complete", screen: "completion" };
    case "completeNoContact":
      if (!canCompleteNoContact(session)) {
        // Clear any residue first; the QR continuation stores nothing personal.
        return {
          ...session,
          contact: emptyBoothContact(),
          outcome: "no_contact_qr",
          screen: "respectful_no_contact_qr",
        };
      }
      return { ...session, outcome: "no_contact_qr", screen: "respectful_no_contact_qr" };
    case "markAbandoned":
      return { ...session, outcome: "abandoned" };
    case "markEventRecorded":
      return session.recordedEvents.includes(action.event)
        ? session
        : { ...session, recordedEvents: [...session.recordedEvents, action.event] };
    case "replace":
      return action.session;
    case "sessionCreated":
      // The reference is write-once. A second create must never silently
      // re-point a session that already has server-issued identity.
      return session.clientRef === null ? { ...session, clientRef: action.clientRef } : session;
    case "reset":
      return createBoothV2Session();
    default:
      return session;
  }
}

function withDraft(session: BoothV2Session, patch: Partial<BoothV2Draft>): BoothV2Session {
  return { ...session, draft: { ...session.draft, ...patch } };
}

function withNav(session: BoothV2Session, patch: Partial<NavigatorAnswers>): BoothV2Session {
  return withDraft(session, { nav: { ...session.draft.nav, ...patch } });
}

function withShortlist(session: BoothV2Session, patch: Partial<ShortlistV2>): BoothV2Session {
  return { ...session, shortlist: { ...session.shortlist, ...patch } };
}

/* ---------- Persistence (sessionStorage) ---------- */

export const BOOTH_V2_SESSION_STORAGE_KEY = "forever.booth.session.v2";

/** Default inactivity timeout before auto-clear (Host warning shows first). */
export const BOOTH_V2_INACTIVITY_TIMEOUT_MS = 4 * 60_000;

/** How long the Host warning stays visible before the auto-clear fires. */
export const BOOTH_V2_INACTIVITY_WARNING_MS = 60_000;

/** Auto-clear delay after a completed (contacted or no-contact) session. */
export const BOOTH_V2_COMPLETED_CLEAR_MS = 45_000;

interface PersistedEnvelope {
  sessionVersion: typeof BOOTH_V2_SESSION_VERSION;
  savedAt: string;
  session: BoothV2Session;
}

export function serializeBoothV2Session(session: BoothV2Session, savedAt: string): string {
  const envelope: PersistedEnvelope = {
    sessionVersion: BOOTH_V2_SESSION_VERSION,
    savedAt,
    session,
  };
  return JSON.stringify(envelope);
}

/**
 * Parse a persisted session fail-closed. Returns null (→ fresh session) when
 * the payload is malformed, has an unknown version, belongs to a finished or
 * abandoned session, or is older than the inactivity window while carrying
 * guest data. A previous guest's data is never rehydrated for the next guest.
 */
export function deserializeBoothV2Session(
  raw: string | null,
  options: { nowMs: number; maxAgeMs?: number },
): BoothV2Session | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedEnvelope>;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.sessionVersion !== BOOTH_V2_SESSION_VERSION) return null;
    const candidate = parsed.session;
    if (!candidate || typeof candidate !== "object") return null;
    if (candidate.sessionVersion !== BOOTH_V2_SESSION_VERSION) return null;
    // Either the server has issued a reference for this session, or it has not
    // yet — nothing in between. A blank or non-string reference is a corrupt
    // payload, and a browser-invented one could never be honoured anyway.
    const storedRef = candidate.clientRef;
    if (storedRef !== null && typeof storedRef !== "string") return null;
    if (typeof storedRef === "string" && storedRef.length === 0) return null;
    if (!BOOTH_V2_SCREENS.includes(candidate.screen as BoothV2Screen)) return null;
    if (candidate.outcome !== "active") return null; // finished sessions never come back
    if (!candidate.draft || typeof candidate.draft !== "object") return null;
    if (!candidate.contact || typeof candidate.contact !== "object") return null;

    // Rebuild on a fresh base so missing fields get safe defaults, then
    // re-validate the confirmed profile through its own fail-closed parser.
    const base = createBoothV2Session(storedRef);
    const session: BoothV2Session = {
      ...base,
      ...candidate,
      draft: {
        ...base.draft,
        ...candidate.draft,
        nav: { ...base.draft.nav, ...candidate.draft.nav },
      },
      contact: { ...base.contact, ...candidate.contact },
      shortlist: normalizeShortlist(candidate.shortlist),
      handoff: { ...base.handoff, ...candidate.handoff },
      confirmedProfile:
        candidate.confirmedProfile === null || candidate.confirmedProfile === undefined
          ? null
          : parseStoredProfileV2(candidate.confirmedProfile),
      recordedEvents: Array.isArray(candidate.recordedEvents)
        ? (candidate.recordedEvents as BoothFunnelEvent[])
        : [],
    };

    const maxAgeMs = options.maxAgeMs ?? BOOTH_V2_INACTIVITY_TIMEOUT_MS;
    const savedAtMs = typeof parsed.savedAt === "string" ? Date.parse(parsed.savedAt) : Number.NaN;
    if (hasGuestDataV2(session)) {
      if (!Number.isFinite(savedAtMs)) return null;
      if (options.nowMs - savedAtMs > maxAgeMs) return null; // stale guest data is dropped
    }

    return session;
  } catch {
    return null;
  }
}

function normalizeShortlist(raw: unknown): ShortlistV2 {
  if (!raw || typeof raw !== "object") return emptyShortlist();
  const candidate = raw as Partial<ShortlistV2>;
  const entries = Array.isArray(candidate.entries)
    ? candidate.entries
        .filter(
          (entry): entry is ShortlistEntry =>
            Boolean(entry) && typeof entry === "object" && typeof entry.slug === "string",
        )
        .map((entry) => ({ slug: entry.slug, mentionedByGuest: entry.mentionedByGuest === true }))
        .slice(0, MAX_SHORTLIST)
    : [];
  return { entries, guidePrepares: candidate.guidePrepares === true };
}
