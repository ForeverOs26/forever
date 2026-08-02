/**
 * Forever Studio — the R2 object layout (FOREVER-R2-MEDIA-STORAGE-CUTOVER-001).
 *
 * Studio's processing code addresses objects by a LOGICAL bucket name plus a
 * path (`studio-uploads` + `jobs/…`). That vocabulary predates R2 and is what
 * every stored manifest already speaks, so it stays. This module is the single
 * total mapping from that vocabulary onto R2:
 *
 *     logical bucket  →  bucket KIND  →  a real R2 bucket (server config only)
 *     logical path    →  object key (kind-specific immutable prefix + path)
 *
 * Everything about R2's physical naming lives here and nowhere else. No other
 * Studio module knows an R2 bucket name, and no R2 bucket name is ever part of
 * a URL, a warning, an audit row, or a browser response.
 *
 * PURE: no credentials, no environment, no I/O — so the layout invariants are
 * testable on their own.
 */

import type { StudioBucketKind } from "../../studio-types";

/** Logical bucket names Studio's manifests and processing code already use. */
export const LOGICAL_PRIVATE_SOURCE_BUCKET = "studio-uploads";
export const LOGICAL_PUBLIC_IMAGE_BUCKET = "project-images";
export const LOGICAL_PUBLIC_DOCUMENT_BUCKET = "project-documents";
/**
 * Logical bucket for a COMPLETED large archive.
 *
 * It has no Supabase counterpart on purpose: on the legacy provider an archive
 * lives as many fixed-size part objects inside the private staging bucket,
 * while on R2 it is one multipart-assembled object in its own bucket. The name
 * only ever appears on R2-provider manifests.
 */
export const LOGICAL_ARCHIVE_BUCKET = "studio-archives";

const LOGICAL_BUCKET_KINDS: Record<string, StudioBucketKind> = {
  [LOGICAL_PRIVATE_SOURCE_BUCKET]: "private_source",
  [LOGICAL_PUBLIC_IMAGE_BUCKET]: "public_media",
  [LOGICAL_PUBLIC_DOCUMENT_BUCKET]: "public_media",
  [LOGICAL_ARCHIVE_BUCKET]: "project_archives",
};

/** Null for an unknown logical bucket — callers fail closed, never guess. */
export function bucketKindForLogicalBucket(bucket: string): StudioBucketKind | null {
  return LOGICAL_BUCKET_KINDS[bucket] ?? null;
}

/**
 * The root prefix EVERY public object key carries, and exactly the prefix the
 * public delivery route prepends to whatever a visitor asks for.
 *
 * That is a structural guarantee, not a convention: a request for
 * `studio/jobs/…` becomes `media/studio/jobs/…`, an object that does not exist,
 * so the public route cannot address a private source or archive key even if
 * the buckets were ever misconfigured to be the same one.
 */
export const PUBLIC_MEDIA_KEY_PREFIX = "media/";

/**
 * Immutable per-LOGICAL-BUCKET key prefix.
 *
 * Per logical bucket rather than per kind, because the two public logical
 * buckets (`project-images`, `project-documents`) map to ONE R2 bucket. Giving
 * them separate key namespaces keeps them as independent on R2 as they are on
 * Supabase — which matters for the post-publication orphan sweep, which
 * enumerates one public bucket at a time and deletes what the committed
 * publication does not reference. Sharing a namespace would make each sweep see
 * the other bucket's committed objects as orphans.
 *
 * The distinguishing segment is a bare token, never a bucket name.
 */
const LOGICAL_BUCKET_KEY_PREFIX: Record<string, string> = {
  [LOGICAL_PRIVATE_SOURCE_BUCKET]: "studio/",
  [LOGICAL_PUBLIC_IMAGE_BUCKET]: `${PUBLIC_MEDIA_KEY_PREFIX}i/`,
  [LOGICAL_PUBLIC_DOCUMENT_BUCKET]: `${PUBLIC_MEDIA_KEY_PREFIX}d/`,
  [LOGICAL_ARCHIVE_BUCKET]: "studio/",
};

/** The immutable key prefix of one logical bucket. */
export function r2KeyPrefixForLogicalBucket(bucket: string): string {
  const prefix = LOGICAL_BUCKET_KEY_PREFIX[bucket];
  if (!prefix) throw new Error("studio_unknown_logical_bucket");
  return prefix;
}

/** Characters an R2 object key derived from a logical path may contain. */
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9/._-]*$/;

/**
 * A logical path is server-generated, but it is validated here anyway: this is
 * the last point before a string becomes a storage address, and a traversal or
 * an absolute path must never survive it.
 */
export function assertSafeLogicalPath(path: string): string {
  if (
    !path ||
    path.length > 900 ||
    !SAFE_KEY.test(path) ||
    path.includes("..") ||
    path.includes("//") ||
    path.endsWith("/")
  ) {
    throw new Error("r2_object_key_invalid");
  }
  return path;
}

/** The R2 object key for one (logical bucket, logical path) pair. */
export function r2ObjectKey(bucket: string, path: string): string {
  return `${r2KeyPrefixForLogicalBucket(bucket)}${assertSafeLogicalPath(path)}`;
}

/**
 * The private staging path for one declared ordinary file on the R2 lane.
 *
 * Deliberately WITHOUT the client's filename. The Supabase lane keeps the
 * sanitized name (it is what production has today and its objects are already
 * written), but a brand-new R2 key has no reason to carry a string the Owner
 * typed: filenames routinely contain personal names, addresses and deal
 * references. Identity comes from the job id and the file's index in the
 * server-assigned manifest, which is exactly what pairs bytes to targets.
 */
export function r2StagingPathForJobFile(jobId: string, index: number): string {
  return `jobs/${jobId}/staging/${String(index).padStart(3, "0")}/object`;
}

/** Private re-staging path for one entry expanded from an inline ZIP. */
export function r2InlineEntryPath(jobId: string, attempt: string, index: number): string {
  return `jobs/${jobId}/zip/${attempt}/${String(index).padStart(3, "0")}/object`;
}

/**
 * The single immutable object key one large archive assembles into.
 *
 * Archive-id scoped, so a restart after an expired or aborted multipart upload
 * gets a FRESH archive row and therefore a FRESH key: an abandoned upload can
 * never be resumed into, or overwritten by, a later one.
 */
export function r2ArchiveObjectPath(jobId: string, archiveId: string): string {
  return `archives/${jobId}/${archiveId}/archive.zip`;
}
