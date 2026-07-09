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

type MotivationKey = (typeof WHY_PHUKET_OPTIONS)[number]["key"];

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

          <div className="navigator-choice-list" aria-label="Why are you considering Phuket?">
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

export function NavigatorFlow() {
  const [step, setStep] = useState(0);
  const [motivations, setMotivations] = useState<MotivationKey[]>([]);

  const toggleMotivation = (motivation: MotivationKey) => {
    setMotivations((currentMotivations) => {
      if (currentMotivations.includes(motivation)) {
        return currentMotivations.filter((currentMotivation) => currentMotivation !== motivation);
      }

      return [...currentMotivations, motivation].slice(-3);
    });
  };

  return (
    <div className="navigator-flow">
      <div className="navigator-flow__shell">
        <ProgressHeader
          step={step}
          onBack={() => setStep((currentStep) => Math.max(0, currentStep - 1))}
        />
        {step === 0 ? (
          <WelcomeScreen onBegin={() => setStep(1)} />
        ) : (
          <WhyPhuketScreen
            motivations={motivations}
            onContinue={() => undefined}
            onToggleMotivation={toggleMotivation}
          />
        )}
      </div>
    </div>
  );
}
