import type { ExecutionCredentialProvider, ExecutionCredentials } from "./execution-credentials";
import { ExecutionCredentialError } from "./execution-credentials";
import { ExecutionEndpointError, verifyExecutionDatabaseEndpoint } from "./execution-endpoint";
import type { ImportOperationCounts } from "./plan-hash";
import {
  validateServerExecutionRequest,
  type ServerExecutionRequest,
} from "./server-execution-request";

/**
 * RC5.5D typed live adapter over a DIRECT-PostgreSQL execution boundary
 * (PREPARATION ONLY — structurally complete, disabled by default).
 *
 * The future first real import is exactly ONE invocation of the fixed statement
 * `SELECT forever_execution.forever_execute_approved_import($1::jsonb)` through
 * a single-purpose {@link ApprovedImportDatabaseTransport} — a direct
 * PostgreSQL connection authenticated as the dedicated least-privilege
 * `forever_import_executor` role, NOT PostgREST. The server runs approval
 * consumption, fresh-state verification, all writes, persisted-row
 * verification, and receipt creation inside one PostgreSQL transaction. This
 * adapter therefore never simulates a transaction client-side, never issues
 * per-entity inserts, never supplies a schema/table/function name or arbitrary
 * SQL, never exposes a generic database client, never retries, and never
 * reissues or reuses an approval.
 *
 * Disablement: construction requires an injected {@link
 * LiveExecutionCapability}; the repository default is
 * {@link LIVE_EXECUTION_CAPABILITY_DISABLED} and the module constant
 * {@link LIVE_SERVER_EXECUTION_ENABLED} is `false`. Even with a capability, a
 * transport must be explicitly injected — the default factory fails closed —
 * so no repository default can reach a credential or the network.
 *
 * Trust boundary: raw provider errors and malformed responses are discarded,
 * never parsed for content and never surfaced. The only error detail that
 * survives is a reason code lifted verbatim from the closed server vocabulary
 * (`forever_import_execution: <code>`); such a code can only originate from a
 * controlled RAISE inside the boundary function, which PostgreSQL guarantees
 * rolled the whole transaction back — that is the only path to a confirmed
 * `rolled_back` outcome. Everything ambiguous (timeout, network failure,
 * unrecognized error, malformed/partial/unknown response) maps to
 * `failed_rollback_unconfirmed`.
 */

/** Repository default: the live server execution path is disabled. */
export const LIVE_SERVER_EXECUTION_ENABLED = false as const;

export interface LiveExecutionCapability {
  readonly liveExecutionAuthorized: boolean;
}

/** The only capability value defined in this repository. */
export const LIVE_EXECUTION_CAPABILITY_DISABLED: LiveExecutionCapability = Object.freeze({
  liveExecutionAuthorized: false,
});

/** Default single-invocation deadline before the outcome is declared unknown. */
export const SERVER_EXECUTION_TIMEOUT_MS = 120_000;

/**
 * Closed whitelist: reason codes the boundary function can RAISE (confirmed
 * rollback semantics) plus adapter-local pre-network and ambiguity codes.
 */
export const SERVER_ROLLBACK_REASON_CODES = [
  "request_malformed",
  "request_too_large",
  "request_schema_unsupported",
  "request_unsupported_property",
  "request_invalid_field",
  "request_operation_counts_invalid",
  "request_operation_count_exceeded",
  "request_duplicate_natural_key",
  "request_duplicate_persistence_key",
  "request_unsafe_path",
  "request_credential_material",
  "approval_unknown",
  "approval_already_consumed",
  "approval_already_registered",
  "approval_request_mismatch",
  "approval_not_yet_valid",
  "approval_expired",
  "approval_scope_mismatch",
  "plan_already_executed",
  "dependency_developer_unresolved",
  "dependency_location_unresolved",
  "target_state_changed",
  "missing_parent_reference",
  "verification_row_missing",
  "verification_extra_rows",
  "verification_duplicate_persistence_key",
  "verification_parent_mismatch",
  "verification_field_mismatch",
  "verification_count_mismatch",
] as const;

export type ServerRollbackReasonCode = (typeof SERVER_ROLLBACK_REASON_CODES)[number];

const SERVER_ROLLBACK_REASON_CODE_SET: ReadonlySet<string> = new Set(SERVER_ROLLBACK_REASON_CODES);

export const ADAPTER_REASON_CODES = [
  "live_execution_disabled",
  "execution_credentials_missing",
  "execution_credentials_invalid",
  "execution_endpoint_invalid",
  "execution_endpoint_mismatch",
  "execution_principal_mismatch",
  "execution_region_mismatch",
  "execution_target_mismatch",
  "adapter_failure",
  "server_response_invalid",
  "execution_outcome_unknown",
] as const;

export type AdapterReasonCode = (typeof ADAPTER_REASON_CODES)[number];

export type ServerExecutionReasonCode = ServerRollbackReasonCode | AdapterReasonCode | string;

export function isServerRollbackReasonCode(value: unknown): value is ServerRollbackReasonCode {
  return typeof value === "string" && SERVER_ROLLBACK_REASON_CODE_SET.has(value);
}

// ---------------------------------------------------------------------------
// Server result and outcome types
// ---------------------------------------------------------------------------

export interface ServerCommittedResult {
  schemaVersion: "1";
  outcome: "committed";
  executionId: string;
  approvalDigest: string;
  requestFingerprint: string;
  projectSlug: string;
  target: string;
  targetProjectId: string;
  planHash: string;
  collisionReportFingerprint: string;
  operationCounts: ImportOperationCounts;
  writesPerformed: number;
  commitConfirmed: true;
}

export type ServerExecutionOutcome =
  | { outcome: "committed"; result: ServerCommittedResult }
  | { outcome: "rolled_back"; reasonCode: ServerRollbackReasonCode }
  | { outcome: "rejected_before_transaction"; reasonCode: string }
  | { outcome: "failed_rollback_unconfirmed"; reasonCode: AdapterReasonCode };

// ---------------------------------------------------------------------------
// Direct-PostgreSQL transport abstraction (no generic database client escapes)
// ---------------------------------------------------------------------------

/**
 * The single sanitized result of the one fixed statement. `result` is the jsonb
 * value returned by `forever_execution.forever_execute_approved_import($1)`;
 * `error` is a provider error signal (discarded raw, mapped by reason code).
 */
export interface DatabaseExecutionResponse {
  result: unknown;
  error: unknown;
}

/**
 * The ONLY capability the adapter has against the database: run one approved
 * import through the single fixed, parameterized statement
 * `SELECT forever_execution.forever_execute_approved_import($1::jsonb)` — the
 * approved request is the ONLY bound parameter. This is a direct PostgreSQL
 * transport, NOT a PostgREST RPC: there is exactly one method, no
 * function-name/schema/table/SQL argument is ever supplied by a caller, and no
 * generic database client is exposed. A future implementation binds `request`
 * as `$1` and runs {@link APPROVED_IMPORT_EXECUTION_STATEMENT} once.
 */
export interface ApprovedImportDatabaseTransport {
  executeApprovedImport(request: ServerExecutionRequest): Promise<DatabaseExecutionResponse>;
}

export type ApprovedImportDatabaseTransportFactory = (
  credentials: ExecutionCredentials,
) => ApprovedImportDatabaseTransport;

class LiveExecutionDisabledError extends Error {
  constructor() {
    super("live_execution_disabled");
    this.name = "LiveExecutionDisabledError";
  }
}

/**
 * Repository-default transport factory: fails closed. A real direct-PostgreSQL
 * transport must be injected explicitly by a future Owner-gated slice; no
 * default wiring in this repository can create one.
 */
export function disabledApprovedImportDatabaseTransportFactory(): ApprovedImportDatabaseTransport {
  throw new LiveExecutionDisabledError();
}

// ---------------------------------------------------------------------------
// Response parsing (strict, fail closed, raw content discarded)
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SERVER_ERROR_MESSAGE_PATTERN = /^forever_import_execution: ([a-z_]+)$/;
const EXECUTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Extracts a whitelisted rollback reason code from a provider error, or null.
 * The raw error is otherwise discarded: no message fragment, URL, SQL text, or
 * provider detail survives this function.
 */
export function parseServerErrorReasonCode(error: unknown): ServerRollbackReasonCode | null {
  if (!isPlainObject(error) || typeof error.message !== "string") return null;
  const match = SERVER_ERROR_MESSAGE_PATTERN.exec(error.message);
  if (!match) return null;
  return isServerRollbackReasonCode(match[1]) ? match[1] : null;
}

const COMMITTED_RESULT_KEYS = [
  "approvalDigest",
  "collisionReportFingerprint",
  "commitConfirmed",
  "executionId",
  "operationCounts",
  "outcome",
  "planHash",
  "projectSlug",
  "requestFingerprint",
  "schemaVersion",
  "target",
  "targetProjectId",
  "writesPerformed",
] as const;

function countsEqual(left: ImportOperationCounts, right: unknown): boolean {
  if (!isPlainObject(right)) return false;
  const keys = Object.keys(right).sort();
  const expected = ["buildings", "operations", "priceHistoryRows", "projects", "units"];
  if (keys.length !== expected.length || !keys.every((key, index) => key === expected[index])) {
    return false;
  }
  return expected.every((key) => right[key] === left[key as keyof ImportOperationCounts]);
}

/**
 * Strict structural validation of a committed server result, cross-checked
 * field by field against the request that was sent. Any missing, extra,
 * mismatched, or malformed field fails closed to null.
 */
export function parseServerCommittedResult(
  data: unknown,
  request: ServerExecutionRequest,
): ServerCommittedResult | null {
  if (!isPlainObject(data)) return null;
  const keys = Object.keys(data).sort();
  if (
    keys.length !== COMMITTED_RESULT_KEYS.length ||
    !keys.every((key, index) => key === COMMITTED_RESULT_KEYS[index])
  ) {
    return null;
  }
  if (data.schemaVersion !== "1") return null;
  if (data.outcome !== "committed") return null;
  if (data.commitConfirmed !== true) return null;
  if (typeof data.executionId !== "string" || !EXECUTION_ID_PATTERN.test(data.executionId)) {
    return null;
  }
  if (data.approvalDigest !== request.approvalDigest) return null;
  if (data.requestFingerprint !== request.requestFingerprint) return null;
  if (data.projectSlug !== request.projectSlug) return null;
  if (data.target !== request.target) return null;
  if (data.targetProjectId !== request.targetProjectId) return null;
  if (data.planHash !== request.planHash) return null;
  if (data.collisionReportFingerprint !== request.collisionReportFingerprint) return null;
  if (!countsEqual(request.operationCounts, data.operationCounts)) return null;
  if (data.writesPerformed !== request.operationCounts.operations) return null;
  return data as unknown as ServerCommittedResult;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export interface ApprovedImportServerExecutor {
  executeApprovedImportRequest(request: unknown): Promise<ServerExecutionOutcome>;
}

export interface CreateServerExecutionAdapterOptions {
  /** Defaults to the disabled capability; the live path stays unreachable. */
  capability?: LiveExecutionCapability;
  credentialProvider: ExecutionCredentialProvider;
  /** Defaults to the fail-closed factory; a real transport must be injected. */
  transportFactory?: ApprovedImportDatabaseTransportFactory;
  timeoutMs?: number;
}

const TIMEOUT_SENTINEL: unique symbol = Symbol("server-execution-timeout");

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | typeof TIMEOUT_SENTINEL> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT_SENTINEL), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Creates the typed server-execution adapter. Gate order is strict and
 * fail-closed:
 *   1. full local request validation — invalid requests are rejected before
 *      the credential provider is invoked and before any client exists;
 *   2. capability — disabled means rejected, still credential-free;
 *   3. credential resolution — the dedicated executor database URL must
 *      strictly parse (dedicated `forever_import_executor` role, an approved
 *      route: direct `db.<ref>.supabase.co:5432` or Supavisor session
 *      `aws-<n>-<region>.pooler.supabase.com:5432`); a missing or invalid
 *      credential — including a service-role/publishable API key or a
 *      transaction-mode pooler port — fails closed, still offline;
 *   4. endpoint + principal identity verification — the derived project ref
 *      must be the canonical Forever project (`abtvsrcnfwlbawvrjeed`), the role
 *      must be the dedicated least-privilege executor, any bound pooler region
 *      must match, and all must agree with the approved target configuration
 *      and the request's target fields; any mismatch fails closed BEFORE
 *      transport creation and before any network access;
 *   5. transport creation — the default factory fails closed;
 *   6. exactly ONE invocation of the one fixed statement, never retried.
 */
export function createServerExecutionAdapter(
  options: CreateServerExecutionAdapterOptions,
): ApprovedImportServerExecutor {
  const capability = options.capability ?? LIVE_EXECUTION_CAPABILITY_DISABLED;
  const transportFactory =
    options.transportFactory ?? disabledApprovedImportDatabaseTransportFactory;
  const timeoutMs = options.timeoutMs ?? SERVER_EXECUTION_TIMEOUT_MS;

  return {
    async executeApprovedImportRequest(candidate: unknown): Promise<ServerExecutionOutcome> {
      // 1. Local validation first: no credential read, no client, no network
      //    for an invalid request.
      const validationError = validateServerExecutionRequest(candidate);
      if (validationError) {
        return { outcome: "rejected_before_transaction", reasonCode: validationError };
      }
      const request = candidate as ServerExecutionRequest;

      // 2. Capability gate (false by default in every repository flow).
      if (capability.liveExecutionAuthorized !== true) {
        return {
          outcome: "rejected_before_transaction",
          reasonCode: "live_execution_disabled",
        };
      }

      // 3. Credential boundary — the first and only point that may read the
      //    dedicated executor database URL; never the service-role key; still
      //    no network.
      let credentials: ExecutionCredentials;
      try {
        credentials = options.credentialProvider.resolveExecutionCredentials();
      } catch (error) {
        const code = error instanceof ExecutionCredentialError ? error.code : "adapter_failure";
        return { outcome: "rejected_before_transaction", reasonCode: code };
      }

      // 4. Endpoint + principal identity binding: the credential must resolve
      //    to the canonical Forever database over an approved route (direct or
      //    Supavisor session), authenticate as the dedicated least-privilege
      //    executor role, satisfy any bound pooler region, and agree with the
      //    request's target identity. Still no transport, no network.
      try {
        verifyExecutionDatabaseEndpoint({
          mode: credentials.identity.mode,
          projectRef: credentials.identity.projectRef,
          role: credentials.identity.role,
          region: credentials.identity.region,
          requestTarget: request.target,
          requestTargetProjectId: request.targetProjectId,
        });
      } catch (error) {
        const code = error instanceof ExecutionEndpointError ? error.code : "adapter_failure";
        return { outcome: "rejected_before_transaction", reasonCode: code };
      }

      // 5. Transport creation; the default factory fails closed here.
      let transport: ApprovedImportDatabaseTransport;
      try {
        transport = transportFactory(credentials);
      } catch (error) {
        const code =
          error instanceof LiveExecutionDisabledError
            ? "live_execution_disabled"
            : "adapter_failure";
        return { outcome: "rejected_before_transaction", reasonCode: code };
      }

      // 6. Exactly one invocation of the one fixed statement. No retry.
      let response: DatabaseExecutionResponse | typeof TIMEOUT_SENTINEL;
      try {
        response = await withTimeout(transport.executeApprovedImport(request), timeoutMs);
      } catch {
        // The request may or may not have reached the server; the raw error
        // is discarded and the outcome is truthfully unknown.
        return {
          outcome: "failed_rollback_unconfirmed",
          reasonCode: "execution_outcome_unknown",
        };
      }
      if (response === TIMEOUT_SENTINEL) {
        return {
          outcome: "failed_rollback_unconfirmed",
          reasonCode: "execution_outcome_unknown",
        };
      }
      if (!isPlainObject(response)) {
        return { outcome: "failed_rollback_unconfirmed", reasonCode: "server_response_invalid" };
      }

      if (response.error !== null && response.error !== undefined) {
        const reasonCode = parseServerErrorReasonCode(response.error);
        if (reasonCode !== null) {
          // A whitelisted code can only originate from a controlled RAISE in
          // the boundary function; PostgreSQL rolled the transaction back.
          return { outcome: "rolled_back", reasonCode };
        }
        return { outcome: "failed_rollback_unconfirmed", reasonCode: "adapter_failure" };
      }

      const result = parseServerCommittedResult(response.result, request);
      if (result === null) {
        return { outcome: "failed_rollback_unconfirmed", reasonCode: "server_response_invalid" };
      }
      return { outcome: "committed", result };
    },
  };
}
