/**
 * FOREVER-STUDIO-R2-MANUAL-E2E-FAILURE-FORENSICS-006 — the honest final state.
 * Corrected by FOREVER-PR141-PR142-EVIDENCE-REVIEW-CORRECTIONS-007.
 *
 * The measured defect: a run whose four declared source files all failed to
 * upload produced `0 units, 0 prices, 0 media` and was presented as
 *
 *     Published — The page is live now. Anything missing can be added later.
 *
 * The heading was a constant. These tests make it impossible for that heading
 * to reappear over a run that did not earn it, and they reconstruct the Owner's
 * exact observed case as a named regression test.
 *
 * THE REVIEW CORRECTIONS PINNED HERE:
 *
 *   1. client and server observations are NEVER reconciled into one number —
 *      no sum, no `Math.max`, no deduplication — because no shared file
 *      identifier exists to justify any of those;
 *   2. the warning vocabulary is audited MECHANICALLY, and not every warning is
 *      a failure;
 *   3. critical sources are exposed for direct rendering, not collapsed.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  classifyWarning,
  countWarningsByClass,
  CRITICAL_WARNING_CLASSES,
  describePublicationOutcome,
  isCriticalWarning,
  producedNoContent,
  RETAINED_WARNING_CLASSES,
  WARNING_CLASSIFICATION,
  type WarningClass,
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

    // The two observers, reported separately and never combined. Four and three
    // are what was actually observed; 4, 3 and 7 are all defensible-looking
    // numbers and only the first two are evidence.
    expect(outcome.clientFailedUploadCount).toBe(4);
    expect(outcome.serverDeliveryFailureCount).toBe(3);
    expect(outcome.clientObservedFailure).toBe(true);
    expect(outcome.serverObservedCriticalProblem).toBe(true);

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
    expect(outcome.clientFailedUploadNames).toEqual(OWNER_FAILED_FILES);
  });
});

// ---------------------------------------------------------------------------
// CORRECTION 1 — no combined count, because no shared identity exists
// ---------------------------------------------------------------------------

describe("client and server observations are independent, and stay independent", () => {
  it("exposes no combined, summed or reconciled skip count at all", () => {
    const outcome = describePublicationOutcome({
      status: "published",
      pagePath: "/projects/x",
      counts: counts(5, 5, 5),
      warnings: [warn("file_upload_missing")],
      failedUploads: ["one.jpg"],
    });
    // The retracted API. `Math.max(clientSkips, serverSkips)` assumed one set
    // was a subset of the other; nothing in the data supports that.
    expect(outcome).not.toHaveProperty("skippedSourceCount");
    expect(outcome).not.toHaveProperty("skippedSourceNames");
  });

  it("reports 1 and 1 for one file both observers saw — never 1-as-a-total", () => {
    const outcome = describePublicationOutcome({
      status: "published",
      pagePath: "/projects/x",
      counts: counts(5, 5, 5),
      warnings: [warn("file_upload_missing")],
      failedUploads: ["one.jpg"],
    });
    expect(outcome.clientFailedUploadCount).toBe(1);
    expect(outcome.serverDeliveryFailureCount).toBe(1);
    expect(outcome.level).toBe("partial");
  });

  it("reports a browser-side abandon the server never heard about", () => {
    const outcome = describePublicationOutcome({
      status: "published",
      pagePath: "/projects/x",
      counts: counts(5, 5, 5),
      warnings: [],
      failedUploads: ["a.jpg", "b.jpg"],
    });
    expect(outcome.clientFailedUploadCount).toBe(2);
    expect(outcome.serverDeliveryFailureCount).toBe(0);
    expect(outcome.serverObservedCriticalProblem).toBe(false);
    expect(outcome.level).toBe("partial");
  });

  it("reports a server-side rejection the browser never noticed", () => {
    const outcome = describePublicationOutcome({
      status: "published",
      pagePath: "/projects/x",
      counts: counts(5, 5, 5),
      warnings: [warn("file_oversized"), warn("file_unreadable")],
      failedUploads: [],
    });
    expect(outcome.clientObservedFailure).toBe(false);
    expect(outcome.serverRejectedSourceCount).toBe(2);
    expect(outcome.serverDeliveryFailureCount).toBe(0);
    expect(outcome.level).toBe("partial");
  });

  it("does not say 'did not finish uploading' about a source that ARRIVED", () => {
    // A rejected source reached storage. Telling the Owner it failed to upload
    // would send them to fix the wrong thing.
    const outcome = describePublicationOutcome({
      status: "published",
      pagePath: "/projects/x",
      counts: counts(5, 5, 5),
      warnings: [warn("media_class_mismatch")],
      failedUploads: [],
    });
    expect(outcome.description).not.toContain("uploading");
    expect(outcome.description).toContain("could not be used");
  });
});

// ---------------------------------------------------------------------------
// CORRECTION 2 — the warning vocabulary, audited mechanically
// ---------------------------------------------------------------------------

/**
 * Extracts every warning code that can reach the browser, from the call sites
 * themselves. `settleRetained` is deliberately excluded: it records an ARCHIVE
 * ENTRY OUTCOME, not a `StudioWarningSummary`, so its reason codes never appear
 * in `result.warnings`.
 */
function emittedWarningCodes(): Set<string> {
  const root = resolve(process.cwd(), "src/features/forever-studio/server");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(full);
    }
  };
  walk(root);
  const pattern = /(?:fileWarning|archiveWarning|neutralWarning)\(\s*"([a-z0-9_]+)"/g;
  const codes = new Set<string>();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(pattern)) codes.add(match[1]!);
  }
  // Emitted through a constant rather than a literal.
  codes.add("structured_purpose_mismatch");
  return codes;
}

describe("the warning vocabulary is audited, not guessed", () => {
  it("classifies EVERY code the server can actually emit", () => {
    const emitted = [...emittedWarningCodes()].sort();
    // A guard that finds nothing is not a guard.
    expect(emitted.length).toBeGreaterThanOrEqual(15);
    const unclassified = emitted.filter((code) => !(code in WARNING_CLASSIFICATION));
    expect(unclassified, `unclassified warning codes: ${unclassified.join(", ")}`).toEqual([]);
  });

  it("classifies no code the server cannot emit", () => {
    // A stale entry is a claim about behaviour that no longer exists.
    const emitted = emittedWarningCodes();
    const stale = Object.keys(WARNING_CLASSIFICATION).filter((code) => !emitted.has(code));
    expect(stale, `classified but never emitted: ${stale.join(", ")}`).toEqual([]);
  });

  it("assigns the reviewed codes to the class their own message states", () => {
    const expected: Record<string, WarningClass> = {
      file_upload_missing: "delivery_failure",
      file_unreadable: "source_rejected",
      file_oversized: "source_rejected",
      media_class_mismatch: "source_rejected",
      structured_artifact_unrecognized: "source_rejected",
      media_sanitization_failed: "retained_private",
      media_sanitization_unsupported: "retained_private",
      media_sanitization_limit: "retained_private",
      media_publish_deferred: "deferred_publication",
      file_too_large_to_parse: "deferred_publication",
      duplicate_media_ignored: "harmless_duplicate",
      price_list_duplicate_ignored: "harmless_duplicate",
      file_declared_size_mismatch: "enrichment_note",
    };
    for (const [code, cls] of Object.entries(expected)) {
      expect(classifyWarning(code), code).toBe(cls);
    }
  });

  it("treats exactly two classes as critical, and no more", () => {
    expect([...CRITICAL_WARNING_CLASSES]).toEqual(["delivery_failure", "source_rejected"]);
    expect([...RETAINED_WARNING_CLASSES]).toEqual(["retained_private", "deferred_publication"]);
  });

  it("does NOT classify every warning as a failure", () => {
    for (const code of [
      "duplicate_media_ignored",
      "price_list_duplicate_ignored",
      "media_publish_deferred",
      "media_sanitization_failed",
      "file_declared_size_mismatch",
    ]) {
      expect(isCriticalWarning(warn(code)), code).toBe(false);
    }
  });

  it("defaults an unrecognised code to a note rather than inventing a failure", () => {
    expect(classifyWarning("some_code_that_does_not_exist")).toBe("enrichment_note");
    expect(isCriticalWarning(warn("some_code_that_does_not_exist"))).toBe(false);
  });

  it("counts each class separately", () => {
    const tally = countWarningsByClass([
      warn("file_upload_missing"),
      warn("file_unreadable"),
      warn("media_sanitization_limit"),
      warn("media_publish_deferred"),
      warn("duplicate_media_ignored"),
      warn("file_declared_size_mismatch"),
    ]);
    expect(tally).toEqual({
      delivery_failure: 1,
      source_rejected: 1,
      retained_private: 1,
      deferred_publication: 1,
      harmless_duplicate: 1,
      enrichment_note: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// CORRECTION 3 — critical sources are separated out for direct display
// ---------------------------------------------------------------------------

describe("critical sources are exposed for direct rendering", () => {
  it("splits warnings into critical, retained and collapsible groups", () => {
    const outcome = describePublicationOutcome({
      status: "published",
      pagePath: "/projects/x",
      counts: counts(4, 4, 4),
      warnings: [
        warn("file_upload_missing"),
        warn("media_class_mismatch"),
        warn("media_sanitization_limit"),
        warn("media_publish_deferred"),
        warn("duplicate_media_ignored"),
        warn("file_declared_size_mismatch"),
      ],
      failedUploads: [],
    });
    expect(outcome.criticalWarnings.map((w) => w.code)).toEqual([
      "file_upload_missing",
      "media_class_mismatch",
    ]);
    expect(outcome.retainedWarnings.map((w) => w.code)).toEqual([
      "media_sanitization_limit",
      "media_publish_deferred",
    ]);
    expect(outcome.enrichmentWarnings.map((w) => w.code)).toEqual([
      "duplicate_media_ignored",
      "file_declared_size_mismatch",
    ]);
  });

  it("never leaves a critical warning inside the collapsible group", () => {
    for (const code of Object.keys(WARNING_CLASSIFICATION)) {
      const outcome = describePublicationOutcome({
        status: "published",
        pagePath: "/projects/x",
        counts: counts(1, 1, 1),
        warnings: [warn(code)],
        failedUploads: [],
      });
      if (isCriticalWarning(warn(code))) {
        expect(outcome.criticalWarnings, code).toHaveLength(1);
        expect(outcome.enrichmentWarnings, code).toHaveLength(0);
      } else {
        expect(outcome.criticalWarnings, code).toHaveLength(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// LEVELS — and the product rules that must NOT change
// ---------------------------------------------------------------------------

describe("publication outcome levels", () => {
  it("COMPLETE only when a page published and no critical problem was seen", () => {
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

  it("PARTIAL when the page has content but a source was lost or rejected", () => {
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

  it("leaves an empty page with NO critical problem as complete", () => {
    // THE DURABLE PRODUCT RULE. Every material window is optional, and a
    // facts-only update legitimately produces no units, prices or media.
    // Reclassifying it would create an approval gate that does not exist.
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

  it("does not degrade a publication for a harmless duplicate", () => {
    const outcome = describePublicationOutcome({
      status: "published",
      pagePath: "/projects/x",
      counts: counts(9, 9, 9),
      warnings: [warn("duplicate_media_ignored"), warn("price_list_duplicate_ignored")],
      failedUploads: [],
    });
    expect(outcome.level).toBe("complete");
    expect(outcome.serverHarmlessDuplicateCount).toBe(2);
  });

  it("does not degrade a publication for retained or deferred material", () => {
    // The ORIGINAL is stored and intact; only the public derivative is absent,
    // and no Owner action changes that. It is surfaced plainly instead — see
    // `retainedWarnings` — but calling the run "partly published" would
    // conflate a platform-side derivative limit with a lost source, which is
    // the exact conflation this correction exists to stop.
    const outcome = describePublicationOutcome({
      status: "published",
      pagePath: "/projects/x",
      counts: counts(9, 9, 0),
      warnings: [warn("media_sanitization_unsupported"), warn("media_publish_deferred")],
      failedUploads: [],
    });
    expect(outcome.level).toBe("complete");
    expect(outcome.serverRetainedPrivateCount).toBe(1);
    expect(outcome.serverDeferredPublicationCount).toBe(1);
    expect(outcome.retainedWarnings).toHaveLength(2);
  });

  it("producedNoContent means PROVABLY empty, not merely unknown", () => {
    // null is "the run reported no tally", which is not "the page has nothing".
    // Claiming the stronger thing would tell the Owner their page is empty on
    // no evidence.
    expect(producedNoContent(null)).toBe(false);
    expect(producedNoContent(counts(0, 0, 0))).toBe(true);
    expect(producedNoContent(counts(0, 0, 1))).toBe(false);
  });

  it("an unknown tally with a lost source is PARTIAL, never 'empty'", () => {
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

describe("no success wording may survive a lost or rejected source", () => {
  it("never emits the old constant heading unless the outcome is complete", () => {
    const cases = [
      { warnings: [warn("file_upload_missing")], failedUploads: [], counts: counts(1, 1, 1) },
      { warnings: [], failedUploads: ["x.jpg"], counts: counts(1, 1, 1) },
      { warnings: [warn("media_class_mismatch")], failedUploads: [], counts: counts(1, 1, 1) },
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
