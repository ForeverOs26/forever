/**
 * Forever Studio — browser side of the large-archive chunked upload.
 *
 * A large ZIP is sliced into the server-planned fixed-size parts; each part
 * streams straight from the device to PRIVATE storage through its own
 * short-lived signed URL (never through the application server). Every part
 * retries independently with backoff, so an unstable connection loses at most
 * one part, and re-planning the same file resumes with only the missing
 * parts. Completion is never self-declared: the server verifies the stored
 * bytes of every part before accepting the archive.
 *
 * Client-safe module: types, Web Crypto, and the Studio server functions
 * only — no server-only imports.
 */

import { supabase } from "@/integrations/supabase/client";

import { studioConfirmArchiveUpload, studioPlanArchiveUpload } from "../studio.functions";
import {
  ARCHIVE_PART_BYTES,
  LARGE_ARCHIVE_MAX_BYTES,
  LARGE_ARCHIVE_MIN_BYTES,
  type StudioArchivePartTarget,
} from "../studio-types";

/** ZIPs above the legacy inline limit must use the chunked lane. */
export function isLargeArchive(file: File): boolean {
  return /\.zip$/i.test(file.name) && file.size > LARGE_ARCHIVE_MIN_BYTES;
}

export function archiveTooLarge(file: File): boolean {
  return isLargeArchive(file) && file.size > LARGE_ARCHIVE_MAX_BYTES;
}

export interface ArchiveUploadProgress {
  /** Bytes stored so far (uploaded parts × part size, capped at total). */
  uploadedBytes: number;
  totalBytes: number;
  partsDone: number;
  partCount: number;
  /**
   * Truthful client-side upload states. "stored" means the server confirmed
   * every part EXISTS with its exact planned size — durably stored, NOT yet
   * byte-verified: hash verification of the actual stored bytes happens in
   * the background processing slices and is reported by the job progress.
   */
  state: "preparing" | "uploading" | "retrying" | "confirming" | "stored";
}

/** Blob bytes with a FileReader fallback (older WebKit, jsdom). */
async function blobBytes(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof blob.arrayBuffer === "function") return new Uint8Array(await blob.arrayBuffer());
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
  });
}

function hexOf(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The exact ordered per-part SHA-256 manifest: one digest per fixed-size
 * upload part, covering EVERY byte of the file. Parts are read and hashed
 * strictly one at a time (never the whole file in one ArrayBuffer), so peak
 * memory stays ≈ one part even for a 300 MiB phone upload. This manifest is
 * the resume identity — the server resumes an upload only when the complete
 * manifest matches digest-for-digest — and doubles as the per-part claims the
 * server later verifies against the ACTUAL stored bytes. It replaces the
 * retired v1 sampled fingerprint, which hashed only four bounded windows and
 * could not distinguish same-size files differing outside those samples.
 * It is a resume identity only — the server still verifies every stored byte.
 */
export async function computeUploadPartManifest(file: File): Promise<string[]> {
  const manifest: string[] = [];
  for (let start = 0; start < file.size; start += ARCHIVE_PART_BYTES) {
    const part = await blobBytes(
      file.slice(start, Math.min(file.size, start + ARCHIVE_PART_BYTES)),
    );
    manifest.push(hexOf(await crypto.subtle.digest("SHA-256", part)));
  }
  if (manifest.length === 0) {
    manifest.push(hexOf(await crypto.subtle.digest("SHA-256", new Uint8Array(0))));
  }
  return manifest;
}

const PART_UPLOAD_ATTEMPTS = 4;
const CONFIRM_ROUNDS = 3;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function uploadOnePart(
  file: File,
  partSize: number,
  target: StudioArchivePartTarget,
  onRetry: () => void,
): Promise<void> {
  const start = target.index * partSize;
  const blob = file.slice(start, Math.min(file.size, start + partSize));
  let lastError: unknown = null;
  for (let attempt = 0; attempt < PART_UPLOAD_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      onRetry();
      await delay(1000 * 2 ** (attempt - 1));
    }
    const { error } = await supabase.storage
      .from(target.bucket)
      .uploadToSignedUrl(target.path, target.token, blob, {
        contentType: "application/octet-stream",
      });
    if (!error) return;
    lastError = error;
  }
  throw new Error(
    `Part ${target.index + 1} failed to upload after ${PART_UPLOAD_ATTEMPTS} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/**
 * Upload one large archive resumably and wait for STORAGE acceptance: the
 * server confirming that every part exists in private staging with exactly
 * its planned size. That means "safely stored", never "verified" — byte
 * verification of the actual stored bytes happens in the background
 * processing slices. Throws when the upload cannot complete (the caller
 * offers a retry — re-running resumes from the stored parts, keyed by the
 * exact per-part manifest rather than the filename).
 */
export async function uploadLargeArchive(
  jobId: string,
  file: File,
  onProgress: (progress: ArchiveUploadProgress) => void,
): Promise<{ archiveId: string }> {
  onProgress({
    uploadedBytes: 0,
    totalBytes: file.size,
    partsDone: 0,
    partCount: 0,
    state: "preparing",
  });
  const partSha256 = await computeUploadPartManifest(file);
  const plan = await studioPlanArchiveUpload({
    data: { jobId, fileName: file.name, declaredSize: file.size, partSha256 },
  });
  const report = (state: ArchiveUploadProgress["state"], partsDone: number) =>
    onProgress({
      uploadedBytes: Math.min(file.size, partsDone * plan.partSize),
      totalBytes: file.size,
      partsDone,
      partCount: plan.partCount,
      state,
    });

  let done = plan.presentParts.length;
  report(plan.parts.length ? "uploading" : "confirming", done);
  for (const target of plan.parts) {
    await uploadOnePart(file, plan.partSize, target, () => report("retrying", done));
    done += 1;
    report("uploading", done);
  }

  // The manifest computed above already carries the per-part SHA-256 claims
  // the server recorded at plan time and later hash-verifies against the
  // ACTUAL stored bytes before anything expands; confirm resubmits it so the
  // server can prove the confirming client still holds the SAME archive.
  report("confirming", done);
  for (let round = 0; round < CONFIRM_ROUNDS; round += 1) {
    const confirm = await studioConfirmArchiveUpload({
      data: { jobId, archiveId: plan.archiveId, partSha256 },
    });
    if (confirm.accepted) {
      report("stored", plan.partCount);
      return { archiveId: plan.archiveId };
    }
    // The server found absent or wrong-sized parts: re-upload just those
    // through the fresh targets it returned, then confirm again.
    for (const target of confirm.missingParts) {
      await uploadOnePart(file, plan.partSize, target, () => report("retrying", done));
    }
  }
  throw new Error(`${file.name} could not be confirmed in storage. Retry to resume this upload.`);
}
