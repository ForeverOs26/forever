import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { Property } from "@/lib/data";
import { projectListQuery } from "@/lib/project-service";
import { submitLead } from "@/lib/lead-service";
import ChoiceGroup from "../components/ChoiceGroup";
import NoteField from "../components/NoteField";
import PrimaryActionBar from "../components/PrimaryActionBar";

import {
  BUDGET_OPTIONS,
  CONCERN_OPTIONS,
  SUCCESS_OPTIONS,
  TIMELINE_OPTIONS,
  WHY_PHUKET_OPTIONS,
  buildBoothLeadPayload,
  buildGuestLink,
  buildProjectPath,
  buildRecommendationPath,
  canContinue,
  concernLabels,
  deriveDecisionProfile,
  evaluateCatalogue,
  evaluateMatch,
  goalLabels,
  hasGuestData,
  humanizeList,
  motivationLabels,
  NO_EXACT_MATCH_MESSAGE,
  visibleResults,
  type BoothContactDetails,
  type CatalogueEvaluation,
  type ForeverStory,
  type LeadStatus,
  type MatchReason,
  type SessionScreen,
  type StoryFacet,
} from "../core";
import { BoothShell } from "./BoothShell";
import { BoothLeadForm } from "./BoothLeadForm";
import { BoothToast, type BoothToastState } from "./BoothToast";
import { MatchResultCard } from "./MatchResultCard";
import { ResetConfirmDialog } from "./ResetConfirmDialog";
import { useBoothSession } from "./useBoothSession";

/** Which question screen an editable Story facet jumps back to. */
const FACET_EDIT_SCREEN: Record<string, SessionScreen> = {
  "Why Phuket": "why_phuket",
  "What you're hoping for": "success",
  "What matters most": "concern",
  "Where you feel unsure": "concern",
  "Your horizon": "budget_timeline",
};

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

export function BoothNavigator() {
  const { session, dispatch, reset } = useBoothSession();
  const [resetOpen, setResetOpen] = useState(false);
  const [toast, setToast] = useState<BoothToastState | null>(null);
  const [failedBanner, setFailedBanner] = useState<string | null>(null);

  const { answers, screen } = session;
  const profile = useMemo(() => deriveDecisionProfile(answers), [answers]);
  const recommendation = useMemo(() => buildRecommendationPath(answers), [answers]);

  // The catalogue is only needed from the results screen onward.
  const catalogueEnabled =
    screen === "recommendation" || screen === "selected" || screen === "contact";
  const catalogue = useQuery({ ...projectListQuery(), enabled: catalogueEnabled });
  const projects = useMemo<Property[]>(() => catalogue.data ?? [], [catalogue.data]);
  const evaluation = useMemo(() => evaluateCatalogue(profile, projects), [profile, projects]);

  const selectedProject = projects.find((p) => p.slug === session.selectedProjectSlug) ?? null;
  const selectedReasons = selectedProject ? evaluateMatch(profile, selectedProject) : [];

  function handleStartNewGuest() {
    if (hasGuestData(session)) {
      setResetOpen(true);
    } else {
      reset();
    }
  }

  function confirmReset() {
    reset();
    setResetOpen(false);
    setFailedBanner(null);
    setToast({ tone: "success", message: "New guest session started." });
  }

  function openProject(slug: string) {
    // New tab so the booth session stays available on the tablet.
    if (typeof window !== "undefined") {
      window.open(buildProjectPath(slug), "_blank", "noopener,noreferrer");
    }
  }

  async function copyGuestLink(slug: string) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const link = buildGuestLink(origin, slug);
    try {
      await navigator.clipboard.writeText(link);
      setToast({ tone: "success", message: `Guest link copied · ${buildProjectPath(slug)}` });
    } catch {
      setToast({
        tone: "error",
        message: "Couldn't copy the link. Read it aloud or try again.",
      });
    }
  }

  async function handleLeadSubmit(contact: BoothContactDetails) {
    if (!selectedProject || session.leadStatus === "submitting") return;
    setFailedBanner(null);
    dispatch({ type: "leadSubmitting" });
    try {
      await submitLead(
        buildBoothLeadPayload({
          contact,
          answers,
          story: session.story,
          recommendation,
          project: selectedProject,
          reasons: selectedReasons,
        }),
      );
      dispatch({ type: "leadSaved" });
    } catch {
      dispatch({ type: "leadError" });
      setFailedBanner(
        "We couldn't save this lead. Please try again in a moment — the guest's session is untouched.",
      );
    }
  }

  return (
    <BoothShell screen={screen} onStartNewGuest={handleStartNewGuest}>
      {screen === "welcome" ? <WelcomeView onBegin={() => dispatch({ type: "begin" })} /> : null}

      {screen === "why_phuket" ? (
        <QuestionView
          index="01"
          title="Why are you considering Phuket?"
          helper="Choose up to three that ring true."
          options={WHY_PHUKET_OPTIONS}
          selected={answers.motivations}
          multi
          onToggle={(value) => dispatch({ type: "toggleMotivation", value })}
          canContinue={canContinue("why_phuket", answers)}
          onContinue={() => dispatch({ type: "goToScreen", screen: "success" })}
          onBack={() => dispatch({ type: "back" })}
        />
      ) : null}

      {screen === "success" ? (
        <QuestionView
          index="02"
          title="What would success look like for you?"
          helper="Up to three."
          options={SUCCESS_OPTIONS}
          selected={answers.goals}
          multi
          onToggle={(value) => dispatch({ type: "toggleGoal", value })}
          canContinue={canContinue("success", answers)}
          onContinue={() => dispatch({ type: "goToScreen", screen: "budget_timeline" })}
          onBack={() => dispatch({ type: "back" })}
        />
      ) : null}

      {screen === "budget_timeline" ? (
        <BudgetTimelineView
          budget={answers.budget}
          timeline={answers.timeline}
          onToggleBudget={(value) => dispatch({ type: "setBudget", value })}
          onToggleTimeline={(value) => dispatch({ type: "setTimeline", value })}
          canContinue={canContinue("budget_timeline", answers)}
          onContinue={() => dispatch({ type: "goToScreen", screen: "concern" })}
          onBack={() => dispatch({ type: "back" })}
        />
      ) : null}

      {screen === "concern" ? (
        <QuestionView
          index="04"
          title="What's your biggest concern right now?"
          helper="Be honest — this is what we help with."
          options={CONCERN_OPTIONS}
          selected={answers.concerns}
          multi
          note={answers.note}
          onNoteChange={(value) => dispatch({ type: "setNote", value })}
          onToggle={(value) => dispatch({ type: "toggleConcern", value })}
          canContinue={canContinue("concern", answers)}
          onContinue={() => dispatch({ type: "startStory" })}
          onBack={() => dispatch({ type: "back" })}
        />
      ) : null}

      {screen === "forever_story" ? (
        <StoryView
          status={session.storyStatus}
          story={session.story}
          onConfirm={() => dispatch({ type: "confirmStory" })}
          onEdit={(target) => dispatch({ type: "editStory", screen: target })}
        />
      ) : null}

      {screen === "recommendation" ? (
        <ResultsView
          isLoading={catalogue.isLoading}
          isError={catalogue.isError}
          onRetry={() => catalogue.refetch()}
          evaluation={evaluation}
          onOpen={openProject}
          onCopyLink={copyGuestLink}
          onSelect={(slug) => dispatch({ type: "selectProject", slug })}
        />
      ) : null}

      {screen === "selected" && selectedProject ? (
        <SelectedView
          project={selectedProject}
          reasons={selectedReasons}
          storyFacets={session.story?.facets ?? []}
          onOpen={() => openProject(selectedProject.slug)}
          onCopyLink={() => copyGuestLink(selectedProject.slug)}
          onChange={() => dispatch({ type: "changeProject" })}
          onContinue={() => dispatch({ type: "continueToContact" })}
        />
      ) : null}

      {screen === "contact" && selectedProject ? (
        <ContactView
          project={selectedProject}
          leadStatus={session.leadStatus}
          failedBanner={failedBanner}
          onSubmit={handleLeadSubmit}
          summary={{
            motivations: humanizeList(motivationLabels(answers.motivations)) || "—",
            goals: humanizeList(goalLabels(answers.goals)) || "—",
            concerns: humanizeList(concernLabels(answers.concerns)) || "—",
            projectName: selectedProject.name,
          }}
        />
      ) : null}

      {screen === "confirmation" ? (
        <CompleteView
          projectName={selectedProject?.name ?? session.selectedProjectSlug ?? "—"}
          onOpen={() =>
            session.selectedProjectSlug ? openProject(session.selectedProjectSlug) : undefined
          }
          onStartNewGuest={handleStartNewGuest}
        />
      ) : null}

      {resetOpen ? (
        <ResetConfirmDialog onCancel={() => setResetOpen(false)} onConfirm={confirmReset} />
      ) : null}
      <BoothToast toast={toast} onDismiss={() => setToast(null)} />
    </BoothShell>
  );
}

/* ---------- Screen views ---------- */

function WelcomeView({ onBegin }: { onBegin: () => void }) {
  return (
    <div className="mx-auto max-w-[680px] pt-6">
      <Panel>
        <p className="text-[11px] font-[700] uppercase tracking-[0.2em] text-[#9C7B4C]">Forever</p>
        <h1
          tabIndex={-1}
          className="mt-3 text-[34px] font-[400] leading-[1.08] text-[#17150F] outline-none [font-family:'Newsreader',Georgia,serif] md:text-[44px]"
        >
          A home in Phuket begins with a conversation.
        </h1>
        <p className="mt-4 max-w-[520px] text-[16px] leading-relaxed text-[#57534A]">
          Before we show a single property, we&apos;d like to understand your guest. A few gentle
          questions — nothing to buy.
        </p>
        <p className="mt-6 text-[13px] font-[600] text-[#8A857A]">
          About 3–5 minutes · Guided by your Forever host
        </p>
        <button
          type="button"
          onClick={onBegin}
          className="mt-7 min-h-[56px] w-full rounded-[15px] bg-[#17150F] px-4 text-[16px] font-[600] text-white outline-none transition-transform focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2 active:translate-y-px sm:w-auto sm:px-10"
        >
          Begin
        </button>
      </Panel>
    </div>
  );
}

interface QuestionViewProps {
  index: string;
  title: string;
  helper: string;
  options: readonly { key: string; label: string }[];
  selected: readonly string[];
  multi?: boolean;
  note?: string;
  onNoteChange?: (value: string) => void;
  onToggle: (value: never) => void;
  canContinue: boolean;
  onContinue: () => void;
  onBack: () => void;
}

function QuestionView({
  index,
  title,
  helper,
  options,
  selected,
  multi = false,
  note,
  onNoteChange,
  onToggle,
  canContinue: canGo,
  onContinue,
  onBack,
}: QuestionViewProps) {
  return (
    <div className="mx-auto max-w-[760px]">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex min-h-[44px] items-center gap-2 rounded-[12px] px-2 text-[14px] font-[600] text-[#57534A] outline-none hover:text-[#17150F] focus-visible:ring-2 focus-visible:ring-[#9C7B4C]"
      >
        ← Back
      </button>
      <Panel>
        <p className="text-[16px] italic text-[#9C7B4C] [font-family:'Newsreader',Georgia,serif]">
          {index}
        </p>
        <h1
          tabIndex={-1}
          className="mt-2 text-[26px] font-[400] leading-tight text-[#17150F] outline-none [font-family:'Newsreader',Georgia,serif] md:text-[34px]"
        >
          {title}
        </h1>
        <p className="mt-2 text-[14px] text-[#8A857A]">
          {helper}
          {multi ? (
            <span className="ml-2 font-[600] text-[#57534A]">{selected.length} of 3 selected</span>
          ) : null}
        </p>

        <div className="mt-6">
          <ChoiceGroup
            ariaLabel={title}
            items={options.map((option) => ({ key: option.key, title: option.label }))}
            selectedKeys={[...selected]}
            onToggle={(key) => onToggle(key as never)}
            className="lg:grid-cols-3"
          />
        </div>

        {onNoteChange ? (
          <div className="mt-4">
            <NoteField
              label="Anything else on your mind?"
              value={note ?? ""}
              onChange={onNoteChange}
              placeholder="Anything else on your mind? (optional)"
              rows={3}
            />
          </div>
        ) : null}
      </Panel>

      <PrimaryActionBar
        primaryLabel="Continue"
        disabled={!canGo}
        onPrimary={onContinue}
        sticky={false}
      />
    </div>
  );
}

function BudgetTimelineView({
  budget,
  timeline,
  onToggleBudget,
  onToggleTimeline,
  canContinue: canGo,
  onContinue,
  onBack,
}: {
  budget: string | null;
  timeline: string | null;
  onToggleBudget: (value: never) => void;
  onToggleTimeline: (value: never) => void;
  canContinue: boolean;
  onContinue: () => void;
  onBack: () => void;
}) {
  return (
    <div className="mx-auto max-w-[760px]">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex min-h-[44px] items-center gap-2 rounded-[12px] px-2 text-[14px] font-[600] text-[#57534A] outline-none hover:text-[#17150F] focus-visible:ring-2 focus-visible:ring-[#9C7B4C]"
      >
        ← Back
      </button>
      <Panel>
        <p className="text-[16px] italic text-[#9C7B4C] [font-family:'Newsreader',Georgia,serif]">
          03
        </p>
        <h1
          tabIndex={-1}
          className="mt-2 text-[26px] font-[400] leading-tight text-[#17150F] outline-none [font-family:'Newsreader',Georgia,serif] md:text-[34px]"
        >
          What feels comfortable, and when?
        </h1>

        <div className="mt-6 flex flex-col gap-6">
          <div>
            <p className="mb-3 text-[12px] font-[700] uppercase tracking-[0.14em] text-[#A29C90]">
              Budget
            </p>
            <ChoiceGroup
              ariaLabel="Budget"
              items={BUDGET_OPTIONS.map((option) => ({ key: option.key, title: option.label }))}
              selectedKeys={budget ? [budget] : []}
              onToggle={(key) => onToggleBudget(key as never)}
              className="lg:grid-cols-3"
            />
          </div>
          <div>
            <p className="mb-3 text-[12px] font-[700] uppercase tracking-[0.14em] text-[#A29C90]">
              Timeline
            </p>
            <ChoiceGroup
              ariaLabel="Timeline"
              items={TIMELINE_OPTIONS.map((option) => ({ key: option.key, title: option.label }))}
              selectedKeys={timeline ? [timeline] : []}
              onToggle={(key) => onToggleTimeline(key as never)}
              className="lg:grid-cols-2"
            />
          </div>
        </div>
      </Panel>

      <PrimaryActionBar
        primaryLabel="Continue"
        disabled={!canGo}
        onPrimary={onContinue}
        sticky={false}
      />
    </div>
  );
}

function StoryView({
  status,
  story,
  onConfirm,
  onEdit,
}: {
  status: string;
  story: ForeverStory | null;
  onConfirm: () => void;
  onEdit: (screen: SessionScreen) => void;
}) {
  if (status === "loading" || !story) {
    return (
      <div className="mx-auto max-w-[680px] pt-10">
        <Panel>
          <div aria-live="polite" className="text-center">
            <div
              aria-hidden="true"
              className="mx-auto mb-5 h-[26px] w-[26px] rounded-full border-2 border-[#DDD8CE] border-t-[#9C7B4C] motion-safe:animate-spin"
            />
            <p className="text-[11px] font-[700] uppercase tracking-[0.2em] text-[#9C7B4C]">
              Your Forever Story
            </p>
            <h1
              tabIndex={-1}
              className="mt-2 text-[26px] font-[400] text-[#17150F] outline-none [font-family:'Newsreader',Georgia,serif]"
            >
              Writing your reflection…
            </h1>
          </div>
        </Panel>
      </div>
    );
  }

  const missing = ["Preferred area", "Bedrooms", "Contact details"];

  return (
    <div className="mx-auto max-w-[980px]">
      <SectionHeading eyebrow="Your Forever Story" title="Here's how we understand your guest." />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Panel>
          <p className="text-[17px] leading-relaxed text-[#2B2820] [font-family:'Newsreader',Georgia,serif]">
            {story.reflection}
          </p>
          <article className="mt-6 rounded-[14px] border border-[#EEEAE2] bg-[#FBFAF7] p-5">
            <p className="text-[11px] font-[700] uppercase tracking-[0.16em] text-[#9C7B4C]">
              How we&apos;d describe your guest
            </p>
            <h2 className="mt-2 text-[22px] font-[400] text-[#17150F] [font-family:'Newsreader',Georgia,serif]">
              {story.profileLabel}
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-[#57534A]">
              {story.profileDescription}
            </p>
          </article>
        </Panel>

        <div className="flex flex-col gap-5">
          <Panel>
            <p className="text-[12px] font-[700] uppercase tracking-[0.14em] text-[#3D8A5F]">
              Confirmed from your answers
            </p>
            <dl className="mt-3 flex flex-col divide-y divide-[#F1EDE6]">
              {story.facets.map((facet) => {
                const target = FACET_EDIT_SCREEN[facet.label];
                return (
                  <div key={facet.label} className="flex items-start justify-between gap-3 py-3">
                    <div>
                      <dt className="text-[12px] font-[700] uppercase tracking-[0.08em] text-[#A29C90]">
                        {facet.label}
                      </dt>
                      <dd className="mt-1 text-[14px] text-[#2B2820]">{facet.value}</dd>
                    </div>
                    {target ? (
                      <button
                        type="button"
                        onClick={() => onEdit(target)}
                        className="min-h-[44px] shrink-0 rounded-[10px] px-3 text-[13px] font-[600] text-[#9C7B4C] outline-none hover:text-[#17150F] focus-visible:ring-2 focus-visible:ring-[#9C7B4C]"
                      >
                        Edit
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </dl>
          </Panel>

          <Panel>
            <p className="text-[12px] font-[700] uppercase tracking-[0.14em] text-[#A29C90]">
              Not yet on file
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {missing.map((item) => (
                <li key={item} className="flex items-center gap-2 text-[14px] text-[#8A857A]">
                  <span aria-hidden="true" className="h-[6px] w-[6px] rounded-full bg-[#DDD8CE]" />
                  {item}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onConfirm}
          className="min-h-[56px] flex-1 rounded-[15px] bg-[#17150F] px-4 text-[16px] font-[600] text-white outline-none transition-transform focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2 active:translate-y-px"
        >
          Yes, this describes me
        </button>
        <button
          type="button"
          onClick={() => onEdit("why_phuket")}
          className="min-h-[56px] flex-1 rounded-[15px] border border-[#EAE6DE] bg-white px-4 text-[15px] font-[600] text-[#57534A] outline-none hover:bg-[#FBFAF7] focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2"
        >
          I&apos;d like to change something
        </button>
      </div>
    </div>
  );
}

function ResultsView({
  isLoading,
  isError,
  onRetry,
  evaluation,
  onOpen,
  onCopyLink,
  onSelect,
}: {
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  evaluation: CatalogueEvaluation;
  onOpen: (slug: string) => void;
  onCopyLink: (slug: string) => void;
  onSelect: (slug: string) => void;
}) {
  const [browseAll, setBrowseAll] = useState(false);
  // Same shared presentation rule as the website: matched by default, all on
  // Browse-all, all under the honest fallback when nothing matched.
  const shown = visibleResults(evaluation, browseAll);

  return (
    <div className="mx-auto max-w-[1000px]">
      <SectionHeading eyebrow="Matching projects" title="Projects matching your preferences" />

      {evaluation.noMatchMessage ? (
        <p className="mb-5 rounded-[13px] border border-[#E7DDC9] bg-[#FBF8F2] px-4 py-3 text-[14px] font-[500] text-[#6E6A60]">
          {evaluation.noMatchMessage}
        </p>
      ) : null}

      {isLoading ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {[0, 1].map((n) => (
            <div key={n} className="h-[360px] animate-pulse rounded-[18px] bg-white/70" />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-[16px] border border-[#EAC9BE] bg-[#FBF1ED] p-6 text-[#8A3D24]">
          <p className="text-[14px] font-[500]">
            The catalogue couldn&apos;t load. Check the connection and retry.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 min-h-[48px] rounded-[13px] bg-[#17150F] px-5 text-[14px] font-[600] text-white outline-none focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {shown.map(({ project, reasons }) => (
              <MatchResultCard
                key={project.slug}
                project={project}
                reasons={reasons}
                onOpen={() => onOpen(project.slug)}
                onCopyLink={() => onCopyLink(project.slug)}
                onSelect={() => onSelect(project.slug)}
              />
            ))}
          </div>

          {evaluation.hasSupportedMatch && !browseAll ? (
            <button
              type="button"
              onClick={() => setBrowseAll(true)}
              className="mt-5 min-h-[48px] rounded-[13px] border border-[#EAE6DE] bg-white px-5 text-[14px] font-[600] text-[#57534A] outline-none hover:bg-[#FBFAF7] focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2"
            >
              Browse all projects
            </button>
          ) : null}
        </>
      )}

      <p className="mt-6 text-[13px] text-[#8A857A]">
        {evaluation.noMatchMessage || browseAll
          ? "Every active project is shown — any can be opened or selected for discussion."
          : "Browse all projects shows the complete catalogue."}
      </p>
    </div>
  );
}

function SelectedView({
  project,
  reasons,
  storyFacets,
  onOpen,
  onCopyLink,
  onChange,
  onContinue,
}: {
  project: Property;
  reasons: MatchReason[];
  storyFacets: StoryFacet[];
  onOpen: () => void;
  onCopyLink: () => void;
  onChange: () => void;
  onContinue: () => void;
}) {
  const dataGaps: string[] = [];
  if (!project.price) dataGaps.push("No published starting price");
  if (reasons.length === 0) dataGaps.push("No structured match reason — shown for discussion");
  if (project.slug === "coralina") dataGaps.push("Unpublished local-development draft");

  return (
    <div className="mx-auto max-w-[1000px]">
      <SectionHeading eyebrow="Selected project" title="Selected for this guest" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.1fr_1fr]">
        <MatchResultCard
          project={project}
          reasons={reasons}
          onOpen={onOpen}
          onCopyLink={onCopyLink}
          variant="selected"
        />
        <div className="flex flex-col gap-5">
          <Panel>
            <p className="text-[12px] font-[700] uppercase tracking-[0.14em] text-[#9C7B4C]">
              Why this project is shown
            </p>
            {reasons.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-2">
                {reasons.map((reason) => (
                  <li
                    key={reason.kind}
                    className="flex items-center gap-2 text-[14px] text-[#2B2820]"
                  >
                    <span
                      aria-hidden="true"
                      className="h-[6px] w-[6px] rounded-full bg-[#9C7B4C]"
                    />
                    {reason.label}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[14px] text-[#8A857A]">{NO_EXACT_MATCH_MESSAGE}</p>
            )}
          </Panel>

          <Panel>
            <p className="text-[12px] font-[700] uppercase tracking-[0.14em] text-[#A29C90]">
              Known data gaps — say so out loud
            </p>
            {dataGaps.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-2">
                {dataGaps.map((gap) => (
                  <li key={gap} className="flex items-center gap-2 text-[14px] text-[#8A857A]">
                    <span
                      aria-hidden="true"
                      className="h-[6px] w-[6px] rounded-full bg-[#DDD8CE]"
                    />
                    {gap}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[14px] text-[#8A857A]">None flagged.</p>
            )}
          </Panel>

          {storyFacets.length > 0 ? (
            <Panel>
              <p className="text-[12px] font-[700] uppercase tracking-[0.14em] text-[#3D8A5F]">
                Confirmed Forever Story
              </p>
              <dl className="mt-3 flex flex-col gap-2">
                {storyFacets.map((facet) => (
                  <div key={facet.label}>
                    <dt className="text-[11px] font-[700] uppercase tracking-[0.08em] text-[#A29C90]">
                      {facet.label}
                    </dt>
                    <dd className="text-[13.5px] text-[#2B2820]">{facet.value}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          ) : null}
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onContinue}
          className="min-h-[56px] flex-1 rounded-[15px] bg-[#17150F] px-4 text-[16px] font-[600] text-white outline-none transition-transform focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2 active:translate-y-px"
        >
          Continue to contact details
        </button>
        <button
          type="button"
          onClick={onChange}
          className="min-h-[56px] flex-1 rounded-[15px] border border-[#EAE6DE] bg-white px-4 text-[15px] font-[600] text-[#57534A] outline-none hover:bg-[#FBFAF7] focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2"
        >
          Change project
        </button>
      </div>
    </div>
  );
}

function ContactView({
  project,
  leadStatus,
  failedBanner,
  onSubmit,
  summary,
}: {
  project: Property;
  leadStatus: LeadStatus;
  failedBanner: string | null;
  onSubmit: (contact: BoothContactDetails) => void;
  summary: { motivations: string; goals: string; concerns: string; projectName: string };
}) {
  return (
    <div className="mx-auto max-w-[1000px]">
      <SectionHeading eyebrow="Contact details" title="Guest contact details" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Panel>
          {import.meta.env.DEV &&
            (import.meta.env.VITE_PARTNER_DEMO === "true" ||
              import.meta.env.VITE_DEMO_LEAD_MODE === "true") && (
              <p className="mb-4 rounded-[10px] border border-dashed border-[#EAE6DE] bg-[#FBFAF7] px-3 py-2 text-[12px] text-[#8A857A]">
                Presentation mode — contact details are validated but not saved.
              </p>
            )}
          <BoothLeadForm status={leadStatus} failedBanner={failedBanner} onSubmit={onSubmit} />
        </Panel>
        <div>
          <Panel>
            <p className="text-[12px] font-[700] uppercase tracking-[0.14em] text-[#A29C90]">
              Session summary · read-only
            </p>
            <dl className="mt-3 flex flex-col gap-3 text-[14px]">
              <div>
                <dt className="text-[12px] font-[600] text-[#8A857A]">Selected project</dt>
                <dd className="text-[#2B2820]">{project.name}</dd>
              </div>
              <div>
                <dt className="text-[12px] font-[600] text-[#8A857A]">Why Phuket</dt>
                <dd className="text-[#2B2820]">{summary.motivations}</dd>
              </div>
              <div>
                <dt className="text-[12px] font-[600] text-[#8A857A]">Success looks like</dt>
                <dd className="text-[#2B2820]">{summary.goals}</dd>
              </div>
              <div>
                <dt className="text-[12px] font-[600] text-[#8A857A]">Biggest concern</dt>
                <dd className="text-[#2B2820]">{summary.concerns}</dd>
              </div>
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function CompleteView({
  projectName,
  onOpen,
  onStartNewGuest,
}: {
  projectName: string;
  onOpen: () => void;
  onStartNewGuest: () => void;
}) {
  const isDemoMode =
    import.meta.env.DEV &&
    (import.meta.env.VITE_PARTNER_DEMO === "true" ||
      import.meta.env.VITE_DEMO_LEAD_MODE === "true");

  return (
    <div className="mx-auto max-w-[680px] pt-6">
      <Panel>
        <div className="mb-4 flex h-[48px] w-[48px] items-center justify-center rounded-full bg-[#F2F8F3] text-[22px] text-[#2C5B3F]">
          ✓
        </div>
        <p className="text-[11px] font-[700] uppercase tracking-[0.2em] text-[#9C7B4C]">
          Booth session complete
        </p>
        <h1
          tabIndex={-1}
          className="mt-2 text-[30px] font-[400] text-[#17150F] outline-none [font-family:'Newsreader',Georgia,serif]"
        >
          {isDemoMode ? "Contact validated" : "Lead saved"}
        </h1>
        <ul className="mt-5 flex flex-col gap-2 text-[15px] text-[#2B2820]">
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="text-[#3D8A5F]">
              ✓
            </span>
            {isDemoMode ? "Contact details not saved" : "Lead saved"}
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="text-[#3D8A5F]">
              ✓
            </span>
            Forever Story confirmed
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="text-[#3D8A5F]">
              ✓
            </span>
            {projectName} selected for discussion
          </li>
        </ul>
        {import.meta.env.DEV &&
          (import.meta.env.VITE_PARTNER_DEMO === "true" ||
            import.meta.env.VITE_DEMO_LEAD_MODE === "true") && (
            <p className="mt-5 rounded-[10px] border border-dashed border-[#EAE6DE] bg-[#FBFAF7] px-3 py-2 text-[12px] text-[#8A857A]">
              Presentation mode — no lead was saved.
            </p>
          )}
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onOpen}
            className="min-h-[56px] flex-1 rounded-[15px] bg-[#17150F] px-4 text-[16px] font-[600] text-white outline-none transition-transform focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2 active:translate-y-px"
          >
            Open selected project
          </button>
          <button
            type="button"
            onClick={onStartNewGuest}
            className="min-h-[56px] flex-1 rounded-[15px] border border-[#EAE6DE] bg-white px-4 text-[15px] font-[600] text-[#57534A] outline-none hover:bg-[#FBFAF7] focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2"
          >
            Start new guest
          </button>
        </div>
      </Panel>
    </div>
  );
}
