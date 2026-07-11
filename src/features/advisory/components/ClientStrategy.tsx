import { NOT_AVAILABLE } from "../investment-intelligence";
import type {
  ClientStrategy,
  ClientStrategySection,
  ClientStrategySectionKey,
} from "../client-strategy";

/**
 * ClientStrategy — the evidence-only Forever Client Strategy section for the
 * Advisory Workspace (RC2.9).
 *
 * Presentational only: it renders a pre-derived Client Strategy view model that
 * COMPOSES the already-derived Forever Passport, Project Summary and the three
 * Intelligence foundations (and, when present, Project Comparison / Project
 * Recommendations). It never fabricates a value, never calculates a new score,
 * verdict, ranking or financial metric, never renders the hidden numeric trust
 * score, and shows anything unsupported by verified data as "Not available".
 * Every substantive line is reused verbatim from the derived output.
 */
export interface ClientStrategyProps {
  data: ClientStrategy;
  headingId?: string;
}

const muted = "text-[#9A958A]";
const serif = { fontFamily: '"Newsreader", Georgia, serif' } as const;

/** Per-section heading for the reused-verbatim considerations list. */
const CONSIDERATIONS_HEADING: Record<ClientStrategySectionKey, string> = {
  investment: "Data gaps",
  purchase: "Data gaps",
  rental: "Data gaps",
  exit: "Data gaps",
  risk: "Considerations",
  "action-plan": "Evidence to obtain",
};

function isMissing(value: string): boolean {
  return !value || value === NOT_AVAILABLE;
}

function PointRow({ label, value }: { label: string; value: string }) {
  const missing = isMissing(value);
  return (
    <div className="flex justify-between gap-3 border-b border-[#F0ECE3] py-1.5 last:border-b-0">
      <dt className={`text-xs uppercase tracking-wide ${muted}`}>{label}</dt>
      <dd className={`text-right text-sm ${missing ? muted : "text-[#17150F]"}`}>
        {missing ? NOT_AVAILABLE : value}
      </dd>
    </div>
  );
}

function StrategyCard({ section }: { section: ClientStrategySection }) {
  const headingId = `advisory-client-strategy-${section.key}-heading`;
  const considerationsHeading = CONSIDERATIONS_HEADING[section.key];

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-2xl border border-[#EAE6DE] bg-white p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={headingId} className="font-serif text-base text-[#17150F] sm:text-lg" style={serif}>
          {section.title}
        </h3>
        {section.readinessVerdict ? (
          <span className="shrink-0 text-xs uppercase tracking-wide text-[#9C7B4C]">
            {section.readinessVerdict}
          </span>
        ) : null}
      </div>

      <p className={`mt-1 text-sm ${muted}`}>{section.summary}</p>

      {section.available ? (
        <>
          {section.points.length > 0 ? (
            <dl className="mt-3">
              {section.points.map((point) => (
                <PointRow key={point.label} label={point.label} value={point.value} />
              ))}
            </dl>
          ) : null}

          {section.considerations.length > 0 ? (
            <div className="mt-3">
              <p className={`text-xs uppercase tracking-wide ${muted}`}>{considerationsHeading}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-[#17150F]">
                {section.considerations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <p className={`mt-3 text-sm ${muted}`}>{NOT_AVAILABLE}</p>
      )}
    </section>
  );
}

export function ClientStrategy({
  data,
  headingId = "advisory-client-strategy-heading",
}: ClientStrategyProps) {
  const { investment, purchase, rental, exit, risk, actionPlan, basis } = data;
  const ordered: ClientStrategySection[] = [investment, purchase, rental, exit, risk, actionPlan];

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-2xl border border-[#EAE6DE] bg-white p-5 sm:p-6"
    >
      <header className="mb-4">
        <h2 id={headingId} className="font-serif text-lg text-[#17150F] sm:text-xl" style={serif}>
          Client Strategy
        </h2>
        <p className={`mt-1 text-sm ${muted}`}>
          An evidence-only strategy composed from already-derived Forever Advisory conclusions. No
          new scores, verdicts or financial figures are produced; missing evidence is shown as
          &ldquo;Not available&rdquo;.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4">
        {ordered.map((section) => (
          <StrategyCard key={section.key} section={section} />
        ))}
      </div>

      <p className={`mt-5 border-t border-[#EAE6DE] pt-4 text-xs ${muted}`}>{basis}</p>
    </section>
  );
}
