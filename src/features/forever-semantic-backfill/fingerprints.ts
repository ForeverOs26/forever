/**
 * The digests that make a stale approval unusable
 * (FOREVER-SEMANTIC-MEDIA-BACKFILL-001).
 *
 * The dangerous failure of a reviewed backfill is not a wrong role. It is a
 * RIGHT role applied to a world that has moved: the policy was fixed, or a
 * package was regenerated, or somebody published a project, between the review
 * and the run. Nothing in the manifest looks different afterwards, and the
 * write lands on rows nobody looked at.
 *
 * So the approval is bound to its inputs. Each digest below covers exactly one
 * input, and the apply step recomputes all of them:
 *
 *   policy_digest              the classification and presentation rules
 *   package_state_digest       the local evidence on disk
 *   production_structure_digest what rows exist in the target
 *   planned_change_digest      what this run intends to write
 *   manifest_body_digest       the reviewed file itself, minus its own header
 *   idempotency_key            all of the above plus the target ref
 *
 * There is no `--force`. A mismatch means the thing that was approved is not
 * the thing in front of us, and the correct response is to re-plan and
 * re-review, which costs minutes. Overriding costs a production page.
 *
 * Pure: no I/O. Callers read the files; this module hashes what they read.
 */

import {
  byteSort,
  digestRecords,
  md5Hex,
  normaliseText,
  record,
  sha256Hex,
  canonicalJson,
  UNIT_SEP,
} from "./canonical";
import type {
  BackfillException,
  BackfillManifest,
  ManifestDigests,
  ManifestProject,
  PackageEvidenceSet,
  ProductionSnapshot,
  SnapshotMediaRow,
} from "./types";

/**
 * Files whose exact text decides what a role means.
 *
 * `hero-policy.ts` holds the vocabulary, `ELIGIBILITY`, `GALLERY_ELIGIBILITY`
 * and `classifySemanticRole`. `role-completeness.ts` decides which rows the
 * release gate governs — widening it changes which rows the plan must cover.
 * `public-media-policy.ts` decides what a role DOES to a page, which is what
 * every `presentation_effect` in the manifest is computed from.
 *
 * A policy edit legitimately changes the right answer for a URL: the Villa
 * Kirara "House Plan" sheets went from `villa_exterior` to `plan` when the
 * slug-word defect was fixed. An approval taken before that fix must not be
 * applicable after it.
 */
export const POLICY_INPUT_FILES: readonly string[] = [
  "src/features/forever-direct-publish/hero-policy.ts",
  "src/features/forever-direct-publish/role-completeness.ts",
  "src/lib/public-media-policy.ts",
];

export function policyDigest(files: ReadonlyArray<{ path: string; contents: string }>): {
  digest: string;
  inputs: Array<{ path: string; sha256: string }>;
} {
  const inputs = files
    .map((file) => ({ path: file.path, sha256: sha256Hex(normaliseText(file.contents)) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { digest: digestRecords(inputs.map((i) => record(i.path, i.sha256))), inputs };
}

/**
 * The local evidence, as bytes.
 *
 * A package header record is emitted alongside its items so that regenerating a
 * package to the same item list but a different `batch_fingerprint` still moves
 * the digest. The fingerprint is the Factory's own statement about which
 * sources produced the package, and two packages with identical files but
 * different sources are not interchangeable evidence.
 */
export function packageStateDigest(packages: readonly PackageEvidenceSet[]): string {
  const records: string[] = [];
  for (const set of packages) {
    records.push(record(set.packageRef, set.batchFingerprint, "#package", set.itemCount, ""));
    for (const candidate of set.candidates) {
      records.push(
        record(
          set.packageRef,
          set.batchFingerprint,
          candidate.packageItemFile,
          candidate.originalSha256,
          candidate.tier === "package_manifest_semantic_role" ? candidate.role : "",
        ),
      );
    }
  }
  return digestRecords(records);
}

/**
 * What rows exist in the target, and what the project header says about them.
 *
 * Deliberately excludes `semantic_role`: the roles are what this run changes,
 * and folding them in here would make the structure guard fail against a
 * partially applied run instead of letting the per-project three-way
 * classification recognise it. Structure is compared EXACTLY; roles are
 * compared per project, with "already applied" as a legitimate outcome.
 */
export function productionStructureDigest(snapshot: ProductionSnapshot): string {
  const records: string[] = [];
  for (const project of snapshot.projects) {
    records.push(
      record(
        project.projectId,
        project.slug,
        "#project",
        project.isActive,
        project.publicStatus,
        project.mainImageUrl ?? "",
      ),
    );
    for (const row of project.media) {
      records.push(record(project.projectId, row.mediaType, row.url, row.sortOrder));
    }
  }
  return digestRecords(records);
}

/**
 * The per-project role digest, in the exact form the database computes it.
 *
 * This one is md5 and it is NOT `digestRecords`, because it has to equal
 * `PROJECT_ROLE_DIGEST_SQL` evaluated inside the write transaction — a client
 * digest the server cannot reproduce would be decoration. The server sorts with
 * `COLLATE "C"`, which is bytewise, which is what `byteSort` gives; the field
 * separator is `|` and the row separator is a newline because that is what fits
 * in a `string_agg`, and neither can appear in a `media_type` or a role.
 *
 * A URL could in principle contain `|`. It cannot collide anything here: the
 * digest is only ever compared against itself, computed the same way on both
 * sides, and a URL is the last field of its line.
 */
export function productionRoleDigest(
  rows: readonly SnapshotMediaRow[],
  projectId?: string,
): string {
  const lines = rows
    .filter((row) => projectId === undefined || row.projectId === projectId)
    .map((row) => `${row.mediaType}|${row.url}|${row.semanticRole ?? ""}`);
  return md5Hex(byteSort(lines).join("\n"));
}

/** What this run intends to write, and what it intends to excuse. */
export function plannedChangeDigest(
  projects: readonly ManifestProject[],
  exceptions: readonly BackfillException[],
): string {
  const records: string[] = [];
  for (const project of projects) {
    for (const url of project.urls) {
      if (!url.proposed_semantic_role) continue;
      for (const row of url.rows) {
        records.push(
          record(
            project.project_id,
            row.media_type,
            url.url,
            url.proposed_semantic_role,
            url.evidence_tier,
          ),
        );
      }
    }
  }
  for (const exception of exceptions) {
    records.push(
      record(
        "#exception",
        exception.projectId,
        exception.url,
        exception.mediaType,
        exception.reasonCode,
      ),
    );
  }
  return digestRecords(records);
}

/**
 * The reviewed file, minus the three fields that legitimately differ per run.
 *
 * `generated_at` and `generator_commit` are provenance, not content, and
 * `digests` cannot include itself. Everything else — every URL, every role,
 * every classifier reason, every acknowledgement — is covered, so hand-editing
 * a single word of a reason string invalidates the approval. That is intended:
 * the reasons are the reviewable part.
 */
export function manifestBodyDigest(manifest: BackfillManifest): string {
  const {
    generated_at: _generatedAt,
    generator_commit: _generatorCommit,
    digests: _digests,
    ...body
  } = manifest;
  void _generatedAt;
  void _generatorCommit;
  void _digests;
  return sha256Hex(
    canonicalJson({
      ...body,
      // `manifestIdempotencyKey` is a digest OVER this body, so it cannot also
      // be inside it — the value would have to be known before it is computed.
      // Stripped on both sides, so a re-read of the written file recomputes the
      // same digest and a hand-edited reason still invalidates the approval.
      exceptions: body.exceptions.map(({ manifestIdempotencyKey: _key, ...rest }) => {
        void _key;
        return rest;
      }),
    }),
  );
}

/**
 * The run's identity, and the journal's `run_id`.
 *
 * Binding the target ref into it is what stops a journal from one database
 * being replayed against another: a resume against a different ref cannot even
 * find its own records.
 */
export function idempotencyKey(
  digests: Omit<ManifestDigests, "idempotency_key">,
  projectRef: string,
  schemaVersion: string,
): string {
  return sha256Hex(
    [
      digests.policy_digest,
      digests.package_state_digest,
      digests.production_structure_digest,
      digests.planned_change_digest,
      digests.manifest_body_digest,
      projectRef,
      schemaVersion,
    ].join(UNIT_SEP),
  );
}
