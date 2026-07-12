/**
 * Forever Cross-Source Validation — the declarative requirements.
 *
 * A {@link CrossValidationRequirements} is the caller's stated bar for a
 * batch: the minimum RC4.4/RC3.3 trust a reading's source authority must
 * meet, the minimum RC4.5 confidence a reading must carry, whether subjects
 * must be corroborated by independent sources, whether every reading must
 * carry located evidence, and which canonical paths the batch is expected to
 * cover. Every requirement is optional and the default demands *nothing* —
 * RC4.7 never invents a threshold, and a bar exists only because a caller
 * stated it (anti-fabrication).
 *
 * Requirements never reject: a reading below a bar is described by a
 * `requires_review` finding — flagged for a human or a future runtime, never
 * silently dropped and never auto-approved. The trust and confidence rungs
 * are judged through the reused RC4.4 {@link meetsCrossSourceTrust} and
 * RC4.5 {@link import("@/features/forever-extraction-pipeline").meetsExtractionConfidence}
 * rules — one ladder each across the whole system, never a local restatement
 * — under which an unknown grade meets only an unknown bar.
 */

import type { CrossSourceTrustLevel } from "./authority";
import type { CrossValidationConfidenceLevel } from "./types";

// Reuse the RC4.5 confidence-bar rule under a cross-validation name — the
// judgement a requirement applies is the very one the extraction pipeline
// grades by.
export { meetsExtractionConfidence as meetsCrossValidationConfidence } from "@/features/forever-extraction-pipeline";

/** The caller's stated bar for one examination. Nothing is demanded by default. */
export interface CrossValidationRequirements {
  /**
   * The reused RC3.3 trust rung a reading's source authority must meet. An
   * unregistered or unattributed source judges by the RC4.4 stated safe
   * posture — `unverified` — and so clears no bar above it.
   */
  minimumTrust?: CrossSourceTrustLevel;
  /** The reused RC4.5 confidence rung a reading must meet. */
  minimumConfidence?: CrossValidationConfidenceLevel;
  /**
   * Whether every subject must be corroborated by at least two independent
   * sources; an uncorroborated subject is flagged for review when demanded.
   */
  requireIndependentCorroboration?: boolean;
  /**
   * Whether every reading must carry located evidence (a verbatim excerpt or
   * a locator); an unlocated reading is flagged for review when demanded.
   */
  requireLocatedEvidence?: boolean;
  /**
   * The canonical field paths the batch is expected to cover, in declared
   * order; an uncovered path is described as missing information.
   */
  expectedPaths?: string[];
}

/**
 * The stated default: no bar, no expectation. Explicitly empty — an absent
 * requirement is never fabricated into a threshold.
 */
export function defaultCrossValidationRequirements(): CrossValidationRequirements {
  return {};
}
