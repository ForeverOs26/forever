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
import type { BudgetKey, ConcernKey, GoalKey, MotivationKey, TimelineKey } from "../questions";
import { emptyAnswers, type NavigatorAnswers } from "../decision-profile";
import {
  budgetV2FromBand,
  canonicalThbBudget,
  DECISION_PROFILE_VERSION,
  parseStoredProfileV2,
  type BedroomPreference,
  type BoothBudgetCurrency,
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
  purchasePurpose: PurchasePurpose | null;
  /** NAV-001 psychological answers — collected by the Full flow only. */
  nav: NavigatorAnswers;
  /** Budget band + original currency; band boundaries are the guest's statement. */
  budgetBand: BudgetKey | null;
  budgetCurrency: BoothBudgetCurrency;
  propertyType: PropertyTypePreference | null;
  bedrooms: BedroomPreference | null;
  preferredAreas: string[];
  helpMeChooseArea: boolean;
  readiness: ReadinessPreference | null;
}

export function emptyDraft(): BoothV2Draft {
  return {
    purchasePurpose: null,
    nav: emptyAnswers(),
    budgetBand: null,
    budgetCurrency: "USD",
    propertyType: null,
    bedrooms: null,
    preferredAreas: [],
    helpMeChooseArea: false,
    readiness: null,
  };
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

/* ---------- Handoff ---------- */

export interface AssignedGuideRef {
  id: string;
  displayName: string;
  languages: string[];
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
    fallbackReason: string | null;
  };
  /** The Guide's live message to the guest, confirmed by the Host. */
  firstContactConfirmedAt: string | null;
  /** Exact agreed consultation / contact time (operator-recorded). */
  consultationScheduledFor: string | null;
  nextStep: string | null;
}

export function emptyHandoff(): HandoffState {
  return {
    contactSavedAt: null,
    whatsapp: { state: "unverified", verifiedAt: null, method: null },
    guide: {
      assigned: null,
      reserve: null,
      assignedAt: null,
      acknowledgedAt: null,
      fallbackReason: null,
    },
    firstContactConfirmedAt: null,
    consultationScheduledFor: null,
    nextStep: null,
  };
}

/* ---------- Session ---------- */

export type BoothV2Outcome = "active" | "contacted_complete" | "no_contact_qr" | "abandoned";

export const BOOTH_V2_SESSION_VERSION = 1 as const;

export interface BoothV2Session {
  sessionVersion: typeof BOOTH_V2_SESSION_VERSION;
  /** Random client reference — idempotency key for every server write. */
  clientRef: string;
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

export function createBoothV2Session(clientRef: string): BoothV2Session {
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
    draft.budgetBand !== null ||
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
  const budget = budgetV2FromBand(draft.budgetBand, draft.budgetCurrency);
  return {
    profileVersion: DECISION_PROFILE_VERSION,
    flowMode: session.flowMode,
    purchasePurpose: draft.purchasePurpose ?? "exploring",
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
    preferredLanguage: session.contact.preferredLanguage.trim() || null,
    confirmedAt,
  };
}

/** Quick Profile is complete when its four required questions are answered. */
export function quickProfileComplete(draft: BoothV2Draft): boolean {
  return (
    draft.purchasePurpose !== null &&
    draft.budgetBand !== null &&
    draft.propertyType !== null &&
    draft.nav.timeline !== null
  );
}

/** Full flow completeness: NAV-001 questions + the Search Essentials. */
export function fullProfileComplete(draft: BoothV2Draft): boolean {
  return (
    draft.nav.motivations.length > 0 &&
    draft.nav.goals.length > 0 &&
    draft.budgetBand !== null &&
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
    session.handoff.consultationScheduledFor === null &&
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
  | { type: "chooseMode"; mode: FlowMode }
  | { type: "back" }
  | { type: "quickNext" }
  | { type: "fullNext" }
  | { type: "setPurchasePurpose"; value: PurchasePurpose }
  | { type: "toggleMotivation"; value: MotivationKey }
  | { type: "toggleGoal"; value: GoalKey }
  | { type: "toggleConcern"; value: ConcernKey }
  | { type: "setNote"; value: string }
  | { type: "setBudgetBand"; value: BudgetKey }
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
  | { type: "guideAcknowledged"; at: string }
  | { type: "continueToNextStep" }
  | { type: "recordFirstContact"; at: string }
  | { type: "setConsultationTime"; value: string | null }
  | { type: "setNextStep"; value: string }
  | { type: "completeContacted" }
  | { type: "completeNoContact" }
  | { type: "markAbandoned" }
  | { type: "markEventRecorded"; event: BoothFunnelEvent }
  | { type: "replace"; session: BoothV2Session }
  | { type: "reset"; clientRef: string };

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
    case "mode_selection":
      return { ...session, screen: "permission" };
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
  purpose: {
    quick: { screen: "quick_profile", step: 0 },
    full: { screen: "quick_profile", step: 0 },
  },
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
      return { ...session, permissionGranted: true, screen: "mode_selection" };
    case "declinePermission":
      // Respectful exit: nothing personal was collected yet; show the QR path.
      return { ...session, permissionGranted: false, screen: "respectful_no_contact_qr" };
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
    case "setBudgetBand":
      return withDraft(session, {
        budgetBand: toggleSingle(action.value, session.draft.budgetBand),
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
            acknowledgedAt: null,
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
          guide: { ...session.handoff.guide, acknowledgedAt: action.at },
        },
      };
    case "continueToNextStep":
      return { ...session, screen: "next_step" };
    case "recordFirstContact":
      return { ...session, handoff: { ...session.handoff, firstContactConfirmedAt: action.at } };
    case "setConsultationTime":
      return {
        ...session,
        handoff: { ...session.handoff, consultationScheduledFor: action.value },
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
    case "reset":
      return createBoothV2Session(action.clientRef);
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
    if (typeof candidate.clientRef !== "string" || candidate.clientRef.length === 0) return null;
    if (!BOOTH_V2_SCREENS.includes(candidate.screen as BoothV2Screen)) return null;
    if (candidate.outcome !== "active") return null; // finished sessions never come back
    if (!candidate.draft || typeof candidate.draft !== "object") return null;
    if (!candidate.contact || typeof candidate.contact !== "object") return null;

    // Rebuild on a fresh base so missing fields get safe defaults, then
    // re-validate the confirmed profile through its own fail-closed parser.
    const base = createBoothV2Session(candidate.clientRef);
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
