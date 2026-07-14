import { createHash } from "node:crypto";

import type { ImportOperation, ImportPlan } from "./types";

export const PLAN_FINGERPRINT_ALGORITHM = "sha256" as const;
export const PLAN_FINGERPRINT_SCHEMA_VERSION = "1" as const;
export const PLAN_FINGERPRINT_SHORT_LENGTH = 12;

export interface ImportOperationCounts {
  projects: number;
  buildings: number;
  units: number;
  priceHistoryRows: number;
  operations: number;
}

export interface PlanFingerprint {
  algorithm: typeof PLAN_FINGERPRINT_ALGORITHM;
  schemaVersion: typeof PLAN_FINGERPRINT_SCHEMA_VERSION;
  hash: string;
  shortHash: string;
  projectSlug: string;
  sourceVersion: string;
  operationCounts: ImportOperationCounts;
}

export interface DryRunReceipt {
  projectSlug: string;
  sourceVersion: string;
  planSha256: string;
  shortHash: string;
  operationCounts: ImportOperationCounts;
  generatedAt: string;
  confirmation: string;
  executeEnabled: false;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function canonicalOperation(operation: ImportOperation) {
  return {
    entity: operation.entity,
    action: operation.action,
    naturalKey: operation.naturalKey,
    dependencies: operation.dependsOn ?? [],
    payload: operation.payload,
  };
}

export function getImportOperationCounts(plan: ImportPlan): ImportOperationCounts {
  return {
    projects: plan.operations.filter((operation) => operation.entity === "project").length,
    buildings: plan.buildings.length,
    units: plan.units.length,
    priceHistoryRows: plan.priceHistoryRows.length,
    operations: plan.operations.length,
  };
}

export function fingerprintImportPlan(plan: ImportPlan): PlanFingerprint {
  const operationCounts = getImportOperationCounts(plan);
  const writeIntent = canonicalize({
    schemaVersion: PLAN_FINGERPRINT_SCHEMA_VERSION,
    projectSlug: plan.projectSlug,
    sourceVersion: plan.manifest.source_version,
    operationCounts,
    operations: plan.operations.map(canonicalOperation),
  });
  const hash = createHash(PLAN_FINGERPRINT_ALGORITHM)
    .update(JSON.stringify(writeIntent))
    .digest("hex");

  return {
    algorithm: PLAN_FINGERPRINT_ALGORITHM,
    schemaVersion: PLAN_FINGERPRINT_SCHEMA_VERSION,
    hash,
    shortHash: hash.slice(0, PLAN_FINGERPRINT_SHORT_LENGTH),
    projectSlug: plan.projectSlug,
    sourceVersion: plan.manifest.source_version,
    operationCounts,
  };
}

export function createDryRunReceipt(
  fingerprint: PlanFingerprint,
  generatedAt: Date = new Date(),
): DryRunReceipt {
  return {
    projectSlug: fingerprint.projectSlug,
    sourceVersion: fingerprint.sourceVersion,
    planSha256: fingerprint.hash,
    shortHash: fingerprint.shortHash,
    operationCounts: fingerprint.operationCounts,
    generatedAt: generatedAt.toISOString(),
    confirmation: `${fingerprint.projectSlug}:${fingerprint.shortHash}`,
    executeEnabled: false,
  };
}
