import type { ConfidenceLevel, RecommendedProject } from "../types";

/**
 * RecommendedProjects — renders the (exactly three) best-match projects.
 * Presentational only. If more than three are supplied, only the first three
 * are shown to preserve the RC1 contract.
 */
export interface RecommendedProjectsProps {
  projects: RecommendedProject[];
  headingId?: string;
}

const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  High: "High confidence",
  Medium: "Medium confidence",
  Low: "Low confidence",
};

/** Border weight communicates confidence without introducing new colour. */
const CONFIDENCE_BORDER: Record<ConfidenceLevel, string> = {
  High: "border-2 border-[#9C7B4C]",
  Medium: "border border-[#9C7B4C]",
  Low: "border border-[#EAE6DE]",
};

function ProjectCard({ project }: { project: RecommendedProject }) {
  return (
    <li
      className={`flex flex-col gap-3 rounded-2xl bg-white p-5 ${CONFIDENCE_BORDER[project.confidence]}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3
          className="font-serif text-base text-[#17150F] sm:text-lg"
          style={{ fontFamily: '"Newsreader", Georgia, serif' }}
        >
          {project.name}
        </h3>
        <span
          className="shrink-0 text-sm font-semibold text-[#9C7B4C]"
          aria-label={`Match score ${project.matchScore} out of 100`}
        >
          {project.matchScore}
          <span className="text-[#9A958A]">/100</span>
        </span>
      </div>

      {project.isPlaceholder ? (
        <p className="w-fit rounded-full bg-[#F3EFE7] px-3 py-1 text-xs uppercase tracking-wide text-[#9A958A]">
          Placeholder
        </p>
      ) : null}

      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-[#9A958A]">Primary reason</dt>
          <dd className="text-[#17150F]">{project.primaryReason}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-[#9A958A]">Trade-off</dt>
          <dd className="text-[#17150F]">{project.tradeOff}</dd>
        </div>
      </dl>

      <p className="mt-auto text-xs text-[#9A958A]">{CONFIDENCE_LABEL[project.confidence]}</p>
    </li>
  );
}

export function RecommendedProjects({
  projects,
  headingId = "advisory-recommendations-heading",
}: RecommendedProjectsProps) {
  const visible = projects.slice(0, 3);

  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="mb-4 font-serif text-lg text-[#17150F] sm:text-xl"
        style={{ fontFamily: '"Newsreader", Georgia, serif' }}
      >
        Best Matches
      </h2>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {visible.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </ul>
    </section>
  );
}
