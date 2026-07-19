/**
 * Hydration-stability regression for the Forever Passport footer.
 *
 * The card once stamped `generatedAt` with a millisecond ISO timestamp, so the
 * server-rendered text never matched the client-hydrated text and React
 * discarded the whole tree on every project page ("Hydration failed because
 * the server rendered text didn't match the client"). The footer must render
 * a stable, date-only value.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { mapProjectDetail } from "@/features/project-detail/project-detail-mappers";
import type { ProjectDetailRecord } from "@/features/project-detail/project-detail-types";
import { ForeverPassportCard } from "./ForeverPassportCard";

function minimalRecord(): ProjectDetailRecord {
  return {
    id: "p-1",
    slug: "modeva",
    name: "Modeva",
    is_featured: true,
    is_active: true,
    forever_verified: true,
    developer: null,
    media: null,
    units: null,
    investment: null,
  } as unknown as ProjectDetailRecord;
}

function generatedFooterText(): string {
  const node = screen.getByText(/^Generated /);
  return node.textContent ?? "";
}

describe("ForeverPassportCard generated-at stability", () => {
  it("renders a date-only generated marker with no time component", () => {
    render(<ForeverPassportCard project={mapProjectDetail(minimalRecord())} />);
    const text = generatedFooterText();
    expect(text).toMatch(/^Generated \d{4}-\d{2}-\d{2}$/);
    expect(text).not.toContain("T");
    expect(text).not.toContain(":");
  });

  it("renders identical text across independent renders (server/client parity)", () => {
    const project = mapProjectDetail(minimalRecord());

    render(<ForeverPassportCard project={project} />);
    const first = generatedFooterText();
    cleanup();

    render(<ForeverPassportCard project={project} />);
    const second = generatedFooterText();

    expect(second).toBe(first);
  });
});
