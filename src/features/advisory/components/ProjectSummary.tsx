import { NOT_AVAILABLE } from "../investment-intelligence";
import type { ProjectSummary, ProjectSummaryReadiness } from "../project-summary";

/**
 * ProjectSummary — the executive-summary section for the Advisory Workspace.
 *
 * Presentational only: it renders a pre-derived, evidence-only Project Summary
 * view model that SUMMARISES the Forever Passport and the Trust, Investment,
 * Rental and Location Intelligence foundations. It never fabricates a value,
 * never renders a numeric score, and shows anything unsupported by verified data
 * as "Not available". The readiness verdict it displays is the Passport's own
 * verdict — reused in the derivation layer, not recomputed here.
 */
export interface ProjectSummaryProps {
  data: ProjectSummary;
  headingId?: string;
}

const VERDICT_BORDER: Record<ProjectSummaryReadiness["verdict"], string> = {
  "Insufficient verified data": "border-l-2 border-l-[#EAE6DE]",
  "More evidence required": "border-l-2 border-l-[#9C7B4C]",
  "Ready for preliminary review": "border-l-4 border-l-[#9C7B4C]",
};

const muted = "text-[#9A958A]";

function EvidenceValue({ value }: { value: string }) {
  const isMissing = value === NOT_AVAILABLE;
  return <span className={`text-sm ${isMissing ? muted : "text-[#17150F]"}`}>{value}</span>;
}

function Chips({ items }: { items: string[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {items.map((item) => (
        <li
          key={item}
          className="rounded-full border border-[#EAE6DE] bg-[#F3EFE7] px-3 py-1 text-xs text-[#17150F]"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

export function ProjectSummary({
  data,
  headingId = "advisory-project-summary-heading",
}: ProjectSummaryProps) {
  const {
    overview,
    keyFacts,
    strengths,
    considerations,
    buyerProfile,
    decisionReadiness,
    dataLimitations,
  } = data;

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-2xl border border-[#EAE6DE] bg-white p-5 sm:p-6"
    >
      <header className="mb-4">
        <h2
          id={headingId}
          className="font-serif text-lg text-[#17150F] sm:text-xl"
          style={{ fontFamily: '"Newsreader", Georgia, serif' }}
        >
          Project Summary
        </h2>
        <p className={`mt-1 text-sm ${muted}`}>
          A concise, evidence-only summary of the recorded project data and the derived Advisory
          intelligence. No new scores are calculated; missing evidence is shown as &ldquo;Not
          available&rdquo;.
        </p>
      </header>

      {/* 1. Executive overview */}
      <div className="rounded-xl border border-[#EAE6DE] bg-[#F3EFE7] p-4">
        <h3 className={`text-xs uppercase tracking-wide ${muted}`}>Executive overview</h3>
        <p className="mt-2 text-sm text-[#17150F]">{overview.headline}</p>
        <p className={`mt-1 text-sm ${muted}`}>{overview.readinessStatement}</p>
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {overview.signals.map((signal) => (
            <div key={signal.key} className="flex flex-col gap-1">
              <dt className={`text-xs uppercase tracking-wide ${muted}`}>{signal.label}</dt>
              <dd>
                <EvidenceValue value={signal.value} />
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* 2. Key project facts */}
      <div className="mt-5">
        <h3 className={`text-xs uppercase tracking-wide ${muted}`}>Key project facts</h3>
        {keyFacts.length === 0 ? (
          <p className={`mt-1 text-sm ${muted}`}>{NOT_AVAILABLE}</p>
        ) : (
          <dl className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {keyFacts.map((fact) => (
              <div key={fact.label} className="flex flex-col gap-1">
                <dt className={`text-xs uppercase tracking-wide ${muted}`}>{fact.label}</dt>
                <dd className="text-sm text-[#17150F]">{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {/* 3 & 4. Principal strengths / considerations */}
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-[#EAE6DE] bg-[#F3EFE7] p-4">
          <h3 className={`text-xs uppercase tracking-wide ${muted}`}>Principal strengths</h3>
          {strengths.length === 0 ? (
            <p className={`mt-1 text-sm ${muted}`}>No evidence-backed strengths identified.</p>
          ) : (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[#17150F]">
              {strengths.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border border-[#EAE6DE] bg-[#F3EFE7] p-4">
          <h3 className={`text-xs uppercase tracking-wide ${muted}`}>Principal considerations</h3>
          {considerations.length === 0 ? (
            <p className={`mt-1 text-sm ${muted}`}>No material considerations identified.</p>
          ) : (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[#17150F]">
              {considerations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 5. Suitable buyer profile */}
      <div className="mt-5">
        <h3 className={`text-xs uppercase tracking-wide ${muted}`}>Suitable buyer profile</h3>
        {buyerProfile.available ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[#17150F]">
            {buyerProfile.statements.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className={`mt-1 text-sm ${muted}`}>{buyerProfile.unavailableLabel}</p>
        )}
        <p className={`mt-2 text-xs ${muted}`}>{buyerProfile.basis}</p>
      </div>

      {/* 6. Decision readiness (reuses the Passport verdict) */}
      <div
        className={`mt-5 rounded-xl border border-[#EAE6DE] bg-[#F3EFE7] p-4 ${VERDICT_BORDER[decisionReadiness.verdict]}`}
      >
        <p className={`text-xs uppercase tracking-wide ${muted}`}>Decision readiness</p>
        <p className="mt-1 text-base font-semibold text-[#17150F]">{decisionReadiness.verdict}</p>
        <p className={`mt-1 text-sm ${muted}`}>{decisionReadiness.explanation}</p>
      </div>

      {/* 7. Data limitations */}
      <div className="mt-5 border-t border-[#EAE6DE] pt-4">
        <h3 className={`text-xs uppercase tracking-wide ${muted}`}>Data limitations</h3>
        {dataLimitations.length === 0 ? (
          <p className="mt-1 text-sm text-[#17150F]">No critical gaps identified.</p>
        ) : (
          <Chips items={dataLimitations} />
        )}
      </div>
    </section>
  );
}
