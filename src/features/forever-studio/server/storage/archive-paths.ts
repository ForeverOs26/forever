/**
 * Forever Studio — large-archive object paths shared by the storage providers.
 *
 * Extracted from large-archive.ts so a provider can address archive parts
 * without importing the slice engine (and creating a cycle). The values are
 * byte-identical to the ones production already wrote: this file moves them,
 * it does not change them.
 */

/** LEGACY Supabase lane: one fixed-size part object per upload part. */
export function archivePartPath(jobId: string, archiveId: string, index: number): string {
  return `jobs/${jobId}/parts/${archiveId}/${String(index).padStart(5, "0")}`;
}

/** The folder holding one archive's part objects (bounded listing). */
export function archivePartFolder(jobId: string, archiveId: string): string {
  return `jobs/${jobId}/parts/${archiveId}`;
}

/**
 * R2 parts-as-objects lane (FOREVER-R2-BINDING-NATIVE-MULTIPART-ARCHIVE-001).
 *
 * Archive-id scoped exactly as the assembled-object key was, so a restart after
 * an abandoned upload gets a FRESH archive row and therefore a FRESH prefix: an
 * abandoned upload can never be resumed into, or overwritten by, a later one.
 *
 * It lives under the same `archives/{job}/{archive}/` prefix the assembled
 * object used, so one prefix still bounds everything one archive ever wrote.
 */
export function r2ArchivePartFolder(jobId: string, archiveId: string): string {
  return `archives/${jobId}/${archiveId}/parts`;
}

/** One part object of an R2 parts-lane archive. */
export function r2ArchivePartPath(jobId: string, archiveId: string, index: number): string {
  return `${r2ArchivePartFolder(jobId, archiveId)}/${String(index).padStart(5, "0")}`;
}

/**
 * The part-object basename shape both parted lanes list against.
 *
 * A listing returns basenames; only a zero-padded five-digit one is a part this
 * server ever addressed. Anything else in the prefix is ignored rather than
 * guessed at, so a stray object can never become a phantom accepted part.
 */
export const ARCHIVE_PART_BASENAME = /^\d{5}$/;

/** The part index a listed basename denotes, or null when it is not a part. */
export function archivePartIndexFromName(name: string): number | null {
  return ARCHIVE_PART_BASENAME.test(name) ? Number(name) : null;
}
