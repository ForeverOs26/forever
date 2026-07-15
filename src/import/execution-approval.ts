/**
 * RC5.5C Owner execution-approval contract.
 *
 * An approval artifact is an explicit, short-lived, single-use Owner
 * authorization for exactly one import execution. It binds project slug,
 * target identity, plan hash, operation count, and the collision-report
 * fingerprint, plus issued-at/expiry timestamps and a one-time-use id.
 *
 * This module is hermetic: it validates artifact structure and scope purely;
 * single-use enforcement is a separate ATOMIC step through
 * {@link ApprovalRegistry.consumeIfUnused} at the execution-attempt boundary.
 * It never contacts a token service, reads credentials, or persists anything
 * to a live database, and it contains no hardcoded approval secret.
 */

import { createHash } from "node:crypto";

export const EXECUTION_APPROVAL_SCHEMA_VERSION = "1" as const;

/** Maximum allowed approval lifetime. Approvals must be short-lived. */
export const EXECUTION_APPROVAL_MAX_LIFETIME_MS = 60 * 60 * 1000;

/**
 * Bounded safe format for the one-time approval identifier: 1–64 characters of
 * letters, digits, dot, underscore, or hyphen. Anything else fails closed as
 * `approval_malformed` and is never echoed into receipts or logs, so a
 * malicious approvalId cannot become a secret-exfiltration channel.
 */
export const APPROVAL_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function safeApprovalId(value: unknown): string | null {
  return typeof value === "string" && APPROVAL_ID_PATTERN.test(value) ? value : null;
}

/** Domain-separation prefix for approval-id digests. */
export const APPROVAL_DIGEST_DOMAIN = "forever-import-approval:v1" as const;

/**
 * Deterministic, domain-separated SHA-256 digest of an approval id. The raw
 * approval id is used internally for atomic registry consumption only; every
 * externally visible surface (receipts, logs) carries this digest instead, so
 * a secret-shaped id — even one that satisfies the bounded safe format — can
 * never be exfiltrated through an execution receipt or logger output. The
 * digest exposes no reversible prefix or raw substring.
 */
export function computeApprovalDigest(approvalId: string): string {
  return createHash("sha256").update(`${APPROVAL_DIGEST_DOMAIN}:${approvalId}`).digest("hex");
}

export interface ImportExecutionApproval {
  schemaVersion: typeof EXECUTION_APPROVAL_SCHEMA_VERSION;
  /** One-time-use identifier. Non-secret; must match {@link APPROVAL_ID_PATTERN}. */
  approvalId: string;
  projectSlug: string;
  target: string;
  targetProjectId: string;
  planHash: string;
  operationCount: number;
  collisionReportFingerprint: string;
  issuedAt: string;
  expiresAt: string;
}

/** The exact execution scope an approval must match, field for field. */
export interface ExecutionApprovalScope {
  projectSlug: string;
  target: string;
  targetProjectId: string;
  planHash: string;
  operationCount: number;
  collisionReportFingerprint: string;
}

export type ApprovalFailureCode =
  | "approval_missing"
  | "approval_malformed"
  | "approval_schema_unsupported"
  | "approval_not_yet_valid"
  | "approval_expired"
  | "approval_lifetime_exceeded"
  | "approval_reused"
  /** The registry infrastructure failed; consumption state is untouched. */
  | "approval_registry_unavailable"
  | `approval_scope_mismatch:${keyof ExecutionApprovalScope}`;

export type ApprovalValidationResult =
  | { ok: true; approval: ImportExecutionApproval }
  | { ok: false; code: ApprovalFailureCode };

/**
 * One-time-use tracking abstraction. The ONLY authorization operation is the
 * atomic {@link consumeIfUnused}: exactly one attempt for a given id can ever
 * resolve `true`; every other concurrent or later attempt resolves `false`.
 * There is deliberately no separate check-then-consume sequence on this
 * interface — a non-atomic pair could let two concurrent executions both pass
 * a reuse check before either consumed the approval.
 *
 * The contract is asynchronous because a real execution boundary requires a
 * DURABLE atomic compare-and-set across processes, machines, retries, and
 * restarts (for example a unique-insert in a transactional store). Any future
 * live implementation is a separately Owner-gated slice and must be backed by
 * such a durable atomic store; {@link InMemoryApprovalRegistry} is hermetic
 * test infrastructure only and must never guard a real execution.
 */
export interface ApprovalRegistry {
  consumeIfUnused(approvalId: string): Promise<boolean>;
}

/**
 * Hermetic in-memory registry for tests. The compare-and-set is performed
 * synchronously (no await between the membership check and the insertion), so
 * within one process exactly one caller can ever win a given id.
 */
export class InMemoryApprovalRegistry implements ApprovalRegistry {
  private readonly consumed = new Set<string>();

  async consumeIfUnused(approvalId: string): Promise<boolean> {
    if (this.consumed.has(approvalId)) return false;
    this.consumed.add(approvalId);
    return true;
  }

  /** Test/observability helper only — never part of the authorization gate. */
  isConsumed(approvalId: string): boolean {
    return this.consumed.has(approvalId);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseTimestamp(value: unknown): number | null {
  if (!isNonEmptyString(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function failure(code: ApprovalFailureCode): ApprovalValidationResult {
  return { ok: false, code };
}

/**
 * Pure fail-closed structural, temporal, and scope validation of an Owner
 * execution approval. Deliberately does NOT touch the registry: single-use is
 * enforced only by the atomic {@link ApprovalRegistry.consumeIfUnused} at the
 * execution-attempt boundary, never by a non-atomic pre-check here.
 */
export function validateExecutionApproval(
  candidate: unknown,
  scope: ExecutionApprovalScope,
  now: Date,
): ApprovalValidationResult {
  if (candidate === null || candidate === undefined) return failure("approval_missing");
  if (typeof candidate !== "object" || Array.isArray(candidate)) {
    return failure("approval_malformed");
  }

  const approval = candidate as Record<string, unknown>;

  if (approval.schemaVersion !== EXECUTION_APPROVAL_SCHEMA_VERSION) {
    return failure("approval_schema_unsupported");
  }
  if (
    safeApprovalId(approval.approvalId) === null ||
    !isNonEmptyString(approval.projectSlug) ||
    !isNonEmptyString(approval.target) ||
    !isNonEmptyString(approval.targetProjectId) ||
    !isNonEmptyString(approval.planHash) ||
    !isNonEmptyString(approval.collisionReportFingerprint) ||
    typeof approval.operationCount !== "number" ||
    !Number.isInteger(approval.operationCount) ||
    approval.operationCount < 0
  ) {
    return failure("approval_malformed");
  }

  const issuedAt = parseTimestamp(approval.issuedAt);
  const expiresAt = parseTimestamp(approval.expiresAt);
  if (issuedAt === null || expiresAt === null || expiresAt <= issuedAt) {
    return failure("approval_malformed");
  }
  if (expiresAt - issuedAt > EXECUTION_APPROVAL_MAX_LIFETIME_MS) {
    return failure("approval_lifetime_exceeded");
  }
  if (now.getTime() < issuedAt) return failure("approval_not_yet_valid");
  if (now.getTime() >= expiresAt) return failure("approval_expired");

  const scopeChecks: Array<[keyof ExecutionApprovalScope, unknown]> = [
    ["projectSlug", approval.projectSlug],
    ["target", approval.target],
    ["targetProjectId", approval.targetProjectId],
    ["planHash", approval.planHash],
    ["operationCount", approval.operationCount],
    ["collisionReportFingerprint", approval.collisionReportFingerprint],
  ];
  for (const [field, value] of scopeChecks) {
    if (value !== scope[field]) return failure(`approval_scope_mismatch:${field}`);
  }

  return { ok: true, approval: approval as unknown as ImportExecutionApproval };
}
