import { useCallback } from "react";

import { NOT_AVAILABLE } from "../investment-intelligence";
import type { AdvisorReport } from "../advisor-report";
import { InvestmentIntelligence } from "./InvestmentIntelligence";
import { RentalIntelligence } from "./RentalIntelligence";
import { LocationIntelligence } from "./LocationIntelligence";
import { ProjectComparison } from "./ProjectComparison";
import { ProjectRecommendations } from "./ProjectRecommendations";

/**
 * AdvisorReport — the print-ready, client-facing advisory report (RC2.8).
 *
 * Presentational only. It renders a pre-derived `AdvisorReport` view model that
 * COMPOSES the already-derived Forever Passport, Project Summary, the three
 * Intelligence foundations and — when present — the Project Comparison and
 * Project Recommendations. It never fabricates a value, never renders the hidden
 * numeric trust score, and shows anything unsupported by verified data as "Not
 * available". Every substantive line is reused verbatim from the derived output.
 *
 * Printing uses the browser's own print flow (`window.print()`), so no heavy PDF
 * dependency is introduced. Interactive controls are marked no-print, and the
 * print stylesheet keeps major sections from splitting across pages where it can.
 */
export interface AdvisorReportProps {
  data: AdvisorReport;
  /** Optional callback fired when the print action is triggered (defaults to `window.print`). */
  onPrint?: () => void;
  className?: string;
}

const muted = "text-[#9A958A]";
const serif = { fontFamily: '"Newsreader", Georgia, serif' } as const;

/** Print rules kept local to the report so they never affect the rest of the app. */
const PRINT_STYLES = `
@media print {
  @page { size: A4; margin: 16mm; }
  html, body { background: #ffffff !important; }
  .advisor-report__noprint { display: none !important; }
  .advisor-report { background: #ffffff !important; padding: 0 !important; }
  .advisor-report__section { break-inside: avoid; page-break-inside: avoid; }
  .advisor-report__pagebreak { break-before: page; page-break-before: always; }
}
`;

function isMissing(value: string): boolean {
  return !value || value === NOT_AVAILABLE;
}

function EvidenceValue({ value }: { value: string }) {
  return (
    <span className={`text-sm ${isMissing(value) ? muted : "text-[#17150F]"}`}>
      {isMissing(value) ? NOT_AVAILABLE : value}
    </span>
  );
}

/** A titled report block. Marked so print keeps it whole where reasonably possible. */
function Section({
  id,
  title,
  eyebrow,
  children,
}: {
  id: string;
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section
      aria-labelledby={headingId}
      className="advisor-report__section rounded-2xl border border-[#EAE6DE] bg-white p-5 sm:p-6"
    >
      <header className="mb-4">
        {eyebrow ? (
          <p className={`text-xs uppercase tracking-[0.18em] ${muted}`}>{eyebrow}</p>
        ) : null}
        <h2 id={headingId} className="font-serif text-lg text-[#17150F] sm:text-xl" style={serif}>
          {title}
        </h2>
      </header>
      {children}
    </section>
  );
}

function BulletList({ items, emptyLabel }: { items: string[]; emptyLabel: string }) {
  if (items.length === 0) {
    return <p className={`text-sm ${muted}`}>{emptyLabel}</p>;
  }
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-[#17150F]">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function DefRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-[#F0ECE3] py-1.5 last:border-b-0">
      <dt className={`text-xs uppercase tracking-wide ${muted}`}>{label}</dt>
      <dd className="text-right">
        <EvidenceValue value={value} />
      </dd>
    </div>
  );
}

export function AdvisorReport({ data, onPrint, className = "" }: AdvisorReportProps) {
  const handlePrint = useCallback(() => {
    if (onPrint) {
      onPrint();
      return;
    }
    if (typeof window !== "undefined" && typeof window.print === "function") {
      window.print();
    }
  }, [onPrint]);

  const {
    cover,
    executiveOverview,
    identity,
    strengths,
    considerations,
    buyerProfile,
    investment,
    rental,
    location,
    trust,
    comparison,
    recommendations,
    dataLimitations,
    disclaimer,
  } = data;

  return (
    <div className={`advisor-report bg-[#F3EFE7] px-4 py-8 text-[#17150F] ${className}`}>
      {/* Static, hard-coded print rules only — no user input is interpolated. */}
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />

      {/* Interactive toolbar — hidden when printing. */}
      <div className="advisor-report__noprint mx-auto mb-6 flex max-w-[820px] items-center justify-between gap-4">
        <p className={`text-xs uppercase tracking-[0.18em] ${muted}`}>Advisor Report</p>
        <button
          type="button"
          onClick={handlePrint}
          className="rounded-full border border-[#9C7B4C] bg-[#9C7B4C] px-5 py-2 text-sm font-medium text-white transition hover:bg-[#876a41]"
        >
          Print / Save as PDF
        </button>
      </div>

      <article className="mx-auto flex max-w-[820px] flex-col gap-6">
        {/* 1. Cover */}
        <section
          aria-labelledby="advisor-report-cover-heading"
          className="advisor-report__section rounded-2xl border border-[#EAE6DE] bg-white p-8 text-center sm:p-10"
        >
          <p className="text-sm uppercase tracking-[0.32em] text-[#9C7B4C]">{cover.brand}</p>
          <h1
            id="advisor-report-cover-heading"
            className="mt-4 font-serif text-3xl text-[#17150F] sm:text-4xl"
            style={serif}
          >
            {cover.reportTitle}
          </h1>
          <p className="mt-3 text-lg text-[#17150F]">{cover.projectName || NOT_AVAILABLE}</p>
          {cover.reportDate ? (
            <p className={`mt-2 text-sm ${muted}`}>Report date: {cover.reportDate}</p>
          ) : null}
          <p className={`mx-auto mt-6 max-w-[60ch] text-xs leading-relaxed ${muted}`}>
            {cover.disclaimer}
          </p>
        </section>

        {/* 2. Executive decision overview */}
        <Section id="advisor-report-executive" eyebrow="01" title="Executive Decision Overview">
          <p className="text-sm text-[#17150F]">{executiveOverview.overviewHeadline}</p>
          <div className="mt-4 rounded-xl border border-[#EAE6DE] bg-[#F3EFE7] p-4">
            <p className={`text-xs uppercase tracking-wide ${muted}`}>Advisory readiness</p>
            <p className="mt-1 text-base font-semibold text-[#17150F]">
              {executiveOverview.readinessVerdict}
            </p>
            <p className={`mt-1 text-sm ${muted}`}>{executiveOverview.readinessRationale}</p>
          </div>
          <p className="mt-3 text-sm text-[#17150F]">{executiveOverview.readinessStatement}</p>
          {executiveOverview.signals.length > 0 ? (
            <dl className="mt-4">
              {executiveOverview.signals.map((signal) => (
                <DefRow key={signal.key} label={signal.label} value={signal.value} />
              ))}
            </dl>
          ) : null}
        </Section>

        {/* 3. Project identity and verified facts */}
        <Section
          id="advisor-report-identity"
          eyebrow="02"
          title="Project Identity & Verified Facts"
        >
          <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <DefRow label="Project" value={identity.identity.projectName} />
            <DefRow label="Property type" value={identity.identity.propertyType} />
            <DefRow label="Location" value={identity.identity.location} />
            <DefRow label="Ownership" value={identity.identity.ownershipType} />
            <DefRow label="Construction" value={identity.identity.constructionStatus} />
            <DefRow label="Developer" value={identity.identity.developerName} />
          </dl>
          {identity.keyFacts.length > 0 ? (
            <dl className="mt-4 border-t border-[#EAE6DE] pt-4">
              {identity.keyFacts.map((fact) => (
                <DefRow key={fact.label} label={fact.label} value={fact.value} />
              ))}
            </dl>
          ) : (
            <p className={`mt-4 text-sm ${muted}`}>No additional verified facts on record.</p>
          )}
        </Section>

        {/* 4. Principal strengths */}
        <Section id="advisor-report-strengths" eyebrow="03" title="Principal Strengths">
          <BulletList items={strengths} emptyLabel="No evidence-backed strengths identified." />
        </Section>

        {/* 5. Principal considerations */}
        <Section id="advisor-report-considerations" eyebrow="04" title="Principal Considerations">
          <BulletList items={considerations} emptyLabel="No material considerations identified." />
        </Section>

        {/* 6. Suitable buyer profile */}
        <Section id="advisor-report-buyer" eyebrow="05" title="Suitable Buyer Profile">
          {buyerProfile.available ? (
            <BulletList items={buyerProfile.statements} emptyLabel={NOT_AVAILABLE} />
          ) : (
            <p className={`text-sm ${muted}`}>{buyerProfile.unavailableLabel}</p>
          )}
          <p className={`mt-3 text-xs ${muted}`}>{buyerProfile.basis}</p>
        </Section>

        {/* 7-9. Intelligence foundations (reused section components) */}
        <div className="advisor-report__section">
          <InvestmentIntelligence data={investment} />
        </div>
        <div className="advisor-report__section">
          <RentalIntelligence data={rental} />
        </div>
        <div className="advisor-report__section">
          <LocationIntelligence data={location} />
        </div>

        {/* 10. Trust and evidence readiness (no numeric trust score) */}
        <Section id="advisor-report-trust" eyebrow="06" title="Trust & Evidence Readiness">
          <div className="rounded-xl border border-[#EAE6DE] bg-[#F3EFE7] p-4">
            <p className={`text-xs uppercase tracking-wide ${muted}`}>Trust readiness</p>
            <p className="mt-1 text-base font-semibold text-[#17150F]">{trust.readinessVerdict}</p>
            <p className={`mt-1 text-sm ${muted}`}>{trust.verdictRationale}</p>
          </div>
          <dl className="mt-4">
            <DefRow label="Verification" value={trust.verificationStatus} />
            <DefRow label="Forever verdict" value={trust.verdict} />
            <DefRow label="Market position" value={trust.marketPosition} />
            <DefRow label="Last inspection" value={trust.lastInspection} />
            <DefRow label="Trust note" value={trust.trustNote} />
          </dl>
          {trust.keyDataGaps.length > 0 ? (
            <div className="mt-4">
              <p className={`text-xs uppercase tracking-wide ${muted}`}>Trust data gaps</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-[#17150F]">
                {trust.keyDataGaps.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </Section>

        {/* 11. Project Comparison — only when a comparison exists. */}
        {comparison ? (
          <div className="advisor-report__section">
            <ProjectComparison data={comparison} />
          </div>
        ) : null}

        {/* 12. Project Recommendations — only when recommendations exist. */}
        {recommendations ? (
          <div className="advisor-report__section">
            <ProjectRecommendations data={recommendations} />
          </div>
        ) : null}

        {/* 13. Data limitations */}
        <Section id="advisor-report-limitations" eyebrow="07" title="Data Limitations">
          <BulletList items={dataLimitations} emptyLabel="No outstanding data gaps recorded." />
        </Section>

        {/* 14. Advisory disclaimer */}
        <Section id="advisor-report-disclaimer" eyebrow="08" title="Advisory Disclaimer">
          <ul className="list-disc space-y-1 pl-5 text-sm text-[#17150F]">
            {disclaimer.statements.map((statement) => (
              <li key={statement}>{statement}</li>
            ))}
          </ul>
        </Section>
      </article>
    </div>
  );
}
