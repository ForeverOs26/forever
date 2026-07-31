import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Images, Play } from "lucide-react";

import type { DecisionDeckMediaAsset } from "../decision-deck-model";
import type { ProjectDetailMediaItem } from "../project-detail-types";

/**
 * The photographs, immediately (FOREVER-PROJECT-DETAIL-FAZWAZ-INSPIRED-UX-001).
 *
 * One large image with four previews beside it, so the first screen answers
 * "what does this look like" before anything else. Replaces a full-bleed hero
 * that was darkened almost to silhouette and then had a headline, a paragraph
 * and four buttons laid over it — a treatment that made the photograph
 * decorative rather than informative.
 *
 * The layout degrades by count rather than stretching: five or more images give
 * the full mosaic, two to four give a proportional split, one fills the frame.
 * Every tile is a real button, so the whole set is reachable by keyboard.
 *
 * Loading is deliberate. The primary image is `eager` with `fetchPriority
 * high` because it is the largest contentful paint; every preview is `lazy`;
 * and nothing beyond the five visible tiles is requested until the viewer
 * opens.
 */

export interface ProjectMediaMosaicProps {
  items: readonly ProjectDetailMediaItem[];
  projectName: string;
  onOpen: (index: number) => void;
  film?: DecisionDeckMediaAsset | null;
}

const RADIUS = "rounded-2xl";

function tileAlt(item: ProjectDetailMediaItem, projectName: string, index: number): string {
  return item.title?.trim() || `${projectName} photograph ${index + 1}`;
}

export function ProjectMediaMosaic({
  items,
  projectName,
  onOpen,
  film = null,
}: ProjectMediaMosaicProps) {
  const [mobileIndex, setMobileIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const touchStartX = useRef<number | null>(null);

  if (items.length === 0) {
    return (
      <div className="space-y-3">
        <div
          data-testid="project-media-empty"
          className={`flex aspect-[16/10] w-full flex-col items-center justify-center gap-3 border border-dashed border-border bg-secondary/50 px-6 text-center text-sm text-muted-foreground ${RADIUS}`}
        >
          <Images className="h-5 w-5 text-accent" aria-hidden="true" />
          Official photography for this project is not recorded.
        </div>
        {film ? <FilmTile /> : null}
      </div>
    );
  }

  const primary = items[0];
  const previews = items.slice(1, 5);
  const remaining = Math.max(0, items.length - 5);

  const goMobile = (delta: number) => {
    const next = (mobileIndex + delta + items.length) % items.length;
    setMobileIndex(next);
    const track = trackRef.current;
    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (track) {
      track.scrollTo({
        left: next * track.clientWidth,
        behavior: reduceMotion ? "auto" : "smooth",
      });
    }
  };

  return (
    // `min-w-0` is load-bearing. As a grid item this div defaults to
    // `min-width: auto`, which refuses to shrink below its content — and its
    // content is a 24-slide track. Without it the mobile carousel widened the
    // page itself by ~2100 px at 375 px instead of scrolling inside its own
    // container.
    <div data-testid="project-media-mosaic" className="w-full min-w-0">
      {/* ---------------- Mobile: one swipeable image + thumbnail strip ------- */}
      <div className="md:hidden">
        <div className="relative">
          <div
            ref={trackRef}
            className={`flex w-full snap-x snap-mandatory overflow-x-auto ${RADIUS}`}
            style={{ scrollbarWidth: "none" }}
            onScroll={(event) => {
              const track = event.currentTarget;
              if (track.clientWidth === 0) return;
              const next = Math.round(track.scrollLeft / track.clientWidth);
              if (next !== mobileIndex) setMobileIndex(next);
            }}
            onTouchStart={(event) => {
              touchStartX.current = event.touches[0]?.clientX ?? null;
            }}
            onTouchEnd={() => {
              touchStartX.current = null;
            }}
          >
            {items.map((item, index) => (
              <button
                type="button"
                key={item.id}
                onClick={() => onOpen(index)}
                tabIndex={index === mobileIndex ? 0 : -1}
                aria-hidden={index === mobileIndex ? undefined : "true"}
                className="relative w-full shrink-0 snap-center focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label={`Open ${tileAlt(item, projectName, index)}`}
              >
                <img
                  src={item.url}
                  alt={tileAlt(item, projectName, index)}
                  width={1600}
                  height={1000}
                  loading={index === 0 ? "eager" : "lazy"}
                  fetchPriority={index === 0 ? "high" : "auto"}
                  className="aspect-[16/10] w-full bg-secondary object-cover"
                />
              </button>
            ))}
          </div>

          {items.length > 1 ? (
            <>
              <button
                type="button"
                onClick={() => goMobile(-1)}
                aria-label="Previous photograph"
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-background/85 p-2 text-foreground shadow-sm backdrop-blur focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => goMobile(1)}
                aria-label="Next photograph"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-background/85 p-2 text-foreground shadow-sm backdrop-blur focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <p
                className="absolute bottom-3 right-3 rounded-full bg-background/85 px-2.5 py-1 text-xs font-medium tabular-nums text-foreground backdrop-blur"
                aria-live="polite"
              >
                {mobileIndex + 1} / {items.length}
              </p>
            </>
          ) : null}
        </div>

        {items.length > 1 ? (
          <div className="mt-3 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            {/* A partially visible next thumbnail is what tells a reader the
                strip scrolls at all. */}
            <ul className="flex gap-2 pr-8">
              {items.map((item, index) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(index)}
                    aria-label={`Open ${tileAlt(item, projectName, index)}`}
                    aria-current={index === mobileIndex ? "true" : undefined}
                    tabIndex={index === mobileIndex ? 0 : -1}
                    className={`block h-16 w-24 shrink-0 overflow-hidden rounded-lg border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      index === mobileIndex ? "border-accent" : "border-border/60"
                    }`}
                  >
                    <img
                      src={item.url}
                      alt=""
                      width={240}
                      height={160}
                      loading="lazy"
                      className="h-full w-full bg-secondary object-cover"
                    />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {/* ---------------- Tablet and desktop: the mosaic ---------------------- */}
      <div className="hidden md:block">
        <div
          data-testid="mosaic-grid"
          className={
            previews.length >= 4
              ? "grid grid-cols-[1.9fr_1fr] gap-3 lg:grid-cols-[2.1fr_1fr]"
              : previews.length > 0
                ? "grid grid-cols-[2fr_1fr] gap-3"
                : "grid grid-cols-1"
          }
        >
          <button
            type="button"
            onClick={() => onOpen(0)}
            className={`group relative overflow-hidden bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${RADIUS}`}
            aria-label={`Open ${tileAlt(primary, projectName, 0)}`}
          >
            <img
              src={primary.url}
              alt={tileAlt(primary, projectName, 0)}
              width={1600}
              height={1000}
              loading="eager"
              fetchPriority="high"
              className="aspect-[16/10] w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.02]"
            />
          </button>

          {previews.length > 0 ? (
            <div
              className={
                previews.length >= 3
                  ? "grid grid-cols-2 grid-rows-2 gap-3"
                  : "grid grid-rows-2 gap-3"
              }
            >
              {previews.map((item, offset) => {
                const index = offset + 1;
                const isLastTile = offset === previews.length - 1 && remaining > 0;
                return (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => onOpen(index)}
                    className={`group relative overflow-hidden bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${RADIUS}`}
                    aria-label={
                      isLastTile
                        ? `View all ${items.length} photos`
                        : `Open ${tileAlt(item, projectName, index)}`
                    }
                  >
                    <img
                      src={item.url}
                      alt={isLastTile ? "" : tileAlt(item, projectName, index)}
                      width={800}
                      height={600}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
                    />
                    {isLastTile ? (
                      <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-foreground/55 text-sm font-medium text-background backdrop-blur-[2px]">
                        <Images className="h-5 w-5" />
                        View all {items.length} photos
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        {remaining === 0 && items.length > 1 ? (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => onOpen(0)}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Images className="h-4 w-4" />
              View all {items.length} photos
            </button>
          </div>
        ) : null}
      </div>

      {film ? <FilmTile /> : null}
    </div>
  );
}

function FilmTile() {
  return (
    <a
      href="#film"
      data-testid="mosaic-film-tile"
      className="mt-3 flex min-h-16 items-center justify-between rounded-xl bg-primary px-5 text-primary-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
    >
      <span>
        <span className="block text-[11px] uppercase tracking-[0.18em] text-primary-foreground/60">
          Recorded media
        </span>
        <span className="mt-1 block text-sm font-medium">Open project film</span>
      </span>
      <span className="grid h-10 w-10 place-items-center rounded-full border border-primary-foreground/35">
        <Play className="h-4 w-4 fill-current" aria-hidden="true" />
      </span>
    </a>
  );
}
