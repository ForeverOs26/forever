/**
 * Refusing a manifest that would do something other than what it says
 * (FOREVER-SEMANTIC-MEDIA-BACKFILL-001).
 *
 * The digest guards answer "is this the file that was reviewed?". These rules
 * answer the earlier question: "is this file safe to review?" — because a
 * manifest can be internally consistent, correctly digested, and still describe
 * a write that quietly defeats the gate it is meant to satisfy.
 *
 * Each rule below has a failure it was written for, not a category it belongs
 * to. Every one is unit-tested with a fixture that trips it.
 */

import { isSemanticRole, SEMANTIC_ROLES } from "../forever-direct-publish/hero-policy";
import { exceptionsHidingProhibited, validateExceptions } from "./exceptions";
import {
  BACKFILL_SCHEMA_VERSION,
  REFUSED_PROJECT_REFS,
  type BackfillManifest,
  type ValidationIssue,
} from "./types";

export function validateBackfillManifest(manifest: BackfillManifest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (code: string, message: string, projectSlug?: string, url?: string) =>
    issues.push({ code, message, projectSlug, url });

  if (manifest.schema_version !== BACKFILL_SCHEMA_VERSION) {
    add(
      "schema_version_unknown",
      `schema_version is "${manifest.schema_version}"; this build applies only ` +
        `"${BACKFILL_SCHEMA_VERSION}".`,
    );
  }

  // The refusal is by literal and it is in the file, so an operator reading the
  // manifest can see which target it will not touch without running anything.
  for (const refused of REFUSED_PROJECT_REFS) {
    if (manifest.target.project_ref === refused) {
      add("target_is_refused_ref", `The manifest targets refused project ref ${refused}.`);
    }
    if (!manifest.target.refuses_project_refs.includes(refused)) {
      add(
        "target_refusal_missing",
        `The manifest does not record ${refused} as refused, so it does not state its own limits.`,
      );
    }
  }

  // V7 — the write scope is the claim the invariant check enforces. If the file
  // claims a wider scope than one column, the transaction's assertions are no
  // longer sufficient evidence for what it did.
  if (
    manifest.write_scope.columns_written.length !== 1 ||
    manifest.write_scope.columns_written[0] !== "public.project_media.semantic_role"
  ) {
    add(
      "write_scope_widened",
      `write_scope.columns_written must be exactly ["public.project_media.semantic_role"]; ` +
        `found ${JSON.stringify(manifest.write_scope.columns_written)}.`,
    );
  }

  const knownProjects = new Set(manifest.projects.map((project) => project.project_id));
  const slugById = new Map(manifest.projects.map((project) => [project.project_id, project.slug]));

  for (const project of manifest.projects) {
    // V8 — a project_id nothing in the plan describes would be written to
    // without a review of its rows.
    if (!project.project_id || !/^[0-9a-f-]{36}$/i.test(project.project_id)) {
      add("unknown_project", `project_id "${project.project_id}" is not a UUID.`, project.slug);
    }

    // V6 — retirement is out of scope and must stay out. Retiring a cover moves
    // the row out of GOVERNED_MEDIA_TYPES, which makes the gate cleaner by
    // shrinking its denominator: the same false-pass shape as writing "unknown".
    if (project.expected_retired_covers.length > 0) {
      add(
        "retirement_out_of_scope",
        `${project.expected_retired_covers.length} cover(s) are listed for retirement. This ` +
          `backfill performs no DML; retirement is a publication decision and shrinking the ` +
          `governed denominator is not a way to pass the gate.`,
        project.slug,
      );
    }

    const rolesSeenForUrl = new Map<string, Set<string>>();
    let fannedOut = 0;

    for (const entry of project.urls) {
      const role = entry.proposed_semantic_role;

      if (role !== null) {
        // V1 — the CHECK constraint from 20260728120000 would reject an
        // out-of-vocabulary value AFTER the bytes are already public.
        if (!isSemanticRole(role)) {
          add(
            "role_out_of_vocabulary",
            `"${role}" is not one of the ${SEMANTIC_ROLES.length} roles; the database CHECK would ` +
              `reject it mid-run.`,
            project.slug,
            entry.url,
          );
        }
        // V1b — the `unknown` trap. It is in the vocabulary and is
        // gallery-eligible, so writing it passes the after_backfill gate while
        // classifying nothing.
        if (role === "unknown") {
          add(
            "role_is_unknown",
            `proposed_semantic_role is "unknown". Writing it would satisfy the gate numerically ` +
              `and assert nothing; a URL with no established role belongs in the exceptions file.`,
            project.slug,
            entry.url,
          );
        }
        // V2 — a planned URL with no rows writes nothing at all, silently.
        if (entry.rows.length === 0) {
          add(
            "fanout_incomplete",
            `A role is proposed for a URL that holds no production rows, so the RPC would match ` +
              `nothing and the count assertion would fail mid-transaction.`,
            project.slug,
            entry.url,
          );
        }
        fannedOut += entry.rows.length;

        const seen = rolesSeenForUrl.get(entry.url) ?? new Set<string>();
        seen.add(role);
        rolesSeenForUrl.set(entry.url, seen);
      }

      // V9 — a plan built against a stale snapshot would propose a role for a
      // row that already carries a different one, and the write would be a
      // silent overwrite rather than a fill.
      for (const row of entry.rows) {
        if (row.current_semantic_role && row.current_semantic_role !== role) {
          add(
            "current_role_would_be_overwritten",
            `Row ${row.media_type}@${row.sort_order} already records ` +
              `"${row.current_semantic_role}" and the plan proposes "${role ?? "(none)"}". This ` +
              `backfill fills empty roles; it does not revise recorded ones.`,
            project.slug,
            entry.url,
          );
        }
      }

      if (entry.requires_acknowledgement && !entry.acknowledgement) {
        add(
          "acknowledgement_missing",
          `The winning role came from a superseded package and no acknowledgement was recorded. ` +
            `Using such a package is defensible per row and never wholesale.`,
          project.slug,
          entry.url,
        );
      }
    }

    // V3 — one URL, two roles. Sierra's active cover is one URL on two rows;
    // giving them different roles bars it everywhere and the project loses its
    // hero. The plan is per URL precisely so this cannot arise, so if it does,
    // something reshaped the file.
    for (const [url, roles] of rolesSeenForUrl) {
      if (roles.size > 1) {
        add(
          "per_url_role_conflict",
          `Two different roles are proposed for one URL (${[...roles].join(", ")}). ` +
            `prohibitedPhotographUrls is per URL: the strictest would bar it on every surface.`,
          project.slug,
          url,
        );
      }
    }

    if (fannedOut !== project.project_totals.rows_to_update) {
      add(
        "fanout_incomplete",
        `project_totals.rows_to_update says ${project.project_totals.rows_to_update} but the URLs ` +
          `fan out to ${fannedOut} rows. The transaction asserts the RPC's return value against ` +
          `the total, so the two must agree or every run rolls back.`,
        project.slug,
      );
    }

    const urlCount = new Set(project.urls.map((entry) => entry.url)).size;
    if (urlCount !== project.urls.length) {
      add(
        "duplicate_url_entry",
        `The same URL appears more than once in this project's plan.`,
        project.slug,
      );
    }
  }

  // V5 and the gate's own consumption rules.
  for (const issue of validateExceptions(manifest.exceptions)) issues.push(issue);
  // V4 — an exception must never be what hides a classifiable defect.
  for (const issue of exceptionsHidingProhibited(manifest.projects, manifest.exceptions)) {
    issues.push(issue);
  }

  for (const exception of manifest.exceptions) {
    const slug = slugById.get(exception.projectId);
    if (!knownProjects.has(exception.projectId) || slug !== exception.projectSlug) {
      add(
        "exception_project_mismatch",
        `Exception names project ${exception.projectId}/${exception.projectSlug}, which does not ` +
          `match any project in this manifest. The gate keys on the slug, so a mismatch excuses ` +
          `nothing while appearing to.`,
        exception.projectSlug,
        exception.url,
      );
    }
  }

  const totalRows = manifest.projects.reduce((sum, project) => sum + project.production_rows, 0);
  if (manifest.totals.rows !== totalRows) {
    add(
      "totals_inconsistent",
      `totals.rows says ${manifest.totals.rows}; the projects hold ${totalRows}.`,
    );
  }

  return issues;
}

/** Format issues for a report — one line each, most specific context first. */
export function formatValidationIssues(issues: readonly ValidationIssue[]): string {
  return issues
    .map((issue) => {
      const where = [issue.projectSlug, issue.url].filter(Boolean).join(" ");
      return `  ${issue.code}${where ? ` [${where}]` : ""} — ${issue.message}`;
    })
    .join("\n");
}
