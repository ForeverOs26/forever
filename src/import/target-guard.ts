import {
  IMPORT_TARGET_REGISTRY,
  isImportTarget,
  type ImportTarget,
  type ImportTargetIdentity,
} from "./import-targets";
import type { ImportOperationCounts, PlanFingerprint } from "./plan-hash";

export type PreflightFailureCode =
  | "target_missing"
  | "target_unknown"
  | "production_blocked"
  | "staging_unconfigured"
  | "local_identity_invalid"
  | "project_slug_mismatch"
  | "plan_hash_mismatch"
  | "operation_counts_mismatch"
  | "source_version_missing"
  | "source_version_mismatch"
  | "confirmation_mismatch";

export interface ImportPreflightInput {
  requestedTarget?: string;
  requestedProjectSlug: string;
  actualPlanFingerprint: PlanFingerprint;
  expectedFullPlanHash: string;
  expectedOperationCounts: ImportOperationCounts;
  manifestSourceVersion: string;
  confirmation: string;
  targetIdentity?: ImportTargetIdentity;
}

export type ImportPreflightResult =
  | { ok: true; target: ImportTarget }
  | { ok: false; code: PreflightFailureCode; reason: string };

function failure(code: PreflightFailureCode, reason: string): ImportPreflightResult {
  return { ok: false, code, reason };
}

function countsEqual(left: ImportOperationCounts, right: ImportOperationCounts) {
  return (Object.keys(left) as Array<keyof ImportOperationCounts>).every(
    (key) => left[key] === right[key],
  );
}

export function runImportPreflight(input: ImportPreflightInput): ImportPreflightResult {
  const target = input.requestedTarget?.trim();
  if (!target) return failure("target_missing", "An explicit import target is required.");
  if (!isImportTarget(target)) {
    return failure("target_unknown", `Import target "${target}" is not recognized.`);
  }
  if (target === "production") {
    return failure(
      "production_blocked",
      "Production imports are blocked unconditionally in RC5.5A.",
    );
  }

  const targetDefinition = IMPORT_TARGET_REGISTRY[target];
  if (target === "staging" && !targetDefinition.expectedProjectId) {
    return failure(
      "staging_unconfigured",
      "Staging imports are blocked until an approved non-secret project identity is configured.",
    );
  }
  if (
    target === "local" &&
    (!targetDefinition.expectedProjectId ||
      input.targetIdentity?.projectId !== targetDefinition.expectedProjectId)
  ) {
    return failure(
      "local_identity_invalid",
      "Local imports require the approved local-only target identity.",
    );
  }

  const fingerprint = input.actualPlanFingerprint;
  if (input.requestedProjectSlug !== fingerprint.projectSlug) {
    return failure("project_slug_mismatch", "Requested project slug does not match the plan.");
  }
  if (input.expectedFullPlanHash !== fingerprint.hash) {
    return failure("plan_hash_mismatch", "Expected full plan hash does not match the plan.");
  }
  if (!countsEqual(input.expectedOperationCounts, fingerprint.operationCounts)) {
    return failure("operation_counts_mismatch", "Expected operation counts do not match the plan.");
  }
  if (!input.manifestSourceVersion.trim()) {
    return failure("source_version_missing", "Manifest source version is required.");
  }
  if (input.manifestSourceVersion !== fingerprint.sourceVersion) {
    return failure("source_version_mismatch", "Manifest source version does not match the plan.");
  }
  if (input.confirmation !== `${fingerprint.projectSlug}:${fingerprint.shortHash}`) {
    return failure(
      "confirmation_mismatch",
      "Confirmation must match the project slug and short plan hash.",
    );
  }

  return { ok: true, target };
}
