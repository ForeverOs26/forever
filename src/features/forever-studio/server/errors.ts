/**
 * Forever Studio — operational error sanitization (item 11).
 *
 * Studio users and persisted job records must only ever see a stable safe
 * code, a concise user-facing explanation, and a retryability flag. Raw
 * database, filesystem, executable, SQL, or local-path text stays in
 * protected server logs, with secrets and paths redacted even there.
 */

import { StudioAccessError } from "./contracts";

/** A processing failure with a safe, user-facing surface. */
export class StudioError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, message: string, retryable = true) {
    super(message);
    this.name = "StudioError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface SafeError {
  code: string;
  message: string;
  retryable: boolean;
}

const SAFE_MESSAGES: Record<string, string> = {
  processing_failed:
    "The upload could not be processed just now. It will be retried automatically.",
  storage_unavailable: "File storage was temporarily unavailable. The upload will be retried.",
  ingest_failed: "The page could not be saved just now. The upload will be retried.",
  studio_job_not_claimed: "This job is being processed by another request.",
  studio_job_not_found: "This upload job no longer exists.",
  publication_failed: "The page could not be published just now. It will be retried.",
  studio_request_failed:
    "Forever Studio hit a temporary problem completing this request. Please try again.",
};

/**
 * Redact anything that could leak infrastructure detail from a log line:
 * absolute paths, connection strings, bearer/JWT/service keys, and env
 * assignments. Never used for user-facing text (which is a fixed catalog).
 */
export function redact(text: string): string {
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgres://[redacted]")
    .replace(/https?:\/\/[^\s"']*supabase[^\s"']*/gi, "[supabase-url]")
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9]+/g, "[key]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+/g, "[jwt]")
    .replace(/\/(?:home|root|tmp|var|usr|etc|opt)\/[^\s"':]+/g, "[path]")
    .replace(/[A-Za-z]:\\[^\s"']+/g, "[path]")
    .replace(/(SUPABASE_[A-Z_]+|SERVICE_ROLE_KEY)=\S+/g, "$1=[redacted]");
}

/** Log the true failure detail server-side only, always redacted. */
export function logStudioFailure(context: string, error: unknown): void {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  console.error(`[studio] ${context}: ${redact(detail)}`);
}

/**
 * Map any thrown value to a safe {code, message, retryable}. Access/validation
 * errors keep their own safe code+message; everything else collapses to a
 * generic retryable failure and the raw detail is logged (redacted), never
 * returned.
 */
export function toSafeError(error: unknown, fallbackCode = "processing_failed"): SafeError {
  if (error instanceof StudioAccessError) {
    return { code: error.code, message: error.message, retryable: false };
  }
  if (error instanceof StudioError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  logStudioFailure(fallbackCode, error);
  return {
    code: fallbackCode,
    message: SAFE_MESSAGES[fallbackCode] ?? SAFE_MESSAGES.processing_failed,
    retryable: true,
  };
}

export function safeMessageFor(code: string): string {
  return SAFE_MESSAGES[code] ?? SAFE_MESSAGES.processing_failed;
}

/**
 * Safe error envelope for EVERY Studio server-function endpoint (and the
 * membership middleware). Access/validation and Studio errors already carry a
 * safe code + message and pass through unchanged; anything else — raw
 * Supabase/PostgREST/SQL/storage/filesystem/connection text — is logged
 * redacted server-side and replaced by a stable safe code and concise
 * message before it can reach the browser. `name` carries the stable code
 * across serialization.
 */
export async function runStudioEndpoint<T>(context: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof StudioAccessError || error instanceof StudioError) throw error;
    logStudioFailure(`endpoint:${context}`, error);
    const safe = new Error(SAFE_MESSAGES.studio_request_failed);
    safe.name = "studio_request_failed";
    throw safe;
  }
}
