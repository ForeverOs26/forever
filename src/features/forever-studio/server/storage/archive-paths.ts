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
 * Archive-id scoped exactly as the assembled-object key was, so one prefix
 * bounds everything one archive ever wrote, and two archives — including a
 * rejected one and the retry that replaces it — never share a prefix.
 *
 * Note this does NOT mean every re-plan gets a fresh prefix: re-presenting the
 * identical manifest deliberately RESUMES the same archive id, and writing the
 * remaining parts into the same prefix is exactly what makes resume work. What
 * the scoping guarantees is that different bytes never land in one prefix,
 * because any manifest difference produces a different archive id.
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
