import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import ChoiceGroup from "./ChoiceGroup";
import NoteField from "./NoteField";
import PrimaryActionBar from "./PrimaryActionBar";
import ProgressHeader from "./ProgressHeader";
import "./navigator-flow.css";

const WHY_PHUKET_OPTIONS = [
  { key: "second_home", label: "A second home by the sea" },
  { key: "retirement", label: "Retirement in a warmer place" },
  { key: "investment", label: "Investment & rental yield" },
  { key: "asia_base", label: "A base in Asia" },
  { key: "slower_life", label: "A slower way of living" },
  { key: "family", label: "Somewhere for the family" },
] as const;

const SUCCESS_OPTIONS = [
  { key: "financial_security", label: "Financial security" },
  { key: "feels_like_home", label: "A place that feels like home" },
  { key: "rental_income", label: "Steady rental income" },
  { key: "freedom", label: "Freedom to travel" },
  { key: "legacy", label: "A legacy for my family" },
  { key: "peace_privacy", label: "Peace and privacy" },
] as const;

const BUDGET_OPTIONS = [
  { key: "lt_250k", label: "Under $250k" },
  { key: "250_500k", label: "$250k–500k" },
  { key: "500k_1m", label: "$500k–1M" },
  { key: "1m_2_5m", label: "$1M–2.5M" },
  { key: "gt_2_5m", label: "$2.5M+" },
  { key: "exploring", label: "Still exploring" },
] as const;

const TIMELINE_OPTIONS = [
  { key: "ready_now", label: "Ready now" },
  { key: "3_6m", label: "3–6 months" },
  { key: "6_12m", label: "6–12 months" },
  { key: "exploring", label: "Just exploring" },
] as const;

const CONCERN_OPTIONS = [
  { key: "ownership", label: "Legal & ownership rules" },
  { key: "developer_trust", label: "Trusting the developer" },
  { key: "rental_returns", label: "Rental returns" },
  { key: "resale", label: "Resale & liquidity" },
  { key: "remote_mgmt", label: "Managing it from abroad" },
  { key: "area_choice", label: "Choosing the right area" },
] as const;

type MotivationKey = (typeof WHY_PHUKET_OPTIONS)[number]["key"];
type GoalKey = (typeof SUCCESS_OPTIONS)[number]["key"];
type BudgetKey = (typeof BUDGET_OPTIONS)[number]["key"];
type TimelineKey = (typeof TIMELINE_OPTIONS)[number]["key"];
type ConcernKey = (typeof CONCERN_OPTIONS)[number]["key"];
type StoryStatus = "idle" | "loading" | "resolved" | "error";

interface LocalRecommendation {
  primaryRecommendation: string;
  whyItFits: string;
  investmentProfile: string;
  suggestedProjects: {
    title: string;
    description: string;
  }[];
}

interface StoryFacet {
  label: string;
  value: string;
}

interface LocalForeverStory {
  reflection: string;
  facets: StoryFacet[];
  profileLabel: string;
  profileDescription: string;
}

const DEFAULT_FOREVER_STORY: LocalForeverStory = {
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

const DEFAULT_RECOMMENDATION: LocalRecommendation = {
  primaryRecommendation: "A verified Phuket property shortlist",
  whyItFits:
    "You are still shaping the decision, so the right first step is a calm shortlist that compares ownership clarity, area fit, budget comfort, and long-term confidence before narrowing to a specific project type.",
  investmentProfile:
    "Balanced explorer: needs clarity before commitment, with room to compare lifestyle and investment tradeoffs.",
  suggestedProjects: [
    {
      title: "Verified entry villas",
      description:
        "Placeholder cards for ownership-friendly villas with practical management options.",
    },
    {
      title: "Low-rise coastal residences",
      description: "Placeholder cards for quiet, easier-to-hold residences near established areas.",
    },
    {
      title: "Rental-ready condominiums",
      description: "Placeholder cards for managed units with clearer rental assumptions.",
    },
  ],
};

const getOptionLabel = <T extends string>(
  options: readonly { key: T; label: string }[],
  key: T | null,
) => options.find((option) => option.key === key)?.label ?? "";

const getOptionLabels = <T extends string>(
  options: readonly { key: T; label: string }[],
  keys: T[],
) =>
  keys
    .map((key) => options.find((option) => option.key === key)?.label)
    .filter((label): label is string => Boolean(label));

function humanizeList(values: string[]) {
  if (values.length === 0) {
    return "";
  }

  if (values.length === 1) {
    return values[0];
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function buildLocalForeverStory({
  motivations,
  goals,
  budget,
  timeline,
  concerns,
}: {
  motivations: MotivationKey[];
  goals: GoalKey[];
  budget: BudgetKey | null;
  timeline: TimelineKey | null;
  concerns: ConcernKey[];
}): LocalForeverStory {
  if (
    motivations.length === 0 ||
    goals.length === 0 ||
    !budget ||
    !timeline ||
    concerns.length === 0
  ) {
    return DEFAULT_FOREVER_STORY;
  }

  const whyLabels = getOptionLabels(WHY_PHUKET_OPTIONS, motivations);
  const goalLabels = getOptionLabels(SUCCESS_OPTIONS, goals);
  const concernLabels = getOptionLabels(CONCERN_OPTIONS, concerns);
  const why = humanizeList(whyLabels).toLowerCase();
  const success = humanizeList(goalLabels).toLowerCase();
  const concern = humanizeList(concernLabels).toLowerCase();
  const budgetLabel = getOptionLabel(BUDGET_OPTIONS, budget).toLowerCase();
  const timelineLabel = getOptionLabel(TIMELINE_OPTIONS, timeline).toLowerCase();

  return {
    reflection: `You're drawn to Phuket for ${why}. Success, for you, looks like ${success} — and with ${budgetLabel} over ${timelineLabel}, the thing that matters most is navigating ${concern}.`,
    facets: [
      { label: "Why Phuket", value: `${humanizeList(whyLabels)}.` },
      {
        label: "What you're hoping for",
        value: `${humanizeList(goalLabels)}.`,
      },
      {
        label: "What matters most",
        value: concerns.includes("ownership")
          ? "Certainty over yield. You'd rather be right than quick."
          : "A clear decision that fits the life you're trying to build.",
      },
      {
        label: "Where you feel unsure",
        value: `${humanizeList(concernLabels)}.`,
      },
      {
        label: "Your horizon",
        value: `${getOptionLabel(TIMELINE_OPTIONS, timeline)} — ready when it's right.`,
      },
    ],
    profileLabel: "The Considered Retreat-Seeker",
    profileDescription:
      "You'll choose slowly, and once. Guidance matters more to you than options — you want the right decision, not the most choice.",
  };
}

function buildLocalRecommendation({
  motivations,
  goals,
  budget,
  timeline,
  concerns,
}: {
  motivations: MotivationKey[];
  goals: GoalKey[];
  budget: BudgetKey | null;
  timeline: TimelineKey | null;
  concerns: ConcernKey[];
}): LocalRecommendation {
  if (
    motivations.length === 0 ||
    goals.length === 0 ||
    !budget ||
    !timeline ||
    concerns.length === 0
  ) {
    return DEFAULT_RECOMMENDATION;
  }

  if (goals.includes("rental_income") || motivations.includes("investment")) {
    return {
      primaryRecommendation: "Rental-ready residences with professional management",
      whyItFits:
        "Your answers point toward income discipline and easier remote ownership. A managed residence gives you clearer operating assumptions before you compare individual projects.",
      investmentProfile:
        timeline === "ready_now" || timeline === "3_6m"
          ? "Yield-aware investor: ready to compare verified rental assumptions and near-term availability."
          : "Patient income planner: focused on rental logic, but still needs time to compare areas and management quality.",
      suggestedProjects: [
        {
          title: "Managed coastal condominium",
          description: "Placeholder card for a furnished unit with rental program comparison.",
        },
        {
          title: "Hotel-managed residence",
          description: "Placeholder card for branded operations and simpler owner use windows.",
        },
        {
          title: "Resale liquidity watchlist",
          description: "Placeholder card for projects with stronger secondary-market signals.",
        },
      ],
    };
  }

  if (
    goals.includes("peace_privacy") ||
    motivations.includes("slower_life") ||
    motivations.includes("retirement")
  ) {
    return {
      primaryRecommendation: "Private low-density villas in established lifestyle areas",
      whyItFits:
        "You are optimizing for calm, privacy, and a decision you can live with. A low-density villa path keeps the search focused on comfort, ownership clarity, and day-to-day livability.",
      investmentProfile:
        budget === "lt_250k" || budget === "250_500k"
          ? "Lifestyle-led buyer: careful on budget, with fit and clarity carrying more weight than maximum yield."
          : "Lifestyle-led capital preserver: values privacy, quality, and long holding confidence.",
      suggestedProjects: [
        {
          title: "Quiet private villa",
          description:
            "Placeholder card for low-density homes with practical maintenance planning.",
        },
        {
          title: "Retreat-style residence",
          description: "Placeholder card for calmer locations with stronger everyday comfort.",
        },
        {
          title: "Ownership clarity shortlist",
          description:
            "Placeholder card for projects screened around legal structure and handover risk.",
        },
      ],
    };
  }

  if (goals.includes("legacy") || motivations.includes("family")) {
    return {
      primaryRecommendation: "Family-sized residences with long-hold fundamentals",
      whyItFits:
        "Your answers suggest the property needs to work for more than one trip or one season. The first screen should favor space, durability, area convenience, and future flexibility.",
      investmentProfile:
        "Long-hold family allocator: prioritizes reliability, usable space, and a decision that remains sensible over time.",
      suggestedProjects: [
        {
          title: "Three-bedroom residence",
          description: "Placeholder card for practical layouts suited to repeat family stays.",
        },
        {
          title: "Established-area villa",
          description:
            "Placeholder card for access to services, beaches, and long-term convenience.",
        },
        {
          title: "Legacy shortlist",
          description:
            "Placeholder card for durable projects with clearer ownership documentation.",
        },
      ],
    };
  }

  return DEFAULT_RECOMMENDATION;
}

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
  story: LocalForeverStory | null;
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
  recommendation,
  onContinue,
}: {
  recommendation: LocalRecommendation;
  onContinue: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

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
            <h3 id="navigator-projects-title">Suggested first projects</h3>
            <div className="navigator-recommendation__project-list">
              {recommendation.suggestedProjects.map((project, index) => (
                <article
                  key={project.title}
                  className="navigator-recommendation__project"
                  style={{ "--navigator-story-delay": `${index * 60}ms` } as CSSProperties}
                >
                  <p>{String(index + 1).padStart(2, "0")}</p>
                  <h4>{project.title}</h4>
                  <span>{project.description}</span>
                </article>
              ))}
            </div>
          </section>
        </section>
      </ScreenFrame>
      <PrimaryActionBar primaryLabel="Continue" onPrimary={onContinue} />
    </>
  );
}

function toggleMaxThree<T>(value: T, values: T[]) {
  if (values.includes(value)) {
    return values.filter((currentValue) => currentValue !== value);
  }

  return [...values, value].slice(-3);
}

export function NavigatorFlow() {
  const [step, setStep] = useState(0);
  const [motivations, setMotivations] = useState<MotivationKey[]>([]);
  const [goals, setGoals] = useState<GoalKey[]>([]);
  const [budget, setBudget] = useState<BudgetKey | null>(null);
  const [timeline, setTimeline] = useState<TimelineKey | null>(null);
  const [concerns, setConcerns] = useState<ConcernKey[]>([]);
  const [freeNote, setFreeNote] = useState("");
  const [storyStatus, setStoryStatus] = useState<StoryStatus>("idle");
  const [foreverStory, setForeverStory] = useState<LocalForeverStory | null>(null);

  useEffect(() => {
    if (storyStatus !== "loading") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setForeverStory(
        buildLocalForeverStory({
          motivations,
          goals,
          budget,
          timeline,
          concerns,
        }),
      );
      setStoryStatus("resolved");
    }, 900);

    return () => window.clearTimeout(timeoutId);
  }, [budget, concerns, goals, motivations, storyStatus, timeline]);

  const beginStoryGeneration = () => {
    setForeverStory(null);
    setStoryStatus("loading");
    setStep(5);
  };

  const recommendation = buildLocalRecommendation({
    motivations,
    goals,
    budget,
    timeline,
    concerns,
  });

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
              setMotivations((currentMotivations) =>
                toggleMaxThree(motivation, currentMotivations),
              );
            }}
          />
        );
      case 2:
        return (
          <SuccessScreen
            goals={goals}
            onContinue={() => setStep(3)}
            onToggleGoal={(goal) => {
              setGoals((currentGoals) => toggleMaxThree(goal, currentGoals));
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
              setBudget((currentBudget) => (currentBudget === nextBudget ? null : nextBudget));
            }}
            onToggleTimeline={(nextTimeline) => {
              setTimeline((currentTimeline) =>
                currentTimeline === nextTimeline ? null : nextTimeline,
              );
            }}
          />
        );
      case 4:
        return (
          <BiggestConcernScreen
            concerns={concerns}
            note={freeNote}
            onContinue={beginStoryGeneration}
            onNoteChange={setFreeNote}
            onToggleConcern={(concern) => {
              setConcerns((currentConcerns) => toggleMaxThree(concern, currentConcerns));
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
      default:
        return (
          <RecommendationScreen recommendation={recommendation} onContinue={() => setStep(6)} />
        );
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
