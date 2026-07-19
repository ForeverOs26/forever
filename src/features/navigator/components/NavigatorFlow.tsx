import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { projectListQuery } from "@/lib/project-service";
import ChoiceGroup from "./ChoiceGroup";
import NoteField from "./NoteField";
import PrimaryActionBar from "./PrimaryActionBar";
import ProgressHeader from "./ProgressHeader";
import "./navigator-flow.css";

import {
  BUDGET_OPTIONS,
  CONCERN_OPTIONS,
  SUCCESS_OPTIONS,
  TIMELINE_OPTIONS,
  WHY_PHUKET_OPTIONS,
  budgetLabel,
  buildForeverStory,
  buildProjectPath,
  buildRecommendationPath,
  concernLabels,
  deriveDecisionProfile,
  emptyAnswers,
  evaluateCatalogue,
  goalLabels,
  humanizeList,
  motivationLabels,
  timelineLabel,
  toggleMaxThree,
  toggleSingle,
  visibleResults,
  type BudgetKey,
  type ConcernKey,
  type ForeverStory,
  type GoalKey,
  type MotivationKey,
  type NavigatorAnswers,
  type RecommendationPath,
  type StoryStatus,
  type TimelineKey,
} from "../core";

function ScreenFrame({ children }: { children: ReactNode }) {
  return <main className="navigator-screen">{children}</main>;
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="navigator-eyebrow">{children}</p>;
}

function SerifHeading({
  children,
  headingRef,
  id,
  variant = "welcome",
}: {
  children: ReactNode;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  id: string;
  variant?: "welcome" | "question";
}) {
  return (
    <h1
      id={id}
      ref={headingRef}
      tabIndex={-1}
      className={`navigator-heading navigator-heading--${variant}`}
    >
      {children}
    </h1>
  );
}

function WelcomeScreen({ onBegin }: { onBegin: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <>
      <ScreenFrame>
        <section className="navigator-welcome" aria-labelledby="navigator-welcome-title">
          <div className="navigator-welcome__content">
            <Eyebrow>FOREVER</Eyebrow>
            <SerifHeading id="navigator-welcome-title" headingRef={headingRef}>
              A home in Phuket begins with a conversation.
            </SerifHeading>
            <p className="navigator-welcome__sub">
              Before we show you a single property, we&apos;d like to understand you. A few gentle
              questions — no sign-up, nothing to buy.
            </p>
          </div>
          <p className="navigator-welcome__footnote">About 3 minutes · No sign-up required</p>
        </section>
      </ScreenFrame>
      <PrimaryActionBar primaryLabel="Begin" onPrimary={onBegin} />
    </>
  );
}

function WhyPhuketScreen({
  motivations,
  onContinue,
  onToggleMotivation,
}: {
  motivations: MotivationKey[];
  onContinue: () => void;
  onToggleMotivation: (motivation: MotivationKey) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const canContinue = motivations.length > 0;

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <>
      <ScreenFrame>
        <section className="navigator-question" aria-labelledby="navigator-why-title">
          <div>
            <p className="navigator-question__index">01</p>
            <SerifHeading id="navigator-why-title" headingRef={headingRef} variant="question">
              Why are you considering Phuket?
            </SerifHeading>
            <p className="navigator-question__helper">Choose up to three that ring true.</p>
          </div>

          <ChoiceGroup
            ariaLabel="Why are you considering Phuket?"
            items={WHY_PHUKET_OPTIONS.map((option) => ({
              key: option.key,
              title: option.label,
            }))}
            selectedKeys={motivations}
            onToggle={(motivation) => onToggleMotivation(motivation as MotivationKey)}
          />
        </section>
      </ScreenFrame>
      <PrimaryActionBar primaryLabel="Continue" disabled={!canContinue} onPrimary={onContinue} />
    </>
  );
}

function SuccessScreen({
  goals,
  onContinue,
  onToggleGoal,
}: {
  goals: GoalKey[];
  onContinue: () => void;
  onToggleGoal: (goal: GoalKey) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const canContinue = goals.length > 0;

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <>
      <ScreenFrame>
        <section className="navigator-question" aria-labelledby="navigator-success-title">
          <div>
            <p className="navigator-question__index">02</p>
            <SerifHeading id="navigator-success-title" headingRef={headingRef} variant="question">
              What would success look like for you?
            </SerifHeading>
            <p className="navigator-question__helper">Up to three.</p>
          </div>

          <ChoiceGroup
            ariaLabel="What would success look like for you?"
            items={SUCCESS_OPTIONS.map((option) => ({
              key: option.key,
              title: option.label,
            }))}
            selectedKeys={goals}
            onToggle={(goal) => onToggleGoal(goal as GoalKey)}
          />
        </section>
      </ScreenFrame>
      <PrimaryActionBar primaryLabel="Continue" disabled={!canContinue} onPrimary={onContinue} />
    </>
  );
}

function BudgetTimelineScreen({
  budget,
  timeline,
  onContinue,
  onToggleBudget,
  onToggleTimeline,
}: {
  budget: BudgetKey | null;
  timeline: TimelineKey | null;
  onContinue: () => void;
  onToggleBudget: (budget: BudgetKey) => void;
  onToggleTimeline: (timeline: TimelineKey) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const canContinue = Boolean(budget && timeline);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <>
      <ScreenFrame>
        <section className="navigator-question" aria-labelledby="navigator-budget-title">
          <div>
            <p className="navigator-question__index">03</p>
            <SerifHeading id="navigator-budget-title" headingRef={headingRef} variant="question">
              What feels comfortable, and when?
            </SerifHeading>
          </div>

          <div className="navigator-pill-groups">
            <div className="navigator-pill-group">
              <p className="navigator-pill-group__label">Budget</p>
              <ChoiceGroup
                ariaLabel="Budget"
                items={BUDGET_OPTIONS.map((option) => ({
                  key: option.key,
                  title: option.label,
                }))}
                selectedKeys={budget ? [budget] : []}
                onToggle={(nextBudget) => onToggleBudget(nextBudget as BudgetKey)}
              />
            </div>

            <div className="navigator-pill-group">
              <p className="navigator-pill-group__label">Timeline</p>
              <ChoiceGroup
                ariaLabel="Timeline"
                items={TIMELINE_OPTIONS.map((option) => ({
                  key: option.key,
                  title: option.label,
                }))}
                selectedKeys={timeline ? [timeline] : []}
                onToggle={(nextTimeline) => onToggleTimeline(nextTimeline as TimelineKey)}
              />
            </div>
          </div>
        </section>
      </ScreenFrame>
      <PrimaryActionBar primaryLabel="Continue" disabled={!canContinue} onPrimary={onContinue} />
    </>
  );
}

function BiggestConcernScreen({
  concerns,
  note,
  onContinue,
  onNoteChange,
  onToggleConcern,
}: {
  concerns: ConcernKey[];
  note: string;
  onContinue: () => void;
  onNoteChange: (note: string) => void;
  onToggleConcern: (concern: ConcernKey) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const canContinue = concerns.length > 0;

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <>
      <ScreenFrame>
        <section className="navigator-question" aria-labelledby="navigator-concern-title">
          <div>
            <p className="navigator-question__index">04</p>
            <SerifHeading id="navigator-concern-title" headingRef={headingRef} variant="question">
              What&apos;s your biggest concern right now?
            </SerifHeading>
            <p className="navigator-question__helper">Be honest — this is what we help with.</p>
          </div>

          <div className="navigator-question__stack">
            <ChoiceGroup
              ariaLabel="What's your biggest concern right now?"
              items={CONCERN_OPTIONS.map((option) => ({
                key: option.key,
                title: option.label,
              }))}
              selectedKeys={concerns}
              onToggle={(concern) => onToggleConcern(concern as ConcernKey)}
            />

            <NoteField
              label="Anything else on your mind?"
              value={note}
              onChange={onNoteChange}
              placeholder="Anything else on your mind? (optional)"
              rows={3}
            />
          </div>
        </section>
      </ScreenFrame>
      <PrimaryActionBar primaryLabel="Continue" disabled={!canContinue} onPrimary={onContinue} />
    </>
  );
}

function ForeverStoryScreen({
  story,
  status,
  onChangeSomething,
  onConfirm,
  onRetry,
}: {
  story: ForeverStory | null;
  status: StoryStatus;
  onChangeSomething: () => void;
  onConfirm: () => void;
  onRetry: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [status]);

  if (status === "loading") {
    return (
      <ScreenFrame>
        <section
          className="navigator-story navigator-story--loading"
          aria-labelledby="navigator-story-loading-title"
          aria-live="polite"
        >
          <div className="navigator-story__loading-mark" aria-hidden="true" />
          <Eyebrow>Your Forever Story</Eyebrow>
          <SerifHeading
            id="navigator-story-loading-title"
            headingRef={headingRef}
            variant="question"
          >
            Writing your reflection…
          </SerifHeading>
          <p className="navigator-story__muted">
            A short pause while we put your answers into something human.
          </p>
        </section>
      </ScreenFrame>
    );
  }

  if (status === "error" || !story) {
    return (
      <>
        <ScreenFrame>
          <section className="navigator-story" aria-labelledby="navigator-story-error-title">
            <Eyebrow>Your Forever Story</Eyebrow>
            <SerifHeading
              id="navigator-story-error-title"
              headingRef={headingRef}
              variant="question"
            >
              Here&apos;s how I understand your situation.
            </SerifHeading>
            <p className="navigator-story__muted">
              I might not have every detail right — you can adjust anything.
            </p>
          </section>
        </ScreenFrame>
        <PrimaryActionBar
          primaryLabel="Try again"
          onPrimary={onRetry}
          secondaryLabel="I'd like to change something"
          onSecondary={onChangeSomething}
        />
      </>
    );
  }

  return (
    <>
      <ScreenFrame>
        <section className="navigator-story" aria-labelledby="navigator-story-title">
          <div>
            <Eyebrow>Your Forever Story</Eyebrow>
            <SerifHeading id="navigator-story-title" headingRef={headingRef} variant="question">
              Here&apos;s how I understand your situation.
            </SerifHeading>
          </div>

          <div className="navigator-story__stack">
            <p className="navigator-story__reflection">{story.reflection}</p>

            <dl className="navigator-story__facets">
              {story.facets.map((facet, index) => (
                <div
                  key={facet.label}
                  className="navigator-story__facet"
                  style={{ "--navigator-story-delay": `${index * 60}ms` } as CSSProperties}
                >
                  <dt>{facet.label}</dt>
                  <dd>{facet.value}</dd>
                </div>
              ))}
            </dl>

            <article className="navigator-story__profile">
              <p>How I&apos;d describe you</p>
              <h2>{story.profileLabel}</h2>
              <p>{story.profileDescription}</p>
            </article>

            <p className="navigator-story__muted">
              I might not have every detail right — you can adjust anything.
            </p>
          </div>
        </section>
      </ScreenFrame>
      <PrimaryActionBar
        primaryLabel="Yes, this describes me"
        onPrimary={onConfirm}
        secondaryLabel="I'd like to change something"
        onSecondary={onChangeSomething}
      />
    </>
  );
}

function RecommendationScreen({
  answers,
  recommendation,
  onContinue,
}: {
  answers: NavigatorAnswers;
  recommendation: RecommendationPath;
  onContinue: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [browseAll, setBrowseAll] = useState(false);

  // Same real result engine as Booth Mode: ProjectService catalogue evaluated
  // by the shared deterministic evaluator. Identical answers and catalogue data
  // therefore show identical project records in both modes.
  const catalogue = useQuery(projectListQuery());
  const profile = useMemo(() => deriveDecisionProfile(answers), [answers]);
  const evaluation = useMemo(
    () => evaluateCatalogue(profile, catalogue.data ?? []),
    [profile, catalogue.data],
  );
  const shown = visibleResults(evaluation, browseAll);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <>
      <ScreenFrame>
        <section
          className="navigator-recommendation"
          aria-labelledby="navigator-recommendation-title"
        >
          <div>
            <Eyebrow>Your Recommendation</Eyebrow>
            <SerifHeading
              id="navigator-recommendation-title"
              headingRef={headingRef}
              variant="question"
            >
              Start here.
            </SerifHeading>
          </div>

          <article className="navigator-recommendation__hero">
            <p>Primary recommendation</p>
            <h2>{recommendation.primaryRecommendation}</h2>
          </article>

          <div className="navigator-recommendation__stack">
            <section
              className="navigator-recommendation__panel"
              aria-labelledby="navigator-fit-title"
            >
              <h3 id="navigator-fit-title">Why it fits</h3>
              <p>{recommendation.whyItFits}</p>
            </section>

            <section
              className="navigator-recommendation__panel"
              aria-labelledby="navigator-profile-title"
            >
              <h3 id="navigator-profile-title">Investment profile</h3>
              <p>{recommendation.investmentProfile}</p>
            </section>
          </div>

          <section
            className="navigator-recommendation__projects"
            aria-labelledby="navigator-projects-title"
          >
            <h3 id="navigator-projects-title">Projects matching your preferences</h3>

            {catalogue.isLoading ? (
              <p className="navigator-story__muted" aria-live="polite">
                Loading available projects…
              </p>
            ) : catalogue.isError ? (
              <div>
                <p className="navigator-story__muted">
                  The catalogue couldn&apos;t load. Check the connection and retry.
                </p>
                <button
                  type="button"
                  onClick={() => catalogue.refetch()}
                  className="mt-3 min-h-[44px] rounded-[12px] bg-[#17150F] px-5 text-[14px] font-[600] text-white outline-none focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2"
                >
                  Retry
                </button>
              </div>
            ) : (
              <>
                {evaluation.noMatchMessage ? (
                  <p className="navigator-story__muted">{evaluation.noMatchMessage}</p>
                ) : null}

                <div className="navigator-recommendation__project-list">
                  {shown.map(({ project, reasons }, index) => (
                    <article
                      key={project.slug}
                      data-project-slug={project.slug}
                      className="navigator-recommendation__project"
                      style={{ "--navigator-story-delay": `${index * 60}ms` } as CSSProperties}
                    >
                      <p>{String(index + 1).padStart(2, "0")}</p>
                      <h4>{project.name}</h4>
                      {project.location ? <span>{project.location}</span> : null}
                      {reasons.length > 0 ? (
                        <ul aria-label={`Why ${project.name} is shown`} className="mt-2 flex flex-wrap gap-2">
                          {reasons.map((reason) => (
                            <li
                              key={reason.kind}
                              className="inline-flex items-center gap-2 rounded-full border border-[#E3DED4] bg-[#FBFAF7] px-3 py-1 text-[12px] font-[600] text-[#3A362E]"
                            >
                              <span
                                aria-hidden="true"
                                className="h-[6px] w-[6px] rounded-full bg-[#9C7B4C]"
                              />
                              {reason.label}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {project.price ? <span>{project.price}</span> : null}
                      <a
                        href={buildProjectPath(project.slug)}
                        className="mt-2 inline-flex min-h-[44px] items-center text-[14px] font-[600] text-[#9C7B4C] underline-offset-4 outline-none hover:text-[#17150F] hover:underline focus-visible:ring-2 focus-visible:ring-[#9C7B4C]"
                      >
                        View project
                      </a>
                    </article>
                  ))}
                </div>

                {evaluation.hasSupportedMatch && !browseAll ? (
                  <button
                    type="button"
                    onClick={() => setBrowseAll(true)}
                    className="mt-4 min-h-[44px] rounded-[12px] border border-[#EAE6DE] bg-white px-5 text-[14px] font-[600] text-[#57534A] outline-none hover:bg-[#FBFAF7] focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2"
                  >
                    Browse all projects
                  </button>
                ) : null}
              </>
            )}
          </section>
        </section>
      </ScreenFrame>
      <PrimaryActionBar primaryLabel="Continue" onPrimary={onContinue} />
    </>
  );
}

function AdvisorInvitationScreen({
  motivations,
  goals,
  recommendation,
  concerns,
  budget,
  timeline,
  onContinue,
}: {
  motivations: MotivationKey[];
  goals: GoalKey[];
  recommendation: RecommendationPath;
  concerns: ConcernKey[];
  budget: BudgetKey | null;
  timeline: TimelineKey | null;
  onContinue: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const priorityLabels = [...motivationLabels(motivations), ...goalLabels(goals)];
  const concernLabelList = concernLabels(concerns);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <>
      <ScreenFrame>
        <section className="navigator-advisor" aria-labelledby="navigator-advisor-title">
          <div>
            <Eyebrow>Personal Review</Eyebrow>
            <SerifHeading id="navigator-advisor-title" headingRef={headingRef} variant="question">
              Meet your Forever Advisor
            </SerifHeading>
            <p className="navigator-advisor__intro">
              A Forever Advisor will personally review your profile before recommending projects
              that fit what matters most to you.
            </p>
          </div>

          <article className="navigator-advisor__summary" aria-label="Your profile summary">
            <dl className="navigator-advisor__list">
              <div className="navigator-advisor__row">
                <dt>Your priorities</dt>
                <dd>{humanizeList(priorityLabels) || "Still taking shape"}</dd>
              </div>
              <div className="navigator-advisor__row">
                <dt>Investment profile</dt>
                <dd>{recommendation.investmentProfile}</dd>
              </div>
              <div className="navigator-advisor__row">
                <dt>Biggest concern</dt>
                <dd>{humanizeList(concernLabelList) || "Not specified"}</dd>
              </div>
              <div className="navigator-advisor__row">
                <dt>Budget summary</dt>
                <dd>
                  {budget ? budgetLabel(budget) : "Still exploring"}
                  {timeline ? ` · ${timelineLabel(timeline)}` : ""}
                </dd>
              </div>
            </dl>
          </article>
        </section>
      </ScreenFrame>
      <PrimaryActionBar primaryLabel="Continue" onPrimary={onContinue} />
    </>
  );
}

function ConfirmationScreen({ onStartAgain }: { onStartAgain: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <>
      <ScreenFrame>
        <section className="navigator-confirmation" aria-labelledby="navigator-confirmation-title">
          <div className="navigator-confirmation__check" aria-hidden="true">
            ✓
          </div>

          <div className="navigator-confirmation__heading">
            <Eyebrow>Navigator Complete</Eyebrow>
            <SerifHeading
              id="navigator-confirmation-title"
              headingRef={headingRef}
              variant="question"
            >
              Your Forever Profile is Ready
            </SerifHeading>
          </div>

          <div className="navigator-confirmation__id">
            <p>Temporary Forever ID</p>
            <strong>FVR-RC1-0001</strong>
          </div>

          <ul className="navigator-confirmation__status" aria-label="Completion status">
            <li>
              <span aria-hidden="true">✓</span>
              Navigator completed
            </li>
            <li>
              <span aria-hidden="true">✓</span>
              Profile generated
            </li>
            <li>
              <span aria-hidden="true">✓</span>
              Ready for Advisor review
            </li>
          </ul>
        </section>
      </ScreenFrame>
      <PrimaryActionBar
        primaryLabel="Request Private Advisory"
        onPrimary={() => undefined}
        secondaryLabel="Start Again"
        onSecondary={onStartAgain}
      />
    </>
  );
}

export function NavigatorFlow() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState(emptyAnswers);
  const [storyStatus, setStoryStatus] = useState<StoryStatus>("idle");
  const [foreverStory, setForeverStory] = useState<ForeverStory | null>(null);

  const { motivations, goals, budget, timeline, concerns, note: freeNote } = answers;

  useEffect(() => {
    if (storyStatus !== "loading") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setForeverStory(buildForeverStory(answers));
      setStoryStatus("resolved");
    }, 900);

    return () => window.clearTimeout(timeoutId);
  }, [answers, storyStatus]);

  const beginStoryGeneration = () => {
    setForeverStory(null);
    setStoryStatus("loading");
    setStep(5);
  };

  const startAgain = () => {
    setAnswers(emptyAnswers());
    setStoryStatus("idle");
    setForeverStory(null);
    setStep(0);
  };

  const recommendation = buildRecommendationPath(answers);

  const renderScreen = () => {
    switch (step) {
      case 0:
        return <WelcomeScreen onBegin={() => setStep(1)} />;
      case 1:
        return (
          <WhyPhuketScreen
            motivations={motivations}
            onContinue={() => setStep(2)}
            onToggleMotivation={(motivation) => {
              setAnswers((current) => ({
                ...current,
                motivations: toggleMaxThree(motivation, current.motivations),
              }));
            }}
          />
        );
      case 2:
        return (
          <SuccessScreen
            goals={goals}
            onContinue={() => setStep(3)}
            onToggleGoal={(goal) => {
              setAnswers((current) => ({
                ...current,
                goals: toggleMaxThree(goal, current.goals),
              }));
            }}
          />
        );
      case 3:
        return (
          <BudgetTimelineScreen
            budget={budget}
            timeline={timeline}
            onContinue={() => setStep(4)}
            onToggleBudget={(nextBudget) => {
              setAnswers((current) => ({
                ...current,
                budget: toggleSingle(nextBudget, current.budget),
              }));
            }}
            onToggleTimeline={(nextTimeline) => {
              setAnswers((current) => ({
                ...current,
                timeline: toggleSingle(nextTimeline, current.timeline),
              }));
            }}
          />
        );
      case 4:
        return (
          <BiggestConcernScreen
            concerns={concerns}
            note={freeNote}
            onContinue={beginStoryGeneration}
            onNoteChange={(nextNote) =>
              setAnswers((current) => ({ ...current, note: nextNote }))
            }
            onToggleConcern={(concern) => {
              setAnswers((current) => ({
                ...current,
                concerns: toggleMaxThree(concern, current.concerns),
              }));
            }}
          />
        );
      case 5:
        return (
          <ForeverStoryScreen
            story={foreverStory}
            status={storyStatus}
            onChangeSomething={() => setStep(4)}
            onConfirm={() => setStep(6)}
            onRetry={beginStoryGeneration}
          />
        );
      case 6:
        return (
          <RecommendationScreen
            answers={answers}
            recommendation={recommendation}
            onContinue={() => setStep(7)}
          />
        );
      case 7:
        return (
          <AdvisorInvitationScreen
            motivations={motivations}
            goals={goals}
            recommendation={recommendation}
            concerns={concerns}
            budget={budget}
            timeline={timeline}
            onContinue={() => setStep(8)}
          />
        );
      default:
        return <ConfirmationScreen onStartAgain={startAgain} />;
    }
  };

  return (
    <div className="navigator-flow">
      <div className="navigator-flow__shell">
        {step >= 1 && step <= 4 ? (
          <ProgressHeader
            currentStep={step}
            totalSteps={4}
            onBack={() => setStep((currentStep) => Math.max(0, currentStep - 1))}
            backLabel="Go back"
          />
        ) : null}
        {renderScreen()}
      </div>
    </div>
  );
}
