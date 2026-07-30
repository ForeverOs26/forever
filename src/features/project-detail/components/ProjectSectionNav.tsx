import { useEffect, useRef, useState } from "react";

import { Container } from "@/components/layout/Container";

import type { ProjectSection } from "../project-sections";

/**
 * Sticky section navigation (FOREVER-PROJECT-DETAIL-FAZWAZ-INSPIRED-UX-001).
 *
 * Built from the sections this project actually has, so every link lands on
 * content. The active item follows the scroll position through an
 * IntersectionObserver rather than a scroll listener, which keeps it off the
 * main thread during a scroll.
 *
 * It is a `<nav>`, not a second `<main>`: the page keeps exactly one main
 * landmark.
 */

export interface ProjectSectionNavProps {
  sections: readonly ProjectSection[];
}

export function ProjectSectionNav({ sections }: ProjectSectionNavProps) {
  const [active, setActive] = useState<string | null>(sections[0]?.id ?? null);
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || sections.length === 0) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) setActive(visible.target.id);
      },
      // A band across the upper third: a section counts as "current" once its
      // heading has arrived, not once its last pixel has left.
      { rootMargin: "-144px 0px -66% 0px", threshold: 0 },
    );
    for (const section of sections) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [sections]);

  useEffect(() => {
    if (!active) return;
    const activeLink = [
      ...(listRef.current?.querySelectorAll<HTMLElement>("[data-section-link]") ?? []),
    ].find((link) => link.dataset.sectionLink === active);
    if (!activeLink || typeof activeLink.scrollIntoView !== "function") return;
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    activeLink.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [active]);

  if (sections.length < 2) return null;

  return (
    <nav
      data-testid="project-section-nav"
      aria-label="Project sections"
      className="sticky top-16 z-30 border-b border-border/60 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75"
    >
      <Container className="px-0 sm:px-6 lg:px-8">
        <ul
          ref={listRef}
          className="flex gap-1 overflow-x-auto px-4 py-2 sm:px-0"
          style={{ scrollbarWidth: "none" }}
        >
          {sections.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                data-section-link={section.id}
                aria-controls={section.id}
                aria-current={active === section.id ? "true" : undefined}
                className={`inline-block whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  active === section.id
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      </Container>
    </nav>
  );
}
