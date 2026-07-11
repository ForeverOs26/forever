import type { AdvisoryWorkspaceProps } from "./types";
import { ADVISORY_ACTIONS } from "./mock";
import {
  AdvisorStrategy,
  ClientSnapshot,
  ForeverPassport,
  InvestmentIntelligence,
  LocationIntelligence,
  NextAction,
  RecommendedProjects,
  RentalIntelligence,
  RiskPanel,
} from "./components";

/**
 * AdvisoryWorkspace — the root, controlled module.
 *
 * Composes the five sections in the order an advisor reads them when preparing
 * for a consultation. Fully presentational: no data fetching, no side effects,
 * no state beyond what the host supplies via props. Mobile-first single column
 * that expands responsively on larger viewports.
 */
export function AdvisoryWorkspace({
  session,
  passport,
  investmentIntelligence,
  rentalIntelligence,
  locationIntelligence,
  actions = [...ADVISORY_ACTIONS],
  onAction,
  title = "Advisory Workspace",
  className = "",
}: AdvisoryWorkspaceProps) {
  return (
    <div
      className={`mx-auto flex w-full max-w-5xl flex-col gap-6 bg-[#F3EFE7] p-4 text-[#17150F] sm:p-6 ${className}`}
      style={{ fontFamily: '"Hanken Grotesk", system-ui, sans-serif' }}
    >
      <header>
        <h1
          className="font-serif text-2xl text-[#17150F] sm:text-3xl"
          style={{ fontFamily: '"Newsreader", Georgia, serif' }}
        >
          {title}
        </h1>
        <p className="mt-1 text-sm text-[#9A958A]">Prepare for the consultation at a glance.</p>
      </header>

      {passport ? <ForeverPassport data={passport} /> : null}

      <ClientSnapshot data={session.client} />

      <RecommendedProjects projects={session.recommendations} />

      <AdvisorStrategy data={session.strategy} projects={session.recommendations} />

      <RiskPanel risks={session.risks} />

      {investmentIntelligence ? <InvestmentIntelligence data={investmentIntelligence} /> : null}

      {rentalIntelligence ? <RentalIntelligence data={rentalIntelligence} /> : null}

      {locationIntelligence ? <LocationIntelligence data={locationIntelligence} /> : null}

      <NextAction actions={actions} onAction={onAction} />
    </div>
  );
}
