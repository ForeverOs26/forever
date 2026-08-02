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
