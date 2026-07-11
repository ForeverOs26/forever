import { NOT_AVAILABLE } from "../investment-intelligence";
import type {
  ProjectRecommendationEntry,
  ProjectRecommendations,
} from "../project-recommendations";

/**
 * ProjectRecommendations — the evidence-only recommendation section for the
 * Advisory Workspace (RC2.7).
 *
 * Presentational only: it renders a pre-derived, evidence-only recommendation
 * view model that RANKS projects using the already-derived Forever Passport,
 * Project Summary and (for the top two) Project Comparison. It never fabricates a
 * value, never renders a numeric match score or rating, and shows anything
 * unsupported by verified data as "Not available". Every ordering statement it
 * shows is grounded in the documented advisory readiness scale and in counts of
 * present evidence signals / recorded gaps — data coverage only, never quality.
 */
export interface ProjectRecommendationsProps {
  data: ProjectRecommendations;
  headingId?: string;
}

const muted = "text-[#9A958A]";

/** Left-border weight communicates rank position without introducing colour. */
function rankBorder(rank: number): string {
  if (rank === 1) return "border-l-4 border-l-[#9C7B4C]";
  if (rank === 2) return "border-l-2 border-l-[#9C7B4C]";
  return "border-l-2 border-l-[#EAE6DE]";
}

function IdentityRow({ label, value }: { label: string; value: string }) {
  const isMissing = !value || value === NOT_AVAILABLE;
  return (
    <div className="flex justify-between gap-3">
      <dt className={`text-xs uppercase tracking-wide ${muted}`}>{label}</dt>
      <dd className={`text-right text-sm ${isMissing ? muted : "text-[#17150F]"}`}>
        {isMissing ? NOT_AVAILABLE : value}
      </dd>
    </div>
  );
}

function EntryList({
  heading,
  items,
  emptyLabel,
}: {
  heading: string;
  items: string[];
  emptyLabel: string;
}) {
  return (
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
}

function RecommendationCard({ entry }: { entry: ProjectRecommendationEntry }) {
  const name = entry.identity.projectName || NOT_AVAILABLE;
  return (
    <li className={`rounded-2xl border border-[#EAE6DE] bg-white p-5 ${rankBorder(entry.rank)}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h3
          className="font-serif text-base text-[#17150F] sm:text-lg"
          style={{ fontFamily: '"Newsreader", Georgia, serif' }}
        >
          {name}
        </h3>
        <span
          className="shrink-0 text-xs uppercase tracking-wide text-[#9C7B4C]"
          aria-label={`Recommendation position ${entry.rank}`}
        >
          Rank {entry.rank}
        </span>
      </div>

      <p className={`mt-1 text-sm ${muted}`}>{entry.readinessVerdict}</p>

      <dl className="mt-3 space-y-1">
        <IdentityRow label="Type" value={entry.identity.propertyType} />
        <IdentityRow label="Location" value={entry.identity.location} />
        <IdentityRow label="Developer" value={entry.identity.developerName} />
        <IdentityRow label="Construction" value={entry.identity.constructionStatus} />
      </dl>

      <div className="mt-3 rounded-xl border border-[#EAE6DE] bg-[#F3EFE7] p-3">
        <p className={`text-xs uppercase tracking-wide ${muted}`}>Evidence coverage</p>
        <p className="mt-1 text-sm text-[#17150F]">
          {entry.coverage.signalsPresent} of {entry.coverage.signalsTotal} verified evidence signals
          present · {entry.coverage.foundationsReady} of {entry.coverage.foundationsTotal}{" "}
          foundations ready · {entry.coverage.recordedGaps} recorded data gaps
        </p>
      </div>

      <p className={`mt-3 text-xs ${muted}`}>{entry.rationale}</p>

      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <EntryList
          heading="Strengths"
          items={entry.strengths}
          emptyLabel="No evidence-backed strengths identified."
        />
        <EntryList
          heading="Considerations"
          items={entry.considerations}
          emptyLabel="No material considerations identified."
        />
      </div>

      <div className="mt-3">
        <p className={`text-xs uppercase tracking-wide ${muted}`}>Suitable buyer profile</p>
        {entry.suitability.available ? (
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-[#17150F]">
            {entry.suitability.statements.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className={`mt-1 text-sm ${muted}`}>{NOT_AVAILABLE}</p>
        )}
      </div>
    </li>
  );
}

export function ProjectRecommendations({
  data,
  headingId = "advisory-project-recommendations-heading",
}: ProjectRecommendationsProps) {
  const { entries, topRecommendation, headline, comparison, basis } = data;

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
          Project Recommendations
        </h2>
        <p className={`mt-1 text-sm ${muted}`}>
          An evidence-only ranking of projects using already-verified data. No new scores or match
          ratings are calculated; missing evidence is shown as &ldquo;Not available&rdquo;.
        </p>
      </header>

      {entries.length === 0 ? (
        <p className={`text-sm ${muted}`}>{NOT_AVAILABLE}</p>
      ) : (
        <>
          {/* Leading candidate */}
          {topRecommendation ? (
            <div className="rounded-xl border border-[#EAE6DE] bg-[#F3EFE7] p-4">
              <h3 className={`text-xs uppercase tracking-wide ${muted}`}>Leading candidate</h3>
              <p className="mt-1 text-base font-semibold text-[#17150F]">
                {topRecommendation.projectName || NOT_AVAILABLE}
              </p>
              <p className={`mt-1 text-sm ${muted}`}>{topRecommendation.note}</p>
            </div>
          ) : null}

          {/* Descriptive headline */}
          <div className="mt-5">
            <h3 className={`text-xs uppercase tracking-wide ${muted}`}>At a glance</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[#17150F]">
              {headline.statements.map((statement) => (
                <li key={statement}>{statement}</li>
              ))}
            </ul>
          </div>

          {/* Ranked entries */}
          <ol className="mt-5 grid grid-cols-1 gap-4">
            {entries.map((entry) => (
              <RecommendationCard key={entry.identity.projectSlug || entry.rank} entry={entry} />
            ))}
          </ol>

          {/* Head-to-head of the top two (reuses the Project Comparison output) */}
          {comparison ? (
            <div className="mt-5 border-t border-[#EAE6DE] pt-4">
              <h3 className={`text-xs uppercase tracking-wide ${muted}`}>Top two head-to-head</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[#17150F]">
                {comparison.headline.statements.map((statement) => (
                  <li key={statement}>{statement}</li>
                ))}
              </ul>
              <p className={`mt-2 text-xs ${muted}`}>{comparison.decisionReadiness.note}</p>
            </div>
          ) : null}

          <p className={`mt-5 border-t border-[#EAE6DE] pt-4 text-xs ${muted}`}>{basis}</p>
        </>
      )}
    </section>
  );
}
