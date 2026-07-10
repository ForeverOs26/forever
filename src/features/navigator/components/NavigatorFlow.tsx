import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

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
            <p className="navigator-question__helper">Be honest вЂ” this is what we help with.</p>
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
      default:
        return (
          <BiggestConcernScreen
            concerns={concerns}
            note={freeNote}
            onContinue={() => undefined}
            onNoteChange={setFreeNote}
            onToggleConcern={(concern) => {
              setConcerns((currentConcerns) => toggleMaxThree(concern, currentConcerns));
            }}
          />
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
