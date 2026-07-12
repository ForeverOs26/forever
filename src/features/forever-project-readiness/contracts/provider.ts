/**
 * Forever Project Readiness — the report provider contract.
 *
 * A {@link ReadinessProvider} is the reusable seam between one described
 * examination and the registry: it exposes a {@link ReadinessReport} that
 * fully describes what the examination concluded. RC4.9 defines the contract
 * only; a future release implements it to plug a concrete examination into
 * the registry without any existing code changing.
 *
 * Providers are pure descriptors: the contract exposes description, never
 * execution. Running a gate, waiving a blocker, approving a project, and any
 * IO live entirely outside this contract — mirroring the Import (RC3.1),
 * Sync (RC3.2), Source Registry (RC3.3), Connectors (RC3.4), Pipeline
 * (RC3.5), Project Integration (RC4.0), Project Template (RC4.2), Project
 * Factory (RC4.3), Project Sources (RC4.4), Extraction Pipeline (RC4.5),
 * Canonical Project Database (RC4.6), Cross-Source Validation (RC4.7), and
 * Knowledge Graph (RC4.8) provider contracts.
 */

import type { ReadinessReport } from "../report";
import { listReadinessBlockers, readinessReportIsBlocked } from "../report";

/** The contract every readiness provider satisfies. */
export interface ReadinessProvider {
  /** The described report this provider represents. */
  readonly report: ReadinessReport;
}

/**
 * Identity helper that pins an object to the {@link ReadinessProvider}
 * contract.
 *
 * Gives implementations full type-checking and inference without forcing a
 * class; the returned value is the provider unchanged.
 */
export function defineReadinessProvider<P extends ReadinessProvider>(provider: P): P {
  return provider;
}

/** The canonical `proj_` id of the project a provider's report concerns. */
export function readinessProviderProjectId(provider: ReadinessProvider): string {
  return provider.report.projectId;
}

/** The number of judged statements a provider's report carries. */
export function readinessProviderEvaluationCount(provider: ReadinessProvider): number {
  return provider.report.evaluations.length;
}

/** The number of described blockers a provider's report carries. */
export function readinessProviderBlockerCount(provider: ReadinessProvider): number {
  return listReadinessBlockers(provider.report).length;
}

/** Whether a provider's report describes at least one unmet required statement. */
export function readinessProviderIsBlocked(provider: ReadinessProvider): boolean {
  return readinessReportIsBlocked(provider.report);
}
