import type { DirectionCard } from "../core/v2";
import { NO_VERIFIED_TRADE_OFF_MESSAGE } from "../core/v2";
import { buildProjectPath } from "../core";

/**
 * Transparent direction card — four explicit sections for every displayed
 * project: Why shown · Trade-off · Unknown · Last updated / source. Only
 * source-backed facts appear under "Why shown"; the trade-off section renders
 * the honest absence line whenever no verified statement exists (always, until
 * a verified trade-off source ships); stale or missing price freshness is
 * visible, never hidden.
 */
export function DirectionCardView({
  card,
  inShortlist,
  shortlistFull,
  mentionedByGuest,
  onToggleShortlist,
  onToggleMentioned,
  onOpenProject,
}: {
  card: DirectionCard;
  inShortlist: boolean;
  shortlistFull: boolean;
  mentionedByGuest: boolean;
  onToggleShortlist: () => void;
  onToggleMentioned: (value: boolean) => void;
  onOpenProject: () => void;
}) {
  const { project } = card;
  const addDisabled = !inShortlist && shortlistFull;

  return (
    <article
      aria-label={`Direction: ${project.name}`}
      className="flex flex-col gap-4 rounded-[18px] border border-[#E3DED4] bg-white p-5 md:p-6"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[20px] font-[400] leading-tight text-[#17150F] [font-family:'Newsreader',Georgia,serif]">
            {project.name}
          </h3>
          <p className="mt-1 text-[13px] text-[#8A857A]">
            {project.location || "Location not available"}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenProject}
          className="min-h-[40px] rounded-[10px] border border-[#EAE6DE] bg-white px-3 text-[12.5px] font-[600] text-[#3A362E] outline-none transition-colors hover:bg-[#FBFAF7] focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2"
        >
          Open {buildProjectPath(project.slug)}
        </button>
      </header>

      <section aria-label="Why shown">
        <h4 className="text-[11px] font-[700] uppercase tracking-[0.16em] text-[#2C5B3F]">
          Why shown
        </h4>
        {card.whyShown.length > 0 ? (
          <ul className="mt-1.5 flex flex-col gap-1">
            {card.whyShown.map((reason) => (
              <li key={reason.dimension} className="text-[13.5px] leading-snug text-[#3A362E]">
                • {reason.label}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-[13.5px] italic text-[#8A857A]">
            No supported reason yet — shown for open discussion.
          </p>
        )}
      </section>

      <section aria-label="Trade-off">
        <h4 className="text-[11px] font-[700] uppercase tracking-[0.16em] text-[#9C7B4C]">
          Trade-off
        </h4>
        <p className="mt-1.5 text-[13.5px] leading-snug text-[#57534A]">
          {card.tradeOff ?? NO_VERIFIED_TRADE_OFF_MESSAGE}
        </p>
      </section>

      <section aria-label="Unknown">
        <h4 className="text-[11px] font-[700] uppercase tracking-[0.16em] text-[#8A857A]">
          Unknown
        </h4>
        {card.unknowns.length > 0 ? (
          <ul className="mt-1.5 flex flex-col gap-1">
            {card.unknowns.map((unknown) => (
              <li
                key={`${unknown.dimension}-${unknown.kind}`}
                className="text-[13px] leading-snug text-[#8A857A]"
              >
                • {unknown.label}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-[13px] text-[#8A857A]">Nothing outstanding on this card.</p>
        )}
      </section>

      <section aria-label="Last updated and source">
        <h4 className="text-[11px] font-[700] uppercase tracking-[0.16em] text-[#8A857A]">
          Last updated · source
        </h4>
        <p className="mt-1.5 text-[13px] text-[#8A857A]">
          {card.freshness.lastPriceUpdate
            ? `Price last updated: ${card.freshness.lastPriceUpdate}`
            : "Price freshness not verified in the public record"}
          {" · Source: Forever project record"}
        </p>
      </section>

      <footer className="mt-1 flex flex-wrap items-center gap-3 border-t border-[#F1EDE6] pt-4">
        <button
          type="button"
          onClick={onToggleShortlist}
          disabled={addDisabled}
          aria-pressed={inShortlist}
          className={[
            "min-h-[44px] rounded-[12px] px-4 text-[13.5px] font-[600] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2",
            addDisabled
              ? "cursor-default border border-[#EFEBE3] bg-white text-[#C4BFB4]"
              : inShortlist
                ? "border-[1.5px] border-[#17150F] bg-[#F3EFE7] text-[#17150F]"
                : "border border-[#EAE6DE] bg-white text-[#3A362E] hover:bg-[#FBFAF7]",
          ].join(" ")}
        >
          {inShortlist ? "In shortlist ✓" : addDisabled ? "Shortlist full (4)" : "Add to shortlist"}
        </button>
        {inShortlist ? (
          <label className="flex items-center gap-2 text-[13px] text-[#57534A]">
            <input
              type="checkbox"
              checked={mentionedByGuest}
              onChange={(event) => onToggleMentioned(event.target.checked)}
              className="h-4 w-4 accent-[#9C7B4C]"
            />
            Mentioned by guest
          </label>
        ) : null}
      </footer>
    </article>
  );
}
