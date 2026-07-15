import type {
  buildingPersistenceProjection,
  priceHistoryPersistenceProjection,
  projectPersistenceProjection,
  unitPersistenceProjection,
} from "./persistence-projection";

/**
 * RC5.5C transaction-capable execution abstraction.
 *
 * The mutation surface is deliberately narrow: one typed write method per
 * approved plan entity plus the read-back methods needed for in-transaction
 * verification. There is no generic table access, no raw SQL, no generic RPC,
 * no delete, and no way to reach a database client from outside the
 * transaction closure — the runner owns the client (if any) and only ever
 * hands work a {@link ImportExecutionTransaction}.
 *
 * The live adapter is structurally defined by these interfaces but is NOT
 * implemented or invokable in this slice: {@link createLiveTransactionRunner}
 * fails closed before reading any credential or creating any client. A future
 * live implementation is a separate, explicitly Owner-gated credential
 * boundary.
 */

export type ProjectWriteRow = ReturnType<typeof projectPersistenceProjection>;
export type BuildingWriteRow = ReturnType<typeof buildingPersistenceProjection>;
export type UnitWriteRow = ReturnType<typeof unitPersistenceProjection>;
export type PriceHistoryWriteRow = ReturnType<typeof priceHistoryPersistenceProjection>;

export interface WrittenRowRef {
  id: string;
}

export interface DependencyRow {
  id: string;
  slug: string | null;
}

/**
 * The only capability execution work has inside the transaction: typed
 * entity-specific writes for the approved plan and bounded read-backs for
 * verification. Every method operates inside the one open transaction.
 */
export interface ImportExecutionTransaction {
  readDeveloper(slug: string): Promise<DependencyRow[]>;
  readLocation(slug: string): Promise<DependencyRow[]>;
  readProject(slug: string): Promise<Array<Record<string, unknown> & WrittenRowRef>>;
  readBuildings(projectId: string): Promise<Array<Record<string, unknown> & WrittenRowRef>>;
  readUnits(projectId: string): Promise<Array<Record<string, unknown> & WrittenRowRef>>;
  readPriceHistory(unitIds: string[]): Promise<Array<Record<string, unknown> & WrittenRowRef>>;
  insertProject(row: ProjectWriteRow): Promise<WrittenRowRef>;
  insertBuilding(row: BuildingWriteRow): Promise<WrittenRowRef>;
  insertUnit(row: UnitWriteRow): Promise<WrittenRowRef>;
  insertPriceHistory(row: PriceHistoryWriteRow): Promise<WrittenRowRef>;
}

export type TransactionOutcome =
  | { outcome: "committed" }
  | { outcome: "rolled_back"; reasonCode: string };

/**
 * Runs one approved import inside one database transaction. The contract:
 * begin exactly one transaction; run `work` against it; if `work` throws,
 * roll back and report the sanitized reason; if `work` resolves, attempt the
 * commit; a commit failure also rolls back (`commit_failed`). Partial success
 * is impossible — either the commit lands atomically or nothing persists.
 */
export interface ImportTransactionRunner {
  runApprovedImport(
    work: (tx: ImportExecutionTransaction) => Promise<void>,
  ): Promise<TransactionOutcome>;
}

/**
 * Closed whitelist of every reason code a transaction outcome or execution
 * failure may carry. This is the trust boundary for untrusted strings: a
 * runner outcome code, an adapter error, or an ExecutionFailure code that is
 * not literally a member of this set collapses to `adapter_failure` — a
 * permissive character pattern is never sufficient, so a credential-, URL-,
 * or SQL-shaped string can never ride through sanitization even when it only
 * uses "safe" characters.
 */
export const EXECUTION_REASON_CODES = [
  "adapter_failure",
  "runner_failure",
  "commit_failed",
  "live_execution_disabled",
  "dependency_read_failed",
  "dependency_developer_unresolved",
  "dependency_location_unresolved",
  "target_state_changed",
  "missing_parent_reference",
  "project_write_failed",
  "building_write_failed",
  "unit_write_failed",
  "price_history_write_failed",
  "verification_read_failed",
  "verification_row_missing",
  "verification_extra_rows",
  "verification_duplicate_persistence_key",
  "verification_parent_mismatch",
  "verification_field_mismatch",
  "verification_count_mismatch",
] as const;

export type ExecutionReasonCode = (typeof EXECUTION_REASON_CODES)[number];

const EXECUTION_REASON_CODE_SET: ReadonlySet<string> = new Set(EXECUTION_REASON_CODES);

export function isExecutionReasonCode(value: unknown): value is ExecutionReasonCode {
  return typeof value === "string" && EXECUTION_REASON_CODE_SET.has(value);
}

/**
 * Deterministic, sanitized execution failure. `code` is the only payload and
 * is constrained to the closed {@link EXECUTION_REASON_CODES} set at the type
 * level for all internal call sites.
 */
export class ExecutionFailure extends Error {
  constructor(public readonly code: ExecutionReasonCode) {
    super(code);
    this.name = "ExecutionFailure";
  }
}

/**
 * Maps any thrown value to a member of the closed stable-code set. Only an
 * {@link ExecutionFailure} whose code is literally in the whitelist survives;
 * every other error — including raw provider/network errors and strings that
 * merely look code-shaped — collapses to `adapter_failure`.
 */
export function sanitizeExecutionReason(error: unknown): ExecutionReasonCode {
  if (error instanceof ExecutionFailure && isExecutionReasonCode(error.code)) {
    return error.code;
  }
  return "adapter_failure";
}

/**
 * Live transaction runner boundary. RC5.5C authorizes preparation only: this
 * factory fails closed before reading any environment variable, creating any
 * database client, or opening any network connection. The future live
 * implementation requires a separate Owner-approved slice with its own
 * explicit, isolated credential boundary.
 */
export function createLiveTransactionRunner(): ImportTransactionRunner {
  throw new ExecutionFailure("live_execution_disabled");
}
