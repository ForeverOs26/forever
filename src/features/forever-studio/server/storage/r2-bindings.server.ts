/**
 * Forever Studio — native Cloudflare R2 bucket bindings (SERVER ONLY).
 *
 * WHY THIS EXISTS
 * ---------------
 * A Worker reaches R2 through a BUCKET BINDING. The S3 API — SigV4 over
 * `fetch` — is what local development, tests and any non-Worker host use, and
 * it is the ONE capability a binding cannot provide that Forever genuinely
 * needs: creating the short-lived presigned request the BROWSER uploads with.
 *
 * The first real R2 production pilot proved the distinction the hard way. Six
 * browser presigned PUTs succeeded and 51,937,418 bytes landed in the private
 * bucket; every server-side request the Worker itself made rejected at `fetch`
 * before reaching R2 at all, so the very first object HEAD threw and the job
 * failed with nothing to show for it. The bindings were configured on that
 * Worker the whole time and simply unused by the processing plane.
 *
 * WHAT THIS MODULE GUARANTEES
 * ---------------------------
 *   - the binding for a bucket KIND is chosen HERE, from a closed table, and
 *     never from a caller-supplied bucket name;
 *   - a private-source or archive binding can never be produced by asking for
 *     public media, and the reverse;
 *   - on a Worker the bindings are REQUIRED: a missing or malformed one fails
 *     closed with a stage-labelled refusal, and there is no automatic downgrade
 *     to S3-over-fetch (which does not work there) and no Supabase fallback;
 *   - off a Worker this module resolves nothing at all, so the S3 object plane
 *     stays exactly what local development and the test harness exercise.
 *
 * The binding OBJECTS themselves are never logged, serialized or persisted.
 */

import type { StudioBucketKind } from "../../studio-types";
import { StudioStageError } from "../processing-stage";

/**
 * The binding this deployment must bind to each bucket kind. CLOSED and total:
 * every `StudioBucketKind` has exactly one name and no name is shared.
 */
export const STUDIO_R2_BINDING_NAMES: Readonly<Record<StudioBucketKind, string>> = {
  private_source: "R2_PRIVATE_SOURCES",
  public_media: "R2_PUBLIC_MEDIA",
  project_archives: "R2_PROJECT_ARCHIVES",
};

/** The bucket kinds Studio's object plane addresses, in binding-table order. */
export const STUDIO_R2_BUCKET_KINDS: readonly StudioBucketKind[] = [
  "private_source",
  "public_media",
  "project_archives",
];

// --- The narrow slice of the Cloudflare R2 binding Studio uses --------------

export interface R2BindingObjectMetadata {
  size: number;
  etag?: string;
  httpEtag?: string;
  httpMetadata?: { contentType?: string; cacheControl?: string };
}

export interface R2BindingObjectBody extends R2BindingObjectMetadata {
  body: ReadableStream<Uint8Array> | null;
}

export interface R2BindingListing {
  /**
   * `etag` is the receipt R2 gave the uploader for that object. It is optional
   * because a listing is authoritative on SIZE alone; when R2 does report it,
   * the archive lane cross-checks the browser's claimed receipt against it.
   */
  objects: Array<{ key: string; size: number; etag?: string }>;
  /** Cloudflare's name for what S3 calls `CommonPrefixes`. */
  delimitedPrefixes?: string[];
  truncated?: boolean;
  cursor?: string;
}

/**
 * Exactly the operations Studio performs. Deliberately smaller than the real
 * binding: nothing here can create a multipart upload, so the multipart control
 * plane cannot quietly acquire a binding path that does not exist.
 */
export interface R2BucketBinding {
  head(key: string): Promise<R2BindingObjectMetadata | null>;
  get(
    key: string,
    options?: { range?: { offset: number; length: number } },
  ): Promise<R2BindingObjectBody | null>;
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
  list(options?: {
    prefix?: string;
    delimiter?: string;
    cursor?: string;
    limit?: number;
  }): Promise<R2BindingListing>;
}

/** One resolved binding per bucket kind. */
export type StudioR2Bindings = Readonly<Record<StudioBucketKind, R2BucketBinding>>;

// --- Runtime detection ------------------------------------------------------

/** `navigator.userAgent` inside a Cloudflare Worker isolate. */
export const CLOUDFLARE_WORKERS_USER_AGENT = "Cloudflare-Workers";

/**
 * Where Nitro's cloudflare-module preset publishes the Worker env.
 *
 * The generated handler assigns it for BOTH the `fetch` and the `scheduled`
 * entry paths, which is what lets a cron-driven processing tick — with no
 * browser session and no HTTP request — resolve the same bindings.
 */
export const WORKER_ENV_GLOBAL = "__env__";

export interface StudioRuntimeGlobals {
  navigator?: { userAgent?: string };
  __env__?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * True when this process is a Cloudflare Worker isolate.
 *
 * Two independent signals, because getting this wrong is expensive in both
 * directions: a false positive would refuse to run locally, and a false
 * negative would put the processing plane back on the transport that does not
 * work in production.
 */
export function isWorkerRuntime(
  globals: StudioRuntimeGlobals = globalThis as StudioRuntimeGlobals,
): boolean {
  if (globals.navigator?.userAgent === CLOUDFLARE_WORKERS_USER_AGENT) return true;
  return isRecord(globals[WORKER_ENV_GLOBAL]);
}

/** The Worker env record, or null when this process is not a Worker. */
export function workerEnv(
  globals: StudioRuntimeGlobals = globalThis as StudioRuntimeGlobals,
): Record<string, unknown> | null {
  const env = globals[WORKER_ENV_GLOBAL];
  return isRecord(env) ? env : null;
}

/** Structural check: every operation Studio calls must actually be there. */
export function isR2BucketBinding(candidate: unknown): candidate is R2BucketBinding {
  if (!isRecord(candidate)) return false;
  for (const method of ["head", "get", "put", "delete", "list"] as const) {
    if (typeof (candidate as Record<string, unknown>)[method] !== "function") return false;
  }
  return true;
}

// --- Resolution -------------------------------------------------------------

export interface StudioR2BindingResolution {
  bindings: StudioR2Bindings | null;
  /** Binding NAMES that were absent or malformed. Never a value. */
  missing: string[];
}

/**
 * Resolve all three bindings from a Worker env record.
 *
 * Partial success is not success: Studio's object plane moves bytes between the
 * private, public and archive buckets within one attempt, so a deployment
 * holding two of three bindings is misconfigured and must be told so before it
 * writes anything.
 */
export function resolveR2BindingsFrom(
  env: Record<string, unknown> | null,
): StudioR2BindingResolution {
  if (!env) return { bindings: null, missing: [...Object.values(STUDIO_R2_BINDING_NAMES)] };
  const resolved: Partial<Record<StudioBucketKind, R2BucketBinding>> = {};
  const missing: string[] = [];
  for (const kind of STUDIO_R2_BUCKET_KINDS) {
    const name = STUDIO_R2_BINDING_NAMES[kind];
    const candidate = env[name];
    if (isR2BucketBinding(candidate)) resolved[kind] = candidate;
    else missing.push(name);
  }
  if (missing.length > 0) return { bindings: null, missing };
  return { bindings: resolved as StudioR2Bindings, missing: [] };
}

/**
 * The bindings this Worker must use, or a loud refusal.
 *
 * FAILS CLOSED. The message names the MISSING BINDING NAMES only — they are
 * deployment configuration, not secrets, and naming them is the difference
 * between a fixable deployment and another generic `processing_failed`.
 */
export function requireStudioR2Bindings(
  globals: StudioRuntimeGlobals = globalThis as StudioRuntimeGlobals,
): StudioR2Bindings {
  const { bindings, missing } = resolveR2BindingsFrom(workerEnv(globals));
  if (!bindings) {
    throw new StudioStageError("provider_resolution", {
      retryable: false,
      message:
        `Cloudflare R2 is selected but this Worker has no usable bucket binding ` +
        `(missing: ${missing.join(", ")}). Nothing was changed.`,
    });
  }
  return bindings;
}

/**
 * The binding for ONE bucket kind.
 *
 * Kind-keyed on purpose: callers hold a LOGICAL bucket name, and the only way
 * from that name to a binding runs through `bucketKindForLogicalBucket`, a
 * closed table that refuses anything it does not know. There is no string that
 * reaches a binding by resembling a bucket name.
 */
export function bindingForKind(
  bindings: StudioR2Bindings,
  kind: StudioBucketKind,
): R2BucketBinding {
  const binding = bindings[kind];
  if (!isR2BucketBinding(binding)) {
    throw new StudioStageError("provider_resolution", {
      retryable: false,
      message:
        `Cloudflare R2 is selected but the ${STUDIO_R2_BINDING_NAMES[kind]} binding is not ` +
        `usable on this Worker. Nothing was changed.`,
    });
  }
  return binding;
}
