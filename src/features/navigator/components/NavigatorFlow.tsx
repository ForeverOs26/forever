import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import "./navigator-flow.css";

function ProgressHeader() {
  return (
    <header className="navigator-progress-header" aria-hidden="true">
      <div className="navigator-progress-header__bar" />
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
}: {
  children: ReactNode;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <h1 id="navigator-welcome-title" ref={headingRef} tabIndex={-1} className="navigator-heading">
      {children}
    </h1>
  );
}

function PrimaryAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <footer className="navigator-primary-action">
      <button type="button" className="navigator-btn" onClick={onClick}>
        {children}
      </button>
    </footer>
  );
}

function WelcomeScreen() {
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
            <SerifHeading headingRef={headingRef}>
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
      <PrimaryAction onClick={() => undefined}>Begin</PrimaryAction>
    </>
  );
}

export function NavigatorFlow() {
  return (
    <div className="navigator-flow">
      <div className="navigator-flow__shell">
        <ProgressHeader />
        <WelcomeScreen />
      </div>
    </div>
  );
}
