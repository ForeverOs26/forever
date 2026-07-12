/**
 * Forever Cross-Source Validation — the report provider contract.
 *
 * A {@link CrossValidationProvider} is the reusable seam between one described
 * examination and the registry: it exposes a {@link CrossValidationReport}
 * that fully describes what the examination concluded. RC4.7 defines the
 * contract only; a future release implements it to plug a concrete
 * examination into the registry without any existing code changing.
 *
 * Providers are pure descriptors: the contract exposes description, never
 * execution. Running an examination, resolving a finding, approving a fact,
 * and any IO live entirely outside this contract — mirroring the Import
 * (RC3.1), Sync (RC3.2), Source Registry (RC3.3), Connectors (RC3.4),
 * Pipeline (RC3.5), Project Integration (RC4.0), Project Template (RC4.2),
 * Project Factory (RC4.3), Project Sources (RC4.4), Extraction Pipeline
 * (RC4.5), and Canonical Project Database (RC4.6) provider contracts.
 */

import { crossValidationFindingRequiresReview } from "../finding";
import type { CrossValidationReport } from "../report";

/** The contract every cross-validation report provider satisfies. */
export interface CrossValidationProvider {
  /** The described report this provider represents. */
  readonly report: CrossValidationReport;
}

/**
 * Identity helper that pins an object to the {@link CrossValidationProvider}
 * contract.
 *
 * Gives implementations full type-checking and inference without forcing a
 * class; the returned value is the provider unchanged.
 */
export function defineCrossValidationProvider<P extends CrossValidationProvider>(provider: P): P {
  return provider;
}

/** The canonical `proj_` id of the project a provider's report examines. */
export function crossValidationProviderProjectId(provider: CrossValidationProvider): string {
  return provider.report.projectId;
}

/** The number of findings a provider's report describes. */
export function crossValidationProviderFindingCount(provider: CrossValidationProvider): number {
  return provider.report.findings.length;
}

/** The number of subjects a provider's report assesses. */
export function crossValidationProviderSubjectCount(provider: CrossValidationProvider): number {
  return provider.report.subjects.length;
}

/** Whether a provider's report carries findings requiring future human review. */
export function crossValidationProviderRequiresReview(provider: CrossValidationProvider): boolean {
  return provider.report.findings.some((finding) => crossValidationFindingRequiresReview(finding));
}
