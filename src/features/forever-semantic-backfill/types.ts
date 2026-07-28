/**
 * The shapes this backfill reads, plans and emits
 * (FOREVER-SEMANTIC-MEDIA-BACKFILL-001).
 *
 * Two naming conventions live here and the split is deliberate.
 *
 *   Working types — `SnapshotMediaRow`, `EvidenceCandidate`, `RoleDecision` —
 *   are camelCase, because they never leave the process.
 *
 *   Emitted types — `BackfillManifest` and everything under it — are snake_case,
 *   because the JSON file IS the reviewed artifact and the exceptions block is
 *   consumed verbatim by `scripts/media/role-completeness-report.mjs`. Renaming
 *   on the way out would mean two shapes to keep in step, and the one that
 *   drifts is always the one nothing reads back.
 *
 * Relative imports only. A `.mjs` runner loads this tree through jiti, and jiti
 * does not resolve the tsconfig `@/` alias.
 */

import type { SemanticRole } from "../forever-direct-publish/hero-policy";

export type { SemanticRole };

export const BACKFILL_SCHEMA_VERSION = "forever-semantic-media-backfill.v1";
export const SNAPSHOT_SCHEMA_VERSION = "forever-production-media-snapshot.v1";
export const JOURNAL_SCHEMA_VERSION = "forever-semantic-media-backfill-journal.v1";

/** The one permitted write target, restated so this module can be read alone. */
export const TARGET_PROJECT_REF = "abtvsrcnfwlbawvrjeed";
/** Present only so it can be recognised and refused. Never a target. */
export const REFUSED_PROJECT_REFS: readonly string[] = ["garjibjhlzeljsnpzisu"];

// ---------------------------------------------------------------------------
// Production snapshot
// ---------------------------------------------------------------------------

export interface SnapshotMediaRow {
  projectId: string;
  mediaType: string;
  url: string;
  sortOrder: number;
  /** Whatever production holds today. Normally `null` before the backfill. */
  semanticRole: string | null;
}

export interface SnapshotProject {
  projectId: string;
  slug: string;
  name: string;
  isActive: boolean;
  publicStatus: string;
  mainImageUrl: string | null;
  media: SnapshotMediaRow[];
}

/**
 * Counts of the business relations this backfill must not touch.
 *
 * Recorded so the plan can state, per project, exactly what it expects to be
 * unchanged. The transaction re-derives them and enforces the expectation; this
 * is the number the Owner reads beforehand.
 */
export interface BusinessBaselineProject {
  projectId: string;
  units: number;
  unitsSold: number;
  unitPriceHistoryRows: number;
  buildings: number;
}

export interface BusinessBaseline {
  /**
   * `head_count_exact` — captured over HTTP with `Prefer: count=exact`, so no
   * business row body was ever fetched. `psql_count` — read from a database
   * connection. `unavailable` — not captured; the plan says so rather than
   * printing a zero it did not measure.
   */
  capturedBy: "head_count_exact" | "psql_count" | "unavailable";
  projects: BusinessBaselineProject[];
}

export interface ProductionSnapshot {
  schemaVersion: string;
  /** Informational. Excluded from every digest, so a re-capture is comparable. */
  capturedAt: string;
  /** Informational. Excluded from every digest. */
  source: "postgrest_get" | "psql_read";
  projectRef: string;
  /**
   * Whether `project_media.semantic_role` existed when the snapshot was taken.
   *
   * `false` is the expected state today — migration 20260728120000 is unapplied
   * in production — and it is why the planner must never require a current role
   * to be present in order to plan a new one.
   */
  semanticRoleColumnPresent: boolean;
  projects: SnapshotProject[];
  businessBaseline: BusinessBaseline;
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/**
 * How a proposed role was arrived at, highest authority first.
 *
 * `none` is a real tier, not a placeholder: a URL with no evidence at all is a
 * fact the manifest states, and the row becomes a written exception rather than
 * quietly acquiring a role.
 */
export type EvidenceTier =
  | "package_manifest_semantic_role"
  | "package_manifest_source_path"
  | "extracted_manifest_source_inventory"
  | "local_source_tree_content_hash"
  | "package_folder_convention"
  | "planner_geometry_rule"
  | "superseded_package_manifest"
  | "none";

export interface EvidenceCandidate {
  tier: EvidenceTier;
  role: SemanticRole;
  /** The field the classifier read, e.g. `media[12].drive_source_path`. */
  input: string;
  /** Its literal value, so a reviewer can disagree with the input, not only the verdict. */
  inputValue: string;
  /** `SemanticAssessment.reason`, verbatim. Never paraphrased. */
  classifierReason: string;
  packageRef: string;
  packageItemFile: string;
  originalSha256: string;
  derivativeSha256: string;
  /** `direct/<slug>/<sha24>.<ext>` — recomputed, never parsed out of a URL. */
  objectPath: string;
}

export interface PackageEvidenceSet {
  /** Directory basename. Never an absolute path: those are private detail. */
  packageRef: string;
  batchFingerprint: string;
  producedByTask: string;
  itemCount: number;
  carriesSemanticRole: boolean;
  /**
   * Produced by a policy version known to be wrong.
   *
   * The pre-fix hero run declared `villa_exterior` for two Villa Kirara "House
   * Plan" sheets — the slug-word defect. Such a package may still be the only
   * record of a role for an image the corrected Factory dropped, so it is kept
   * and constrained rather than discarded: see `role-resolution`.
   */
  superseded: boolean;
  candidates: EvidenceCandidate[];
}

export interface ConflictRecord {
  winning_role: SemanticRole;
  winning_tier: EvidenceTier;
  losing: Array<{ role: SemanticRole; tier: EvidenceTier; input: string; input_value: string }>;
  /** Why the winner won, in the words of the rule that decided it. */
  resolution: string;
}

// ---------------------------------------------------------------------------
// Manifest (emitted; snake_case is the contract)
// ---------------------------------------------------------------------------

/**
 * What the visitor sees change, computed from the real presentation policy
 * rather than looked up in a table this module maintains separately.
 */
export type PresentationEffect =
  | "visible_unchanged"
  | "leaves_gallery"
  | "leaves_gallery_and_cover"
  | "leaves_every_surface"
  | "role_less_exception";

export interface ManifestRow {
  media_type: string;
  sort_order: number;
  current_semantic_role: string | null;
}

export interface ManifestUrl {
  url: string;
  object_path: string | null;
  rows: ManifestRow[];
  /** `null` when nothing could be established. Never the string `"unknown"`. */
  proposed_semantic_role: SemanticRole | null;
  evidence_tier: EvidenceTier;
  evidence: { input: string; input_value: string; classifier_reason: string } | null;
  origin: {
    package_ref: string;
    package_item_file: string;
    original_sha256: string;
    derivative_sha256: string;
  } | null;
  conflict: ConflictRecord | null;
  /**
   * Why no role was proposed, when none was.
   *
   * Without this the exceptions builder cannot tell "nothing on this machine
   * explains these bytes" from "a superseded package tried to reveal and was
   * refused" — both leave `evidence_tier: "none"`. They are different facts
   * about the world and the Owner's next action differs for each.
   */
  no_role_reason: ExceptionReasonCode | null;
  /**
   * Evidence that was read and then rejected, with the rule that rejected it.
   *
   * Recorded because a reviewer must be able to disagree with the refusal. It
   * is also what `exception_hides_prohibited` reads: a URL that some package
   * calls `event` may not be quietly excused.
   */
  refused_evidence: Array<{
    tier: EvidenceTier;
    role: SemanticRole;
    input: string;
    input_value: string;
    why: string;
  }>;
  presentation_effect: PresentationEffect;
  /** True when a superseded package supplied the winning role. */
  restrictive_override: boolean;
  requires_acknowledgement: boolean;
  /** Present only when `requires_acknowledgement`; the operator's recorded words. */
  acknowledgement: string | null;
}

export interface PackageConsulted {
  package_ref: string;
  batch_fingerprint: string;
  produced_by_task: string;
  item_count: number;
  carries_semantic_role: boolean;
  superseded: boolean;
}

export interface ProjectTotals {
  urls: number;
  rows: number;
  rows_to_update: number;
  rows_left_role_less: number;
  proposed_roles: Record<string, number>;
  expected_public_gallery_count: number;
  expected_excluded_by_role: Record<string, number>;
  rows_leaving_a_public_surface: number;
}

export interface UnchangedExpectations {
  units: number | null;
  units_sold: number | null;
  unit_price_history_rows: number | null;
  buildings: number | null;
  project_media_rows: number;
  /**
   * `null` whenever the snapshot could not carry it, which is the normal case:
   * the capture runner never selects `title` or `metadata`, precisely because
   * `metadata` is the column the privacy migration exists to hide. The
   * invariant is still ENFORCED — the transaction computes this digest before
   * and after the write and rolls back on any difference — it simply cannot be
   * predicted from a snapshot that deliberately did not read those columns.
   */
  project_media_non_role_digest: string | null;
}

export interface AcceptanceExpectation {
  id: string;
  checkable: boolean;
  expected: string;
}

export interface RetirementCandidate {
  url: string;
  why: string;
  handled_by: string;
}

export interface ManifestProject {
  slug: string;
  project_id: string;
  packages_consulted: PackageConsulted[];
  production_rows: number;
  distinct_urls: number;
  expected_active_cover: string | null;
  /** Always empty. Retirement is out of scope — see `apply-plan`. */
  expected_retired_covers: string[];
  retirement_candidates: RetirementCandidate[];
  role_digest_before: string;
  role_digest_expected_after: string;
  urls: ManifestUrl[];
  project_totals: ProjectTotals;
  unchanged_expectations: UnchangedExpectations;
  acceptance: AcceptanceExpectation[];
}

export interface ManifestDigests {
  policy_digest: string;
  package_state_digest: string;
  production_structure_digest: string;
  planned_change_digest: string;
  manifest_body_digest: string;
  idempotency_key: string;
}

/**
 * One written exception, in the exact shape the census gate already consumes.
 *
 * `projectSlug`, `url` and a non-blank `reason` are the only fields
 * `buildRoleCompletenessReport` reads; everything after them is carried for the
 * human reviewer and ignored by the gate. That is what lets one file be both
 * the proposal and the gate input, with no translation step to drift.
 */
export interface BackfillException {
  projectSlug: string;
  url: string;
  reason: string;
  projectId: string;
  mediaType: string;
  objectIdentifier: string;
  reasonCode: ExceptionReasonCode;
  publicPresentationDecision: string;
  ownerActionRequired: string;
  reEvaluateWhen: string;
  expiresAfterRelease: string;
  manifestIdempotencyKey: string;
}

export const EXCEPTION_REASON_CODES = [
  "not_a_public_url_bundled_asset_key",
  "classification_unavailable_no_evidence",
  "classification_unavailable_no_role_bearing_package",
  "classifier_returned_unknown",
  "superseded_evidence_refused_may_only_hide",
] as const;

export type ExceptionReasonCode = (typeof EXCEPTION_REASON_CODES)[number];

export interface ReviewRequiredEntry {
  project_slug: string;
  url: string;
  why: string;
}

export interface BackfillManifest {
  schema_version: string;
  /** Informational. Excluded from `manifest_body_digest`. */
  generated_at: string;
  /** Informational. Excluded from `manifest_body_digest`. */
  generator_commit: string;
  target: { project_ref: string; refuses_project_refs: string[] };
  digests: ManifestDigests;
  policy_inputs: Array<{ path: string; sha256: string }>;
  apply_rule: string;
  write_scope: {
    columns_written: string[];
    columns_never_written: string[];
    relations_never_written: string[];
  };
  review_required: ReviewRequiredEntry[];
  projects: ManifestProject[];
  exceptions: BackfillException[];
  totals: { projects: number; rows: number; rows_to_update: number; exceptions: number };
}

/**
 * An operator's recorded acknowledgement of one restrictive-override row.
 *
 * A superseded package may only ever HIDE an image, and even then somebody has
 * to say so per URL. This is the shape of that statement; it is an input to the
 * planner, never something the planner can invent for itself.
 */
export interface Acknowledgement {
  projectSlug: string;
  url: string;
  acknowledgement: string;
}

export interface ValidationIssue {
  code: string;
  projectSlug?: string;
  url?: string;
  message: string;
}
