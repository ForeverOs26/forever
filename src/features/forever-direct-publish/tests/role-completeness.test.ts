/**
 * The rollout has two states, and the gate is the boundary
 * (FOREVER-MEDIA-SEMANTIC-PUBLIC-CONTRACT-001).
 *
 * The readers show a role-less row. That is correct on the day of the deploy and
 * indefensible a month later, so these tests exist to prove the permissive case
 * is temporary rather than permanent.
 */

import { describe, expect, it } from "vitest";

import { GALLERY_EXCLUDED_ROLES } from "../hero-policy";
import {
  buildRoleCompletenessReport,
  evaluateReleaseGate,
  formatRoleCompletenessReport,
  type MediaCensusRow,
} from "../role-completeness";

function row(overrides: Partial<MediaCensusRow> = {}): MediaCensusRow {
  return {
    projectSlug: "coralina",
    mediaType: "gallery",
    url: "https://cdn/a.jpg",
    semanticRole: null,
    ...overrides,
  };
}

describe("the census", () => {
  it("governs covers and gallery rows, and nothing else", () => {
    const report = buildRoleCompletenessReport([
      row({ mediaType: "cover", url: "https://cdn/1.jpg" }),
      row({ mediaType: "gallery", url: "https://cdn/2.jpg" }),
      row({ mediaType: "floor_plan", url: "https://cdn/3.pdf" }),
      row({ mediaType: "brochure", url: "https://cdn/4.pdf" }),
      row({ mediaType: "superseded_cover", url: "https://cdn/5.jpg" }),
    ]);
    expect(report.governed).toBe(2);
  });

  it("counts a role-less row without guessing what it depicts", () => {
    const report = buildRoleCompletenessReport([
      row({ url: "https://cdn/launch-party-group.jpg" }),
      row({ url: "https://cdn/b.jpg", semanticRole: "property_exterior" }),
    ]);
    expect(report.roleLess).toHaveLength(1);
    expect(report.classified).toBe(1);
    // The obvious filename is not evidence and must not be reported as a role.
    expect(report.byRole).toEqual({ "(none)": 1, property_exterior: 1 });
  });

  it("treats an empty or whitespace role as no role", () => {
    const report = buildRoleCompletenessReport([
      row({ url: "https://cdn/a.jpg", semanticRole: "" }),
      row({ url: "https://cdn/b.jpg", semanticRole: "   " }),
    ]);
    expect(report.roleLess).toHaveLength(2);
  });

  it("separates prohibited roles, which are the contract working", () => {
    const report = buildRoleCompletenessReport(
      [...GALLERY_EXCLUDED_ROLES].map((role) =>
        row({ url: `https://cdn/${role}.jpg`, semanticRole: role }),
      ),
    );
    expect(report.prohibited).toHaveLength(GALLERY_EXCLUDED_ROLES.size);
    expect(report.unexplained).toEqual([]);
  });

  it("flags a value the vocabulary does not contain", () => {
    const report = buildRoleCompletenessReport([
      row({ url: "https://cdn/a.jpg", semanticRole: "verified_amenity" }),
    ]);
    expect(report.outOfVocabulary).toHaveLength(1);
  });

  it("is order-independent", () => {
    const rows = [
      row({ url: "https://cdn/a.jpg", semanticRole: "property_exterior" }),
      row({ url: "https://cdn/b.jpg" }),
      row({ url: "https://cdn/c.jpg", semanticRole: "event" }),
    ];
    const forward = buildRoleCompletenessReport(rows);
    const reverse = buildRoleCompletenessReport([...rows].reverse());
    expect(forward.byRole).toEqual(reverse.byRole);
    expect(forward.governed).toBe(reverse.governed);
    expect(forward.unexplained).toHaveLength(reverse.unexplained.length);
  });
});

describe("written exceptions", () => {
  it("account for a role-less row when they name the project and the exact URL", () => {
    const report = buildRoleCompletenessReport(
      [row({ url: "https://cdn/a.jpg" })],
      [{ projectSlug: "coralina", url: "https://cdn/a.jpg", reason: "Owner-supplied, reviewed" }],
    );
    expect(report.excused).toHaveLength(1);
    expect(report.unexplained).toEqual([]);
  });

  it("do not carry across projects", () => {
    const report = buildRoleCompletenessReport(
      [row({ projectSlug: "sierra", url: "https://cdn/a.jpg" })],
      [{ projectSlug: "coralina", url: "https://cdn/a.jpg", reason: "reviewed" }],
    );
    expect(report.unexplained).toHaveLength(1);
  });

  it("are ignored when no reason is written", () => {
    const report = buildRoleCompletenessReport(
      [row({ url: "https://cdn/a.jpg" })],
      [{ projectSlug: "coralina", url: "https://cdn/a.jpg", reason: "   " }],
    );
    expect(report.unexplained).toHaveLength(1);
  });
});

describe("the release gate", () => {
  const roleLess = [row({ url: "https://cdn/a.jpg" }), row({ url: "https://cdn/b.jpg" })];

  it("passes before the backfill with role-less rows, and says so", () => {
    const report = buildRoleCompletenessReport(roleLess);
    const verdict = evaluateReleaseGate(report, "before_backfill");
    expect(verdict.passed).toBe(true);
    expect(verdict.notes.join(" ")).toContain("2 of 2");
  });

  it("blocks after the backfill on the same rows", () => {
    const report = buildRoleCompletenessReport(roleLess);
    const verdict = evaluateReleaseGate(report, "after_backfill");
    expect(verdict.passed).toBe(false);
    expect(verdict.failures.join(" ")).toContain("no semantic_role");
  });

  it("passes after the backfill once every governed row carries a role", () => {
    const report = buildRoleCompletenessReport([
      row({ url: "https://cdn/a.jpg", semanticRole: "property_exterior" }),
      row({ url: "https://cdn/b.jpg", semanticRole: "event" }),
      row({ mediaType: "cover", url: "https://cdn/c.jpg", semanticRole: "architecture_render" }),
    ]);
    expect(evaluateReleaseGate(report, "after_backfill").passed).toBe(true);
  });

  it("passes after the backfill when the only role-less rows are excused", () => {
    const report = buildRoleCompletenessReport(roleLess, [
      { projectSlug: "coralina", url: "https://cdn/a.jpg", reason: "reviewed by Owner" },
      { projectSlug: "coralina", url: "https://cdn/b.jpg", reason: "reviewed by Owner" },
    ]);
    expect(evaluateReleaseGate(report, "after_backfill").passed).toBe(true);
  });

  /**
   * A value outside the vocabulary means the CHECK constraint from the migration
   * is not in force, which no amount of backfilling repairs. It blocks at every
   * stage, including the one that tolerates missing roles.
   */
  it("blocks at BOTH stages on a value outside the vocabulary", () => {
    const report = buildRoleCompletenessReport([
      row({ url: "https://cdn/a.jpg", semanticRole: "logo" }),
    ]);
    expect(evaluateReleaseGate(report, "before_backfill").passed).toBe(false);
    expect(evaluateReleaseGate(report, "after_backfill").passed).toBe(false);
  });

  /**
   * `--stage` is self-declared, so the gate has to be suspicious of the shape of
   * a pass. "Zero unexplained role-less rows" is also what a wrong connection
   * string, an empty database and a wrong schema all look like.
   */
  it("blocks after the backfill when the census found nothing at all", () => {
    const report = buildRoleCompletenessReport([]);
    const verdict = evaluateReleaseGate(report, "after_backfill");
    expect(verdict.passed).toBe(false);
    expect(verdict.failures.join(" ")).toContain("NO public image rows");
  });

  it("does not block an empty census before the backfill", () => {
    // A fresh database with no projects yet is not a release failure.
    expect(evaluateReleaseGate(buildRoleCompletenessReport([]), "before_backfill").passed).toBe(
      true,
    );
  });

  it("never blocks merely because a role is prohibited", () => {
    const report = buildRoleCompletenessReport([
      row({ url: "https://cdn/a.jpg", semanticRole: "event" }),
      row({ url: "https://cdn/b.jpg", semanticRole: "text_promo" }),
    ]);
    const verdict = evaluateReleaseGate(report, "after_backfill");
    expect(verdict.passed).toBe(true);
    expect(verdict.notes.join(" ")).toContain("contract working");
  });

  /**
   * NEGATIVE CONTROL — the gate that never blocks.
   *
   * A gate whose after-backfill branch is missing passes the exact case it
   * exists for. If the real gate ever agrees with this one on role-less rows,
   * the rollout has no closing step.
   */
  it("negative control: a gate without the after-backfill branch is detectably wrong", () => {
    const report = buildRoleCompletenessReport(roleLess);
    const permissive = { passed: report.outOfVocabulary.length === 0 };
    expect(permissive.passed).toBe(true);
    expect(evaluateReleaseGate(report, "after_backfill").passed).toBe(false);
  });
});

describe("the printed report", () => {
  it("states the counts and the verdict without any URL classification", () => {
    const report = buildRoleCompletenessReport([
      row({ url: "https://cdn/a.jpg", semanticRole: "property_exterior" }),
      row({ url: "https://cdn/b.jpg" }),
    ]);
    const text = formatRoleCompletenessReport(
      report,
      evaluateReleaseGate(report, "after_backfill"),
    );
    expect(text).toContain("governed rows   : 2");
    expect(text).toContain("property_exterior");
    expect(text).toContain("GATE  BLOCKED");
  });

  it("is stable for the same input", () => {
    const rows = [row({ url: "https://cdn/a.jpg", semanticRole: "amenity" })];
    const once = buildRoleCompletenessReport(rows);
    const twice = buildRoleCompletenessReport(rows);
    expect(formatRoleCompletenessReport(once, evaluateReleaseGate(once, "before_backfill"))).toBe(
      formatRoleCompletenessReport(twice, evaluateReleaseGate(twice, "before_backfill")),
    );
  });
});
