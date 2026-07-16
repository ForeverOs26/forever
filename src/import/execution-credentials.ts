import { FOREVER_IMPORT_EXECUTOR_ROLE } from "./execution-endpoint";

/**
 * RC5.5D isolated live execution credential boundary (PREPARATION ONLY).
 *
 * Design A — dedicated least-privilege database principal. A FUTURE live
 * execution authenticates as the dedicated `forever_import_executor` role
 * through a direct database transport — NEVER as service_role and NEVER through
 * the Supabase Data API. The execution credential is a PostgreSQL connection
 * URL for that role, supplied in a dedicated variable
 * {@link EXECUTION_DATABASE_URL_ENV_VAR}. Because the role's two granted
 * capabilities are USAGE on the dedicated closed `forever_execution` schema plus
 * EXECUTE on the SECURITY DEFINER wrapper (see the migration), possession of
 * this credential can reach the one bounded import function but cannot read or
 * mutate the target tables directly. (The role's effective privileges are
 * proven only by the effective-privilege & PUBLIC-ACL audit against the real
 * target, since direct grants alone do not account for PUBLIC inheritance.)
 *
 * Two approved connection routes, matching Supabase's official contract:
 *
 * - `direct` — `postgres(ql)://forever_import_executor:<pw>@db.<ref>.supabase.co[:5432]/postgres`.
 *   Supabase's direct endpoint is IPv6-only unless the paid IPv4 add-on is
 *   enabled; usable where IPv6 (or the add-on) is available.
 * - `supavisor_session` — the Shared Pooler / Supavisor SESSION-mode endpoint,
 *   available over IPv4 WITHOUT the paid add-on:
 *   `postgres(ql)://forever_import_executor.<ref>:<pw>@aws-<n>-<region>.pooler.supabase.com:5432/postgres`.
 *   The Supabase pooler encodes the tenant in the username as
 *   `<db-role>.<project-ref>`, so the dedicated role and the project ref are
 *   derived independently: the role is the fixed `forever_import_executor`
 *   prefix, and the ref is the 20-char suffix. Session mode is port 5432;
 *   transaction mode (6543) is rejected.
 *
 * Guarantees:
 * - The live path NEVER reads `SUPABASE_SERVICE_ROLE_KEY` (nor the publishable
 *   key). It reads ONLY {@link EXECUTION_DATABASE_URL_ENV_VAR}, lazily, inside
 *   `resolveExecutionCredentials` — never at import time, never during dry-run
 *   or collision inspection (which keep their own publishable-key path in
 *   `collision-reader.ts`).
 * - Only a PostgreSQL URL for the dedicated `forever_import_executor` principal,
 *   the canonical database `postgres`, and an approved route/port passes. A
 *   Supabase API key, a JWT, an HTTPS URL, a foreign role, a foreign host, a
 *   transaction-mode pooler port, or any structural deviation fails closed as
 *   `execution_credentials_invalid`. Absent configuration fails closed as
 *   `execution_credentials_missing`.
 * - The connection string (which embeds a password) can never leak through JSON
 *   serialization, spread/enumeration, or console inspection: it is
 *   non-enumerable and `toJSON`/`toString`/the node inspect hook return a fixed
 *   redaction marker. Only a NON-SECRET identity (mode, role, projectRef, host,
 *   port, database, region, password-free origin) is enumerable.
 * - This module contains no secret value and enables nothing: resolving a
 *   credential still cannot execute anything while the RC5.5D live capability
 *   and transport remain disabled.
 */

/** Dedicated execution credential variable — a database connection URL. */
export const EXECUTION_DATABASE_URL_ENV_VAR = "FOREVER_IMPORT_EXECUTOR_DATABASE_URL" as const;

/** Prefix of publishable (read-only surface) Supabase API keys. */
export const PUBLISHABLE_KEY_PREFIX = "sb_publishable_" as const;

/** Prefix of new-format privileged Supabase secret API keys. */
export const SERVICE_ROLE_KEY_PREFIX = "sb_secret_" as const;

/** Approved connection route to the dedicated executor principal. */
export type ExecutionRouteMode = "direct" | "supavisor_session";

/** Exact approved direct database hostname form: `db.<20-char-ref>.supabase.co`. */
const SUPABASE_DIRECT_HOSTNAME_PATTERN = /^db\.([a-z0-9]{20})\.supabase\.co$/;

/**
 * Exact approved Supavisor pooler hostname form:
 * `aws-<n>-<region>.pooler.supabase.com` (region e.g. `us-east-1`,
 * `ap-southeast-1`). Anchored, so deceptive prefix/suffix hosts are rejected.
 */
const SUPAVISOR_HOSTNAME_PATTERN = /^aws-[0-9]-([a-z]{2}-[a-z]+-[0-9]+)\.pooler\.supabase\.com$/;

/** Supavisor username form: `<dedicated-role>.<20-char-ref>`. */
const SUPAVISOR_USERNAME_PATTERN = new RegExp(`^${FOREVER_IMPORT_EXECUTOR_ROLE}\\.([a-z0-9]{20})$`);

/** Supabase's default database name. */
const SUPABASE_DATABASE_NAME = "postgres" as const;

/** Approved port for BOTH the direct route and the Supavisor SESSION route. */
const APPROVED_PORT = "5432" as const;

export const CREDENTIAL_REDACTION_MARKER = "[forever-execution-credentials:redacted]" as const;

export type ExecutionCredentialFailureCode =
  | "execution_credentials_missing"
  | "execution_credentials_invalid";

export class ExecutionCredentialError extends Error {
  constructor(public readonly code: ExecutionCredentialFailureCode) {
    // The message is exactly the stable code — no env value, no connection
    // string, no password, no host.
    super(code);
    this.name = "ExecutionCredentialError";
  }
}

/** Non-secret validated execution-principal identity (no password). */
export interface ExecutionCredentialIdentity {
  /** Connection route: direct database or Supavisor session pooler. */
  mode: ExecutionRouteMode;
  /** Database role the connection authenticates as (dedicated executor). */
  role: string;
  /** Canonical Supabase project ref (from host for direct, username for pooler). */
  projectRef: string;
  /** Validated host. */
  host: string;
  /** Validated port (always the approved 5432). */
  port: number;
  /** Database name. */
  database: string;
  /** Pooler region for the Supavisor route; null for the direct route. */
  region: string | null;
  /** Password-free origin, safe for display. */
  origin: string;
}

export interface ExecutionCredentials {
  /** Non-secret validated identity; safe to enumerate/serialize. */
  readonly identity: ExecutionCredentialIdentity;
  /** Non-enumerable secret; excluded from JSON, spread, and console inspection. */
  readonly connectionString: string;
  readonly toJSON: () => string;
}

export interface ExecutionCredentialProvider {
  resolveExecutionCredentials(): ExecutionCredentials;
}

/** True for a value that is clearly a Supabase API key or a JWT, never a DB URL. */
export function looksLikeApiKey(value: string): boolean {
  return (
    value.startsWith(PUBLISHABLE_KEY_PREFIX) ||
    value.startsWith(SERVICE_ROLE_KEY_PREFIX) ||
    value.startsWith("eyJ")
  );
}

function hasForbiddenCharacters(raw: string): boolean {
  // Reject whitespace (including CR/LF), quotes, backslashes, and control
  // characters outright — no trimming, no normalization.
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001F\u007F\s"'`\\]/.test(raw);
}

function invalid(): never {
  throw new ExecutionCredentialError("execution_credentials_invalid");
}

/**
 * Strictly parses the dedicated executor database connection URL and returns
 * its non-secret identity, keeping the password out of the return value. Two
 * approved routes are accepted (see the module docblock); everything else —
 * API keys, HTTPS URLs, other schemes, a missing/foreign role, a missing
 * password, a foreign/deceptive host, a transaction-mode pooler port (6543),
 * an unexpected port/path/query/fragment, the wrong database, and
 * whitespace/quote/control-character variants — fails closed.
 */
export function parseExecutorDatabaseUrl(raw: string): ExecutionCredentialIdentity {
  if (typeof raw !== "string" || raw.length === 0 || hasForbiddenCharacters(raw)) invalid();
  if (looksLikeApiKey(raw)) invalid();

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return invalid();
  }

  // ----- Shared envelope: scheme, password, database, no query/fragment -----
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") invalid();
  if (url.password === "" || url.search !== "" || url.hash !== "") invalid();
  if (raw.includes("?") || raw.includes("#")) invalid();
  const database = url.pathname.replace(/^\//, "");
  if (database !== SUPABASE_DATABASE_NAME) invalid();

  const directHost = SUPABASE_DIRECT_HOSTNAME_PATTERN.exec(url.hostname);
  const poolerHost = SUPAVISOR_HOSTNAME_PATTERN.exec(url.hostname);

  if (directHost) {
    // ----- Direct route -----------------------------------------------------
    // Username is exactly the dedicated role; port empty (default) or 5432.
    if (url.username !== FOREVER_IMPORT_EXECUTOR_ROLE) invalid();
    if (url.port !== "" && url.port !== APPROVED_PORT) invalid();
    const projectRef = directHost[1];
    const host = url.hostname;
    return {
      mode: "direct",
      role: FOREVER_IMPORT_EXECUTOR_ROLE,
      projectRef,
      host,
      port: Number(APPROVED_PORT),
      database,
      region: null,
      origin: `postgres://${FOREVER_IMPORT_EXECUTOR_ROLE}@${host}:${APPROVED_PORT}/${database}`,
    };
  }

  if (poolerHost) {
    // ----- Supavisor SESSION route (IPv4-capable) ---------------------------
    // Username is `<role>.<ref>`: derive the dedicated role (fixed prefix) and
    // the project ref (suffix) independently. Session mode REQUIRES port 5432;
    // transaction mode (6543) and a missing port are rejected.
    const userMatch = SUPAVISOR_USERNAME_PATTERN.exec(url.username);
    if (!userMatch) invalid();
    if (url.port !== APPROVED_PORT) invalid();
    const projectRef = userMatch![1];
    const region = poolerHost[1];
    const host = url.hostname;
    return {
      mode: "supavisor_session",
      role: FOREVER_IMPORT_EXECUTOR_ROLE,
      projectRef,
      host,
      port: Number(APPROVED_PORT),
      database,
      region,
      origin: `postgres://${FOREVER_IMPORT_EXECUTOR_ROLE}.${projectRef}@${host}:${APPROVED_PORT}/${database}`,
    };
  }

  return invalid();
}

function createExecutionCredentials(
  connectionString: string,
  identity: ExecutionCredentialIdentity,
): ExecutionCredentials {
  const credentials = {
    identity: Object.freeze({ ...identity }),
    toJSON: () => CREDENTIAL_REDACTION_MARKER,
  };
  Object.defineProperty(credentials, "connectionString", {
    value: connectionString,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  Object.defineProperty(credentials, Symbol.for("nodejs.util.inspect.custom"), {
    value: () => CREDENTIAL_REDACTION_MARKER,
    enumerable: false,
  });
  Object.defineProperty(credentials, "toString", {
    value: () => CREDENTIAL_REDACTION_MARKER,
    enumerable: false,
  });
  return Object.freeze(credentials) as ExecutionCredentials;
}

/**
 * Environment-backed provider for the FUTURE live checkpoint. Reads ONLY the
 * dedicated executor database URL variable, and only when
 * `resolveExecutionCredentials()` is invoked — creating the provider reads
 * nothing, and the service-role key is never read on this path. Fails closed
 * when the variable is absent or is not a valid dedicated executor connection
 * URL for an approved route.
 */
export function createEnvExecutionCredentialProvider(
  env: Record<string, string | undefined> = process.env,
): ExecutionCredentialProvider {
  return {
    resolveExecutionCredentials(): ExecutionCredentials {
      const connectionString = env[EXECUTION_DATABASE_URL_ENV_VAR];
      if (!connectionString) {
        throw new ExecutionCredentialError("execution_credentials_missing");
      }
      const identity = parseExecutorDatabaseUrl(connectionString);
      return createExecutionCredentials(connectionString, identity);
    },
  };
}
