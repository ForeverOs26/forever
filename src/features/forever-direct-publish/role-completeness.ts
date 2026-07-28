/**
 * Role completeness — the gate that closes the rollout
 * (FOREVER-MEDIA-SEMANTIC-PUBLIC-CONTRACT-001).
 *
 * The public readers are deliberately permissive about a missing role: a row
 * with `semantic_role = NULL` is shown, because today every one of Forever's
 * published assets has no role and an include-list would have blanked the whole
 * site on the first deploy. That permissiveness is correct for the deploy and
 * wrong forever. Left in place it is a standing hole: any row that the backfill
 * misses, or that a future writer forgets to classify, is silently public and
 * indistinguishable from a row that was checked and found fine.
 *
 * So the rollout has two states, and this module is the boundary between them.
 *
 *   BEFORE the backfill — a role-less public row is expected. The report counts
 *   them and the gate is not applied.
 *
 *   AFTER the backfill — a role-less public row is a defect. Every `cover` and
 *   `gallery` row must carry a role, or be named in a written exception that
 *   says why. Anything else fails the gate and the release does not proceed.
 *
 * Two things this deliberately does NOT do.
 *
 * It does not classify anything. A role is assigned by the publish lane, from
 * the source package's own structure, and recorded. Nothing here — and nothing
 * in any browser — looks at a URL and decides what it depicts. A row this gate
 * cannot account for is reported, never guessed at.
 *
 * It does not perform the backfill, and it holds no credential. It is given
 * counts that some caller has already read, so it can be exercised exhaustively
 * against fixtures without a database, and so the only component that ever needs
 * a connection string is a script the Owner runs deliberately.
 */

import { isGalleryEligibleRole, isSemanticRole } from "./hero-policy";

/**
 * The media types this gate governs.
 *
 * Every type that can become a public image or a public document — which is
 * more than the photographs. `ProjectFloorPlans` renders each `floor_plan` row
 * as an `<img>` tile and `ProjectLocation` renders a `document` row as a
 * full-width figure, so a role-less row in either is an unguarded public image
 * for exactly the same reason a role-less gallery row is.
 *
 * Governing them only became possible once the publish lane started recording a
 * role for non-photograph media. Before that, every plan and document was
 * permanently role-less and this list would have described a gate that could
 * never pass.
 *
 * `superseded_cover` is deliberately absent: it is not presentation media, so
 * whether it carries a role changes nothing a visitor can see. The census counts
 * them separately and reports the number.
 */
export const GOVERNED_MEDIA_TYPES: readonly string[] = [
  "cover",
  "gallery",
  "floor_plan",
  "master_plan",
  "unit_plan",
  "document",
  "brochure",
  "video",
];

/** One row of the census, as a caller reads it out of `project_media`. */
export interface MediaCensusRow {
  projectSlug: string;
  mediaType: string;
  url: string;
  semanticRole: string | null;
}

/**
 * A role-less public row somebody has looked at and consciously accepted.
 *
 * Matched on the exact URL within one project, because that pair is the natural
 * key the database already enforces. A reason is required and is not allowed to
 * be blank: the point of an exception is that it is written down.
 */
export interface RoleLessException {
  projectSlug: string;
  url: string;
  reason: string;
}

export interface RoleCompletenessReport {
  /** Every governed row seen. */
  governed: number;
  /** Governed rows carrying a role in the vocabulary. */
  classified: number;
  /** Governed rows with no role at all. */
  roleLess: MediaCensusRow[];
  /** Role-less rows a written exception accounts for. */
  excused: Array<MediaCensusRow & { reason: string }>;
  /** Role-less rows nothing accounts for — the gate's subject. */
  unexplained: MediaCensusRow[];
  /**
   * Governed rows whose recorded role is prohibited from public presentation.
   *
   * Not a failure. The readers already exclude them, and they are exactly what
   * the contract was built to catch. Counted so the backfill's effect can be
   * compared against its dry run.
   */
  prohibited: MediaCensusRow[];
  /**
   * Rows carrying a value outside the vocabulary.
   *
   * A failure of a different kind: the database CHECK constraint should make it
   * impossible, so one appearing means the constraint was not applied.
   */
  outOfVocabulary: MediaCensusRow[];
  /** Per-role counts, for comparison against the backfill dry run. */
  byRole: Record<string, number>;
}

function isGoverned(row: MediaCensusRow): boolean {
  return GOVERNED_MEDIA_TYPES.includes(row.mediaType.trim());
}

function hasRole(row: MediaCensusRow): boolean {
  return Boolean(row.semanticRole && row.semanticRole.trim());
}

/**
 * The map key one written exception is matched on.
 *
 * A space is an unambiguous separator here, and provably so rather than by
 * hope: two different pairs could only collide if a slug contained the
 * separator, and a slug is `[a-z0-9-]`. So the left side can never absorb the
 * boundary, whatever the URL on the right contains.
 */
function exceptionKey(projectSlug: string, url: string): string {
  return `${projectSlug} ${url.trim()}`;
}

/**
 * Census the public media of a set of projects.
 *
 * Pure and total: it never throws, never reads a network, and returns the same
 * report for the same rows in any order.
 */
export function buildRoleCompletenessReport(
  rows: readonly MediaCensusRow[],
  exceptions: readonly RoleLessException[] = [],
): RoleCompletenessReport {
  const excused = new Map<string, string>();
  for (const exception of exceptions) {
    if (!exception.reason.trim()) continue;
    excused.set(exceptionKey(exception.projectSlug, exception.url), exception.reason.trim());
  }

  const governed = rows.filter(isGoverned);
  const roleLess: MediaCensusRow[] = [];
  const prohibited: MediaCensusRow[] = [];
  const outOfVocabulary: MediaCensusRow[] = [];
  const byRole: Record<string, number> = {};

  for (const row of governed) {
    if (!hasRole(row)) {
      roleLess.push(row);
      byRole["(none)"] = (byRole["(none)"] ?? 0) + 1;
      continue;
    }
    const role = row.semanticRole!.trim();
    byRole[role] = (byRole[role] ?? 0) + 1;
    if (!isSemanticRole(role)) {
      outOfVocabulary.push(row);
      continue;
    }
    if (!isGalleryEligibleRole(role)) prohibited.push(row);
  }

  const excusedRows: Array<MediaCensusRow & { reason: string }> = [];
  const unexplained: MediaCensusRow[] = [];
  for (const row of roleLess) {
    const reason = excused.get(exceptionKey(row.projectSlug, row.url));
    if (reason) excusedRows.push({ ...row, reason });
    else unexplained.push(row);
  }

  return {
    governed: governed.length,
    classified: governed.length - roleLess.length,
    roleLess,
    excused: excusedRows,
    unexplained,
    prohibited,
    outOfVocabulary,
    byRole,
  };
}

export type RolloutStage = "before_backfill" | "after_backfill";

export interface ReleaseGateVerdict {
  stage: RolloutStage;
  passed: boolean;
  /** One line per reason the gate refused, empty when it passed. */
  failures: string[];
  /** Stated observations that are not failures. */
  notes: string[];
}

/**
 * The release gate.
 *
 * Before the backfill it can only fail for a reason that is wrong at any stage —
 * a value outside the vocabulary means the CHECK constraint is not in place, and
 * no amount of backfilling fixes that.
 *
 * After the backfill an unexplained role-less public row fails it, full stop.
 * That is the whole point: the permissive reader is safe precisely because this
 * gate makes the permissive case temporary.
 */
export function evaluateReleaseGate(
  report: RoleCompletenessReport,
  stage: RolloutStage,
): ReleaseGateVerdict {
  const failures: string[] = [];
  const notes: string[] = [];

  if (report.outOfVocabulary.length > 0) {
    failures.push(
      `${report.outOfVocabulary.length} row(s) carry a semantic_role outside the vocabulary — ` +
        `the CHECK constraint from 20260728120000 is not in force: ` +
        report.outOfVocabulary
          .slice(0, 5)
          .map((row) => `${row.projectSlug} "${row.semanticRole}"`)
          .join(", "),
    );
  }

  if (stage === "before_backfill") {
    notes.push(
      `${report.roleLess.length} of ${report.governed} public image row(s) have no role yet. ` +
        `Expected before the backfill: readers show them, because absence of a role is not ` +
        `evidence of anything.`,
    );
  } else if (report.governed === 0) {
    // An empty census is not evidence that the backfill succeeded. It is far
    // more likely to mean the gate was pointed at an empty database, a wrong
    // schema, or a connection that returned nothing — and "zero unexplained
    // rows" would otherwise let all three pass as a completed rollout.
    failures.push(
      `The census found NO public image rows at all. After the backfill that is not a ` +
        `pass, it is a reason to doubt the connection: verify the database and the schema ` +
        `before treating this as release evidence.`,
    );
  } else if (report.unexplained.length > 0) {
    failures.push(
      `${report.unexplained.length} public image row(s) still have no semantic_role and no ` +
        `written exception: ` +
        report.unexplained
          .slice(0, 10)
          .map((row) => `${row.projectSlug} ${row.mediaType} ${row.url}`)
          .join(", "),
    );
  }

  if (report.excused.length > 0) {
    notes.push(
      `${report.excused.length} role-less row(s) are accounted for by a written exception.`,
    );
  }
  if (report.prohibited.length > 0) {
    notes.push(
      `${report.prohibited.length} row(s) carry a prohibited role and are excluded from every ` +
        `public surface by the presentation policy. This is the contract working, not a failure.`,
    );
  }

  return { stage, passed: failures.length === 0, failures, notes };
}

/** The report as a stable, diffable block of text for the release record. */
export function formatRoleCompletenessReport(
  report: RoleCompletenessReport,
  verdict: ReleaseGateVerdict,
): string {
  const lines: string[] = [];
  lines.push(`stage           : ${verdict.stage}`);
  lines.push(
    `governed rows   : ${report.governed} (media_type in ${GOVERNED_MEDIA_TYPES.join(", ")})`,
  );
  lines.push(`classified      : ${report.classified}`);
  lines.push(`role-less       : ${report.roleLess.length}`);
  lines.push(`  excused       : ${report.excused.length}`);
  lines.push(`  unexplained   : ${report.unexplained.length}`);
  lines.push(`prohibited      : ${report.prohibited.length}`);
  lines.push(`out of vocab    : ${report.outOfVocabulary.length}`);
  lines.push("per role:");
  for (const role of Object.keys(report.byRole).sort()) {
    lines.push(`  ${role.padEnd(24)} ${report.byRole[role]}`);
  }
  for (const note of verdict.notes) lines.push(`NOTE  ${note}`);
  for (const failure of verdict.failures) lines.push(`FAIL  ${failure}`);
  lines.push(verdict.passed ? "GATE  PASS" : "GATE  BLOCKED");
  return lines.join("\n");
}
