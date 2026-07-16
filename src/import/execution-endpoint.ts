/**
 * RC5.5D execution endpoint identity boundary (PREPARATION ONLY).
 *
 * The live adapter must never talk to "whatever URL the environment carries":
 * before any transport is created and before any network access, the
 * configured execution endpoint must be PROVEN to be the approved Forever
 * Supabase project. The request's self-declared `targetProjectId` is never
 * sufficient — endpoint identity is derived independently from the strictly
 * parsed credential URL and then required to agree with the committed
 * approved-target configuration AND with the request's target fields.
 *
 * Everything here is non-secret: the canonical project ref is committed
 * repository configuration (`supabase/config.toml`), and validated identities
 * carry only the ref, the normalized origin, and the approved target name.
 * No raw URL, credential, or header ever leaves this module through an error:
 * failures carry a stable reason code only.
 */

/** Canonical Forever Supabase project ref (non-secret, committed config). */
export const CANONICAL_SUPABASE_PROJECT_REF = "abtvsrcnfwlbawvrjeed" as const;

/**
 * The dedicated least-privilege database role the future execution transport
 * must authenticate as (design A). Mirrors the migration's
 * `forever_import_executor`; the execution credential URL must name exactly
 * this role, and no other principal (service_role, postgres, anon,
 * authenticated) is ever an approved executor.
 */
export const FOREVER_IMPORT_EXECUTOR_ROLE = "forever_import_executor" as const;

/** Exact approved Supabase hostname form: `<20-char-ref>.supabase.co`. */
const SUPABASE_HOSTNAME_PATTERN = /^([a-z0-9]{20})\.supabase\.co$/;

export type ExecutionEndpointFailureCode =
  /** URL malformed, non-HTTPS, userinfo, port, path, query, fragment, or bad host form. */
  | "execution_endpoint_invalid"
  /** Well-formed Supabase endpoint, but not the approved canonical project. */
  | "execution_endpoint_mismatch"
  /** Endpoint is canonical, but not the dedicated least-privilege executor role. */
  | "execution_principal_mismatch"
  /** Supavisor route to the canonical project, but not the approved bound region. */
  | "execution_region_mismatch"
  /** Endpoint/principal are canonical, but the request's target identity disagrees. */
  | "execution_target_mismatch";

export class ExecutionEndpointError extends Error {
  constructor(public readonly code: ExecutionEndpointFailureCode) {
    // The message is exactly the stable code — never a URL, host, or header.
    super(code);
    this.name = "ExecutionEndpointError";
  }
}

/** Non-secret validated endpoint identity. */
export interface ExecutionEndpointIdentity {
  /** Canonical Supabase project ref derived from the hostname. */
  projectRef: string;
  /** Normalized origin (`https://<ref>.supabase.co`), no path/query/fragment. */
  origin: string;
  /** Approved execution target this endpoint is configured for. */
  target: string;
}

/**
 * The committed approved execution-target configuration. Only the canonical
 * local target exists; staging remains unconfigured and production remains
 * blocked (their absence here makes them fail closed structurally).
 * `targetProjectId` is the RC5.5A non-secret marker identity the request and
 * approval carry; `projectRef` is the Supabase project the endpoint must be.
 *
 * `poolerRegion` optionally binds the Supavisor session route to one region:
 * when set, a pooler credential whose region differs fails closed. It is
 * deliberately left UNSET here — the live transport is unconfigured in this
 * slice, and the Owner binds the real region out-of-band at the future
 * checkpoint. The direct route has no region and is unaffected.
 */
export const APPROVED_EXECUTION_ENDPOINTS: ReadonlyArray<{
  target: string;
  targetProjectId: string;
  projectRef: string;
  poolerRegion?: string;
}> = Object.freeze([
  Object.freeze({
    target: "local",
    targetProjectId: "forever-local",
    projectRef: CANONICAL_SUPABASE_PROJECT_REF,
  }),
]);

function hasForbiddenCharacters(rawUrl: string): boolean {
  // Reject whitespace (including CR/LF), quotes, backslashes, and control
  // characters outright — no trimming, no normalization, no second guess.
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001F\u007F\s"'`\\]/.test(rawUrl);
}

/**
 * Strictly parses a Supabase execution endpoint URL. Fails closed
 * (`execution_endpoint_invalid`) on anything but
 * `https://<20-char-ref>.supabase.co` optionally followed by a single `/`:
 * malformed URLs, non-HTTPS schemes, userinfo, explicit ports, paths,
 * query strings, fragments, deceptive hostname prefixes/suffixes, and
 * whitespace/quote/control-character variants are all rejected.
 */
export function parseSupabaseExecutionEndpoint(rawUrl: string): {
  projectRef: string;
  origin: string;
} {
  if (typeof rawUrl !== "string" || rawUrl.length === 0 || hasForbiddenCharacters(rawUrl)) {
    throw new ExecutionEndpointError("execution_endpoint_invalid");
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ExecutionEndpointError("execution_endpoint_invalid");
  }

  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.pathname !== "" && url.pathname !== "/")
  ) {
    throw new ExecutionEndpointError("execution_endpoint_invalid");
  }
  // The raw string must not smuggle an empty query/fragment the URL parser
  // normalizes away ("https://x.supabase.co?#").
  if (rawUrl.includes("?") || rawUrl.includes("#")) {
    throw new ExecutionEndpointError("execution_endpoint_invalid");
  }

  const match = SUPABASE_HOSTNAME_PATTERN.exec(url.hostname);
  if (!match) throw new ExecutionEndpointError("execution_endpoint_invalid");

  const projectRef = match[1];
  return { projectRef, origin: `https://${projectRef}.supabase.co` };
}

export interface VerifyExecutionEndpointInput {
  /** The configured execution endpoint URL (from the credential boundary). */
  url: string;
  /** The request's approved target name (e.g. "local"). */
  requestTarget: string;
  /** The request's non-secret target identity (e.g. "forever-local"). */
  requestTargetProjectId: string;
}

/**
 * Full endpoint identity verification, run BEFORE transport creation and
 * before any network access:
 *
 * 1. the URL parses strictly and its hostname yields a project ref;
 * 2. the ref equals the canonical Forever project ref
 *    (`abtvsrcnfwlbawvrjeed`) — no other endpoint is approved for execution;
 * 3. an approved execution-target configuration exists whose `projectRef`
 *    matches the endpoint;
 * 4. the request's target name AND target identity agree with that validated
 *    configuration — the request's self-declared identity alone proves
 *    nothing.
 *
 * Returns the non-secret validated identity, or throws a stable-code
 * {@link ExecutionEndpointError}.
 */
export function verifyExecutionEndpoint(
  input: VerifyExecutionEndpointInput,
): ExecutionEndpointIdentity {
  const { projectRef, origin } = parseSupabaseExecutionEndpoint(input.url);
  const approved = bindApprovedExecutionTarget(
    {
      projectRef,
      requestTarget: input.requestTarget,
      requestTargetProjectId: input.requestTargetProjectId,
    },
    APPROVED_EXECUTION_ENDPOINTS,
  );
  return { projectRef, origin, target: approved.target };
}

/**
 * Shared canonical-target binding used by both the HTTPS endpoint verifier and
 * the database-principal verifier: the project ref must equal the canonical
 * Forever project, an approved execution-target configuration must exist for
 * it, and the request's target name and non-secret target identity must both
 * agree with that configuration. Returns the approved target name or throws a
 * stable-code {@link ExecutionEndpointError}.
 */
export type ApprovedExecutionEndpoints = typeof APPROVED_EXECUTION_ENDPOINTS;

function bindApprovedExecutionTarget(
  input: {
    projectRef: string;
    requestTarget: string;
    requestTargetProjectId: string;
  },
  approvedEndpoints: ApprovedExecutionEndpoints,
): ApprovedExecutionEndpoints[number] {
  if (input.projectRef !== CANONICAL_SUPABASE_PROJECT_REF) {
    throw new ExecutionEndpointError("execution_endpoint_mismatch");
  }
  const approved = approvedEndpoints.find((entry) => entry.projectRef === input.projectRef);
  if (!approved) throw new ExecutionEndpointError("execution_endpoint_mismatch");
  if (
    input.requestTarget !== approved.target ||
    input.requestTargetProjectId !== approved.targetProjectId
  ) {
    throw new ExecutionEndpointError("execution_target_mismatch");
  }
  return approved;
}

/** Non-secret validated database execution-principal identity. */
export interface ExecutionDatabaseIdentity {
  mode: "direct" | "supavisor_session";
  projectRef: string;
  role: string;
  region: string | null;
  target: string;
}

export interface VerifyExecutionDatabaseEndpointInput {
  /** Connection route derived from the strictly parsed connection URL. */
  mode: "direct" | "supavisor_session";
  /** Canonical project ref derived from the strictly parsed connection URL. */
  projectRef: string;
  /** Database role the connection URL authenticates as. */
  role: string;
  /** Supavisor pooler region (null for the direct route). */
  region: string | null;
  /** The request's approved target name (e.g. "local"). */
  requestTarget: string;
  /** The request's non-secret target identity (e.g. "forever-local"). */
  requestTargetProjectId: string;
}

/**
 * Full database execution-principal verification, run BEFORE transport creation
 * and before any network access. It REQUIRES the connection to authenticate as
 * the dedicated least-privilege `forever_import_executor` role — never
 * service_role, postgres, anon, or authenticated — binds the canonical project
 * ref and request target, and, for the Supavisor session route, enforces the
 * approved region when one is bound in the committed configuration. Both the
 * direct and Supavisor routes reach the SAME dedicated principal and the SAME
 * canonical project, so IPv4 (session pooler) and IPv6/add-on (direct)
 * environments share one least-privilege boundary. Returns the non-secret
 * validated identity or throws a stable-code {@link ExecutionEndpointError}.
 */
export function verifyExecutionDatabaseEndpoint(
  input: VerifyExecutionDatabaseEndpointInput,
  approvedEndpoints: ApprovedExecutionEndpoints = APPROVED_EXECUTION_ENDPOINTS,
): ExecutionDatabaseIdentity {
  if (input.role !== FOREVER_IMPORT_EXECUTOR_ROLE) {
    throw new ExecutionEndpointError("execution_principal_mismatch");
  }
  const approved = bindApprovedExecutionTarget(
    {
      projectRef: input.projectRef,
      requestTarget: input.requestTarget,
      requestTargetProjectId: input.requestTargetProjectId,
    },
    approvedEndpoints,
  );
  // Region binding applies to the Supavisor route only, and only when the
  // committed configuration binds a region.
  if (
    input.mode === "supavisor_session" &&
    approved.poolerRegion != null &&
    input.region !== approved.poolerRegion
  ) {
    throw new ExecutionEndpointError("execution_region_mismatch");
  }
  return {
    mode: input.mode,
    projectRef: input.projectRef,
    role: input.role,
    region: input.region,
    target: approved.target,
  };
}
