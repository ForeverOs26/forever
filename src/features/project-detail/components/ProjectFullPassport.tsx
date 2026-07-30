import { CircleAlert, ShieldCheck, UserRound } from "lucide-react";

import { Section } from "@/components/layout/Section";

import type {
  DecisionDeckFullPassport,
  DecisionDeckScoreDimension,
  DecisionDeckValue,
} from "../decision-deck-model";

function supported<T>(
  value: DecisionDeckValue<T>,
): value is Extract<DecisionDeckValue<T>, { state: "supported" }> {
  return value.state === "supported";
}

export interface ProjectFullPassportProps {
  passport: DecisionDeckFullPassport;
}

/**
 * The detailed Passport is an interpretation layer, not a second copy of the
 * compact identity strip. It renders only when supported score/advisory
 * evidence exists and explains those additional dimensions.
 */
export function ProjectFullPassport({ passport }: ProjectFullPassportProps) {
  const hasDetailedEvidence = [
    passport.overallScore,
    passport.coreDimensions,
    passport.buyerProfile,
    passport.advisorySummary,
    passport.riskSummary,
  ].some((field) => field.state === "supported");

  if (!hasDetailedEvidence) return null;

  return (
    <Section
      id="passport"
      eyebrow="Full Forever Passport"
      title="Evidence interpretation"
      description="Detailed supported dimensions and their recorded interpretation."
      className="py-11 sm:py-16"
      data-decision-deck-section
      data-testid="full-passport"
    >
      <div className="rounded-[18px] border border-border/70 bg-card p-5 sm:p-7">
        {supported(passport.overallScore) ? (
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Supported overall score
            </p>
            <p className="mt-2 font-serif text-3xl text-foreground">
              {passport.overallScore.value}
            </p>
          </div>
        ) : null}

        {supported(passport.coreDimensions) ? (
          <div className="mt-5 border-t border-border/70 pt-5">
            <h3 className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-accent" aria-hidden="true" />
              Supported dimensions
            </h3>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              {passport.coreDimensions.value.map((dimension: DecisionDeckScoreDimension) => (
                <div key={dimension.id} className="rounded-xl border border-border/60 p-4">
                  <dt className="text-sm text-muted-foreground">{dimension.label}</dt>
                  <dd className="mt-1 font-serif text-2xl text-foreground">{dimension.value}</dd>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    Recorded dimension only; no certainty or methodology is inferred.
                  </p>
                </div>
              ))}
            </dl>
          </div>
        ) : null}

        {supported(passport.buyerProfile) ? (
          <div className="mt-5 border-t border-border/70 pt-5">
            <p className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
              <UserRound className="h-4 w-4 text-accent" aria-hidden="true" />
              Supported buyer profile
            </p>
            <p className="mt-2 text-sm leading-6 text-foreground">{passport.buyerProfile.value}</p>
          </div>
        ) : null}

        {supported(passport.advisorySummary) ? (
          <div className="mt-5 border-t border-border/70 pt-5">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Supported advisory summary
            </p>
            <p className="mt-2 text-sm leading-6 text-foreground">
              {passport.advisorySummary.value}
            </p>
          </div>
        ) : null}

        {supported(passport.riskSummary) ? (
          <div className="mt-5 border-t border-border/70 pt-5">
            <p className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
              <CircleAlert className="h-4 w-4 text-accent" aria-hidden="true" />
              Supported risk summary
            </p>
            <p className="mt-2 text-sm leading-6 text-foreground">{passport.riskSummary.value}</p>
          </div>
        ) : null}
      </div>
    </Section>
  );
}
