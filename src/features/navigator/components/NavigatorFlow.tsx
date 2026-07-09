import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

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

type MotivationKey = (typeof WHY_PHUKET_OPTIONS)[number]["key"];
type GoalKey = (typeof SUCCESS_OPTIONS)[number]["key"];
type BudgetKey = (typeof BUDGET_OPTIONS)[number]["key"];
type TimelineKey = (typeof TIMELINE_OPTIONS)[number]["key"];

function ProgressHeader({ step, onBack }: { step: number; onBack: () => void }) {
  if (step < 1 || step > 4) {
    return null;
  }

  return (
    <header className="navigator-progress-header">
      <button type="button" className="navigator-back" onClick={onBack} aria-label="Go back">
        Back
      </button>
      <div className="navigator-progress" aria-hidden="true">
        <div className="navigator-progress__track">
          <div
            className="navigator-progress__bar"
            style={{ inlineSize: `${Math.round((Math.min(step, 4) / 4) * 100)}%` }}
          />
        </div>
      </div>
      <p className="navigator-step-count" aria-label={`Step ${step} of 4`}>
        {String(step).padStart(2, "0")} / 04
      </p>
    </header>
  );
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

function PrimaryAction({
  children,
  disabled = false,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <footer className="navigator-primary-action">
      <button type="button" className="navigator-btn" disabled={disabled} onClick={onClick}>
        {children}
      </button>
    </footer>
  );
}

function ChoiceCard({
  children,
  selected,
  onToggle,
}: {
  children: ReactNode;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="navigator-choice-card"
      aria-pressed={selected}
      onClick={onToggle}
    >
      <span>{children}</span>
      <span className="navigator-choice-card__dot" aria-hidden="true" />
    </button>
  );
}

function Pill({
  children,
  selected,
  onToggle,
}: {
  children: ReactNode;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button type="button" className="navigator-pill" aria-pressed={selected} onClick={onToggle}>
      {children}
    </button>
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
      <PrimaryAction onClick={onBegin}>Begin</PrimaryAction>
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

          <div
            className="navigator-choice-list"
            role="group"
            aria-label="Why are you considering Phuket?"
          >
            {WHY_PHUKET_OPTIONS.map((option) => (
              <ChoiceCard
                key={option.key}
                selected={motivations.includes(option.key)}
                onToggle={() => onToggleMotivation(option.key)}
              >
                {option.label}
              </ChoiceCard>
            ))}
          </div>
        </section>
      </ScreenFrame>
      <PrimaryAction disabled={!canContinue} onClick={onContinue}>
        Continue
      </PrimaryAction>
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

          <div
            className="navigator-choice-list"
            role="group"
            aria-label="What would success look like for you?"
          >
            {SUCCESS_OPTIONS.map((option) => (
              <ChoiceCard
                key={option.key}
                selected={goals.includes(option.key)}
                onToggle={() => onToggleGoal(option.key)}
              >
                {option.label}
              </ChoiceCard>
            ))}
          </div>
        </section>
      </ScreenFrame>
      <PrimaryAction disabled={!canContinue} onClick={onContinue}>
        Continue
      </PrimaryAction>
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
              <div className="navigator-pill-list" role="group" aria-label="Budget">
                {BUDGET_OPTIONS.map((option) => (
                  <Pill
                    key={option.key}
                    selected={budget === option.key}
                    onToggle={() => onToggleBudget(option.key)}
                  >
                    {option.label}
                  </Pill>
                ))}
              </div>
            </div>

            <div className="navigator-pill-group">
              <p className="navigator-pill-group__label">Timeline</p>
              <div className="navigator-pill-list" role="group" aria-label="Timeline">
                {TIMELINE_OPTIONS.map((option) => (
                  <Pill
                    key={option.key}
                    selected={timeline === option.key}
                    onToggle={() => onToggleTimeline(option.key)}
                  >
                    {option.label}
                  </Pill>
                ))}
              </div>
            </div>
          </div>
        </section>
      </ScreenFrame>
      <PrimaryAction disabled={!canContinue} onClick={onContinue}>
        Continue
      </PrimaryAction>
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
      default:
        return (
          <BudgetTimelineScreen
            budget={budget}
            timeline={timeline}
            onContinue={() => undefined}
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
    }
  };

  return (
    <div className="navigator-flow">
      <div className="navigator-flow__shell">
        <ProgressHeader
          step={step}
          onBack={() => setStep((currentStep) => Math.max(0, currentStep - 1))}
        />
        {renderScreen()}
      </div>
    </div>
  );
}
