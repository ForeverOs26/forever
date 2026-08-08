/**
 * What the Owner actually SEES when an archive contained material Forever
 * could not tie to the project.
 *
 * The count and the reason already exist in the progress data; this pins that
 * they reach the screen, in words, and that they say the three things the
 * Owner needs: how many, that the material is safe, and why it was held back.
 *
 * It also pins the two silences: nothing is shown when there is nothing to
 * review, and no private filename or storage path is ever rendered.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ArchiveProcessingPanel } from "../components/StudioUploader";
import type { StudioArchiveProgress, StudioJobProgress } from "../studio-types";

function archive(overrides: Partial<StudioArchiveProgress> = {}): StudioArchiveProgress {
  return {
    archiveId: "00000000-0000-4000-8000-000000000001",
    label: "Archive 1",
    status: "processing_entries",
    partCount: 4,
    uploadedParts: 4,
    verifiedParts: 4,
    entryCount: 18,
    entriesProcessed: 18,
    entriesPublished: 7,
    entriesRetained: 9,
    entriesManualReview: 2,
    entriesSkipped: 0,
    entriesFailed: 0,
    warningCode: null,
    ...overrides,
  };
}

function progress(overrides: Partial<StudioJobProgress> = {}): StudioJobProgress {
  return {
    jobId: "00000000-0000-4000-8000-0000000000ff",
    status: "processing",
    archives: [archive()],
    discovered: 18,
    processed: 18,
    published: 7,
    retained: 9,
    manualReview: 2,
    skippedDuplicates: 0,
    failed: 0,
    pending: 0,
    warnings: [],
    ...overrides,
  };
}

function notice(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-block="manual-review-notice"]');
}

describe("the manual-review notice in the archive panel", () => {
  it("shows the COUNT, that the material is private, and the reason", () => {
    render(<ArchiveProcessingPanel progress={progress()} />);

    const block = notice();
    expect(block).toBeTruthy();
    const text = block!.textContent ?? "";

    // 1. how many
    expect(text).toContain("2 items need your review");
    // 2. what happened to them — kept, not lost, not published
    expect(text.toLowerCase()).toContain("kept private");
    expect(text.toLowerCase()).toContain("not added");
    // 3. WHY, in the Owner's terms rather than an outcome code
    expect(text.toLowerCase()).toContain("showroom");
    expect(text.toLowerCase()).toContain("different location");
    // The reason is explained, never spelled as an internal code.
    expect(text).not.toContain("manual_review_location_conflict");
  });

  it("reads naturally for a single item", () => {
    render(
      <ArchiveProcessingPanel
        progress={progress({ manualReview: 1, archives: [archive({ entriesManualReview: 1 })] })}
      />,
    );
    const text = notice()!.textContent ?? "";
    expect(text).toContain("1 item needs your review");
    expect(text).not.toContain("items need");
  });

  it("renders NOTHING when there is nothing to review", () => {
    render(
      <ArchiveProcessingPanel
        progress={progress({
          manualReview: 0,
          retained: 7,
          archives: [archive({ entriesManualReview: 0, entriesRetained: 7 })],
        })}
      />,
    );
    expect(notice()).toBeNull();
    // The ordinary summary line is still there — only the alarm is silent.
    expect(screen.getByText(/kept private/)).toBeTruthy();
  });

  it("never renders a filename, a path, a bucket or a location", () => {
    render(<ArchiveProcessingPanel progress={progress()} />);
    const rendered = document.body.textContent ?? "";
    for (const forbidden of [
      "Show Unit",
      "Bangtao",
      "Kamala",
      ".jpg",
      "studio/archives",
      "studio-archives",
      "_DSC",
    ]) {
      expect(rendered, `must not render ${forbidden}`).not.toContain(forbidden);
    }
    // What it DOES render is neutral: the archive's label, not its filename.
    expect(rendered).toContain("Archive 1");
  });
});
