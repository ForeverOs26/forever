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
  /** Bytes accepted so far (uploaded parts × part size, capped at total). */
  uploadedBytes: number;
  totalBytes: number;
  partsDone: number;
  partCount: number;
  state: "preparing" | "uploading" | "retrying" | "verifying" | "accepted";
}

const PART_UPLOAD_ATTEMPTS = 4;
const CONFIRM_ROUNDS = 3;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sha256HexOf(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
 * Upload one large archive resumably and wait for server acceptance.
 * Resolves with the archive id once the server has verified every stored
 * part's existence and exact size; throws when the upload cannot complete
 * (the caller offers a retry — re-running resumes from the stored parts).
 */
export async function uploadLargeArchive(
  jobId: string,
  file: File,
  onProgress: (progress: ArchiveUploadProgress) => void,
): Promise<{ archiveId: string }> {
  const plan = await studioPlanArchiveUpload({
    data: { jobId, fileName: file.name, declaredSize: file.size },
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
  report(plan.parts.length ? "uploading" : "verifying", done);
  for (const target of plan.parts) {
    await uploadOnePart(file, plan.partSize, target, () => report("retrying", done));
    done += 1;
    report("uploading", done);
  }

  // Per-part SHA-256 claims for every part (server verifies the stored bytes).
  report("verifying", done);
  const partSha256: string[] = [];
  for (let index = 0; index < plan.partCount; index += 1) {
    const start = index * plan.partSize;
    partSha256.push(
      await sha256HexOf(file.slice(start, Math.min(file.size, start + plan.partSize))),
    );
  }

  for (let round = 0; round < CONFIRM_ROUNDS; round += 1) {
    const confirm = await studioConfirmArchiveUpload({
      data: { jobId, archiveId: plan.archiveId, partSha256 },
    });
    if (confirm.accepted) {
      report("accepted", plan.partCount);
      return { archiveId: plan.archiveId };
    }
    // The server found absent or wrong-sized parts: re-upload just those
    // through the fresh targets it returned, then confirm again.
    for (const target of confirm.missingParts) {
      await uploadOnePart(file, plan.partSize, target, () => report("retrying", done));
    }
  }
  throw new Error(`${file.name} could not be verified in storage. Retry to resume this upload.`);
}
