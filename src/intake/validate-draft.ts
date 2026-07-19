/**
 * Fast Intake v1 — draft-only payload validation boundary.
 *
 * This mirrors, invariant-for-invariant, the `-ValidateOnly` path of
 * `scripts/import/Import-ForeverProjectDraft.ps1` so intake can validate its
 * generated payload with no database credentials, no database client, no
 * network, and no write. It additionally recomputes the deterministic batch
 * fingerprint from content (the PowerShell path checks only its format), so a
 * tampered or stale payload fails closed here too.
 *
 * The PowerShell script remains the canonical Windows import path; the exact
 * command to run it is printed by the CLI. This port never imports it and
 * never runs an import.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { fingerprintBatch } from "@/features/forever-ingestion/build-batch";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export class DraftValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftValidationError";
  }
}

export interface DraftValidationResult {
  ok: true;
  slug: string;
  payloadSha256: string;
  fingerprint: string;
  fingerprintVerified: boolean;
  counts: {
    projects: number;
    buildings: number;
    units: number;
    prices: number;
    media: number;
    documents: number;
    warnings: number;
    batches: number;
  };
  marker: string;
}

function requireArrayCount(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  if (value === undefined) return 0;
  if (!Array.isArray(value)) throw new DraftValidationError(`payload.${key} must be an array.`);
  return value.length;
}

/**
 * Validate a parsed payload object against the draft-only invariants. Returns
 * the count summary and fingerprint verdict, or throws DraftValidationError.
 */
export function validateDraftPayload(
  payload: unknown,
  payloadSha256: string,
): DraftValidationResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new DraftValidationError("payload must be a JSON object.");
  }
  const batch = payload as Record<string, unknown>;
  const project = batch.project as Record<string, unknown> | undefined;
  const slug = typeof project?.slug === "string" ? project.slug : "";

  if (!slug || !SLUG_PATTERN.test(slug)) {
    throw new DraftValidationError("payload.project.slug must be a lowercase slug.");
  }
  if (batch.schema_version !== "1") {
    throw new DraftValidationError('payload.schema_version must be "1".');
  }
  if (batch.mode !== "create") {
    throw new DraftValidationError('Draft project imports require payload.mode="create".');
  }
  if (!project || project.publish !== false) {
    throw new DraftValidationError("Draft project imports require payload.project.publish=false.");
  }
  if (typeof project.name !== "string" || project.name.trim().length === 0) {
    throw new DraftValidationError("payload.project.name is required.");
  }
  const fingerprint = typeof batch.batch_fingerprint === "string" ? batch.batch_fingerprint : "";
  if (!SHA256_PATTERN.test(fingerprint)) {
    throw new DraftValidationError(
      "payload.batch_fingerprint must be a lowercase SHA-256 hexadecimal value.",
    );
  }

  const counts = {
    projects: 1,
    buildings: requireArrayCount(batch, "buildings"),
    units: requireArrayCount(batch, "units"),
    prices: requireArrayCount(batch, "prices"),
    media: requireArrayCount(batch, "media"),
    documents: requireArrayCount(batch, "documents"),
    warnings: requireArrayCount(batch, "warnings"),
    batches: 1,
  };
  if (counts.documents !== 0) {
    throw new DraftValidationError(
      "payload.documents is not supported by the ordinary importer; import documents separately.",
    );
  }

  // Stronger-than-PowerShell integrity: recompute the content fingerprint.
  const { batch_fingerprint, ...body } = batch;
  void batch_fingerprint;
  const recomputed = fingerprintBatch(body as never);
  const fingerprintVerified = recomputed === fingerprint;
  if (!fingerprintVerified) {
    throw new DraftValidationError(
      `batch_fingerprint does not match payload content (declared ${fingerprint}, recomputed ${recomputed}).`,
    );
  }

  const marker =
    `DRAFT_PAYLOAD_VALID|slug=${slug}|sha256=${payloadSha256}` +
    `|buildings=${counts.buildings}|units=${counts.units}|prices=${counts.prices}` +
    `|media=${counts.media}|documents=${counts.documents}|warnings=${counts.warnings}`;

  return {
    ok: true,
    slug,
    payloadSha256,
    fingerprint,
    fingerprintVerified,
    counts,
    marker,
  };
}

/** Validate a payload file on disk (UTF-8, BOM-tolerant). */
export function validateDraftPayloadFile(payloadPath: string): DraftValidationResult {
  const raw = readFileSync(payloadPath);
  const payloadSha256 = createHash("sha256").update(raw).digest("hex");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new DraftValidationError(
      `Payload is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return validateDraftPayload(parsed, payloadSha256);
}
