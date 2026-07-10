import type { AdvisorStrategyData, RecommendedProject } from "../types";

/**
 * AdvisorStrategy — private, advisor-only guidance. Clearly marked as private
 * so it is never mistaken for client-facing content.
 */
export interface AdvisorStrategyProps {
  data: AdvisorStrategyData;
  /** Used to resolve `showFirstProjectId` to a readable project name. */
  projects: RecommendedProject[];
  headingId?: string;
}

interface GuidanceRowProps {
  label: string;
  children: React.ReactNode;
}

function GuidanceRow({ label, children }: GuidanceRowProps) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs uppercase tracking-wide text-[#9A958A]">{label}</dt>
      <dd className="text-sm text-[#17150F]">{children}</dd>
    </div>
  );
}

export function AdvisorStrategy({
  data,
  projects,
  headingId = "advisory-strategy-heading",
}: AdvisorStrategyProps) {
  const showFirst = projects.find((p) => p.id === data.showFirstProjectId);
  const showFirstName = showFirst ? showFirst.name : data.showFirstProjectId;

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-2xl border border-[#EAE6DE] bg-[#F3EFE7] p-5 sm:p-6"
    >
      <header className="mb-4">
        <h2
          id={headingId}
          className="font-serif text-lg text-[#17150F] sm:text-xl"
          style={{ fontFamily: '"Newsreader", Georgia, serif' }}
        >
          Advisor Strategy
        </h2>
        <p className="mt-1 text-xs uppercase tracking-wide text-[#9C7B4C]">
          Private — advisor only
        </p>
      </header>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <GuidanceRow label="Discuss first">{data.discussFirst ?? "Not available"}</GuidanceRow>
        <GuidanceRow label="Don't lead with">{data.avoidLeadingWith ?? "Not available"}</GuidanceRow>
        <GuidanceRow label="Show first">{showFirstName}</GuidanceRow>
        <GuidanceRow label="Must clarify">{data.mustClarify ?? "Not available"}</GuidanceRow>
      </dl>

      <div className="mt-5">
        <h3 className="mb-2 text-xs uppercase tracking-wide text-[#9A958A]">
          Suggested consultation sequence
        </h3>
        {data.consultationSequence.length === 0 ? (
          <p className="text-sm text-[#9A958A]">Not available</p>
        ) : <ol className="flex flex-col gap-2">
          {data.consultationSequence.map((step, index) => (
            <li key={step} className="flex gap-3 text-sm text-[#17150F]">
              <span
                aria-hidden="true"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#9C7B4C] text-xs text-[#9C7B4C]"
              >
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>}
      </div>
    </section>
  );
}
