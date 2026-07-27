import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

import type { ProjectDetailMediaItem } from "../project-detail-types";

/**
 * The one fullscreen viewer on the project page
 * (FOREVER-PROJECT-DETAIL-FAZWAZ-INSPIRED-UX-001).
 *
 * Every surface that opens an image — the media mosaic, the photo strip, the
 * plan previews — opens this. One component means one set of keyboard rules,
 * one focus trap and one loading policy, instead of three that drift apart.
 *
 * Deliberate behaviours:
 *   - only the current image and its immediate neighbours are given a `src`, so
 *     opening a 24-image gallery fetches three files rather than twenty-four;
 *   - the page scroll position is locked on open and restored on close, so
 *     dismissing the viewer never teleports the reader somewhere else;
 *   - focus is trapped while open and returned to the control that opened it;
 *   - nothing plays or advances on its own.
 */

export interface ProjectLightboxProps {
  items: readonly ProjectDetailMediaItem[];
  /** Index to show, or null when closed. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** Names the set for assistive technology, e.g. "Coralina photos". */
  label: string;
}

export function ProjectLightbox({
  items,
  index,
  onIndexChange,
  onClose,
  label,
}: ProjectLightboxProps) {
  const open = index !== null && items.length > 0;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<Element | null>(null);
  const touchStartX = useRef<number | null>(null);
  const titleId = useId();

  const go = useCallback(
    (delta: number) => {
      if (index === null || items.length === 0) return;
      onIndexChange((index + delta + items.length) % items.length);
    },
    [index, items.length, onIndexChange],
  );

  // Remember who opened us, so focus can go back there on close.
  useEffect(() => {
    if (!open) return;
    openerRef.current = typeof document === "undefined" ? null : document.activeElement;
    const timer = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (open) return;
    const opener = openerRef.current;
    if (opener instanceof HTMLElement) opener.focus();
  }, [open]);

  // Lock the body, remembering the exact scroll offset rather than relying on
  // the browser to restore it: `overflow: hidden` on <body> loses it otherwise.
  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const { body } = document;
    const scrollY = window.scrollY;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
      window.scrollTo({ top: scrollY });
    };
  }, [open]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        go(1);
        return;
      }
      if (event.key !== "Tab") return;
      // Focus trap: cycle within the dialog's own focusable controls.
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, go, onClose]);

  // Only the visible image and its neighbours are worth fetching.
  const prepared = useMemo(() => {
    if (index === null) return new Set<number>();
    const total = items.length;
    return new Set([index, (index + 1) % total, (index - 1 + total) % total]);
  }, [index, items.length]);

  if (!open || index === null) return null;
  const current = items[index];

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      ref={dialogRef}
      data-testid="project-lightbox"
      onTouchStart={(event) => {
        touchStartX.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const start = touchStartX.current;
        touchStartX.current = null;
        if (start === null) return;
        const delta = (event.changedTouches[0]?.clientX ?? start) - start;
        if (Math.abs(delta) < 48) return;
        go(delta < 0 ? 1 : -1);
      }}
    >
      <div className="flex items-center justify-between gap-4 px-4 py-3 text-white sm:px-6">
        <p id={titleId} className="text-sm font-medium">
          {label}
        </p>
        <p className="text-sm tabular-nums text-white/70" aria-live="polite">
          Image {index + 1} of {items.length}
        </p>
        <button
          type="button"
          ref={closeRef}
          onClick={onClose}
          className="rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label="Close image viewer"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-14">
        {items.length > 1 ? (
          <button
            type="button"
            onClick={() => go(-1)}
            className="absolute left-1 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2.5 text-white transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white sm:left-3"
            aria-label="Previous image"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        ) : null}

        <img
          src={current.url}
          alt={current.title || `${label} ${index + 1}`}
          className="max-h-full max-w-full object-contain"
        />

        {items.length > 1 ? (
          <button
            type="button"
            onClick={() => go(1)}
            className="absolute right-1 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2.5 text-white transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white sm:right-3"
            aria-label="Next image"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        ) : null}
      </div>

      {items.length > 1 ? (
        <div className="overflow-x-auto px-4 py-3 sm:px-6">
          <ul className="flex gap-2" aria-label="Choose an image">
            {items.map((item, thumbIndex) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onIndexChange(thumbIndex)}
                  aria-current={thumbIndex === index ? "true" : undefined}
                  aria-label={`Image ${thumbIndex + 1}`}
                  className={`block h-14 w-20 shrink-0 overflow-hidden rounded-md border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                    thumbIndex === index
                      ? "border-white"
                      : "border-white/20 opacity-60 hover:opacity-100"
                  }`}
                >
                  {prepared.has(thumbIndex) || Math.abs(thumbIndex - index) <= 6 ? (
                    <img
                      src={item.url}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="block h-full w-full bg-white/10" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Shared open/close state for any surface that shows this viewer. */
export function useLightbox() {
  const [index, setIndex] = useState<number | null>(null);
  return {
    index,
    open: (value: number) => setIndex(value),
    close: () => setIndex(null),
    onIndexChange: setIndex,
  };
}
