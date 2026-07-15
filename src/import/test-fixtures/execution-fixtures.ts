import {
  fingerprintCollisionReport,
  inspectPlanCollisions,
  type CollisionInspectionReport,
} from "../collision-inspector";
import {
  sanitizeExecutionReason,
  type DependencyRow,
  type ImportExecutionTransaction,
  type ImportTransactionRunner,
  type TransactionOutcome,
  type WrittenRowRef,
} from "../execution-adapter";
import type { ImportExecutionApproval } from "../execution-approval";
import type { ExecuteApprovedImportInput } from "../transaction-executor";
import type { PlanFingerprint } from "../plan-hash";
import type { ImportOperation } from "../types";
import { slugify } from "../persistence-projection";
import {
  DEVELOPER_ID,
  FakeCollisionReader,
  HERMETIC_IDENTITY,
  LOCATION_ID,
  MANIFEST,
} from "./collision-fixtures";

/**
 * Hermetic RC5.5C execution fixtures: an in-memory transaction runner with
 * real begin/commit/rollback semantics (rollback provably discards all staged
 * writes), scripted failure points, and deterministic approval artifacts.
 * Nothing here touches a network, a credential, or a real database.
 */

export const EXECUTION_NOW = new Date("2026-07-15T12:00:00Z");

type StoredRow = Record<string, unknown> & WrittenRowRef;

export interface FakeExecutionStore {
  developers: DependencyRow[];
  locations: DependencyRow[];
  projects: StoredRow[];
  buildings: StoredRow[];
  units: StoredRow[];
  priceHistory: StoredRow[];
}

export function seededStore(): FakeExecutionStore {
  return {
    developers: [{ id: DEVELOPER_ID, slug: slugify(MANIFEST.developer) }],
    locations: [{ id: LOCATION_ID, slug: slugify(MANIFEST.location) }],
    projects: [],
    buildings: [],
    units: [],
    priceHistory: [],
  };
}

type TxMethod =
  | "readDeveloper"
  | "readLocation"
  | "readProject"
  | "readBuildings"
  | "readUnits"
  | "readPriceHistory"
  | "insertProject"
  | "insertBuilding"
  | "insertUnit"
  | "insertPriceHistory";

export interface ScriptedFailure {
  method: TxMethod;
  /** 1-based call number of that method on which to throw. Default 1. */
  onCall?: number;
  error: unknown;
}

export interface FakeRunnerConfig {
  store?: FakeExecutionStore;
  failures?: ScriptedFailure[];
  commitFails?: boolean;
  /** Runner-level throw BEFORE the work closure is ever invoked (begin failure). */
  throwBeforeWork?: unknown;
  /**
   * Simulate a runner that BEGINS a transaction and then throws before ever
   * invoking the work closure — rollback state is unknown to the caller.
   */
  beginThenThrow?: unknown;
  /** Return `malformedOutcome` without ever invoking the work closure. */
  skipWork?: boolean;
  /** Runner-level throw AFTER the work closure ran (commit/rollback machinery crash). */
  throwAfterWork?: unknown;
  /** Return this raw value instead of a well-formed TransactionOutcome. */
  malformedOutcome?: unknown;
  /** Untrusted rolled_back reason code to return instead of the sanitized one. */
  overrideRollbackReason?: string;
  /** Tamper with read-back rows to exercise in-transaction verification. */
  tamper?: Partial<
    Record<
      "readProject" | "readBuildings" | "readUnits" | "readPriceHistory",
      (rows: StoredRow[]) => StoredRow[]
    >
  >;
}

class FakeImportTransaction implements ImportExecutionTransaction {
  private sequence = 0;
  private readonly callCounts = new Map<TxMethod, number>();

  constructor(
    private readonly store: FakeExecutionStore,
    private readonly config: FakeRunnerConfig,
    public readonly calls: string[],
  ) {}

  private track(method: TxMethod): void {
    this.calls.push(method);
    const count = (this.callCounts.get(method) ?? 0) + 1;
    this.callCounts.set(method, count);
    for (const failure of this.config.failures ?? []) {
      if (failure.method === method && (failure.onCall ?? 1) === count) {
        throw failure.error;
      }
    }
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  private tampered(
    method: "readProject" | "readBuildings" | "readUnits" | "readPriceHistory",
    rows: StoredRow[],
  ): StoredRow[] {
    const tamper = this.config.tamper?.[method];
    return tamper ? tamper(rows.map((row) => ({ ...row }))) : rows.map((row) => ({ ...row }));
  }

  async readDeveloper(slug: string): Promise<DependencyRow[]> {
    this.track("readDeveloper");
    return this.store.developers.filter((row) => row.slug === slug);
  }

  async readLocation(slug: string): Promise<DependencyRow[]> {
    this.track("readLocation");
    return this.store.locations.filter((row) => row.slug === slug);
  }

  async readProject(slug: string): Promise<StoredRow[]> {
    this.track("readProject");
    return this.tampered(
      "readProject",
      this.store.projects.filter((row) => row.slug === slug),
    );
  }

  async readBuildings(projectId: string): Promise<StoredRow[]> {
    this.track("readBuildings");
    return this.tampered(
      "readBuildings",
      this.store.buildings.filter((row) => row.project_id === projectId),
    );
  }

  async readUnits(projectId: string): Promise<StoredRow[]> {
    this.track("readUnits");
    return this.tampered(
      "readUnits",
      this.store.units.filter((row) => row.project_id === projectId),
    );
  }

  async readPriceHistory(unitIds: string[]): Promise<StoredRow[]> {
    this.track("readPriceHistory");
    return this.tampered(
      "readPriceHistory",
      this.store.priceHistory.filter((row) => unitIds.includes(row.unit_id as string)),
    );
  }

  async insertProject(row: Record<string, unknown>): Promise<WrittenRowRef> {
    this.track("insertProject");
    const stored = { ...row, id: this.nextId("proj") } as StoredRow;
    this.store.projects.push(stored);
    return { id: stored.id };
  }

  async insertBuilding(row: Record<string, unknown>): Promise<WrittenRowRef> {
    this.track("insertBuilding");
    const stored = { ...row, id: this.nextId("bldg") } as StoredRow;
    this.store.buildings.push(stored);
    return { id: stored.id };
  }

  async insertUnit(row: Record<string, unknown>): Promise<WrittenRowRef> {
    this.track("insertUnit");
    const stored = { ...row, id: this.nextId("unit") } as StoredRow;
    this.store.units.push(stored);
    return { id: stored.id };
  }

  async insertPriceHistory(row: Record<string, unknown>): Promise<WrittenRowRef> {
    this.track("insertPriceHistory");
    const stored = { ...row, id: this.nextId("price") } as StoredRow;
    this.store.priceHistory.push(stored);
    return { id: stored.id };
  }
}

/**
 * In-memory transaction runner with genuine atomicity: work runs against a
 * deep clone of the committed store; only a successful commit replaces the
 * committed store, so any rollback provably leaves zero partial writes.
 */
export class FakeTransactionRunner implements ImportTransactionRunner {
  public committedStore: FakeExecutionStore;
  public readonly txCalls: string[] = [];
  public runs = 0;

  constructor(private readonly config: FakeRunnerConfig = {}) {
    this.committedStore = config.store ?? seededStore();
  }

  async runApprovedImport(
    work: (tx: ImportExecutionTransaction) => Promise<void>,
  ): Promise<TransactionOutcome> {
    this.runs += 1;
    if (this.config.throwBeforeWork !== undefined) throw this.config.throwBeforeWork;

    const staged = structuredClone(this.committedStore);
    if (this.config.beginThenThrow !== undefined) {
      // A transaction was begun (staged state exists) but work never runs and
      // no rollback confirmation ever reaches the caller.
      throw this.config.beginThenThrow;
    }
    if (this.config.skipWork) {
      return this.config.malformedOutcome as TransactionOutcome;
    }
    const tx = new FakeImportTransaction(staged, this.config, this.txCalls);
    try {
      await work(tx);
    } catch (error) {
      return {
        outcome: "rolled_back",
        reasonCode: this.config.overrideRollbackReason ?? sanitizeExecutionReason(error),
      };
    }
    if (this.config.throwAfterWork !== undefined) throw this.config.throwAfterWork;
    if (this.config.malformedOutcome !== undefined) {
      return this.config.malformedOutcome as TransactionOutcome;
    }
    if (this.config.commitFails) {
      return { outcome: "rolled_back", reasonCode: "commit_failed" };
    }
    this.committedStore = staged;
    return { outcome: "committed" };
  }
}

// ---------------------------------------------------------------------------
// Plan / report / approval builders
// ---------------------------------------------------------------------------

export function fingerprintFor(operations: ImportOperation[]): PlanFingerprint {
  return {
    algorithm: "sha256",
    schemaVersion: "1",
    hash: "a".repeat(64),
    shortHash: "a".repeat(12),
    projectSlug: MANIFEST.project_slug,
    sourceVersion: "2.0.0",
    operationCounts: {
      projects: operations.filter((op) => op.entity === "project").length,
      buildings: operations.filter((op) => op.entity === "building").length,
      units: operations.filter((op) => op.entity === "unit").length,
      priceHistoryRows: operations.filter((op) => op.entity === "unit_price_history").length,
      operations: operations.length,
    },
  };
}

/** Runs the real inspector against an empty target to get an all-absent report. */
export async function absentCollisionReport(
  operations: ImportOperation[],
): Promise<CollisionInspectionReport> {
  const fingerprint = fingerprintFor(operations);
  return inspectPlanCollisions({
    reader: new FakeCollisionReader({ projects: [] }),
    target: "local",
    targetIdentity: HERMETIC_IDENTITY,
    sourceVersion: fingerprint.sourceVersion,
    planHash: fingerprint.hash,
    shortPlanHash: fingerprint.shortHash,
    operationCounts: fingerprint.operationCounts,
    operations,
    manifest: MANIFEST,
  });
}

export function approvalFor(
  operations: ImportOperation[],
  report: CollisionInspectionReport,
  overrides: Partial<ImportExecutionApproval> = {},
): ImportExecutionApproval {
  return {
    schemaVersion: "1",
    approvalId: "approval-test-0001",
    projectSlug: MANIFEST.project_slug,
    target: "local",
    targetProjectId: HERMETIC_IDENTITY.projectId,
    planHash: "a".repeat(64),
    operationCount: operations.length,
    collisionReportFingerprint: fingerprintCollisionReport(report),
    issuedAt: new Date(EXECUTION_NOW.getTime() - 60_000).toISOString(),
    expiresAt: new Date(EXECUTION_NOW.getTime() + 30 * 60_000).toISOString(),
    ...overrides,
  };
}

export function executionInput(
  operations: ImportOperation[],
  report: CollisionInspectionReport,
  runner: ImportTransactionRunner,
  overrides: Partial<ExecuteApprovedImportInput> = {},
): Omit<ExecuteApprovedImportInput, "approval" | "approvalRegistry"> &
  Partial<Pick<ExecuteApprovedImportInput, "approval" | "approvalRegistry">> {
  const fingerprint = fingerprintFor(operations);
  return {
    runner,
    now: EXECUTION_NOW,
    requestedTarget: "local",
    targetIdentity: HERMETIC_IDENTITY,
    manifest: MANIFEST,
    sourceVersion: fingerprint.sourceVersion,
    planFingerprint: fingerprint,
    expectedPlanHash: fingerprint.hash,
    expectedOperationCounts: fingerprint.operationCounts,
    confirmation: `${MANIFEST.project_slug}:${fingerprint.shortHash}`,
    operations,
    collisionReport: report,
    ...overrides,
  };
}
