/**
 * Forever Studio — the archive-capability refusal (SERVER ONLY).
 *
 * THE BOUNDARY, NOT THE HINT.
 *
 * The browser is told whether the resumable large-archive lane is available so
 * it can show the Owner an honest window instead of a picker that leads
 * nowhere. That is a courtesy. THIS is the enforcement: every endpoint that
 * could allocate an archive, a job, a signed part target or a stored object
 * asks here first, and a client that ignores the capability, forges it, or was
 * simply written before it existed gets exactly the same refusal.
 *
 * WHERE IT IS CALLED, AND WHY THERE
 * ---------------------------------
 * After authentication and Studio-actor authorization — a refusal must not
 * become an unauthenticated probe of what a deployment supports — and BEFORE
 * the first durable effect of any kind:
 *
 *   startUploadJob        → before the job row exists
 *   planJobArchiveUpload  → before the archive row, the multipart upload and
 *                           the signed part targets exist
 *   confirmJobArchiveUpload → before any part-state or completion call
 *
 * The capability is read from the PROVIDER that would have to do the work, so
 * the refusal and the underlying inability can never drift apart. The provider
 * for an existing job is the one that job recorded; for a new job it is the
 * one the job is about to be created on.
 */

import {
  ARCHIVE_UPLOAD_UNAVAILABLE_CODE,
  ARCHIVE_UPLOAD_UNAVAILABLE_MESSAGE,
  isArchiveUploadAvailable,
  type StudioArchiveUploadCapability,
} from "../archive-capability";
import { StudioAccessError } from "./contracts";
import type { StudioStorageProvider, StudioStorageProviderSet } from "./storage/provider";

/**
 * Refuse the resumable archive lane when the provider cannot drive it.
 *
 * `StudioAccessError` on purpose: it is terminal, it carries its own safe code
 * and message through `toSafeError` and `runStudioEndpoint` unchanged, and it
 * is never retried. The message names the capability and nothing else — no
 * filename, path, object key, bucket, binding, URL, provider id, runtime or
 * credential.
 */
export function assertArchiveControlPlaneAvailable(provider: StudioStorageProvider): void {
  if (isArchiveUploadAvailable(provider.archiveControlPlane)) return;
  throw new StudioAccessError(ARCHIVE_UPLOAD_UNAVAILABLE_CODE, ARCHIVE_UPLOAD_UNAVAILABLE_MESSAGE);
}

/**
 * The capability the browser is told about, for a NEW upload.
 *
 * Resolved through the write provider, because that is the provider a new job
 * would be created on. Every failure — an unrecognized write-provider setting,
 * missing credentials, a Worker with no usable binding — reports
 * `temporarily_unavailable` rather than propagating: the dashboard must still
 * load, and a storage plane that cannot even be constructed certainly cannot
 * run a resumable multipart upload. Fail closed, and stay quiet about why.
 */
export function archiveUploadCapabilityFor(
  providers: StudioStorageProviderSet,
): StudioArchiveUploadCapability {
  try {
    return providers.get(providers.writeProviderId).archiveControlPlane;
  } catch {
    return "temporarily_unavailable";
  }
}
