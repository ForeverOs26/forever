/**
 * Forever Studio — whether the resumable large-archive lane can run here.
 *
 * WHY A CAPABILITY EXISTS AT ALL
 * ------------------------------
 * A large ZIP does not travel the ordinary signed-upload lane. It is sliced
 * into server-planned parts, each uploaded straight from the device, and the
 * server's authority over "which parts does storage actually hold" is what
 * makes resume safe: a browser's claim about its own upload is only ever
 * cross-checked against that list, never trusted.
 *
 * On Cloudflare Workers the R2 binding API cannot produce that list. It can
 * create, resume, complete and abort a multipart upload, but it cannot
 * enumerate the parts R2 durably holds. Substituting the client's own receipts
 * would make the uploader the authority over its own upload, so the lane is
 * declared UNAVAILABLE on that combination rather than quietly weakened. The
 * completing architecture is tracked as
 * FOREVER-R2-BINDING-NATIVE-MULTIPART-ARCHIVE-001.
 *
 * WHAT THIS MODULE IS, AND IS NOT
 * -------------------------------
 * It is a CLOSED two-value vocabulary plus the exact copy the Owner reads. It
 * is deliberately client-safe and deliberately empty of everything else: no
 * runtime probe, no provider id, no binding name, no bucket, no credential, no
 * endpoint, no object path. The client is TOLD the answer by the server and
 * cannot compute, infer or override it — and the server never relies on being
 * told, because every archive endpoint re-derives it from the provider that
 * would have to do the work.
 *
 * The value is a UI signal and an error code. It is not a security boundary;
 * the boundary is the server-side refusal that precedes every allocation.
 */

/**
 * Whether an Owner can start a resumable large-archive upload right now.
 *
 * Two values, forever. "temporarily_unavailable" is a statement about this
 * deployment's storage plane, not about the Owner, the material, the workflow
 * or the file — so it never needs a reason code, and adding one would start
 * leaking why.
 */
export type StudioArchiveUploadCapability = "available" | "temporarily_unavailable";

export const STUDIO_ARCHIVE_UPLOAD_CAPABILITIES: readonly StudioArchiveUploadCapability[] = [
  "available",
  "temporarily_unavailable",
];

export function isStudioArchiveUploadCapability(
  value: unknown,
): value is StudioArchiveUploadCapability {
  return (
    typeof value === "string" &&
    (STUDIO_ARCHIVE_UPLOAD_CAPABILITIES as readonly string[]).includes(value)
  );
}

/**
 * The safe internal code every archive endpoint refuses with.
 *
 * Stable and non-identifying: it names the CAPABILITY, never the file, the
 * key, the bucket, the binding, the provider or the runtime.
 */
export const ARCHIVE_UPLOAD_UNAVAILABLE_CODE = "archive_upload_temporarily_unavailable";

/**
 * What the Owner is told, in the refusal and in the window alike.
 *
 * One sentence of what, one of why, one of what to do instead. It says
 * "temporarily" because that is true — the replacement architecture is
 * specified — and it names no filename, path, key, bucket, URL, credential,
 * provider or runtime, because none of those are the Owner's problem.
 */
export const ARCHIVE_UPLOAD_UNAVAILABLE_MESSAGE =
  "Full project archive upload is temporarily unavailable while resumable upload support is " +
  "being completed. Every other upload window works normally — upload the individual files you " +
  "have and add the archive later.";

/** Short form for the window itself, where the heading already says what it is. */
export const ARCHIVE_UPLOAD_UNAVAILABLE_WINDOW_NOTE =
  "Temporarily unavailable while resumable upload support is being completed. " +
  "Every other window works normally.";

/**
 * The SUBMIT-time question: may this browser start an archive upload?
 *
 * Absent counts as NOT available. A client that never loaded the capability
 * must not start a chunked upload on the assumption that it will work; the
 * server would refuse it anyway, and refusing here means nothing is allocated
 * at all. Note this is deliberately stricter than the DISPLAY question below —
 * a window is not painted as unavailable merely because a query has not
 * resolved yet.
 */
export function isArchiveUploadAvailable(
  capability: StudioArchiveUploadCapability | undefined | null,
): boolean {
  return capability === "available";
}

/**
 * The DISPLAY question: should the window show its unavailable state?
 *
 * Only when the server has actually said so. While the capability is still
 * loading the window stays as it was, because flashing "temporarily
 * unavailable" at every Owner on every page load would be its own kind of lie.
 */
export function isArchiveUploadDisplayedUnavailable(
  capability: StudioArchiveUploadCapability | undefined | null,
): boolean {
  return capability === "temporarily_unavailable";
}
