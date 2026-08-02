/**
 * Forever Studio — the write-provider cutover control
 * (FOREVER-R2-MEDIA-STORAGE-CUTOVER-001).
 *
 * ONE server-only, NON-SECRET deployment value decides where the bytes of a
 * NEWLY CREATED job go:
 *
 *   STUDIO_STORAGE_WRITE_PROVIDER = supabase | r2
 *
 * It is deliberately not a secret and deliberately not a client value: it never
 * appears in a `VITE_*` variable and is read only here, on the server. The
 * browser is told which transport to use for the target it was handed — it is
 * never told what the global setting is.
 *
 * DOCUMENTED BEHAVIOUR FOR EVERY INPUT — there is no undefined case:
 *
 *   absent / empty / whitespace   → `supabase`. This is the PRE-CUTOVER state:
 *                                   a deployment that has not been configured
 *                                   yet keeps behaving exactly as production
 *                                   behaves today. Nothing new reaches R2.
 *   "supabase" / "r2"             → that provider (case-insensitive, trimmed;
 *                                   " R2 " is an operator typing a value, not a
 *                                   different value).
 *   anything else                 → REFUSAL. A non-empty value Studio does not
 *                                   recognize is a broken deployment variable,
 *                                   not a request for the old behaviour:
 *                                   silently writing to Supabase would ignore
 *                                   an operator who meant to switch. New job
 *                                   creation fails closed with a stable code
 *                                   until the value is corrected.
 *
 * A change to this value affects NEW jobs only. Every job records the provider
 * it was created under, and retries, resumes and scheduled continuations read
 * THAT — never this setting again.
 */

import { isStudioStorageProvider, type StudioStorageProviderId } from "../../studio-types";

export const STUDIO_STORAGE_WRITE_PROVIDER_ENV = "STUDIO_STORAGE_WRITE_PROVIDER";

/** The provider a deployment with no configured value writes with. */
export const DEFAULT_STUDIO_WRITE_PROVIDER: StudioStorageProviderId = "supabase";

/** A configured-but-unrecognized value. Never retryable; fix the deployment. */
export const STUDIO_WRITE_PROVIDER_INVALID_CODE = "storage_write_provider_invalid";

export interface StudioWriteProviderResolution {
  provider: StudioStorageProviderId | null;
  /** Set only when the configured value is non-empty and unrecognized. */
  invalidCode: typeof STUDIO_WRITE_PROVIDER_INVALID_CODE | null;
  /** True when nothing was configured and the safe default applied. */
  defaulted: boolean;
}

/**
 * Pure resolution of one raw configuration value. Exported separately from the
 * environment read so the whole matrix is testable without touching
 * `process.env`, and so no caller has to reimplement the normalization rules.
 *
 * The raw value is NEVER echoed into the result: a mistyped variable might
 * contain anything, and this result crosses into error messages.
 */
export function resolveWriteProviderValue(raw: unknown): StudioWriteProviderResolution {
  if (raw === undefined || raw === null) {
    return { provider: DEFAULT_STUDIO_WRITE_PROVIDER, invalidCode: null, defaulted: true };
  }
  if (typeof raw !== "string") {
    return { provider: null, invalidCode: STUDIO_WRITE_PROVIDER_INVALID_CODE, defaulted: false };
  }
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return { provider: DEFAULT_STUDIO_WRITE_PROVIDER, invalidCode: null, defaulted: true };
  }
  if (!isStudioStorageProvider(normalized)) {
    return { provider: null, invalidCode: STUDIO_WRITE_PROVIDER_INVALID_CODE, defaulted: false };
  }
  return { provider: normalized, invalidCode: null, defaulted: false };
}
