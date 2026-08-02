/**
 * Forever Studio — reading back the provider a job was created with.
 *
 * THE LEGACY-COMPATIBILITY RULE, in one place:
 *
 *   a job says which storage system holds its bytes. A job written before the
 *   provider contract existed says nothing, and "nothing" means SUPABASE —
 *   which is exactly what those jobs were created on. There is no third
 *   answer, no inference from a URL, and no consultation of the current
 *   deployment setting.
 *
 * This is what makes "a retry never changes provider mid-job", "a resumed R2
 * job never falls back to Supabase" and "a resumed Supabase legacy job never
 * changes itself into R2" true by construction rather than by convention.
 *
 * The value is persisted in the job's existing `facts` JSONB (and mirrored onto
 * every declared file in the existing `files` JSONB), so no migration and no
 * backfill is required.
 */

import {
  isStudioStorageProvider,
  type StudioJobFile,
  type StudioStorageProviderId,
} from "../../studio-types";
import type { StudioArchiveRow, StudioJobRow } from "../contracts";
import type { StudioArchiveStorageState } from "./provider";

/** Key inside `studio_upload_jobs.facts` holding the storage decision. */
export const JOB_STORAGE_FACTS_KEY = "storage";

export interface StudioJobStorageFacts {
  provider: StudioStorageProviderId;
}

/** The provider one job records. Absent ⇒ `supabase` (pre-contract manifest). */
export function jobStorageProvider(job: {
  facts?: Record<string, unknown> | null;
  files?: StudioJobFile[] | null;
}): StudioStorageProviderId {
  const facts = (job.facts ?? {}) as Record<string, unknown>;
  const stored = (facts[JOB_STORAGE_FACTS_KEY] as { provider?: unknown } | undefined)?.provider;
  if (isStudioStorageProvider(stored)) return stored;
  // A manifest whose job-level record is missing but whose FILES carry the
  // provider still resolves truthfully (a job created by an older build of
  // this same contract, or a row edited by hand).
  for (const file of job.files ?? []) {
    if (isStudioStorageProvider(file.storageProvider)) return file.storageProvider;
  }
  return "supabase";
}

/** The facts patch written when a job is created. */
export function jobStorageFacts(provider: StudioStorageProviderId): {
  [JOB_STORAGE_FACTS_KEY]: StudioJobStorageFacts;
} {
  return { [JOB_STORAGE_FACTS_KEY]: { provider } };
}

/**
 * The archive's durable upload identity, read back from its `extracted` JSONB.
 *
 * A pre-contract archive has none: it is a Supabase parted archive, which is
 * exactly what it was planned as, and the parted reader addresses it from
 * (job, archive, index) with no stored state at all.
 */
export function archiveStorageState(archive: StudioArchiveRow): StudioArchiveStorageState {
  const stored = (archive.extracted as { storage?: StudioArchiveStorageState } | null)?.storage;
  if (stored && isStudioStorageProvider(stored.provider)) return stored;
  return { provider: "supabase" };
}

/** Whether the job and one of its archives agree about the storage system. */
export function archiveProviderMatchesJob(job: StudioJobRow, archive: StudioArchiveRow): boolean {
  return archiveStorageState(archive).provider === jobStorageProvider(job);
}
