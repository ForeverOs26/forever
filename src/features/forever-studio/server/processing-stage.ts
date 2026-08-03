/**
 * Forever Studio — sanitized processing-stage telemetry.
 *
 * A failed processing attempt used to record one word: `processing_failed`.
 * That is true of every failure, so it identifies none of them — and the
 * generic wrapper is exactly why the first real R2 production pilot could not
 * be diagnosed from its own job record. This module gives the pipeline a
 * closed vocabulary of stages, a stage-specific safe failure code, and an
 * ALLOWLISTED telemetry record.
 *
 * THE ALLOWLIST IS THE POINT. `StudioStageTelemetry` has exactly seven fields,
 * every one of them a bounded, non-identifying value: an enum member, a small
 * integer, or a boolean. There is no free-text field, so there is nowhere for a
 * filename, an object key, a bucket path, a presigned URL, a signature, a
 * credential, document content, an Owner id or a job id to be written — not by
 * accident, and not by a later edit that "just adds one more detail".
 *
 * PURE: no I/O, no environment, no credentials. Both the storage plane and the
 * orchestrator import it, and the invariants are testable on their own.
 */

import type { StudioStorageProviderId, StudioWorkflow } from "../studio-types";
import { StudioAccessError } from "./contracts";
import { StudioError } from "./errors";

/**
 * Every stage one processing attempt can fail in, in pipeline order.
 *
 * The list is deliberately finer-grained than the code paths strictly require:
 * `object_stat` and `object_read` are separate because the production failure
 * was a HEAD that never reached R2, and collapsing them back together would
 * hide precisely the distinction that took a forensic investigation to make.
 */
export const STUDIO_PROCESSING_STAGES = [
  /** Resolving the storage provider the JOB recorded (never the deployment's). */
  "provider_resolution",
  /** The first server-side object existence/size check. */
  "object_stat",
  /** Streaming or ranged reading of a stored object. */
  "object_read",
  /** Writing a re-staged private object (expanded archive entries). */
  "object_write",
  /** Removing job-scoped objects during hygiene or rollback. */
  "object_delete",
  /** Byte count / SHA-256 / magic-byte verification of read bytes. */
  "byte_verification",
  /** Decoding an image to establish its true media class and dimensions. */
  "media_decode",
  /** Producing a sanitized public derivative from verified bytes. */
  "derivative_generation",
  /** Parsing documents for structured facts (price lists, profiles). */
  "structured_extraction",
  /** The atomic ingest + publish transaction. */
  "database_publication",
  /** Writing a verified derivative to the PUBLIC media bucket. */
  "public_object_write",
  /** The large-archive multipart control plane (create/list/complete/abort). */
  "archive_control_plane",
  /** Recording the terminal outcome of the attempt. */
  "terminal_transition",
] as const;

export type StudioProcessingStage = (typeof STUDIO_PROCESSING_STAGES)[number];

export function isStudioProcessingStage(value: unknown): value is StudioProcessingStage {
  return (
    typeof value === "string" && (STUDIO_PROCESSING_STAGES as readonly string[]).includes(value)
  );
}

/**
 * The safe internal failure code each stage collapses to.
 *
 * These are the values that reach `studio_upload_jobs.error_code`, so every one
 * of them is a fixed identifier chosen here — never anything derived from an
 * exception message, a path, or a response body.
 */
export const STUDIO_STAGE_FAILURE_CODES: Readonly<Record<StudioProcessingStage, string>> = {
  provider_resolution: "provider_resolution_failed",
  object_stat: "object_stat_failed",
  object_read: "object_read_failed",
  object_write: "object_write_failed",
  object_delete: "object_delete_failed",
  byte_verification: "byte_verification_failed",
  media_decode: "media_decode_failed",
  derivative_generation: "derivative_generation_failed",
  structured_extraction: "structured_extraction_failed",
  database_publication: "database_publication_failed",
  public_object_write: "public_object_write_failed",
  archive_control_plane: "archive_control_plane_unavailable",
  terminal_transition: "terminal_transition_failed",
};

/**
 * User-facing text per stage. A fixed catalog, exactly like `SAFE_MESSAGES`:
 * the Owner learns which part of the pipeline stopped, and nothing about the
 * material, the storage address, or the infrastructure.
 */
export const STUDIO_STAGE_SAFE_MESSAGES: Readonly<Record<StudioProcessingStage, string>> = {
  provider_resolution:
    "Forever could not reach the storage system this upload was created on. Nothing was changed.",
  object_stat: "Forever could not confirm the uploaded files in storage. Nothing was changed.",
  object_read: "Forever could not read the uploaded files from storage. Nothing was changed.",
  object_write: "Forever could not stage part of this upload. Nothing was published.",
  object_delete: "Forever could not tidy up temporary files for this upload.",
  byte_verification: "The uploaded bytes did not verify. Nothing was published.",
  media_decode: "Forever could not read one of the uploaded images. Nothing was published.",
  derivative_generation:
    "Forever could not prepare the public images for this upload. Nothing was published.",
  structured_extraction:
    "Forever could not read the documents in this upload. Nothing was published.",
  database_publication: "The page could not be saved just now. It will be retried.",
  public_object_write:
    "Forever could not publish the prepared images just now. Nothing was published.",
  archive_control_plane:
    "Large archive uploads are not available on this deployment. Nothing was changed.",
  terminal_transition: "Forever could not record the outcome of this upload.",
};

/**
 * Exception classes worth distinguishing, as a CLOSED set.
 *
 * Anything else becomes `other`. A constructor name is attacker-influenceable
 * in principle and minifier-influenceable in practice, so it is matched against
 * this list rather than copied into the record.
 */
const KNOWN_ERROR_CLASSES: readonly string[] = [
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "AggregateError",
  "DOMException",
  "Error",
  "R2RequestError",
  "StudioError",
  "StudioAccessError",
  "StudioStageError",
  "StudioArchiveUploadLostError",
];

export type StudioErrorClass = (typeof KNOWN_ERROR_CLASSES)[number] | "other" | "non_error";

/** The exception CATEGORY, from the closed list above. Never free text. */
export function errorClassOf(error: unknown): StudioErrorClass {
  if (!(error instanceof Error)) return "non_error";
  if (error instanceof StudioStageError) return "StudioStageError";
  const named = (error as { constructor?: { name?: string } }).constructor?.name;
  return named && KNOWN_ERROR_CLASSES.includes(named) ? named : "other";
}

/**
 * A failure that knows which stage it happened in.
 *
 * Extends `StudioError`, so `toSafeError` already returns its safe code,
 * catalogued message and retryability unchanged — the stage rides along for
 * telemetry without widening what reaches the browser. The underlying cause is
 * attached for server-side logging (redacted there) and is NEVER persisted.
 */
export class StudioStageError extends StudioError {
  readonly stage: StudioProcessingStage;
  readonly causeClass: StudioErrorClass;

  constructor(
    stage: StudioProcessingStage,
    options: { retryable?: boolean; cause?: unknown; code?: string; message?: string } = {},
  ) {
    super(
      options.code ?? STUDIO_STAGE_FAILURE_CODES[stage],
      options.message ?? STUDIO_STAGE_SAFE_MESSAGES[stage],
      options.retryable ?? true,
    );
    this.stage = stage;
    this.causeClass = errorClassOf(options.cause);
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/** The stage an error carries, or null when it carries none. */
export function stageOf(error: unknown): StudioProcessingStage | null {
  const stage = (error as { stage?: unknown } | null)?.stage;
  return isStudioProcessingStage(stage) ? stage : null;
}

/**
 * Run `fn`, and label anything it throws with the stage it happened in.
 *
 * Three cases, in order:
 *
 *   1. an error that ALREADY carries a stage passes through untouched — the
 *      innermost stage is the true one and an outer wrapper must not relabel it;
 *   2. an error that already carries a DELIBERATE safe code and message
 *      (`StudioError`, `StudioAccessError`) keeps its identity, code, message
 *      and retryability exactly, and only gains the stage. A refusal that took
 *      care to say `storage_provider_unavailable` must not be flattened into a
 *      stage's generic code — the stage is extra information, not a
 *      replacement for it;
 *   3. anything else — a raw `TypeError` from a transport, say — becomes a
 *      `StudioStageError`, which is how a fetch-level rejection stops being
 *      `processing_failed` and starts being `object_stat_failed`.
 */
export async function inStage<T>(
  stage: StudioProcessingStage,
  fn: () => Promise<T>,
  options: { retryable?: boolean } = {},
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (stageOf(error)) throw error;
    if (error instanceof StudioError || error instanceof StudioAccessError) {
      Object.defineProperty(error, "stage", {
        value: stage,
        enumerable: false,
        configurable: true,
      });
      throw error;
    }
    throw new StudioStageError(stage, { cause: error, ...options });
  }
}

/**
 * The ONLY shape persisted or logged for a failed attempt.
 *
 * Seven bounded fields. Adding an eighth is a deliberate act that has to pass
 * `telemetry-contract` review, which is exactly the friction this shape exists
 * to create.
 */
export interface StudioStageTelemetry {
  /** The provider the JOB recorded. */
  provider: StudioStorageProviderId;
  stage: StudioProcessingStage;
  /** Safe internal code, from `STUDIO_STAGE_FAILURE_CODES` or the legacy set. */
  code: string;
  errorClass: StudioErrorClass;
  /** The job's attempt number at the time of the failure. */
  attempt: number;
  retryable: boolean;
  workflow: StudioWorkflow;
}

/** Exactly the keys `StudioStageTelemetry` may contain. Pinned by tests. */
export const STUDIO_STAGE_TELEMETRY_KEYS: readonly string[] = [
  "provider",
  "stage",
  "code",
  "errorClass",
  "attempt",
  "retryable",
  "workflow",
];

/** Key inside `studio_upload_jobs.facts` holding the last failure's telemetry. */
export const JOB_PROCESSING_FACTS_KEY = "processing";

export function buildStageTelemetry(input: {
  provider: StudioStorageProviderId;
  error: unknown;
  code: string;
  attempt: number;
  retryable: boolean;
  workflow: StudioWorkflow;
  /** Stage to record when the error carries none of its own. */
  fallbackStage?: StudioProcessingStage;
}): StudioStageTelemetry {
  return {
    provider: input.provider,
    stage: stageOf(input.error) ?? input.fallbackStage ?? "terminal_transition",
    code: input.code,
    errorClass:
      input.error instanceof StudioStageError ? input.error.causeClass : errorClassOf(input.error),
    attempt: Number.isFinite(input.attempt) ? Math.max(0, Math.trunc(input.attempt)) : 0,
    retryable: input.retryable,
    workflow: input.workflow,
  };
}

/** One log line, built only from allowlisted values. */
export function stageTelemetryLogLine(telemetry: StudioStageTelemetry): string {
  return STUDIO_STAGE_TELEMETRY_KEYS.map((key) => {
    const value = (telemetry as unknown as Record<string, unknown>)[key];
    return `${key}=${String(value)}`;
  }).join(" ");
}
