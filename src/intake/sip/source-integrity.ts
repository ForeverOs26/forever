/**
 * Source-file integrity primitives shared by SIP read-only processors.
 *
 * The source files are never written by SIP. These helpers nevertheless prove
 * that a read-only operation left an authorized source byte-for-byte intact.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";

export interface SourceFileFingerprint {
  sha256: string;
  byte_size: number;
}

export class SourceIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceIntegrityError";
  }
}

export function fingerprintSourceFile(path: string): SourceFileFingerprint {
  if (!existsSync(path)) throw new SourceIntegrityError("sip_source_file_missing");
  const stat = statSync(path);
  if (!stat.isFile()) throw new SourceIntegrityError("sip_source_file_not_regular");
  return {
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
    byte_size: stat.size,
  };
}

/**
 * Capture the post-processing fingerprint and fail closed unless it exactly
 * matches the pre-processing fingerprint. A missing post-processing source is
 * an integrity failure, not a successful read-only operation.
 */
export function assertSourceUnchanged(
  before: SourceFileFingerprint,
  path: string,
): SourceFileFingerprint {
  let after: SourceFileFingerprint;
  try {
    after = fingerprintSourceFile(path);
  } catch (error) {
    if (error instanceof SourceIntegrityError) {
      throw new SourceIntegrityError(
        `sip_source_file_unavailable_after_processing: ${error.message}`,
      );
    }
    throw error;
  }
  if (after.byte_size !== before.byte_size || after.sha256 !== before.sha256) {
    throw new SourceIntegrityError("sip_source_file_changed_during_processing");
  }
  return after;
}

/** Execute a read-only action and prove its source remains unchanged afterward. */
export function processWithSourceIntegrity<T>(
  path: string,
  processor: () => T,
): { value: T; before: SourceFileFingerprint; after: SourceFileFingerprint } {
  const before = fingerprintSourceFile(path);
  let result: { value: T } | undefined;
  let after: SourceFileFingerprint;
  try {
    result = { value: processor() };
  } finally {
    // A failed processor still performed a processing attempt. Check the
    // source before propagating that failure so an attempted mutation cannot
    // evade the read-only integrity boundary by throwing first.
    after = assertSourceUnchanged(before, path);
  }
  if (!result) throw new SourceIntegrityError("sip_source_processing_did_not_complete");
  return { value: result.value, before, after };
}
