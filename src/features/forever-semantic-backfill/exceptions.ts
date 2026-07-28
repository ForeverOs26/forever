/**
 * Written exceptions — one file, no translation step
 * (FOREVER-SEMANTIC-MEDIA-BACKFILL-001).
 *
 * The census gate already has an exceptions format, and it reads exactly three
 * fields: `projectSlug`, `url`, and a `reason` that must not be blank. It
 * performs no schema validation and ignores everything else, so the richer
 * record the Owner needs can be a SUPERSET of the shape the gate consumes —
 * which means the file the controller writes is the file the gate is handed.
 *
 * That matters more than it sounds. The alternative is two files: a rich one
 * for the review and a reduced one for the gate. The reduced one would be
 * generated at some point in the process, and from then on the release evidence
 * and the release decision would be describing two different sets of rows.
 *
 * Two caveats the gate cannot own, so this module does:
 *
 *   An entry MISSING `reason` throws a `TypeError` inside
 *   `buildRoleCompletenessReport` (`exception.reason.trim()` on `undefined`).
 *   The runner's top-level catch turns that into exit 2 with a redacted
 *   message — it fails closed, but with no diagnostic anyone can act on. So the
 *   builder refuses to emit such an entry at all.
 *
 *   `expiry` is not honoured. The gate has no concept of time and an expired
 *   exception excuses its row forever. `expiresAfterRelease` is therefore
 *   enforced here and by `verify`, never by the gate.
 */

import { writeFileSync } from "node:fs";

import { isSemanticRole } from "../forever-direct-publish/hero-policy";
import { assertNoPrivatePaths, canonicalJson } from "./canonical";
import { strictnessBand } from "./role-resolution";
import {
  EXCEPTION_REASON_CODES,
  type BackfillException,
  type ExceptionReasonCode,
  type ManifestProject,
  type ManifestUrl,
  type ValidationIssue,
} from "./types";

/** The release this set of exceptions was written for. */
export const EXPIRES_AFTER_RELEASE = "FOREVER-SEMANTIC-MEDIA-BACKFILL-001";

function reasonCodeFor(url: ManifestUrl): ExceptionReasonCode {
  if (url.object_path === null) return "not_a_public_url_bundled_asset_key";
  return url.no_role_reason ?? "classification_unavailable_no_evidence";
}

const REASON_TEXT: Record<ExceptionReasonCode, string> = {
  not_a_public_url_bundled_asset_key:
    "Seeded placeholder row: the url is a bundled-asset key, not a URL. No storage object " +
    "exists for it, resolveMediaUrl returns an empty string, the slug is quarantined by " +
    "KNOWN_FICTITIOUS_PROJECT_SLUGS, and nothing renders it. Nothing can classify it.",
  classification_unavailable_no_evidence:
    "No local package explains this object. Its bytes are not on this machine, so no " +
    "section, no original path and no recorded role exist to read. Left role-less rather " +
    "than guessed at from its filename.",
  classification_unavailable_no_role_bearing_package:
    "The only local package for this project predates the semantic_role field, and no " +
    "role-bearing package exists on disk. Regenerating one needs network access to the " +
    "original source, which this lane does not perform.",
  classifier_returned_unknown:
    "The classifier read the available evidence and returned unknown — no section and no " +
    "filename evidence. unknown is inside the vocabulary and is gallery-eligible, so " +
    "writing it would satisfy the gate numerically while asserting nothing.",
  superseded_evidence_refused_may_only_hide:
    "The only role recorded for this object comes from a package produced by a policy " +
    "version known to be wrong, and it would put the image BACK on a public surface. A " +
    "superseded manifest is believed when it hides and refused when it reveals.",
};

const OWNER_ACTION: Record<ExceptionReasonCode, string> = {
  not_a_public_url_bundled_asset_key:
    "Deactivate per docs/FOREVER_TRUTH_001A_PRODUCTION_CLEANUP_PLAN.md, or accept permanently.",
  classification_unavailable_no_evidence:
    "Supply the source bytes or a role-bearing package, then re-plan.",
  classification_unavailable_no_role_bearing_package:
    "Regenerate the package with source access, then re-plan. Do not hand-write a role.",
  classifier_returned_unknown:
    "Record a role in the source package and regenerate, or accept the row as undescribed.",
  superseded_evidence_refused_may_only_hide:
    "Confirm the subject from the original source and record the role in a current package.",
};

const RE_EVALUATE: Record<ExceptionReasonCode, string> = {
  not_a_public_url_bundled_asset_key:
    "the project is deactivated, or a real image is published for it",
  classification_unavailable_no_evidence: "the source bytes become available locally",
  classification_unavailable_no_role_bearing_package:
    "a role-bearing package for this project exists on disk",
  classifier_returned_unknown: "a package records a role for this object",
  superseded_evidence_refused_may_only_hide:
    "a current, non-superseded package records a role for this object",
};

function presentationDecisionFor(url: ManifestUrl, code: ExceptionReasonCode): string {
  if (code === "not_a_public_url_bundled_asset_key") return "renders_nothing_project_quarantined";
  const governed = url.rows.some(
    (row) => row.media_type === "cover" || row.media_type === "gallery",
  );
  return governed
    ? "shown_as_before — a role-less row is shown, because absence of a role is not evidence"
    : "shown_in_its_own_section_as_before";
}

/**
 * One exception per (project, URL) that has no proposed role.
 *
 * The key omits `media_type` because the gate's key omits it, so one entry
 * covers every governed row of that URL — which is what Sierra's dual-typed
 * hero needs and what stops the file and the gate disagreeing about how many
 * rows an entry accounts for.
 */
export function buildExceptions(projects: readonly ManifestProject[]): BackfillException[] {
  const entries: BackfillException[] = [];
  for (const project of projects) {
    for (const url of project.urls) {
      if (url.proposed_semantic_role !== null) continue;
      const reasonCode = reasonCodeFor(url);
      const mediaTypes = [...new Set(url.rows.map((row) => row.media_type))].sort();
      entries.push({
        projectSlug: project.slug,
        url: url.url,
        reason: REASON_TEXT[reasonCode],
        projectId: project.project_id,
        mediaType: mediaTypes.join("+"),
        objectIdentifier: url.object_path ?? `bundled-asset-key:${url.url}`,
        reasonCode,
        publicPresentationDecision: presentationDecisionFor(url, reasonCode),
        ownerActionRequired: OWNER_ACTION[reasonCode],
        reEvaluateWhen: RE_EVALUATE[reasonCode],
        expiresAfterRelease: EXPIRES_AFTER_RELEASE,
        // Filled in by the planner once the manifest identity exists. It cannot
        // be known here: the identity is a digest OVER this list.
        manifestIdempotencyKey: "",
      });
    }
  }
  return entries.sort((a, b) =>
    a.projectSlug === b.projectSlug
      ? a.url < b.url
        ? -1
        : a.url > b.url
          ? 1
          : 0
      : a.projectSlug < b.projectSlug
        ? -1
        : 1,
  );
}

export function validateExceptions(entries: readonly BackfillException[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const where = { projectSlug: entry.projectSlug, url: entry.url };
    if (!entry.projectSlug || !entry.projectSlug.trim()) {
      issues.push({
        ...where,
        code: "exception_missing_project_slug",
        message: "projectSlug is blank.",
      });
    }
    if (!entry.url || !entry.url.trim()) {
      issues.push({ ...where, code: "exception_missing_url", message: "url is blank." });
    }
    // The gate reads `.reason.trim()` unconditionally. A missing reason is a
    // TypeError inside the gate, not a validation failure with a diagnostic.
    if (typeof entry.reason !== "string" || !entry.reason.trim()) {
      issues.push({
        ...where,
        code: "exception_missing_reason",
        message:
          "reason is blank or absent. The gate would either excuse nothing (blank) or throw a " +
          "TypeError and exit 2 with no diagnostic (absent).",
      });
    }
    if (!EXCEPTION_REASON_CODES.includes(entry.reasonCode)) {
      issues.push({
        ...where,
        code: "exception_unknown_reason_code",
        message: `reasonCode "${entry.reasonCode}" is not in the vocabulary.`,
      });
    }
    const key = `${entry.projectSlug} ${entry.url.trim()}`;
    if (seen.has(key)) {
      issues.push({
        ...where,
        code: "exception_duplicate",
        message:
          "Two entries excuse the same (projectSlug, url); the gate would apply the last one.",
      });
    }
    seen.add(key);
  }
  return issues;
}

/**
 * An exception must never be the thing that hides a defect.
 *
 * If any evidence for a URL says the image is band 0 or band 1 — people, or
 * text and drawings among the photographs — then it is classifiable and must be
 * classified. Excusing it instead would leave it role-less, and a role-less row
 * is SHOWN by every reader. The exception would make the gate pass while
 * keeping the launch party on the page: the precise inversion this contract
 * exists to prevent.
 */
export function exceptionsHidingProhibited(
  projects: readonly ManifestProject[],
  entries: readonly BackfillException[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const excused = new Set(entries.map((entry) => `${entry.projectSlug} ${entry.url.trim()}`));
  for (const project of projects) {
    for (const url of project.urls) {
      if (!excused.has(`${project.slug} ${url.url.trim()}`)) continue;
      const damning = [
        ...(url.conflict ? url.conflict.losing : []),
        ...url.refused_evidence,
      ].filter(
        (candidate) => isSemanticRole(candidate.role) && strictnessBand(candidate.role) <= 1,
      );
      if (damning.length === 0) continue;
      issues.push({
        projectSlug: project.slug,
        url: url.url,
        code: "exception_hides_prohibited",
        message:
          `Evidence describes this URL as ${damning.map((c) => c.role).join(", ")} — a role that ` +
          `removes it from a public surface — yet it is being excused instead of classified. A ` +
          `role-less row is shown; the exception would keep it public.`,
      });
    }
  }
  return issues;
}

/**
 * The exact bytes of the exceptions file.
 *
 * A BARE ARRAY. `readExceptions` in the census runner does `JSON.parse` then
 * `Array.isArray(parsed)` and exits 2 on anything else, so wrapping the entries
 * in an object with a `schema_version` — which would otherwise be the obvious
 * thing to do — makes the file unusable by the one consumer it exists for.
 */
export function serialiseExceptions(entries: readonly BackfillException[]): string {
  const text = canonicalJson(entries);
  assertNoPrivatePaths(text, "The exceptions file");
  return text;
}

/**
 * Write the file the census gate will be handed, refusing first.
 *
 * The refusal happens before the write, not after: a file already on disk with
 * a home directory in it has leaked whether or not anything notices next.
 */
export function writeExceptionsFile(path: string, entries: readonly BackfillException[]): void {
  const issues = validateExceptions(entries);
  if (issues.length > 0) {
    throw new Error(
      `Refusing to write an exceptions file the gate cannot use:\n` +
        issues.map((issue) => `  ${issue.code} ${issue.url ?? ""} — ${issue.message}`).join("\n"),
    );
  }
  writeFileSync(path, serialiseExceptions(entries), "utf8");
}
