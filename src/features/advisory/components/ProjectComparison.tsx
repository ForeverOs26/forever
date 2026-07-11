import { NOT_AVAILABLE } from "../investment-intelligence";
import type {
  ComparisonRow,
  ComparisonSetDiff,
  DomainComparison,
  ProjectComparison,
} from "../project-comparison";

/**
 * ProjectComparison — the two-project comparison section for the Advisory
 * Workspace (RC2.6).
 *
 * Presentational only: it renders a pre-derived, evidence-only comparison view
 * model that COMPARES the already-derived Forever Passport and Project Summary
 * of two projects. It never fabricates a value, never renders a numeric score or
 * ranking, and shows anything unsupported by verified data as "Not available".
 * Every comparative statement it shows is grounded in the documented readiness
 * scale or in counts of present evidence signals / recorded gaps — data coverage
 * only, never quality.
 */
export interface ProjectComparisonProps {
  data: ProjectComparison;
  headingId?: string;
}

const muted = "text-[#9A958A]";

function ProjectValue({ value }: { value: string }) {
  const isMissing = value === NOT_AVAILABLE;
  return <span className={`text-sm ${isMissing ? muted : "text-[#17150F]"}`}>{value}</span>;
}

/** A per-domain field-level comparison table (Project A vs Project B). */
function DomainTable({
  title,
  domain,
  nameA,
  nameB,
}: {
  title: string;
  domain: DomainComparison;
  nameA: string;
  nameB: string;
}) {
  return (
    <div className="rounded-xl border border-[#EAE6DE] bg-[#F3EFE7] p-4">
      <h3 className={`text-xs uppercase tracking-wide ${muted}`}>{title}</h3>
      <dl className="mt-3 space-y-3">
        {domain.rows.map((row: ComparisonRow) => (
          <div key={row.key} className="grid grid-cols-1 gap-1 sm:grid-cols-[1fr_1fr_1fr]">
            <dt className={`text-xs uppercase tracking-wide ${muted}`}>
              {row.label}
              {row.status === "different" ? (
                <span className="ml-2 rounded-full border border-[#9C7B4C] px-2 py-0.5 text-[10px] text-[#9C7B4C]">
                  differs
                </span>
              ) : null}
            </dt>
            <dd>
              <span className={`sr-only`}>{nameA}: </span>
              <ProjectValue value={row.a} />
            </dd>
            <dd>
              <span className={`sr-only`}>{nameB}: </span>
              <ProjectValue value={row.b} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** A shared / only-A / only-B set comparison (strengths, considerations, …). */
function SetDiffColumns({
  diff,
  nameA,
  nameB,
  emptyLabel,
}: {
  diff: ComparisonSetDiff;
  nameA: string;
  nameB: string;
  emptyLabel: string;
}) {
  const column = (heading: string, items: string[]) => (
    <div>
      <p className={`text-xs uppercase tracking-wide ${muted}`}>{heading}</p>
      {items.length === 0 ? (
        <p className={`mt-1 text-sm ${muted}`}>{emptyLabel}</p>
      ) : (
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-[#17150F]">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
      {column("Shared", diff.shared)}
      {column(`Only ${nameA}`, diff.onlyA)}
      {column(`Only ${nameB}`, diff.onlyB)}
    </div>
  );
}

export function ProjectComparison({
  data,
  headingId = "advisory-project-comparison-heading",
}: ProjectComparisonProps) {
  const {
    comparedProjects,
    headline,
    passport,
    investment,
    rental,
    location,
    trust,
    strengths,
    considerations,
    buyerProfile,
    decisionReadiness,
    evidenceCompleteness,
  } = data;

  const nameA = comparedProjects.a.projectName || "Project A";
  const nameB = comparedProjects.b.projectName || "Project B";

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
          Project Comparison
        </h2>
        <p className={`mt-1 text-sm ${muted}`}>
          A descriptive, evidence-only comparison of two projects using already-verified data. No
          new scores or rankings are calculated; missing evidence is shown as &ldquo;Not
          available&rdquo;.
        </p>
      </header>

      {/* 1. Compared projects */}
      <div className="rounded-xl border border-[#EAE6DE] bg-[#F3EFE7] p-4">
        <h3 className={`text-xs uppercase tracking-wide ${muted}`}>Compared projects</h3>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[comparedProjects.a, comparedProjects.b].map((identity, index) => (
            <div key={identity.projectSlug || index}>
              <p className="text-sm font-semibold text-[#17150F]">
                {index === 0 ? "Project A" : "Project B"}: {identity.projectName || NOT_AVAILABLE}
              </p>
              <dl className="mt-2 space-y-1">
                {[
                  ["Type", identity.propertyType],
                  ["Location", identity.location],
                  ["Developer", identity.developerName],
                  ["Construction", identity.constructionStatus],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className={`text-xs uppercase tracking-wide ${muted}`}>{label}</dt>
                    <dd className="text-right">
                      <ProjectValue value={value} />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
        <p className={`mt-3 text-xs ${muted}`}>{comparedProjects.note}</p>
      </div>

      {/* Descriptive headline */}
      <div className="mt-5">
        <h3 className={`text-xs uppercase tracking-wide ${muted}`}>At a glance</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[#17150F]">
          {headline.statements.map((statement) => (
            <li key={statement}>{statement}</li>
          ))}
        </ul>
      </div>

      {/* 3-6. Domain comparisons */}
      <div className="mt-5 grid grid-cols-1 gap-4">
        <DomainTable title="Trust" domain={trust} nameA={nameA} nameB={nameB} />
        <DomainTable title="Investment" domain={investment} nameA={nameA} nameB={nameB} />
        <DomainTable title="Rental" domain={rental} nameA={nameA} nameB={nameB} />
        <DomainTable title="Location" domain={location} nameA={nameA} nameB={nameB} />
      </div>

      {/* 7. Strengths comparison */}
      <div className="mt-5">
        <h3 className={`text-xs uppercase tracking-wide ${muted}`}>Strength comparison</h3>
        <SetDiffColumns diff={strengths} nameA={nameA} nameB={nameB} emptyLabel="None on record." />
      </div>

      {/* 8. Consideration comparison */}
      <div className="mt-5">
        <h3 className={`text-xs uppercase tracking-wide ${muted}`}>Consideration comparison</h3>
        <SetDiffColumns
          diff={considerations}
          nameA={nameA}
          nameB={nameB}
          emptyLabel="None on record."
        />
      </div>

      {/* 9. Buyer profile comparison */}
      <div className="mt-5">
        <h3 className={`text-xs uppercase tracking-wide ${muted}`}>Buyer profile comparison</h3>
        {buyerProfile.availability.a || buyerProfile.availability.b ? (
          <SetDiffColumns
            diff={buyerProfile.diff}
            nameA={nameA}
            nameB={nameB}
            emptyLabel={NOT_AVAILABLE}
          />
        ) : (
          <p className={`mt-1 text-sm ${muted}`}>{NOT_AVAILABLE}</p>
        )}
        <p className={`mt-2 text-xs ${muted}`}>{buyerProfile.basis}</p>
      </div>

      {/* 10. Decision readiness comparison */}
      <div className="mt-5 rounded-xl border border-[#EAE6DE] bg-[#F3EFE7] p-4">
        <h3 className={`text-xs uppercase tracking-wide ${muted}`}>
          Decision readiness comparison
        </h3>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <p className={`text-xs uppercase tracking-wide ${muted}`}>{nameA}</p>
            <p className="text-sm font-semibold text-[#17150F]">{decisionReadiness.a}</p>
          </div>
          <div>
            <p className={`text-xs uppercase tracking-wide ${muted}`}>{nameB}</p>
            <p className="text-sm font-semibold text-[#17150F]">{decisionReadiness.b}</p>
          </div>
        </div>
        <p className={`mt-2 text-sm ${muted}`}>{decisionReadiness.note}</p>
      </div>

      {/* 11. Evidence completeness comparison */}
      <div className="mt-5 border-t border-[#EAE6DE] pt-4">
        <h3 className={`text-xs uppercase tracking-wide ${muted}`}>
          Evidence completeness comparison
        </h3>
        <dl className="mt-3 space-y-2">
          {evidenceCompleteness.byFoundation.map((row) => (
            <div key={row.key} className="grid grid-cols-1 gap-1 sm:grid-cols-[1fr_1fr_1fr]">
              <dt className={`text-xs uppercase tracking-wide ${muted}`}>{row.label}</dt>
              <dd className="text-sm text-[#17150F]">
                <span className="sr-only">{nameA}: </span>
                {row.aPresent} of {row.total} signals
              </dd>
              <dd className="text-sm text-[#17150F]">
                <span className="sr-only">{nameB}: </span>
                {row.bPresent} of {row.total} signals
              </dd>
            </div>
          ))}
        </dl>
        <p className={`mt-2 text-xs ${muted}`}>{evidenceCompleteness.note}</p>
      </div>

      {/* Combined passport data gaps */}
      <div className="mt-5">
        <h3 className={`text-xs uppercase tracking-wide ${muted}`}>Data gap comparison</h3>
        <SetDiffColumns
          diff={passport.gaps}
          nameA={nameA}
          nameB={nameB}
          emptyLabel="No gaps on record."
        />
      </div>
    </section>
  );
}
