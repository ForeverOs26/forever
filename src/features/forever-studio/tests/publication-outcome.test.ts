/**
 * FOREVER-STUDIO-R2-MANUAL-E2E-FAILURE-FORENSICS-006 — the honest final state.
 *
 * The measured defect: a run whose four declared source files all failed to
 * upload produced `0 units, 0 prices, 0 media` and was presented as
 *
 *     Published — The page is live now. Anything missing can be added later.
 *
 * The heading was a constant. These tests make it impossible for that heading
 * to reappear over a run that did not earn it, and they reconstruct the Owner's
 * exact observed case as a named regression test.
 */

import { describe, expect, it } from "vitest";

import {
  countSkippedSourceWarnings,
  describePublicationOutcome,
  producedNoContent,
  SKIPPED_SOURCE_WARNING_CODES,
} from "../publication-outcome";
import type { StudioWarningSummary } from "../studio-types";

const warn = (code: string): StudioWarningSummary => ({
  code,
  message: "Private source file was declared but never arrived in storage; continuing without it.",
});

const OWNER_FAILED_FILES = [
  "SUB - Price List V.1. - Updated 24.07.2026.pdf",
  "The Title Sierra Show Unit 30 sq.m.-01.jpg",
  "The Title Sierra Show Unit 30 sq.m.-02.jpg",
  "The Title Sierra Show Unit 30 sq.m.-03.jpg",
];

const counts = (units: number, prices: number, media: number, warnings = 0) => ({
  buildings: 0,
  units,
  prices,
  media,
  warnings,
});

describe("the Owner's exact observed run is never reported as success", () => {
  it("reconstructs it: 4 failed uploads, 3 missing-source notes, 0/0/0 → FAILED", () => {
    const outcome = describePublicationOutcome({
      status: "published",
      pagePath: "/projects/the-title-sierra",
      counts: counts(0, 0, 0, 3),
      warnings: [
        warn("file_upload_missing"),
        warn("file_upload_missing"),
        warn("file_upload_missing"),
      ],
      failedUploads: OWNER_FAILED_FILES,
    });

    expect(outcome.level).toBe("failed");
    expect(outcome.ok).toBe(false);
    expect(outcome.producedNothing).toBe(true);
    expect(outcome.skippedSourceCount).toBe(4);

    // The precise regression: this screen must never again claim completeness.
    expect(outcome.title).not.toBe("Published");
    expect(outcome.description).not.toContain("The page is live now");
    expect(outcome.description).toContain("never finished uploading");
  });

  it("names every failed file so the Owner can tell WHICH ones to re-upload", () => {
    // The server-side notes are redacted to "Private source file" by design, so
    // the client's own record is the only place the names survive.
    const outcome = describePublicationOutcome({
      status: "published",
      pagePath: "/projects/x",
      counts: counts(0, 0, 0),
      warnings: [],
      failedUploads: OWNER_FAILED_FILES,
    });
    expect(outcome.skippedSourceNames).toEqual(OWNER_FAILED_FILES);
  });
});

describe("publication outcome levels", () => {
  it("COMPLETE only when a page published and nothing was skipped", () => {
    const outcome = describePublicationOutcome({
      status: "published",
      pagePath: "/projects/x",
      counts: counts(12, 12, 30),
      warnings: [],
      failedUploads: [],
    });
    expect(outcome.level).toBe("complete");
    expect(outcome.ok).toBe(true);
    expect(outcome.title).toBe("Published");
  });

  it("PARTIAL when the page has content but a declared source was skipped", () => {
    const outcome = describePublicationOutcome({
      status: "published",
      pagePath: "/projects/x",
      counts: counts(12, 12, 30),
      warnings: [warn("file_upload_missing")],
      failedUploads: [],
    });
    expect(outcome.level).toBe("partial");
    expect(outcome.ok).toBe(false);
    expect(outcome.title).toBe("Partly published");
  });

  it("FAILED when no page was published at all", () => {
    const outcome = describePublicationOutcome({
      status: "failed",
      pagePath: null,
      counts: null,
      warnings: [],
      failedUploads: [],
    });
    expect(outcome.level).toBe("failed");
    expect(outcome.title).toBe("Not published");
  });

  it("does NOT require a pagePath — status is the only publication authority", () => {
    // `pagePath` is documented as the path "when a page exists". A published run
    // that produces no public page is legitimate, and demanding a path here
    // would invent a product rule and fail healthy runs.
    const outcome = describePublicationOutcome({
      status: "published",
      pagePath: null,
      counts: counts(1, 1, 1),
      warnings: [],
      failedUploads: [],
    });
    expect(outcome.level).toBe("complete");
    expect(outcome.ok).toBe(true);
  });

  it("leaves an empty page with NO skipped sources as complete", () => {
    // Not the defect under repair. A facts-only update legitimately produces no
    // units, prices or media, and reclassifying it would invent a product rule.
    const outcome = describePublicationOutcome({
      status: "published",
      pagePath: "/projects/x",
      counts: counts(0, 0, 0),
      warnings: [],
      failedUploads: [],
    });
    expect(outcome.level).toBe("complete");
    expect(outcome.ok).toBe(true);
  });
});

describe("skip accounting", () => {
  it("counts every code that means a declared source did not contribute", () => {
    for (const code of SKIPPED_SOURCE_WARNING_CODES) {
      expect(countSkippedSourceWarnings([warn(code)]), code).toBe(1);
    }
  });

  it("does NOT count a warning about a file that WAS ingested", () => {
    // A size mismatch describes a file that arrived and was used. Counting it
    // would report a healthy run as partial.
    expect(countSkippedSourceWarnings([warn("file_declared_size_mismatch")])).toBe(0);
    expect(countSkippedSourceWarnings([warn("duplicate_media_ignored")])).toBe(0);
    expect(countSkippedSourceWarnings([warn("media_publish_deferred")])).toBe(0);
  });

  it("reconciles client and server skips by the greater, never by summing", () => {
    // Both observed the SAME lost file. Summing would report 2 skips for 1 file
    // and could turn a partial into a wrong count on screen.
    const outcome = describePublicationOutcome({
      status: "published",
      pagePath: "/projects/x",
      counts: counts(5, 5, 5),
      warnings: [warn("file_upload_missing")],
      failedUploads: ["one.jpg"],
    });
    expect(outcome.skippedSourceCount).toBe(1);
  });

  it("still counts a browser-side abandon the server never heard about", () => {
    const outcome = describePublicationOutcome({
      status: "published",
      pagePath: "/projects/x",
      counts: counts(5, 5, 5),
      warnings: [],
      failedUploads: ["a.jpg", "b.jpg"],
    });
    expect(outcome.skippedSourceCount).toBe(2);
    expect(outcome.level).toBe("partial");
  });

  it("still counts a server-side skip the browser never noticed", () => {
    const outcome = describePublicationOutcome({
      status: "published",
      pagePath: "/projects/x",
      counts: counts(5, 5, 5),
      warnings: [warn("file_oversized"), warn("file_unreadable")],
      failedUploads: [],
    });
    expect(outcome.skippedSourceCount).toBe(2);
    expect(outcome.level).toBe("partial");
  });

  it("producedNoContent means PROVABLY empty, not merely unknown", () => {
    // null is "the run reported no tally", which is not "the page has nothing".
    // Claiming the stronger thing would tell the Owner their page is empty on
    // no evidence.
    expect(producedNoContent(null)).toBe(false);
    expect(producedNoContent(counts(0, 0, 0))).toBe(true);
    expect(producedNoContent(counts(0, 0, 1))).toBe(false);
  });

  it("an unknown tally with a skipped source is PARTIAL, never 'empty'", () => {
    const outcome = describePublicationOutcome({
      status: "published",
      pagePath: "/projects/x",
      counts: null,
      warnings: [],
      failedUploads: ["deed.pdf"],
    });
    expect(outcome.level).toBe("partial");
    expect(outcome.producedNothing).toBe(false);
    expect(outcome.title).toBe("Partly published");
  });
});

describe("no success wording may survive a skipped source", () => {
  it("never emits the old constant heading unless the outcome is complete", () => {
    const cases = [
      { warnings: [warn("file_upload_missing")], failedUploads: [], counts: counts(1, 1, 1) },
      { warnings: [], failedUploads: ["x.jpg"], counts: counts(1, 1, 1) },
      {
        warnings: [warn("file_upload_missing")],
        failedUploads: ["x.jpg"],
        counts: counts(0, 0, 0),
      },
    ];
    for (const one of cases) {
      const outcome = describePublicationOutcome({
        status: "published",
        pagePath: "/projects/x",
        ...one,
      });
      expect(outcome.ok).toBe(false);
      expect(outcome.title).not.toBe("Published");
      expect(outcome.description).not.toBe(
        "The page is live now. Anything missing can be added later.",
      );
    }
  });
});
