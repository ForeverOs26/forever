import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { Property } from "@/lib/data";
import { projectListQuery } from "@/lib/project-service";
import ChoiceGroup from "../components/ChoiceGroup";
import NoteField from "../components/NoteField";
import PrimaryActionBar from "../components/PrimaryActionBar";
import {
  BUDGET_OPTIONS,
  CONCERN_OPTIONS,
  SUCCESS_OPTIONS,
  TIMELINE_OPTIONS,
  WHY_PHUKET_OPTIONS,
  budgetLabel,
  buildProjectPath,
  concernLabels,
  goalLabels,
  humanizeList,
  isUnavailableValue,
  motivationLabels,
  timelineLabel,
  type BudgetKey,
  type ConcernKey,
  type GoalKey,
  type MotivationKey,
  type TimelineKey,
} from "../core";
import {
  BOOTH_BUDGET_CURRENCIES,
  BOOTH_CONTACT_LANGUAGES,
  FULL_NAV_STEPS,
  GUIDE_ACK_TARGET_SECONDS,
  GUIDE_CONTACT_SLA_SECONDS,
  MAX_SHORTLIST,
  NO_DIRECTION_MESSAGE,
  QUICK_STEPS,
  WHATSAPP_UNAVAILABLE_MESSAGE,
  buildProfileFromDraft,
  derivePurchasePurpose,
  canCompleteContacted,
  contactedCompletionBlockers,
  draftBudget,
  draftBudgetAnswered,
  evaluateDirections,
  fullProfileComplete,
  hasGuestDataV2,
  quickProfileComplete,
  suggestGuides,
  validateBudgetRange,
  visibleDirections,
  type BedroomPreference,
  type BoothBudgetCurrency,
  type BoothFunnelEvent,
  type BoothGuide,
  type BoothV2Action,
  type BoothV2Session,
  type EditTarget,
  type FxRateConfig,
  type PropertyTypePreference,
  type PurchasePurpose,
  type ReadinessPreference,
} from "../core/v2";
import { BoothToast, type BoothToastState } from "../booth/BoothToast";
import { ResetConfirmDialog } from "../booth/ResetConfirmDialog";
import { BoothV2Shell } from "./BoothV2Shell";
import { BoothV2ContactForm } from "./BoothV2ContactForm";
import { DirectionCardView } from "./DirectionCardView";
import { useBoothV2Session } from "./useBoothV2Session";
import {
  boothV2AcknowledgeGuide,
  boothV2AssignGuide,
  boothV2CommitConsent,
  boothV2CompleteSession,
  boothV2ConfirmWhatsappVerification,
  boothV2EnsureSession,
  boothV2GetConfig,
  boothV2ListGuides,
  boothV2MarkProfileConfirmed,
  boothV2RecordEvent,
  boothV2RecordHandoff,
  boothV2StartWhatsappVerification,
  boothV2ValidateShortlist,
} from "./booth-v2.functions";

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-5">
      <p className="text-[11px] font-[700] uppercase tracking-[0.2em] text-[#9C7B4C]">{eyebrow}</p>
      <h1
        tabIndex={-1}
        className="mt-2 text-[28px] font-[400] leading-tight text-[#17150F] outline-none [font-family:'Newsreader',Georgia,serif] md:text-[36px]"
      >
        {title}
      </h1>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[18px] border border-[#E3DED4] bg-white p-6 md:p-8">{children}</div>
  );
}

const PURPOSE_OPTIONS = [
  { key: "lifestyle", label: "For living & lifestyle" },
  { key: "investment", label: "For investment" },
  { key: "both", label: "Both" },
  { key: "exploring", label: "Just exploring" },
] as const;

const PROPERTY_TYPE_OPTIONS = [
  { key: "condominium", label: "Condominium" },
  { key: "villa", label: "Villa" },
  { key: "both", label: "Either — condo or villa" },
  { key: "unsure", label: "Not sure yet" },
] as const;

const BEDROOM_OPTIONS = [
  { key: "studio", label: "Studio" },
  { key: "1", label: "1 bedroom" },
  { key: "2", label: "2 bedrooms" },
  { key: "3", label: "3 bedrooms" },
  { key: "4_plus", label: "4+ bedrooms" },
  { key: "unsure", label: "Not sure yet" },
] as const;

const READINESS_OPTIONS = [
  { key: "ready", label: "Ready to move in" },
  { key: "off_plan", label: "Off-plan / under construction" },
  { key: "both", label: "Open to both" },
  { key: "unsure", label: "Not sure yet" },
] as const;

/** The guest's own numeric statement, echoed exactly — never converted. */
function formatStatedBudget(draft: BoothV2Session["draft"]): string {
  const currency = draft.budgetCurrency;
  const format = (value: number) => `${value.toLocaleString("en-US")} ${currency}`;
  if (draft.budgetMinimum !== null && draft.budgetMaximum !== null) {
    return `${format(draft.budgetMinimum)} – ${format(draft.budgetMaximum)}`;
  }
  if (draft.budgetMaximum !== null) return `Up to ${format(draft.budgetMaximum)}`;
  if (draft.budgetMinimum !== null) return `From ${format(draft.budgetMinimum)}`;
  return "Not stated";
}

export function BoothV2Navigator({ hostName }: { hostName?: string | null } = {}) {
  const [resetOpen, setResetOpen] = useState(false);
  const [toast, setToast] = useState<BoothToastState | null>(null);
  const [failedBanner, setFailedBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [browseAll, setBrowseAll] = useState(false);
  const [waState, setWaState] = useState<{
    configured: boolean | null;
    waHref: string | null;
    sessionCode: string | null;
  }>({ configured: null, waHref: null, sessionCode: null });

  const { session, dispatch, reset, inactivityWarning, dismissInactivityWarning } =
    useBoothV2Session({
      onInactivityClear: (abandoned) => {
        void boothV2RecordEvent({
          data: {
            clientRef: abandoned.clientRef,
            event: "session_abandoned",
            step: abandoned.screen,
            reason: "inactivity_timeout",
          },
        }).catch(() => undefined);
      },
    });

  const { screen, draft, contact } = session;

  const configQuery = useQuery({
    queryKey: ["booth-v2", "config"],
    queryFn: () => boothV2GetConfig(),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const fx: FxRateConfig | null = configQuery.data?.fx ?? null;

  // The catalogue is needed from Location fit onward (areas come from it).
  const catalogueEnabled =
    screen === "location_fit" ||
    screen === "decision_summary" ||
    screen === "initial_directions" ||
    screen === "contact";
  const catalogue = useQuery({ ...projectListQuery(), enabled: catalogueEnabled });
  const projects = useMemo<Property[]>(() => catalogue.data ?? [], [catalogue.data]);

  const guidesQuery = useQuery({
    queryKey: ["booth-v2", "guides"],
    queryFn: () => boothV2ListGuides(),
    enabled: screen === "guide_assignment",
    retry: 1,
  });

  // The language is a PROFILE fact captured before the summary; the contact
  // form only mirrors it, so the two can never disagree (the server rejects a
  // mismatch outright).
  useEffect(() => {
    const language = session.draft.preferredLanguage ?? "";
    if (session.screen === "contact" && session.contact.preferredLanguage !== language) {
      dispatch({ type: "setContactField", field: "preferredLanguage", value: language });
    }
  }, [
    session.screen,
    session.draft.preferredLanguage,
    session.contact.preferredLanguage,
    dispatch,
  ]);

  const directions = useMemo(
    () =>
      session.confirmedProfile ? evaluateDirections(session.confirmedProfile, projects) : null,
    [session.confirmedProfile, projects],
  );

  /**
   * Client-observed funnel events only, with acknowledgement BEFORE dedupe:
   * the event is marked recorded only after the server confirms persistence,
   * so a transient network failure leaves it retryable instead of silently
   * lost. Every transition event (profile confirmed, WhatsApp verified, Guide
   * assigned/acknowledged, first contact, consultation booked, no-contact
   * continuation) is emitted server-side by the operation that establishes
   * the fact and is not routed through here at all.
   */
  async function recordEventOnce(event: BoothFunnelEvent, step?: string, reason?: string) {
    if (session.recordedEvents.includes(event)) return;
    try {
      await boothV2RecordEvent({
        data: { clientRef: session.clientRef, event, step, reason },
      });
      dispatch({ type: "markEventRecorded", event });
    } catch {
      // Left unmarked on purpose: the next attempt retries it, and the
      // database's (session_id, event) uniqueness keeps it exactly-once.
    }
  }

  function handleStartNewGuest() {
    if (hasGuestDataV2(session)) {
      setResetOpen(true);
    } else {
      reset();
    }
  }

  function confirmReset() {
    reset();
    setResetOpen(false);
    setFailedBanner(null);
    setBrowseAll(false);
    setWaState({ configured: null, waHref: null, sessionCode: null });
    setToast({ tone: "success", message: "New guest session started." });
  }

  function openProject(slug: string) {
    if (typeof window !== "undefined") {
      window.open(buildProjectPath(slug), "_blank", "noopener,noreferrer");
    }
  }

  async function grantPermission() {
    dispatch({ type: "grantPermission" });
    try {
      await boothV2EnsureSession({ data: { clientRef: session.clientRef } });
    } catch {
      setToast({ tone: "error", message: "Couldn't open a booth session. Try again." });
      return;
    }
    void recordEventOnce("meaningful_conversation");
  }

  function chooseMode(mode: "quick" | "full") {
    dispatch({ type: "chooseMode", mode });
    // The mode travels as the funnel event's step, so quick-vs-full stays
    // measurable without the session row retaining anything about the guest.
    void recordEventOnce("profile_started", mode);
  }

  /**
   * Confirming the profile does NOT persist it. The server re-runs the strict
   * schema (so a malformed or tampered payload is caught here rather than at
   * the contact step) and records only the non-personal funnel fact; the
   * profile itself stays in this tablet's local session until the guest gives
   * the consultation consent.
   */
  async function confirmProfile() {
    const profile = buildProfileFromDraft(session, fx, new Date().toISOString());
    if (!profile) return;
    try {
      await boothV2MarkProfileConfirmed({ data: { clientRef: session.clientRef, profile } });
      dispatch({ type: "confirmProfile", profile });
    } catch {
      setToast({
        tone: "error",
        message: "We couldn't confirm the Decision Profile. Please try again.",
      });
    }
  }

  async function syncShortlistAndContinue() {
    dispatch({ type: "continueToContact" });
    try {
      // Validation only: proves every selected direction is a real project.
      // The selection is persisted by the consent transaction, not here.
      await boothV2ValidateShortlist({
        data: {
          clientRef: session.clientRef,
          entries: session.shortlist.entries,
          guidePrepares: session.shortlist.guidePrepares,
        },
      });
    } catch {
      // A stale direction surfaces again at the consent step, which refuses it.
    }
  }

  /**
   * THE consent boundary. The confirmed profile and the shortlist are sent HERE
   * — with the contact bundle and the guest's acknowledgement — because none of
   * them has been persisted before this moment. The server writes all of it,
   * the consent and exactly one lead in a single transaction.
   */
  async function handleContactSubmit() {
    if (submitting) return;
    if (!session.confirmedProfile) return;
    setFailedBanner(null);
    setSubmitting(true);
    try {
      await boothV2CommitConsent({
        data: {
          clientRef: session.clientRef,
          profile: session.confirmedProfile,
          entries: session.shortlist.entries,
          guidePrepares: session.shortlist.guidePrepares,
          contact,
        },
      });
      dispatch({ type: "contactSaved", at: new Date().toISOString() });
    } catch {
      setFailedBanner(
        "We couldn't save the contact details. Please try again — the guest's session is untouched.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function declineContact() {
    dispatch({ type: "declineContact" });
    // Nothing about the guest was ever persisted before consent, so there is
    // usually nothing to erase; the server still clears anything a corrected
    // earlier consent had stored, deletes any lead for this session, and emits
    // qr_continuation — all in one transaction.
    try {
      await boothV2CompleteSession({
        data: { clientRef: session.clientRef, outcome: "no_contact_qr" },
      });
    } catch {
      setToast({ tone: "error", message: "Couldn't close the session. Try again." });
    }
  }

  async function startWhatsappVerification() {
    try {
      const result = await boothV2StartWhatsappVerification({
        data: { clientRef: session.clientRef },
      });
      setWaState({
        configured: result.configured,
        waHref: result.waHref,
        sessionCode: result.sessionCode,
      });
      dispatch({ type: result.configured ? "whatsappPending" : "whatsappUnavailable" });
    } catch {
      setToast({ tone: "error", message: "Couldn't start WhatsApp verification. Try again." });
    }
  }

  async function confirmWhatsappVerification() {
    try {
      const result = await boothV2ConfirmWhatsappVerification({
        data: { clientRef: session.clientRef, method: "wa_me_host_confirmed" },
      });
      dispatch({ type: "whatsappVerified", at: result.verifiedAt, method: "wa_me_host_confirmed" });
    } catch {
      setToast({ tone: "error", message: "Couldn't record the verification. Try again." });
    }
  }

  async function assignGuide(
    guide: BoothGuide,
    reserve: BoothGuide | null,
    fallback: string | null,
  ) {
    try {
      const result = await boothV2AssignGuide({
        data: {
          clientRef: session.clientRef,
          guideId: guide.id,
          reserveGuideId: reserve?.id ?? null,
          fallbackReason: fallback,
        },
      });
      dispatch({
        type: "guideAssigned",
        at: result.assignedAt,
        guide: {
          id: guide.id,
          displayName: guide.displayName,
          languages: guide.languages,
          hasStaffAccount: guide.hasStaffAccount === true,
        },
        reserve: reserve
          ? { id: reserve.id, displayName: reserve.displayName, languages: reserve.languages }
          : null,
        fallbackReason: fallback,
      });
    } catch {
      setToast({ tone: "error", message: "Couldn't assign the Guide. Try again." });
    }
  }

  async function acknowledgeGuide() {
    try {
      // The server decides the METHOD from who is actually acting: only the
      // assigned Guide's own account yields "guide_self_confirmed".
      const result = await boothV2AcknowledgeGuide({ data: { clientRef: session.clientRef } });
      dispatch({
        type: "guideAcknowledged",
        at: result.acknowledgedAt,
        method: result.method,
      });
    } catch {
      setToast({ tone: "error", message: "Couldn't record the acknowledgement. Try again." });
    }
  }

  async function recordFirstContact() {
    try {
      const result = await boothV2RecordHandoff({
        data: { clientRef: session.clientRef, firstContactConfirmed: true },
      });
      dispatch({
        type: "recordFirstContact",
        at: new Date().toISOString(),
        method: result.firstContactMethod ?? "host_observed",
      });
    } catch {
      setToast({ tone: "error", message: "Couldn't record the live contact. Try again." });
    }
  }

  /** `scheduledAt` is an exact instant (ISO) or null — never free text. */
  async function saveNextStep(nextStep: string, scheduledAt: string | null) {
    const timezone =
      typeof Intl !== "undefined"
        ? (Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC")
        : "UTC";
    try {
      await boothV2RecordHandoff({
        data: {
          clientRef: session.clientRef,
          nextStep,
          consultationScheduledAt: scheduledAt,
          consultationTimezone: scheduledAt ? timezone : null,
        },
      });
      dispatch({ type: "setNextStep", value: nextStep });
      dispatch({
        type: "setConsultationTime",
        at: scheduledAt,
        timezone: scheduledAt ? timezone : null,
      });
    } catch {
      setToast({
        tone: "error",
        message: "Couldn't save the next step — check the consultation time and try again.",
      });
    }
  }

  async function completeContacted() {
    if (!canCompleteContacted(session)) return;
    try {
      await boothV2CompleteSession({
        data: { clientRef: session.clientRef, outcome: "contacted_complete" },
      });
      dispatch({ type: "completeContacted" });
    } catch {
      setToast({
        tone: "error",
        message: "The session could not be completed — check the remaining steps.",
      });
    }
  }

  return (
    <BoothV2Shell
      screen={screen}
      hostName={hostName ?? configQuery.data?.hostName ?? null}
      onStartNewGuest={handleStartNewGuest}
    >
      {screen === "welcome" ? (
        <Panel>
          <SectionHeading
            eyebrow="Forever · Assisted Decision"
            title="Deciding well takes a moment of clarity."
          />
          <p className="max-w-[560px] text-[15px] leading-relaxed text-[#57534A]">
            A short, honest conversation about what you actually want from Phuket — and a clear
            picture to take home. No pressure, no sales script.
          </p>
          <PrimaryActionBar
            primaryLabel="Begin"
            onPrimary={() => dispatch({ type: "begin" })}
            sticky={false}
          />
        </Panel>
      ) : null}

      {screen === "permission" ? (
        <Panel>
          <SectionHeading eyebrow="Before we start" title="May we look at this together?" />
          <p className="max-w-[560px] text-[15px] leading-relaxed text-[#57534A]">
            A few quick questions help us understand what matters to you. Nothing is saved until you
            say so, and you can stop at any point.
          </p>
          <PrimaryActionBar
            primaryLabel="Yes — let's look together"
            onPrimary={grantPermission}
            secondaryLabel="I'm just browsing on my own"
            onSecondary={() => {
              dispatch({ type: "declinePermission" });
              void recordEventOnce("qr_continuation");
            }}
            sticky={false}
          />
        </Panel>
      ) : null}

      {screen === "language" ? (
        <Panel>
          <SectionHeading eyebrow="So we understand each other" title="Which language suits you?" />
          <p className="mb-5 max-w-[560px] text-[14px] leading-relaxed text-[#57534A]">
            We capture this now so your Decision Profile — and the Guide we introduce you to — match
            the language you are most comfortable in.
          </p>
          <ChoiceGroup
            ariaLabel="Preferred language"
            items={BOOTH_CONTACT_LANGUAGES.map((language) => ({ key: language, title: language }))}
            selectedKeys={draft.preferredLanguage ? [draft.preferredLanguage] : []}
            onToggle={(key) => dispatch({ type: "setPreferredLanguage", value: key })}
          />
          <PrimaryActionBar
            primaryLabel="Continue"
            disabled={!draft.preferredLanguage}
            onPrimary={() => dispatch({ type: "continueToModeSelection" })}
            secondaryLabel="Back"
            onSecondary={() => dispatch({ type: "back" })}
            sticky={false}
          />
        </Panel>
      ) : null}

      {screen === "mode_selection" ? (
        <Panel>
          <SectionHeading eyebrow="Your pace" title="How much time do you have?" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <button
              type="button"
              onClick={() => chooseMode("quick")}
              className="rounded-[16px] border border-[#EAE6DE] bg-white p-6 text-left outline-none transition-colors hover:border-[#D8D2C6] hover:bg-[#FBFAF7] focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2"
            >
              <span className="text-[19px] font-[600] text-[#17150F]">Quick — about a minute</span>
              <p className="mt-2 text-[14px] leading-relaxed text-[#57534A]">
                Four essentials: purpose, budget, property type, timeline. Enough to hand you to the
                right person.
              </p>
            </button>
            <button
              type="button"
              onClick={() => chooseMode("full")}
              className="rounded-[16px] border border-[#EAE6DE] bg-white p-6 text-left outline-none transition-colors hover:border-[#D8D2C6] hover:bg-[#FBFAF7] focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2"
            >
              <span className="text-[19px] font-[600] text-[#17150F]">Full — a deeper look</span>
              <p className="mt-2 text-[14px] leading-relaxed text-[#57534A]">
                The full Decision Profile: what draws you to Phuket, what success looks like, your
                concerns — plus the practical search essentials.
              </p>
            </button>
          </div>
          <PrimaryActionBar
            primaryLabel="Back"
            onPrimary={() => dispatch({ type: "back" })}
            sticky={false}
          />
        </Panel>
      ) : null}

      {screen === "quick_profile" ? (
        <QuickProfileView
          session={session}
          onBack={() => dispatch({ type: "back" })}
          onNext={() => dispatch({ type: "quickNext" })}
          dispatch={dispatch}
        />
      ) : null}

      {screen === "full_nav_questions" ? (
        <FullNavView
          session={session}
          onBack={() => dispatch({ type: "back" })}
          onNext={() => dispatch({ type: "fullNext" })}
          dispatch={dispatch}
        />
      ) : null}

      {screen === "property_fit" ? (
        <Panel>
          <SectionHeading eyebrow="Search essentials · 1 of 3" title="What kind of home?" />
          <ChoiceGroup
            ariaLabel="Property type"
            items={PROPERTY_TYPE_OPTIONS.map((o) => ({ key: o.key, title: o.label }))}
            selectedKeys={draft.propertyType ? [draft.propertyType] : []}
            onToggle={(key) =>
              dispatch({ type: "setPropertyType", value: key as PropertyTypePreference })
            }
          />
          <h2 className="mb-3 mt-8 text-[17px] font-[600] text-[#17150F]">Bedrooms</h2>
          <ChoiceGroup
            ariaLabel="Bedrooms"
            items={BEDROOM_OPTIONS.map((o) => ({ key: o.key, title: o.label }))}
            selectedKeys={draft.bedrooms ? [draft.bedrooms] : []}
            onToggle={(key) => dispatch({ type: "setBedrooms", value: key as BedroomPreference })}
          />
          <PrimaryActionBar
            primaryLabel="Continue"
            disabled={!draft.propertyType || !draft.bedrooms}
            onPrimary={() => dispatch({ type: "continueToLocationFit" })}
            secondaryLabel="Back"
            onSecondary={() => dispatch({ type: "back" })}
            sticky={false}
          />
        </Panel>
      ) : null}

      {screen === "location_fit" ? (
        <LocationFitView
          session={session}
          projects={projects}
          loading={catalogue.isLoading}
          dispatch={dispatch}
        />
      ) : null}

      {screen === "readiness" ? (
        <Panel>
          <SectionHeading
            eyebrow="Search essentials · 3 of 3"
            title="Ready, or still being built?"
          />
          <ChoiceGroup
            ariaLabel="Readiness"
            items={READINESS_OPTIONS.map((o) => ({ key: o.key, title: o.label }))}
            selectedKeys={draft.readiness ? [draft.readiness] : []}
            onToggle={(key) =>
              dispatch({ type: "setReadiness", value: key as ReadinessPreference })
            }
          />
          <PrimaryActionBar
            primaryLabel="See my Decision Summary"
            disabled={!fullProfileComplete(draft)}
            onPrimary={() => dispatch({ type: "continueToSummary" })}
            secondaryLabel="Back"
            onSecondary={() => dispatch({ type: "back" })}
            sticky={false}
          />
        </Panel>
      ) : null}

      {screen === "decision_summary" ? (
        <DecisionSummaryView
          session={session}
          fx={fx}
          onConfirm={confirmProfile}
          dispatch={dispatch}
        />
      ) : null}

      {screen === "initial_directions" && session.confirmedProfile ? (
        <DirectionsView
          session={session}
          directions={directions}
          browseAll={browseAll}
          setBrowseAll={setBrowseAll}
          loading={catalogue.isLoading}
          onOpenProject={openProject}
          onContinue={syncShortlistAndContinue}
          dispatch={dispatch}
        />
      ) : null}

      {screen === "contact" ? (
        <Panel>
          <SectionHeading eyebrow="Stay in touch" title="Where should your Guide reach you?" />
          <p className="mb-5 max-w-[560px] text-[14px] leading-relaxed text-[#57534A]">
            First name, WhatsApp, and your language — that's all we need. Everything else is
            optional.
          </p>
          <BoothV2ContactForm
            contact={contact}
            onChangeLanguage={() => dispatch({ type: "editSection", target: "language" })}
            submitting={submitting}
            failedBanner={failedBanner}
            onFieldChange={(field, value) => dispatch({ type: "setContactField", field, value })}
            onConsentChange={(value) => dispatch({ type: "setConsultationConsent", value })}
            onMarketingChange={(value) => dispatch({ type: "setMarketingOptIn", value })}
            onSubmit={handleContactSubmit}
            onDeclineContact={declineContact}
          />
          <PrimaryActionBar
            primaryLabel="Back"
            onPrimary={() => dispatch({ type: "back" })}
            sticky={false}
          />
        </Panel>
      ) : null}

      {screen === "whatsapp_verification" ? (
        <WhatsappView
          waState={waState}
          verificationState={session.handoff.whatsapp.state}
          onStart={startWhatsappVerification}
          onConfirm={confirmWhatsappVerification}
          onContinue={() => dispatch({ type: "continueToGuideAssignment" })}
          onBack={() => dispatch({ type: "back" })}
        />
      ) : null}

      {screen === "guide_assignment" ? (
        <GuideAssignmentView
          preferredLanguage={contact.preferredLanguage || null}
          guides={guidesQuery.data ?? null}
          loading={guidesQuery.isLoading}
          onAssign={assignGuide}
          onBack={() => dispatch({ type: "back" })}
        />
      ) : null}

      {screen === "handoff_waiting" ? (
        <HandoffWaitingView
          session={session}
          onAcknowledge={acknowledgeGuide}
          onContinue={() => dispatch({ type: "continueToNextStep" })}
          onBack={() => dispatch({ type: "back" })}
        />
      ) : null}

      {screen === "next_step" ? (
        <NextStepView
          session={session}
          onRecordFirstContact={recordFirstContact}
          onSave={saveNextStep}
          onComplete={completeContacted}
          onBack={() => dispatch({ type: "back" })}
        />
      ) : null}

      {screen === "completion" ? (
        <CompletionView session={session} onNewGuest={confirmReset} />
      ) : null}

      {screen === "respectful_no_contact_qr" ? (
        <NoContactView
          finished={session.outcome === "no_contact_qr"}
          onFinish={() => {
            void recordEventOnce("qr_continuation");
            dispatch({ type: "completeNoContact" });
            void boothV2CompleteSession({
              data: { clientRef: session.clientRef, outcome: "no_contact_qr" },
            }).catch(() => undefined);
          }}
          onBack={() => dispatch({ type: "back" })}
          setToast={setToast}
        />
      ) : null}

      {resetOpen ? (
        <ResetConfirmDialog onCancel={() => setResetOpen(false)} onConfirm={confirmReset} />
      ) : null}

      {inactivityWarning ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#17150F]/40 px-6"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="booth-idle-title"
        >
          <div className="w-full max-w-[440px] rounded-[18px] border border-[#E3DED4] bg-white p-7">
            <h2
              id="booth-idle-title"
              className="text-[22px] font-[400] leading-tight text-[#17150F] [font-family:'Newsreader',Georgia,serif]"
            >
              Is this guest still here?
            </h2>
            <p className="mt-3 text-[14.5px] leading-relaxed text-[#57534A]">
              This session has been idle. To protect the guest's privacy it will clear itself
              shortly unless you keep it open.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
              <button
                type="button"
                onClick={dismissInactivityWarning}
                className="min-h-[52px] flex-1 rounded-[14px] bg-[#17150F] px-4 text-[15px] font-[600] text-white outline-none focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2"
              >
                Keep this session
              </button>
              <button
                type="button"
                onClick={() => {
                  void recordEventOnce("session_abandoned", screen, "host_cleared_after_warning");
                  confirmReset();
                }}
                className="min-h-[52px] flex-1 rounded-[14px] border border-[#EAE6DE] bg-white px-4 text-[15px] font-[600] text-[#57534A] outline-none hover:bg-[#FBFAF7] focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2"
              >
                Clear now
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <BoothToast toast={toast} onDismiss={() => setToast(null)} />
    </BoothV2Shell>
  );
}

/* ---------- Quick Profile ---------- */

function QuickProfileView({
  session,
  onBack,
  onNext,
  dispatch,
}: {
  session: BoothV2Session;
  onBack: () => void;
  onNext: () => void;
  dispatch: (action: BoothV2Action) => void;
}) {
  const { draft, quickStep } = session;
  const step = QUICK_STEPS[quickStep];
  const stepReady =
    step === "purpose"
      ? draft.purchasePurpose !== null
      : step === "budget"
        ? draftBudgetAnswered(draft)
        : step === "property_type"
          ? draft.propertyType !== null
          : draft.nav.timeline !== null;

  return (
    <Panel>
      <SectionHeading
        eyebrow={`Quick profile · ${quickStep + 1} of ${QUICK_STEPS.length}`}
        title={
          step === "purpose"
            ? "What is this purchase for?"
            : step === "budget"
              ? "What budget feels comfortable?"
              : step === "property_type"
                ? "Condominium or villa?"
                : "When would you like to decide?"
        }
      />

      {step === "purpose" ? (
        <ChoiceGroup
          ariaLabel="Purchase purpose"
          items={PURPOSE_OPTIONS.map((o) => ({ key: o.key, title: o.label }))}
          selectedKeys={draft.purchasePurpose ? [draft.purchasePurpose] : []}
          onToggle={(key) =>
            dispatch({ type: "setPurchasePurpose", value: key as PurchasePurpose })
          }
        />
      ) : null}

      {step === "budget" ? <BudgetPicker session={session} dispatch={dispatch} /> : null}

      {step === "property_type" ? (
        <ChoiceGroup
          ariaLabel="Property type"
          items={PROPERTY_TYPE_OPTIONS.map((o) => ({ key: o.key, title: o.label }))}
          selectedKeys={draft.propertyType ? [draft.propertyType] : []}
          onToggle={(key) =>
            dispatch({ type: "setPropertyType", value: key as PropertyTypePreference })
          }
        />
      ) : null}

      {step === "timeline" ? (
        <ChoiceGroup
          ariaLabel="Decision timeline"
          items={TIMELINE_OPTIONS.map((o) => ({ key: o.key, title: o.label }))}
          selectedKeys={draft.nav.timeline ? [draft.nav.timeline] : []}
          onToggle={(key) => dispatch({ type: "setTimeline", value: key as TimelineKey })}
        />
      ) : null}

      <PrimaryActionBar
        primaryLabel={quickStep === QUICK_STEPS.length - 1 ? "See my summary" : "Continue"}
        disabled={quickStep === QUICK_STEPS.length - 1 ? !quickProfileComplete(draft) : !stepReady}
        onPrimary={onNext}
        secondaryLabel="Back"
        onSecondary={onBack}
        sticky={false}
      />
    </Panel>
  );
}

/**
 * Explicit numeric budget in the guest's OWN currency. The approved NAV-001
 * USD bands are never reused as amounts in another currency — that would be a
 * commercially misleading pseudo-conversion — so the booth asks for real
 * numbers and treats "still exploring" as a first-class answer.
 */
function BudgetPicker({
  session,
  dispatch,
}: {
  session: BoothV2Session;
  dispatch: (action: BoothV2Action) => void;
}) {
  const { draft } = session;
  const uid = useId();
  const error = draft.budgetExploring ? null : validateBudgetRange(draftBudget(draft));
  const parseAmount = (raw: string): number | null => {
    const cleaned = raw.replace(/[\s,]/g, "");
    if (cleaned.length === 0) return null;
    const value = Number(cleaned);
    return Number.isFinite(value) ? value : Number.NaN;
  };

  return (
    <div>
      <div
        className="mb-4 flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Budget currency"
      >
        {BOOTH_BUDGET_CURRENCIES.map((currency) => (
          <button
            key={currency}
            type="button"
            aria-pressed={draft.budgetCurrency === currency}
            onClick={() => dispatch({ type: "setBudgetCurrency", value: currency })}
            className={[
              "min-h-[40px] rounded-full border px-4 text-[13px] font-[600] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2",
              draft.budgetCurrency === currency
                ? "border-[#17150F] bg-[#F3EFE7] text-[#17150F]"
                : "border-[#EAE6DE] bg-white text-[#57534A] hover:bg-[#FBFAF7]",
            ].join(" ")}
          >
            {currency}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={uid + "-min"} className="text-[13px] font-[600] text-[#3A362E]">
            From ({draft.budgetCurrency})
          </label>
          <input
            id={uid + "-min"}
            inputMode="numeric"
            disabled={draft.budgetExploring}
            value={draft.budgetMinimum === null ? "" : String(draft.budgetMinimum)}
            onChange={(event) =>
              dispatch({
                type: "setBudgetAmounts",
                minimum: parseAmount(event.target.value),
                maximum: draft.budgetMaximum,
              })
            }
            className="min-h-[50px] rounded-[13px] border border-[#EAE6DE] bg-white px-4 text-[15px] text-[#2A2820] outline-none focus:border-[#D8D2C6] focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2 disabled:bg-[#F6F4EF] disabled:text-[#B0AB9F]"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={uid + "-max"} className="text-[13px] font-[600] text-[#3A362E]">
            Up to ({draft.budgetCurrency})
          </label>
          <input
            id={uid + "-max"}
            inputMode="numeric"
            disabled={draft.budgetExploring}
            value={draft.budgetMaximum === null ? "" : String(draft.budgetMaximum)}
            onChange={(event) =>
              dispatch({
                type: "setBudgetAmounts",
                minimum: draft.budgetMinimum,
                maximum: parseAmount(event.target.value),
              })
            }
            className="min-h-[50px] rounded-[13px] border border-[#EAE6DE] bg-white px-4 text-[15px] text-[#2A2820] outline-none focus:border-[#D8D2C6] focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2 disabled:bg-[#F6F4EF] disabled:text-[#B0AB9F]"
          />
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-[12.5px] text-[#C96F52]">
          {error === "range_inverted"
            ? "The lower amount must not exceed the upper amount."
            : error === "amount_invalid"
              ? "Enter a plain number, or leave the field empty."
              : "Enter at least one amount, or choose \u201cstill exploring\u201d."}
        </p>
      ) : null}

      <button
        type="button"
        aria-pressed={draft.budgetExploring}
        onClick={() => dispatch({ type: "setBudgetExploring", value: !draft.budgetExploring })}
        className={[
          "mt-4 w-full rounded-[15px] border px-[18px] py-[17px] text-left text-[15.5px] font-[500] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2",
          draft.budgetExploring
            ? "border-[1.5px] border-[#17150F] bg-[#F3EFE7] font-[600] text-[#17150F]"
            : "border border-[#EAE6DE] bg-white text-[#3A362E] hover:bg-[#FBFAF7]",
        ].join(" ")}
      >
        Still exploring — no budget yet
      </button>

      <p className="mt-3 text-[12.5px] text-[#8A857A]">
        Your budget is recorded exactly as you state it, in {draft.budgetCurrency}. We only compare
        it with THB prices when a dated, source-identified exchange rate is configured — never with
        an invented rate.
      </p>
    </div>
  );
}

/* ---------- Full NAV-001 questions ---------- */

function FullNavView({
  session,
  onBack,
  onNext,
  dispatch,
}: {
  session: BoothV2Session;
  onBack: () => void;
  onNext: () => void;
  dispatch: (action: BoothV2Action) => void;
}) {
  const { draft, fullStep } = session;
  const step = FULL_NAV_STEPS[fullStep];
  const nav = draft.nav;
  const stepReady =
    step === "why_phuket"
      ? nav.motivations.length > 0
      : step === "success"
        ? nav.goals.length > 0
        : step === "budget_timeline"
          ? draftBudgetAnswered(draft) && nav.timeline !== null
          : nav.concerns.length > 0;

  return (
    <Panel>
      <SectionHeading
        eyebrow={`Decision profile · ${fullStep + 1} of ${FULL_NAV_STEPS.length}`}
        title={
          step === "why_phuket"
            ? "Why are you considering Phuket?"
            : step === "success"
              ? "What would success look like for you?"
              : step === "budget_timeline"
                ? "Budget and timeline"
                : "What's your biggest concern right now?"
        }
      />

      {step === "why_phuket" ? (
        <ChoiceGroup
          ariaLabel="Why Phuket"
          items={WHY_PHUKET_OPTIONS.map((o) => ({ key: o.key, title: o.label }))}
          selectedKeys={nav.motivations}
          onToggle={(key) => dispatch({ type: "toggleMotivation", value: key as MotivationKey })}
        />
      ) : null}

      {step === "success" ? (
        <ChoiceGroup
          ariaLabel="What success looks like"
          items={SUCCESS_OPTIONS.map((o) => ({ key: o.key, title: o.label }))}
          selectedKeys={nav.goals}
          onToggle={(key) => dispatch({ type: "toggleGoal", value: key as GoalKey })}
        />
      ) : null}

      {step === "budget_timeline" ? (
        <div>
          <BudgetPicker session={session} dispatch={dispatch} />
          <h2 className="mb-3 mt-8 text-[17px] font-[600] text-[#17150F]">Timeline</h2>
          <ChoiceGroup
            ariaLabel="Decision timeline"
            items={TIMELINE_OPTIONS.map((o) => ({ key: o.key, title: o.label }))}
            selectedKeys={nav.timeline ? [nav.timeline] : []}
            onToggle={(key) => dispatch({ type: "setTimeline", value: key as TimelineKey })}
          />
          <h2 className="mb-3 mt-8 text-[17px] font-[600] text-[#17150F]">Purpose</h2>
          <ChoiceGroup
            ariaLabel="Purchase purpose"
            items={PURPOSE_OPTIONS.map((o) => ({ key: o.key, title: o.label }))}
            selectedKeys={draft.purchasePurpose ? [draft.purchasePurpose] : []}
            onToggle={(key) =>
              dispatch({ type: "setPurchasePurpose", value: key as PurchasePurpose })
            }
          />
        </div>
      ) : null}

      {step === "concern" ? (
        <div>
          <ChoiceGroup
            ariaLabel="Biggest concerns"
            items={CONCERN_OPTIONS.map((o) => ({ key: o.key, title: o.label }))}
            selectedKeys={nav.concerns}
            onToggle={(key) => dispatch({ type: "toggleConcern", value: key as ConcernKey })}
          />
          <NoteField
            value={nav.note}
            onChange={(value) => dispatch({ type: "setNote", value })}
            label="Anything else you'd like us to know?"
            placeholder="Anything else you'd like us to know? (optional)"
            maxLength={500}
            showCounter
          />
        </div>
      ) : null}

      <PrimaryActionBar
        primaryLabel="Continue"
        disabled={!stepReady}
        onPrimary={onNext}
        secondaryLabel="Back"
        onSecondary={onBack}
        sticky={false}
      />
    </Panel>
  );
}

/* ---------- Location fit ---------- */

function LocationFitView({
  session,
  projects,
  loading,
  dispatch,
}: {
  session: BoothV2Session;
  projects: Property[];
  loading: boolean;
  dispatch: (action: BoothV2Action) => void;
}) {
  const { draft } = session;
  const areas = useMemo(() => {
    const seen = new Set<string>();
    for (const project of projects) {
      if (!isUnavailableValue(project.location)) seen.add(project.location);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [projects]);

  const ready = draft.preferredAreas.length > 0 || draft.helpMeChooseArea;

  return (
    <Panel>
      <SectionHeading eyebrow="Search essentials · 2 of 3" title="Any part of Phuket in mind?" />
      {loading ? (
        <p className="text-[14px] text-[#8A857A]">Loading available areas…</p>
      ) : areas.length > 0 ? (
        <ChoiceGroup
          ariaLabel="Preferred areas"
          items={areas.map((area) => ({ key: area, title: area }))}
          selectedKeys={draft.preferredAreas}
          onToggle={(key) => dispatch({ type: "toggleArea", value: key })}
        />
      ) : (
        <p className="text-[14px] text-[#8A857A]">
          No area facts are available from the current project records.
        </p>
      )}
      <div className="mt-5">
        <button
          type="button"
          aria-pressed={draft.helpMeChooseArea}
          onClick={() => dispatch({ type: "setHelpMeChooseArea", value: !draft.helpMeChooseArea })}
          className={[
            "w-full rounded-[15px] border px-[18px] py-[17px] text-left text-[15.5px] font-[500] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2",
            draft.helpMeChooseArea
              ? "border-[1.5px] border-[#17150F] bg-[#F3EFE7] font-[600] text-[#17150F]"
              : "border border-[#EAE6DE] bg-white text-[#3A362E] hover:bg-[#FBFAF7]",
          ].join(" ")}
        >
          Help me choose based on my lifestyle
        </button>
      </div>
      <PrimaryActionBar
        primaryLabel="Continue"
        disabled={!ready}
        onPrimary={() => dispatch({ type: "continueToReadiness" })}
        secondaryLabel="Back"
        onSecondary={() => dispatch({ type: "back" })}
        sticky={false}
      />
    </Panel>
  );
}

/* ---------- Decision summary ---------- */

function SummaryRow({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: string;
  onEdit?: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[#F1EDE6] py-3 last:border-b-0">
      <div>
        <p className="text-[11.5px] font-[700] uppercase tracking-[0.14em] text-[#8A857A]">
          {label}
        </p>
        <p className="mt-1 text-[14.5px] leading-snug text-[#2A2820]">{value}</p>
      </div>
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${label}`}
          className="shrink-0 rounded-[10px] border border-[#EAE6DE] bg-white px-3 py-1.5 text-[12.5px] font-[600] text-[#3A362E] outline-none hover:bg-[#FBFAF7] focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2"
        >
          Edit
        </button>
      ) : null}
    </div>
  );
}

function DecisionSummaryView({
  session,
  fx,
  onConfirm,
  dispatch,
}: {
  session: BoothV2Session;
  fx: FxRateConfig | null;
  onConfirm: () => void;
  dispatch: (action: BoothV2Action) => void;
}) {
  const { draft, flowMode } = session;
  const edit = (target: EditTarget) => () => dispatch({ type: "editSection", target });
  // Quick asks the purpose; Full derives it from the NAV-001 answers.
  const purposeKey = flowMode === "full" ? derivePurchasePurpose(draft.nav) : draft.purchasePurpose;
  const purposeLabel =
    (PURPOSE_OPTIONS.find((o) => o.key === purposeKey)?.label ?? "Not stated") +
    (flowMode === "full" ? " · from your answers" : "");
  const complete = flowMode === "quick" ? quickProfileComplete(draft) : fullProfileComplete(draft);

  return (
    <Panel>
      <SectionHeading eyebrow="Your Decision Profile" title="Does this look right?" />
      <p className="mb-5 max-w-[600px] rounded-[13px] border border-[#EAE6DE] bg-[#FBFAF7] px-4 py-3 text-[14px] leading-relaxed text-[#57534A]">
        This is your initial Decision Profile. It is not a sales recommendation yet — it is what we
        understood, so your Guide starts from the truth.
      </p>

      <div className="rounded-[15px] border border-[#EAE6DE] bg-white px-5 py-2">
        <SummaryRow label="Purchase purpose" value={purposeLabel} onEdit={edit("purpose")} />
        <SummaryRow
          label="Budget"
          value={
            draft.budgetExploring
              ? "Still exploring"
              : `${formatStatedBudget(draft)}${
                  fx || draft.budgetCurrency === "THB"
                    ? ""
                    : " · THB comparison off (no dated verified rate)"
                }`
          }
          onEdit={edit("budget_timeline")}
        />
        <SummaryRow
          label="Preferred language"
          value={draft.preferredLanguage ?? "Not stated"}
          onEdit={edit("language")}
        />
        <SummaryRow
          label="Timeline"
          value={timelineLabel(draft.nav.timeline) || "Not stated"}
          onEdit={edit("budget_timeline")}
        />
        {flowMode === "full" ? (
          <>
            <SummaryRow
              label="Why Phuket"
              value={humanizeList(motivationLabels(draft.nav.motivations)) || "Not stated"}
              onEdit={edit("why_phuket")}
            />
            <SummaryRow
              label="What success looks like"
              value={humanizeList(goalLabels(draft.nav.goals)) || "Not stated"}
              onEdit={edit("success")}
            />
            <SummaryRow
              label="Concerns"
              value={humanizeList(concernLabels(draft.nav.concerns)) || "Not stated"}
              onEdit={edit("concern")}
            />
            {draft.nav.note.trim() ? (
              <SummaryRow
                label="Your note"
                value={draft.nav.note.trim()}
                onEdit={edit("concern")}
              />
            ) : null}
          </>
        ) : null}
        <SummaryRow
          label="Property type"
          value={
            PROPERTY_TYPE_OPTIONS.find((o) => o.key === draft.propertyType)?.label ?? "Not stated"
          }
          onEdit={edit("property_fit")}
        />
        {flowMode === "full" ? (
          <>
            <SummaryRow
              label="Bedrooms"
              value={BEDROOM_OPTIONS.find((o) => o.key === draft.bedrooms)?.label ?? "Not stated"}
              onEdit={edit("property_fit")}
            />
            <SummaryRow
              label="Areas"
              value={
                draft.helpMeChooseArea
                  ? "Help me choose based on my lifestyle"
                  : draft.preferredAreas.join(", ") || "Not stated"
              }
              onEdit={edit("location_fit")}
            />
            <SummaryRow
              label="Readiness"
              value={
                READINESS_OPTIONS.find((o) => o.key === draft.readiness)?.label ?? "Not stated"
              }
              onEdit={edit("readiness")}
            />
          </>
        ) : null}
      </div>

      <PrimaryActionBar
        primaryLabel="This is right — continue"
        disabled={!complete}
        onPrimary={onConfirm}
        secondaryLabel="Back"
        onSecondary={() => dispatch({ type: "back" })}
        sticky={false}
      />
    </Panel>
  );
}

/* ---------- Initial directions ---------- */

function DirectionsView({
  session,
  directions,
  browseAll,
  setBrowseAll,
  loading,
  onOpenProject,
  onContinue,
  dispatch,
}: {
  session: BoothV2Session;
  directions: ReturnType<typeof evaluateDirections> | null;
  browseAll: boolean;
  setBrowseAll: (value: boolean) => void;
  loading: boolean;
  onOpenProject: (slug: string) => void;
  onContinue: () => void;
  dispatch: (action: BoothV2Action) => void;
}) {
  const { shortlist } = session;
  const cards = directions ? visibleDirections(directions, browseAll) : [];

  return (
    <div className="flex flex-col gap-5">
      <Panel>
        <SectionHeading
          eyebrow="Not a ranking — a starting point"
          title="Initial directions based on what we know"
        />
        <p className="max-w-[640px] text-[14px] leading-relaxed text-[#57534A]">
          These are directions worth discussing, drawn only from facts both you and the project
          records actually stated. Pick up to four for your Guide, let your Guide prepare the
          shortlist, or take none — all three are fine.
        </p>
        {directions && !directions.hasSupportedDirection ? (
          <p className="mt-3 text-[14px] font-[600] text-[#8A6B3F]">{NO_DIRECTION_MESSAGE}</p>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-[13px] font-[600] text-[#57534A]">
            Shortlist:{" "}
            {shortlist.guidePrepares
              ? "Guide will prepare"
              : `${shortlist.entries.length} / ${MAX_SHORTLIST}`}
          </span>
          <button
            type="button"
            aria-pressed={shortlist.guidePrepares}
            onClick={() => dispatch({ type: "setGuidePrepares", value: !shortlist.guidePrepares })}
            className={[
              "min-h-[40px] rounded-full border px-4 text-[12.5px] font-[600] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2",
              shortlist.guidePrepares
                ? "border-[#17150F] bg-[#F3EFE7] text-[#17150F]"
                : "border-[#EAE6DE] bg-white text-[#57534A] hover:bg-[#FBFAF7]",
            ].join(" ")}
          >
            Let my Guide prepare the shortlist
          </button>
          {directions?.hasSupportedDirection ? (
            <button
              type="button"
              aria-pressed={browseAll}
              onClick={() => setBrowseAll(!browseAll)}
              className="min-h-[40px] rounded-full border border-[#EAE6DE] bg-white px-4 text-[12.5px] font-[600] text-[#57534A] outline-none transition-colors hover:bg-[#FBFAF7] focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2"
            >
              {browseAll ? "Show supported directions" : "Browse all projects"}
            </button>
          ) : null}
        </div>
      </Panel>

      {loading ? (
        <Panel>
          <p className="text-[14px] text-[#8A857A]">Loading the project catalogue…</p>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {cards.map((card) => {
            const entry = shortlist.entries.find((e) => e.slug === card.project.slug);
            return (
              <DirectionCardView
                key={card.project.slug}
                card={card}
                inShortlist={Boolean(entry)}
                shortlistFull={shortlist.entries.length >= MAX_SHORTLIST}
                mentionedByGuest={entry?.mentionedByGuest ?? false}
                onToggleShortlist={() =>
                  dispatch({ type: "toggleShortlist", slug: card.project.slug })
                }
                onToggleMentioned={(value) =>
                  dispatch({ type: "setMentionedByGuest", slug: card.project.slug, value })
                }
                onOpenProject={() => onOpenProject(card.project.slug)}
              />
            );
          })}
        </div>
      )}

      <Panel>
        <PrimaryActionBar
          primaryLabel="Continue — stay in touch"
          onPrimary={onContinue}
          secondaryLabel="Back to summary"
          onSecondary={() => dispatch({ type: "back" })}
          sticky={false}
        />
      </Panel>
    </div>
  );
}

/* ---------- WhatsApp verification ---------- */

function WhatsappView({
  waState,
  verificationState,
  onStart,
  onConfirm,
  onContinue,
  onBack,
}: {
  waState: { configured: boolean | null; waHref: string | null; sessionCode: string | null };
  verificationState: string;
  onStart: () => void;
  onConfirm: () => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    onStart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Panel>
      <SectionHeading eyebrow="One quick check" title="Let's make sure WhatsApp reaches you" />

      {waState.configured === null ? (
        <p className="text-[14px] text-[#8A857A]">Preparing verification…</p>
      ) : null}

      {waState.configured === false ? (
        <div
          role="alert"
          className="rounded-[13px] border border-[#EAC9BE] bg-[#FBF1ED] px-4 py-3 text-[14px] leading-relaxed text-[#8A3D24]"
        >
          {WHATSAPP_UNAVAILABLE_MESSAGE} The session can continue, but it cannot be completed as a
          verified handoff — record an exact contact time with the Guide instead.
        </div>
      ) : null}

      {waState.configured === true && verificationState !== "verified" ? (
        <div className="flex flex-col gap-4">
          <p className="max-w-[560px] text-[14.5px] leading-relaxed text-[#57534A]">
            Open the official Forever WhatsApp and send the prefilled message — session code{" "}
            <strong>{waState.sessionCode}</strong>. When it arrives, the Host confirms below.
          </p>
          {waState.waHref ? (
            <a
              href={waState.waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[52px] w-fit items-center rounded-[14px] bg-[#17150F] px-6 text-[15px] font-[600] text-white outline-none focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2"
            >
              Open WhatsApp (wa.me)
            </a>
          ) : null}
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-[52px] w-fit rounded-[14px] border border-[#EAE6DE] bg-white px-6 text-[15px] font-[600] text-[#2C5B3F] outline-none hover:bg-[#FBFAF7] focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2"
          >
            Host: message received — mark verified
          </button>
        </div>
      ) : null}

      {verificationState === "verified" ? (
        <p className="rounded-[13px] border border-[#CFE3D5] bg-[#F2F8F3] px-4 py-3 text-[14px] font-[600] text-[#2C5B3F]">
          WhatsApp verified ✓
        </p>
      ) : null}

      <PrimaryActionBar
        primaryLabel="Continue to Guide"
        disabled={verificationState !== "verified"}
        onPrimary={onContinue}
        secondaryLabel="Back"
        onSecondary={onBack}
        sticky={false}
      />
    </Panel>
  );
}

/* ---------- Guide assignment ---------- */

function GuideAssignmentView({
  preferredLanguage,
  guides,
  loading,
  onAssign,
  onBack,
}: {
  preferredLanguage: string | null;
  guides: BoothGuide[] | null;
  loading: boolean;
  onAssign: (guide: BoothGuide, reserve: BoothGuide | null, fallback: string | null) => void;
  onBack: () => void;
}) {
  const suggestion = useMemo(
    () => (guides ? suggestGuides(guides, preferredLanguage) : null),
    [guides, preferredLanguage],
  );
  const [manualId, setManualId] = useState<string | null>(null);

  const onDuty = (guides ?? []).filter((g) => g.onDuty);
  const manual = onDuty.find((g) => g.id === manualId) ?? null;
  const chosen = manual ?? suggestion?.primary ?? null;
  const reserve =
    chosen && suggestion?.reserve && suggestion.reserve.id !== chosen.id
      ? suggestion.reserve
      : (onDuty.find((g) => g.id !== chosen?.id) ?? null);

  return (
    <Panel>
      <SectionHeading eyebrow="Your person, by name" title="Meet your Forever Guide" />

      {loading ? <p className="text-[14px] text-[#8A857A]">Checking who is on duty…</p> : null}

      {!loading && suggestion?.blockReason ? (
        <div
          role="alert"
          className="rounded-[13px] border border-[#EAC9BE] bg-[#FBF1ED] px-4 py-3 text-[14px] leading-relaxed text-[#8A3D24]"
        >
          {suggestion.blockReason === "no_guides_configured"
            ? "No Guides are configured yet — assignment is blocked. Record an exact contact time with the guest and complete the handoff when the roster exists."
            : "No Guides are on duty right now — assignment is blocked. Record an exact contact time with the guest instead."}
        </div>
      ) : null}

      {!loading && onDuty.length > 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-[#57534A]">
            {suggestion?.primaryMatchesLanguage
              ? `Suggested first because they speak ${preferredLanguage}.`
              : "Suggested from the on-duty roster. The Host may choose manually."}
          </p>
          <div
            role="radiogroup"
            aria-label="Choose a Guide"
            className="grid grid-cols-1 gap-3 md:grid-cols-2"
          >
            {onDuty.map((guide) => {
              const selected = chosen?.id === guide.id;
              return (
                <button
                  key={guide.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setManualId(guide.id)}
                  className={[
                    "rounded-[15px] border px-5 py-4 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2",
                    selected
                      ? "border-[1.5px] border-[#17150F] bg-[#F3EFE7]"
                      : "border-[#EAE6DE] bg-white hover:bg-[#FBFAF7]",
                  ].join(" ")}
                >
                  <span className="text-[16px] font-[600] text-[#17150F]">{guide.displayName}</span>
                  <p className="mt-1 text-[13px] text-[#57534A]">
                    {guide.languages.length > 0
                      ? guide.languages.join(" · ")
                      : "Languages not recorded"}
                  </p>
                  {guide.specializations.length > 0 ? (
                    <p className="mt-1 text-[12.5px] text-[#8A857A]">
                      {guide.specializations.join(" · ")}
                    </p>
                  ) : null}
                </button>
              );
            })}
          </div>
          {reserve ? (
            <p className="text-[12.5px] text-[#8A857A]">
              Reserve Guide if unavailable: {reserve.displayName}
            </p>
          ) : null}
        </div>
      ) : null}

      <PrimaryActionBar
        primaryLabel={chosen ? `Assign ${chosen.displayName}` : "Assign Guide"}
        disabled={!chosen}
        onPrimary={() =>
          chosen && onAssign(chosen, reserve, manual ? "host_manual_selection" : null)
        }
        secondaryLabel="Back"
        onSecondary={onBack}
        sticky={false}
      />
    </Panel>
  );
}

/* ---------- Handoff waiting (2-minute ack / 5-minute SLA) ---------- */

function useElapsedSeconds(sinceIso: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);
  if (!sinceIso) return null;
  const since = Date.parse(sinceIso);
  if (!Number.isFinite(since)) return null;
  return Math.max(0, Math.floor((now - since) / 1_000));
}

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function HandoffWaitingView({
  session,
  onAcknowledge,
  onContinue,
  onBack,
}: {
  session: BoothV2Session;
  onAcknowledge: () => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const { guide } = session.handoff;
  const elapsed = useElapsedSeconds(guide.assignedAt);
  const acknowledged = guide.acknowledgedAt !== null;

  return (
    <Panel>
      <SectionHeading
        eyebrow="Warm handoff"
        title={
          guide.assigned
            ? `${guide.assigned.displayName} has been notified`
            : "Waiting for the Guide"
        }
      />
      {guide.assigned ? (
        <p className="text-[14px] text-[#57534A]">
          Languages: {guide.assigned.languages.join(" · ") || "not recorded"}
          {guide.reserve ? ` · Reserve: ${guide.reserve.displayName}` : ""}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-4">
        <div className="rounded-[15px] border border-[#EAE6DE] bg-white px-5 py-4">
          <p className="text-[11.5px] font-[700] uppercase tracking-[0.14em] text-[#8A857A]">
            Acknowledgement target
          </p>
          <p
            className={[
              "mt-1 text-[24px] font-[600] tabular-nums",
              acknowledged
                ? "text-[#2C5B3F]"
                : elapsed !== null && elapsed > GUIDE_ACK_TARGET_SECONDS
                  ? "text-[#8A3D24]"
                  : "text-[#17150F]",
            ].join(" ")}
          >
            {acknowledged
              ? "Acknowledged ✓"
              : elapsed !== null
                ? `${formatClock(elapsed)} / ${formatClock(GUIDE_ACK_TARGET_SECONDS)}`
                : "—"}
          </p>
          {acknowledged ? (
            <p className="mt-1 text-[12px] text-[#8A857A]">
              {guide.acknowledgedMethod === "guide_self_confirmed"
                ? "Confirmed by the Guide's own account"
                : "Observed by the Host — not a Guide confirmation"}
            </p>
          ) : null}
        </div>
        <div className="rounded-[15px] border border-[#EAE6DE] bg-white px-5 py-4">
          <p className="text-[11.5px] font-[700] uppercase tracking-[0.14em] text-[#8A857A]">
            First-contact SLA
          </p>
          <p className="mt-1 text-[24px] font-[600] tabular-nums text-[#17150F]">
            {elapsed !== null
              ? `${formatClock(elapsed)} / ${formatClock(GUIDE_CONTACT_SLA_SECONDS)}`
              : "—"}
          </p>
        </div>
      </div>

      {!acknowledged ? (
        <button
          type="button"
          onClick={onAcknowledge}
          className="mt-5 min-h-[52px] w-fit rounded-[14px] border border-[#EAE6DE] bg-white px-6 text-[15px] font-[600] text-[#2C5B3F] outline-none hover:bg-[#FBFAF7] focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2"
        >
          {guide.assigned?.hasStaffAccount
            ? "Record acknowledgement"
            : "Host: record that the Guide acknowledged (observation)"}
        </button>
      ) : null}

      <PrimaryActionBar
        primaryLabel="Continue — record the next step"
        disabled={!acknowledged}
        onPrimary={onContinue}
        secondaryLabel="Back"
        onSecondary={onBack}
        sticky={false}
      />
    </Panel>
  );
}

/* ---------- Next step + completion ---------- */

/** ISO instant → the local wall-clock value a datetime-local input expects. */
function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}` +
    `T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
  );
}

/** Local wall-clock value → an exact ISO instant, or null when unusable. */
function fromLocalInputValue(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function NextStepView({
  session,
  onRecordFirstContact,
  onSave,
  onComplete,
  onBack,
}: {
  session: BoothV2Session;
  onRecordFirstContact: () => void;
  onSave: (nextStep: string, scheduledAt: string | null) => Promise<void>;
  onComplete: () => void;
  onBack: () => void;
}) {
  const [nextStep, setNextStep] = useState(session.handoff.nextStep ?? "");
  // <input type="datetime-local"> works in local wall-clock time; the exact
  // instant is resolved to ISO on save and stored as a real timestamp.
  const [time, setTime] = useState(() =>
    toLocalInputValue(session.handoff.consultationScheduledAt),
  );
  const blockers = contactedCompletionBlockers(session);
  const liveConfirmed = session.handoff.firstContactConfirmedAt !== null;

  return (
    <Panel>
      <SectionHeading eyebrow="Agreeing the next step" title="What happens next?" />
      <div className="flex max-w-[620px] flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="booth-next-step" className="text-[13px] font-[600] text-[#3A362E]">
            Next step<span className="text-[#9C7B4C]"> *</span>
          </label>
          <input
            id="booth-next-step"
            value={nextStep}
            onChange={(event) => setNextStep(event.target.value)}
            placeholder="e.g. 30-minute consultation about Bang Tao condominiums"
            className="min-h-[50px] rounded-[13px] border border-[#EAE6DE] bg-white px-4 text-[15px] text-[#2A2820] outline-none focus:border-[#D8D2C6] focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="booth-consultation-time"
            className="text-[13px] font-[600] text-[#3A362E]"
          >
            Exact consultation / contact time
            <span className="ml-1 font-[400] text-[#A29C90]">
              · required unless the Guide's live message is confirmed
            </span>
          </label>
          <input
            id="booth-consultation-time"
            type="datetime-local"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            className="min-h-[50px] rounded-[13px] border border-[#EAE6DE] bg-white px-4 text-[15px] text-[#2A2820] outline-none focus:border-[#D8D2C6] focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2"
          />
          <p className="text-[12px] text-[#8A857A]">
            An exact date and time — free text such as “tomorrow” cannot complete a handoff.
          </p>
        </div>

        <button
          type="button"
          onClick={onRecordFirstContact}
          disabled={liveConfirmed}
          className={[
            "min-h-[48px] w-fit rounded-[12px] border px-5 text-[14px] font-[600] outline-none focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2",
            liveConfirmed
              ? "cursor-default border-[#CFE3D5] bg-[#F2F8F3] text-[#2C5B3F]"
              : "border-[#EAE6DE] bg-white text-[#3A362E] hover:bg-[#FBFAF7]",
          ].join(" ")}
        >
          {liveConfirmed
            ? "Guide's live message confirmed ✓"
            : "Host: the Guide already messaged the guest — confirm"}
        </button>

        <button
          type="button"
          onClick={() => void onSave(nextStep, fromLocalInputValue(time))}
          disabled={nextStep.trim().length === 0}
          className={[
            "min-h-[52px] rounded-[14px] px-6 text-[15px] font-[600] outline-none focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2",
            nextStep.trim().length === 0
              ? "cursor-default bg-[#EDE9E1] text-[#B7B2A6]"
              : "bg-[#17150F] text-white",
          ].join(" ")}
        >
          Save next step
        </button>

        {blockers.length > 0 ? (
          <div className="rounded-[13px] border border-[#EAE6DE] bg-[#FBFAF7] px-4 py-3">
            <p className="text-[13px] font-[600] text-[#57534A]">Before completion:</p>
            <ul className="mt-1 flex flex-col gap-1">
              {blockers.map((blocker) => (
                <li key={blocker} className="text-[13px] text-[#8A857A]">
                  • {blocker}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <PrimaryActionBar
        primaryLabel="Complete the handoff"
        disabled={!canCompleteContacted(session)}
        onPrimary={onComplete}
        secondaryLabel="Back"
        onSecondary={onBack}
        sticky={false}
      />
    </Panel>
  );
}

function CompletionView({
  session,
  onNewGuest,
}: {
  session: BoothV2Session;
  onNewGuest: () => void;
}) {
  const { handoff } = session;
  return (
    <Panel>
      <SectionHeading eyebrow="Done — truthfully" title="Here's exactly where things stand" />
      <ul className="flex max-w-[560px] flex-col gap-2">
        <li className="text-[15px] text-[#2C5B3F]">✓ Decision Profile saved</li>
        <li className="text-[15px] text-[#2C5B3F]">
          ✓ WhatsApp verified
          {handoff.whatsapp.verifiedAt ? ` · ${handoff.whatsapp.verifiedAt}` : ""}
        </li>
        <li className="text-[15px] text-[#2C5B3F]">
          ✓ Guide assigned{handoff.guide.assigned ? ` · ${handoff.guide.assigned.displayName}` : ""}
        </li>
        <li className="text-[15px] text-[#2C5B3F]">
          ✓ Next step: {handoff.nextStep}
          {handoff.consultationScheduledAt ? ` · ${handoff.consultationScheduledAt}` : ""}
          {handoff.firstContactConfirmedAt ? " · live Guide message confirmed" : ""}
        </li>
      </ul>
      <p className="mt-4 text-[13px] text-[#8A857A]">
        This tablet clears itself in under a minute to protect the guest's privacy.
      </p>
      <PrimaryActionBar primaryLabel="Start new guest" onPrimary={onNewGuest} sticky={false} />
    </Panel>
  );
}

/* ---------- Respectful no-contact QR continuation ---------- */

function NoContactView({
  finished,
  onFinish,
  onBack,
  setToast,
}: {
  finished: boolean;
  onFinish: () => void;
  onBack: () => void;
  setToast: (toast: BoothToastState) => void;
}) {
  const continueUrl =
    typeof window !== "undefined" ? `${window.location.origin}/navigator` : "/navigator";

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(continueUrl);
      setToast({ tone: "success", message: "Link copied." });
    } catch {
      setToast({ tone: "error", message: "Couldn't copy the link — read it aloud instead." });
    }
  }

  return (
    <Panel>
      <SectionHeading eyebrow="No pressure — truly" title="Continue in your own time" />
      <p className="max-w-[560px] text-[15px] leading-relaxed text-[#57534A]">
        Scan the printed QR at this booth, or open the address below at home. Nothing about you is
        stored from this conversation.
      </p>
      <p className="mt-4 rounded-[13px] border border-[#EAE6DE] bg-[#FBFAF7] px-4 py-3 text-[15px] font-[600] text-[#17150F]">
        {continueUrl}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={copyLink}
          className="min-h-[48px] rounded-[12px] border border-[#EAE6DE] bg-white px-5 text-[14px] font-[600] text-[#3A362E] outline-none hover:bg-[#FBFAF7] focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2"
        >
          Copy link
        </button>
      </div>
      <PrimaryActionBar
        primaryLabel={finished ? "Session closing…" : "Finish — clear this tablet"}
        disabled={finished}
        onPrimary={onFinish}
        secondaryLabel={finished ? undefined : "Back"}
        onSecondary={finished ? undefined : onBack}
        sticky={false}
      />
    </Panel>
  );
}
