import type { Property } from "@/lib/data";
import { DEMO_PREVIEW_SLUG } from "@/features/project-detail/demo-preview";
import type { MatchReason } from "../core";

/** A single factual, source-backed match reason. Bronze dot + label; never a score. */
function MatchReasonChip({ reason }: { reason: MatchReason }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-[#E3DED4] bg-[#FBFAF7] px-3 py-1.5 text-[12.5px] font-[600] text-[#3A362E] [font-family:'Hanken_Grotesk',system-ui,sans-serif]">
      <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-[#9C7B4C]" />
      {reason.label}
    </span>
  );
}

function ActionButton({
  label,
  onClick,
  tone = "secondary",
}: {
  label: string;
  onClick: () => void;
  tone?: "primary" | "secondary";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "min-h-[48px] rounded-[13px] px-4 text-[14px] font-[600] outline-none transition-transform focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2 active:translate-y-px [font-family:'Hanken_Grotesk',system-ui,sans-serif]",
        tone === "primary"
          ? "bg-[#17150F] text-white"
          : "border border-[#EAE6DE] bg-white text-[#3A362E] hover:bg-[#FBFAF7]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

export function MatchResultCard({
  project,
  reasons,
  onOpen,
  onCopyLink,
  onSelect,
  variant = "result",
}: {
  project: Property;
  reasons: MatchReason[];
  onOpen: () => void;
  onCopyLink: () => void;
  onSelect?: () => void;
  variant?: "result" | "selected";
}) {
  const isDraftPreview = project.slug === DEMO_PREVIEW_SLUG;
  const hasImage = Boolean(project.image);

  return (
    <article className="flex flex-col overflow-hidden rounded-[18px] border border-[#E3DED4] bg-white">
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-[#ECEAE3]">
        {hasImage ? (
          <img
            src={project.image}
            alt={`${project.name}${project.location ? ` in ${project.location}` : ""}`}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          // Refined neutral placeholder — Coralina's draft graph has no media.
          <div
            aria-hidden="true"
            className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#EFEBE3] to-[#E1DBCF] text-[13px] font-[600] uppercase tracking-[0.2em] text-[#B4AC9C]"
          >
            No media yet
          </div>
        )}
        {isDraftPreview ? (
          <span className="absolute left-3 top-3 rounded-full border border-[#E3DED4] bg-white/95 px-3 py-1 text-[11px] font-[700] uppercase tracking-[0.12em] text-[#9C7B4C] [font-family:'Hanken_Grotesk',system-ui,sans-serif]">
            Local development preview · unpublished draft
          </span>
        ) : null}
        {variant === "selected" ? (
          <span className="absolute right-3 top-3 rounded-full bg-[#17150F] px-3 py-1 text-[11px] font-[700] uppercase tracking-[0.12em] text-white [font-family:'Hanken_Grotesk',system-ui,sans-serif]">
            Selected for this guest
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-4 p-5">
        <div>
          <h3 className="text-[21px] font-[400] leading-tight text-[#17150F] [font-family:'Newsreader',Georgia,serif]">
            {project.name}
          </h3>
          {project.location ? (
            <p className="mt-1 text-[13.5px] text-[#8A857A] [font-family:'Hanken_Grotesk',system-ui,sans-serif]">
              {project.location}
            </p>
          ) : null}
          {project.tagline ? (
            <p className="mt-2 text-[14px] leading-relaxed text-[#57534A] [font-family:'Hanken_Grotesk',system-ui,sans-serif]">
              {project.tagline}
            </p>
          ) : null}
        </div>

        {reasons.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Why this project is shown">
            {reasons.map((reason) => (
              <li key={reason.kind}>
                <MatchReasonChip reason={reason} />
              </li>
            ))}
          </ul>
        ) : null}

        {project.price ? (
          <p className="text-[13px] text-[#57534A] [font-family:'Hanken_Grotesk',system-ui,sans-serif]">
            <span className="uppercase tracking-[0.14em] text-[#A29C90]">Starting</span>{" "}
            <span className="font-[600] text-[#17150F]">{project.price}</span>
          </p>
        ) : null}

        <div className="mt-auto grid grid-cols-1 gap-2 sm:grid-cols-2">
          {onSelect ? (
            <ActionButton label="Select for guest" onClick={onSelect} tone="primary" />
          ) : null}
          <ActionButton label="Open project" onClick={onOpen} />
          <ActionButton label="Copy guest link" onClick={onCopyLink} />
        </div>
      </div>
    </article>
  );
}
