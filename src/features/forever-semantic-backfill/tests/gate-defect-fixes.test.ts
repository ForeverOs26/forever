/**
 * The four confirmed defects in the release gate this backfill depends on.
 *
 * These are not this task's code — they are PR #117's — and they are fixed here
 * because the after_backfill gate is the instrument the whole backfill is
 * measured by. A hole in it makes every other assurance unverifiable.
 *
 * Each test fails without its fix.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildRoleCompletenessReport,
  evaluateReleaseGate,
  formatRoleCompletenessReport,
  GOVERNED_MEDIA_TYPES,
  type MediaCensusRow,
} from "../../forever-direct-publish/role-completeness";

const REPO = process.cwd();
const HARNESS = readFileSync(join(REPO, "scripts/media/run-semantic-media-pg-tests.mjs"), "utf8");
const GATE = readFileSync(join(REPO, "scripts/media/role-completeness-report.mjs"), "utf8");

describe("D1 — payment_plan is a public document the census must govern", () => {
  it("is in GOVERNED_MEDIA_TYPES", () => {
    // publicMediaTypeForCategory("payment-plan") produces the type, and both
    // readers render it: DOCUMENT_LABELS.payment_plan is "Payment Plan" and
    // project-sections.ts looks it up in project.media.documents.
    expect(GOVERNED_MEDIA_TYPES).toContain("payment_plan");
  });

  it("blocks the after_backfill gate when a payment plan is role-less", () => {
    const rows: MediaCensusRow[] = [
      { projectSlug: "modeva", mediaType: "gallery", url: "u1", semanticRole: "property_exterior" },
      { projectSlug: "modeva", mediaType: "payment_plan", url: "u2", semanticRole: null },
    ];
    const report = buildRoleCompletenessReport(rows);
    // Without the fix, isGoverned drops the row and it appears in NO line of
    // the report — not the numerator, not the denominator, not "not counted".
    expect(report.governed).toBe(2);
    expect(report.unexplained.map((row) => row.url)).toEqual(["u2"]);
    expect(evaluateReleaseGate(report, "after_backfill").passed).toBe(false);
  });

  it("appears in the printed governed-types list the Owner reads", () => {
    const report = buildRoleCompletenessReport([]);
    const text = formatRoleCompletenessReport(
      report,
      evaluateReleaseGate(report, "before_backfill"),
    );
    expect(text).toContain("payment_plan");
  });

  it("is mirrored by the harness's own SQL literal, or Path B's count check breaks", () => {
    expect(HARNESS).toContain("'brochure','payment_plan','video'");
  });
});

describe("D2 — the excluded-count check must count the way EXCLUDED_SQL counts", () => {
  it("derives the expectation from the same predicate, not from all - governed", () => {
    // EXCLUDED_SQL takes every media_type except price_list, including
    // superseded_cover which the governed list omits on purpose; and a retired
    // cover on a PUBLISHED project belongs to neither side of the subtraction.
    expect(HARNESS).toContain("const excludedInDb = Number(");
    expect(HARNESS).toContain("p.public_status IS DISTINCT FROM 'published'");
    expect(HARNESS).not.toContain("excludedReported === allInDb - governedInDb");
  });
});

describe("D3 — the retired-row check must be scoped the way the report is scoped", () => {
  it("joins projects and filters to published", () => {
    // The census derives `retired` from rows CENSUS_SQL already restricted to
    // is_active AND published; an unscoped count compared two different sets.
    const block = HARNESS.slice(
      HARNESS.indexOf("const retiredInDb"),
      HARNESS.indexOf("retiredReported"),
    );
    expect(block).toContain("JOIN public.projects p ON p.id = m.project_id");
    expect(block).toContain("p.is_active AND p.public_status = 'published'");
  });
});

describe("D4 — the report must describe what it actually counted", () => {
  it("no longer calls every excluded media type a cover/gallery row", () => {
    expect(GATE).toContain("media row(s) of projects that are not ");
    expect(GATE).not.toContain("cover/gallery row(s) of projects");
  });
});
