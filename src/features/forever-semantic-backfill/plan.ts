/**
 * Building the manifest — the reviewable artifact
 * (FOREVER-SEMANTIC-MEDIA-BACKFILL-001).
 *
 * Pure. No filesystem, no clock, no network, no randomness. Everything variable
 * — the time, the commit, the bytes read off disk — is an argument, so two runs
 * over the same inputs produce byte-identical output and a digest can therefore
 * mean something. A single `new Date()` in here would make every plan differ
 * from every other plan and turn the stale-approval guard into noise.
 *
 * PLAN PER URL, EMIT PER ROW. The decision is made once for the URL, because
 * `prohibitedPhotographUrls` is per URL and Sierra's active cover is one URL on
 * two rows. The write is then fanned out to every row that URL holds, because
 * `forever_project_media_semantic_projection` matches on the full natural key
 * `(project_id, media_type, url)` and would silently skip a row it was not
 * given. Those two facts are not in tension; they are why the plan and the
 * payload have different shapes.
 *
 * Every array is explicitly byte-sorted. Insertion order here is directory
 * listing order, which differs between machines.
 */

import { isSemanticRole, type SemanticRole } from "../forever-direct-publish/hero-policy";
import {
  isGalleryEligibleRole,
  NEVER_PUBLIC_ROLES,
  type RecordedMedia,
} from "../../lib/public-media-policy";
import { acceptanceExpectations } from "./acceptance";
import { byteSort } from "./canonical";
import { buildExceptions } from "./exceptions";
import {
  idempotencyKey,
  manifestBodyDigest,
  packageStateDigest,
  plannedChangeDigest,
  productionRoleDigest,
  productionStructureDigest,
} from "./fingerprints";
import { candidatesByObjectPath, objectPathFromUrl } from "./package-evidence";
import { needsReview, resolveRoleForUrl, strictnessBand } from "./role-resolution";
import { urlsOf } from "./production-snapshot";
import {
  BACKFILL_SCHEMA_VERSION,
  REFUSED_PROJECT_REFS,
  TARGET_PROJECT_REF,
  type Acknowledgement,
  type BackfillManifest,
  type ManifestProject,
  type ManifestUrl,
  type PackageEvidenceSet,
  type PresentationEffect,
  type ProductionSnapshot,
  type ReviewRequiredEntry,
  type SnapshotMediaRow,
  type SnapshotProject,
} from "./types";

const APPLY_RULE =
  "Recompute policy_digest, package_state_digest, manifest_body_digest and " +
  "production_structure_digest at apply time. On ANY mismatch, refuse and re-review. " +
  "There is no --force.";

const COLUMNS_WRITTEN = ["public.project_media.semantic_role"];
const COLUMNS_NEVER_WRITTEN = [
  "public.project_media.media_type",
  "public.project_media.url",
  "public.project_media.sort_order",
  "public.project_media.metadata",
  "public.project_media.title",
  "public.projects.main_image_url",
];
const RELATIONS_NEVER_WRITTEN = [
  "public.units",
  "public.unit_price_history",
  "public.buildings",
  "public.projects",
];

/**
 * What a visitor stops seeing, computed from the real policy.
 *
 * Deliberately not a lookup table. `isGalleryEligibleRole` and
 * `NEVER_PUBLIC_ROLES` are the functions the readers ask, so asking them here
 * means the manifest's prediction cannot drift from the page's behaviour. A
 * table would have to be edited in step with a policy change and one day would
 * not be.
 */
function presentationEffect(
  role: SemanticRole | null,
  url: string,
  mainImageUrl: string | null,
): PresentationEffect {
  if (role === null) return "role_less_exception";
  if (NEVER_PUBLIC_ROLES.has(role)) return "leaves_every_surface";
  if (isGalleryEligibleRole(role)) return "visible_unchanged";
  return url === (mainImageUrl ?? "") ? "leaves_gallery_and_cover" : "leaves_gallery";
}

/** The rows as they will be once the plan is applied — for acceptance and totals. */
function projectedRows(
  project: SnapshotProject,
  roleByUrl: Map<string, SemanticRole | null>,
): RecordedMedia[] {
  return project.media.map((row) => ({
    mediaType: row.mediaType,
    url: row.url,
    semanticRole: roleByUrl.get(row.url) ?? row.semanticRole ?? null,
  }));
}

export interface BuildBackfillManifestInput {
  snapshot: ProductionSnapshot;
  evidenceBySlug: ReadonlyMap<string, PackageEvidenceSet[]>;
  policy: { digest: string; inputs: Array<{ path: string; sha256: string }> };
  generatorCommit: string;
  generatedAt: string;
  acknowledgements: readonly Acknowledgement[];
}

export function buildBackfillManifest(input: BuildBackfillManifestInput): BackfillManifest {
  const acknowledgementByKey = new Map(
    input.acknowledgements.map((entry) => [
      `${entry.projectSlug} ${entry.url.trim()}`,
      entry.acknowledgement,
    ]),
  );
  const reviewRequired: ReviewRequiredEntry[] = [];
  const projects: ManifestProject[] = [];
  const allEvidence: PackageEvidenceSet[] = [];

  const orderedProjects = [...input.snapshot.projects].sort((a, b) =>
    byteSort([a.slug, b.slug])[0] === a.slug ? -1 : 1,
  );

  for (const project of orderedProjects) {
    const evidence = input.evidenceBySlug.get(project.slug) ?? [];
    allEvidence.push(...evidence);
    const byObjectPath = candidatesByObjectPath(evidence);
    const byUrl = urlsOf(project);

    const urls: ManifestUrl[] = [];
    const roleByUrl = new Map<string, SemanticRole | null>();

    for (const url of byteSort([...byUrl.keys()])) {
      const rows = [...(byUrl.get(url) ?? [])].sort(
        (a, b) =>
          (byteSort([a.mediaType, b.mediaType])[0] === a.mediaType ? -1 : 1) ||
          a.sortOrder - b.sortOrder,
      );
      const objectPath = objectPathFromUrl(url);
      const candidates = objectPath ? (byObjectPath.get(objectPath) ?? []) : [];
      const decision = resolveRoleForUrl(candidates);
      roleByUrl.set(url, decision.role);

      const key = `${project.slug} ${url}`;
      const acknowledgement = acknowledgementByKey.get(key) ?? null;

      urls.push({
        url,
        object_path: objectPath,
        rows: rows.map((row) => ({
          media_type: row.mediaType,
          sort_order: row.sortOrder,
          current_semantic_role: row.semanticRole,
        })),
        proposed_semantic_role: decision.role,
        evidence_tier: decision.winner?.tier ?? "none",
        evidence: decision.winner
          ? {
              input: decision.winner.input,
              input_value: decision.winner.inputValue,
              classifier_reason: decision.winner.classifierReason,
            }
          : null,
        origin: decision.winner
          ? {
              package_ref: decision.winner.packageRef,
              package_item_file: decision.winner.packageItemFile,
              original_sha256: decision.winner.originalSha256,
              derivative_sha256: decision.winner.derivativeSha256,
            }
          : null,
        conflict: decision.conflict,
        no_role_reason:
          decision.role !== null
            ? null
            : objectPath === null
              ? "not_a_public_url_bundled_asset_key"
              : decision.refusedCandidates.some((r) => r.why === "classifier_returned_unknown")
                ? "classifier_returned_unknown"
                : decision.refusedCandidates.some(
                      (r) => r.why === "superseded_manifest_may_only_hide",
                    )
                  ? "superseded_evidence_refused_may_only_hide"
                  : evidence.length === 0
                    ? "classification_unavailable_no_role_bearing_package"
                    : "classification_unavailable_no_evidence",
        refused_evidence: decision.refusedCandidates.map((entry) => ({
          tier: entry.candidate.tier,
          role: entry.candidate.role,
          input: entry.candidate.input,
          input_value: entry.candidate.inputValue,
          why: entry.why,
        })),
        presentation_effect: presentationEffect(decision.role, url, project.mainImageUrl),
        restrictive_override: decision.restrictiveOverride,
        requires_acknowledgement: decision.restrictiveOverride,
        acknowledgement: decision.restrictiveOverride ? acknowledgement : null,
      });

      if (needsReview(decision)) {
        reviewRequired.push({
          project_slug: project.slug,
          url,
          why: `conflict resolved to a restrictive role (${decision.role}) — this removes the image from a public surface`,
        });
      }
    }

    const after = projectedRows(project, roleByUrl);
    const proposedRoles: Record<string, number> = {};
    const excludedByRole: Record<string, number> = {};
    let rowsToUpdate = 0;
    let rowsLeftRoleLess = 0;
    let rowsLeaving = 0;

    for (const entry of urls) {
      if (entry.proposed_semantic_role) {
        rowsToUpdate += entry.rows.length;
        proposedRoles[entry.proposed_semantic_role] =
          (proposedRoles[entry.proposed_semantic_role] ?? 0) + entry.rows.length;
        if (!isGalleryEligibleRole(entry.proposed_semantic_role)) {
          excludedByRole[entry.proposed_semantic_role] =
            (excludedByRole[entry.proposed_semantic_role] ?? 0) + entry.rows.length;
        }
      } else {
        rowsLeftRoleLess += entry.rows.length;
      }
      if (
        entry.presentation_effect !== "visible_unchanged" &&
        entry.presentation_effect !== "role_less_exception"
      ) {
        rowsLeaving += entry.rows.length;
      }
    }

    const expectedPublicGallery = new Set(
      after
        .filter((row) => row.mediaType === "gallery" && isGalleryEligibleRole(row.semanticRole))
        .map((row) => row.url),
    ).size;

    const baseline = input.snapshot.businessBaseline.projects.find(
      (entry) => entry.projectId === project.projectId,
    );

    // The second cover row is recorded, not retired. Applying 20260728120000
    // performs no DML, so it survives; and retiring it would move it out of
    // GOVERNED_MEDIA_TYPES, making the gate cleaner by shrinking its
    // denominator — the same shape of false pass as writing "unknown".
    const retirementCandidates = byteSort(
      project.media
        .filter((row) => row.mediaType === "cover" && row.url !== (project.mainImageUrl ?? ""))
        .map((row) => row.url),
    ).map((url) => ({
      url,
      why: "second cover row; this backfill performs no DML",
      handled_by:
        roleByUrl.get(url) && !isGalleryEligibleRole(roleByUrl.get(url)!)
          ? `role ${roleByUrl.get(url)} bars it from every photograph surface`
          : "still presentable — its role does not bar it; retirement remains an Owner decision",
    }));

    const projected: SnapshotMediaRow[] = project.media.map((row) => ({
      ...row,
      semanticRole: roleByUrl.get(row.url) ?? row.semanticRole ?? null,
    }));

    const manifestProject: ManifestProject = {
      slug: project.slug,
      project_id: project.projectId,
      packages_consulted: evidence
        .map((set) => ({
          package_ref: set.packageRef,
          batch_fingerprint: set.batchFingerprint,
          produced_by_task: set.producedByTask,
          item_count: set.itemCount,
          carries_semantic_role: set.carriesSemanticRole,
          superseded: set.superseded,
        }))
        .sort((a, b) =>
          a.package_ref < b.package_ref ? -1 : a.package_ref > b.package_ref ? 1 : 0,
        ),
      production_rows: project.media.length,
      distinct_urls: byUrl.size,
      expected_active_cover: project.mainImageUrl,
      expected_retired_covers: [],
      retirement_candidates: retirementCandidates,
      role_digest_before: productionRoleDigest(project.media),
      role_digest_expected_after: productionRoleDigest(projected),
      urls,
      project_totals: {
        urls: urls.length,
        rows: project.media.length,
        rows_to_update: rowsToUpdate,
        rows_left_role_less: rowsLeftRoleLess,
        proposed_roles: proposedRoles,
        expected_public_gallery_count: expectedPublicGallery,
        expected_excluded_by_role: excludedByRole,
        rows_leaving_a_public_surface: rowsLeaving,
      },
      unchanged_expectations: {
        units: baseline?.units ?? null,
        units_sold: baseline?.unitsSold ?? null,
        unit_price_history_rows: baseline?.unitPriceHistoryRows ?? null,
        buildings: baseline?.buildings ?? null,
        project_media_rows: project.media.length,
        project_media_non_role_digest: null,
      },
      acceptance: acceptanceExpectations(project.slug),
    };

    projects.push(manifestProject);
  }

  const exceptions = buildExceptions(projects);

  const digestsWithoutKey = {
    policy_digest: input.policy.digest,
    package_state_digest: packageStateDigest(allEvidence),
    production_structure_digest: productionStructureDigest(input.snapshot),
    planned_change_digest: plannedChangeDigest(projects, exceptions),
    manifest_body_digest: "",
  };

  const manifest: BackfillManifest = {
    schema_version: BACKFILL_SCHEMA_VERSION,
    generated_at: input.generatedAt,
    generator_commit: input.generatorCommit,
    target: {
      project_ref: input.snapshot.projectRef,
      refuses_project_refs: [...REFUSED_PROJECT_REFS],
    },
    digests: { ...digestsWithoutKey, idempotency_key: "" },
    policy_inputs: input.policy.inputs,
    apply_rule: APPLY_RULE,
    write_scope: {
      columns_written: [...COLUMNS_WRITTEN],
      columns_never_written: [...COLUMNS_NEVER_WRITTEN],
      relations_never_written: [...RELATIONS_NEVER_WRITTEN],
    },
    review_required: reviewRequired.sort((a, b) =>
      a.project_slug === b.project_slug
        ? a.url < b.url
          ? -1
          : 1
        : a.project_slug < b.project_slug
          ? -1
          : 1,
    ),
    projects,
    exceptions,
    totals: {
      projects: projects.length,
      rows: projects.reduce((sum, project) => sum + project.production_rows, 0),
      rows_to_update: projects.reduce(
        (sum, project) => sum + project.project_totals.rows_to_update,
        0,
      ),
      exceptions: exceptions.length,
    },
  };

  // The body digest covers everything except the three fields that legitimately
  // differ per run, so it must be computed after the body is complete and then
  // folded into the identity.
  const bodyDigest = manifestBodyDigest(manifest);
  manifest.digests.manifest_body_digest = bodyDigest;
  manifest.digests.idempotency_key = idempotencyKey(
    { ...digestsWithoutKey, manifest_body_digest: bodyDigest },
    input.snapshot.projectRef,
    BACKFILL_SCHEMA_VERSION,
  );
  for (const exception of manifest.exceptions) {
    exception.manifestIdempotencyKey = manifest.digests.idempotency_key;
  }

  return manifest;
}

/** The target this plan may be applied to, refusing staging by literal. */
export function planTargetIsPermitted(manifest: BackfillManifest): boolean {
  return (
    manifest.target.project_ref === TARGET_PROJECT_REF &&
    !REFUSED_PROJECT_REFS.includes(manifest.target.project_ref)
  );
}

/** Convenience for reports: how strict a planned role is, for a whole project. */
export function bandCounts(project: ManifestProject): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const url of project.urls) {
    const role = url.proposed_semantic_role;
    const key = role && isSemanticRole(role) ? `band_${strictnessBand(role)}` : "no_role";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
