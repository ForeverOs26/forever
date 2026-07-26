/**
 * Owner Direct Publish — write-target verification
 * (FOREVER-STUDIO-OWNER-DIRECT-PUBLISH-001).
 *
 * Direct publication writes straight into the live public database. There is no
 * draft to inspect afterwards, so the target identity must be proven BEFORE the
 * first write rather than assumed from ambient configuration.
 *
 * Two rules are absolute here:
 *   1. The only permitted target is production `abtvsrcnfwlbawvrjeed`.
 *   2. Staging `garjibjhlzeljsnpzisu` is refused by ref, by name, and by URL —
 *      a direct-publish run must never contact it, not even read-only.
 *
 * Client-safe: pure string/ref reasoning, no credentials and no network. The
 * credential itself is read only by the server/CLI client that consumes
 * `assertProductionTarget`'s verdict.
 */

/** The one authorized direct-publish database identity. */
export const PRODUCTION_PROJECT_REF = "abtvsrcnfwlbawvrjeed";

/**
 * Known staging identity. Present ONLY so it can be recognized and refused;
 * nothing in this module ever builds a request against it.
 */
export const STAGING_PROJECT_REF = "garjibjhlzeljsnpzisu";

/** Direct publication has exactly one legal target. */
export type DirectPublishTarget = "production";

export const DIRECT_PUBLISH_TARGET: DirectPublishTarget = "production";

export interface VerifiedTarget {
  target: DirectPublishTarget;
  projectRef: string;
  /** Origin the verified ref was proven from. Never carries a credential. */
  url: string;
}

export class DirectPublishTargetError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DirectPublishTargetError";
    this.code = code;
  }
}

/**
 * Extract a Supabase project ref from an API origin. Accepts only the exact
 * `https://<ref>.supabase.co` shape: anything else (custom domain, pooler
 * host, path-carrying URL, http) is unverifiable and returns null rather than
 * guessing, because a guess here could send writes to the wrong database.
 */
export function projectRefFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.pathname !== "" && parsed.pathname !== "/") return null;
  const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(parsed.hostname);
  return match ? match[1] : null;
}

/**
 * Prove the configured environment points at production before any write.
 *
 * `requestedTarget` must be stated explicitly by the caller so a direct publish
 * can never happen as a side effect of whatever happened to be in the
 * environment — the request and the environment must agree.
 */
export function assertProductionTarget(input: {
  supabaseUrl: string | undefined;
  requestedTarget: string;
}): VerifiedTarget {
  if (input.requestedTarget !== DIRECT_PUBLISH_TARGET) {
    throw new DirectPublishTargetError(
      "target_not_production",
      `Direct publication targets production only; "${input.requestedTarget}" was requested.`,
    );
  }
  const url = input.supabaseUrl?.trim();
  if (!url) {
    throw new DirectPublishTargetError(
      "target_url_missing",
      "SUPABASE_URL is not configured, so the production identity cannot be proven.",
    );
  }
  const ref = projectRefFromUrl(url);
  if (!ref) {
    throw new DirectPublishTargetError(
      "target_url_unverifiable",
      "SUPABASE_URL is not an exact https://<ref>.supabase.co origin; the project ref cannot be proven.",
    );
  }
  if (ref === STAGING_PROJECT_REF) {
    throw new DirectPublishTargetError(
      "target_is_staging",
      "Refusing to run: the configured project ref is staging. Direct publication never contacts staging.",
    );
  }
  if (ref !== PRODUCTION_PROJECT_REF) {
    throw new DirectPublishTargetError(
      "target_ref_mismatch",
      `Refusing to run: configured project ref "${ref}" is not production ${PRODUCTION_PROJECT_REF}.`,
    );
  }
  return { target: DIRECT_PUBLISH_TARGET, projectRef: ref, url };
}
