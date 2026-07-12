/**
 * Forever Cross-Source Validation — the cross-source reading.
 *
 * A {@link CrossSourceReading} is one RC4.5 extracted fact viewed through the
 * cross-source lens: which catalogued source (and received revision) stated
 * it, the deterministic signature of the canonical value it would settle
 * into, the comparability facts (unit, currency, language), the confidence
 * its extraction carried, whether the fact still stands as its subject's
 * current reading, and — when the caller registered the source — the RC4.4
 * authority and status standing behind it. A reading never copies the fact's
 * value representation; it *references* the fact by id, so every judgement
 * stays traceable back to the fact, its evidence, and its provenance.
 *
 * The signature is the architectural bridge into RC4.6:
 * {@link crossSourceReadingSignature} re-describes the fact as the canonical
 * value it would settle into through the reused RC4.6
 * {@link import("@/features/forever-project-database").projectFieldValueFromFact}
 * and fingerprints it through the reused RC4.6
 * {@link import("@/features/forever-project-database").projectFieldValueSignature}
 * — so RC4.7's agreement/conflict judgement can never disagree with the
 * judgement the canonical merge will make when the same facts arrive there.
 * Byte-level, never normalized: two readings that differ only in formatting
 * are different readings, and saying so preserves uncertainty instead of
 * manufacturing agreement.
 */

import type { ExtractionFact } from "@/features/forever-extraction-pipeline";
import {
  extractionFactStatusCarriesValue,
  isCurrentExtractionFactStatus,
  isKnownExtractionFactStatus,
} from "@/features/forever-extraction-pipeline";
import {
  projectFieldValueFromFact,
  projectFieldValueSignature,
} from "@/features/forever-project-database";
import type {
  ProjectSourceDefinition,
  ProjectSourceStatus,
} from "@/features/forever-project-sources";
import {
  isKnownProjectSourceStatus,
  validateProjectSourceAuthority,
} from "@/features/forever-project-sources";

import type { CrossSourceAuthority } from "./authority";
import { resolveCrossValidationSource } from "./authority";
import { compareCrossValidationStrings, isAbsent, isNonEmptyString } from "./helpers";
import type { CrossFactId, CrossSourceRef, CrossValidationConfidence } from "./types";
import { unknownCrossValidationConfidence } from "./types";
import type { CrossValidationSourceVersion } from "./version";
import { compareCrossValidationSourceVersionTotal } from "./version";

/**
 * The stable marker a reading's signature collapses to when the fact cannot
 * be re-described as a canonical value at all (an exotic, uncloneable part) —
 * comparable, never thrown. Distinct from the reused RC4.6 unserializable
 * marker so the two failure layers stay tellable apart.
 */
export const CROSS_READING_UNDESCRIBABLE_SIGNATURE = "\u0000undescribable";

/**
 * Deterministic fingerprint of the canonical value one fact would settle
 * into, computed through the reused RC4.6 bridge and signature rule — the
 * very comparison the canonical merge performs. Total: a fact whose parts
 * cannot even be copied collapses to the one stable
 * {@link CROSS_READING_UNDESCRIBABLE_SIGNATURE} marker instead of throwing.
 */
export function crossSourceReadingSignature(fact: ExtractionFact): string {
  try {
    return projectFieldValueSignature(projectFieldValueFromFact(fact));
  } catch {
    return CROSS_READING_UNDESCRIBABLE_SIGNATURE;
  }
}

/** One extracted fact viewed through the cross-source lens. */
export interface CrossSourceReading {
  /** The RC4.5 fact this reading references. Reused id, never a copy. */
  factId: CrossFactId;
  /** The RC4.4 catalogued source that stated the reading. Reused directly. */
  sourceId: CrossSourceRef;
  /** The received revision the reading was extracted from. Reused shape. */
  sourceVersion: CrossValidationSourceVersion;
  /** The reused RC4.6 signature of the value the fact would settle into. */
  signature: string;
  /** Unit of the reading where the fact declared one, e.g. `sqm`. */
  unit?: string;
  /** Currency of the reading where its structured value is an RC3.0 Money. */
  currency?: string;
  /** Language of the reading where the fact declared one, e.g. `en`. */
  language?: string;
  /** Confidence the extraction carried; explicitly `unknown` when it carried none. */
  confidence: CrossValidationConfidence;
  /**
   * Whether the fact still stands as a current statement of its subject —
   * judged through the reused RC4.5 status predicate. A stated absence
   * (`unavailable`) *is* a current statement — "the value is not there" is
   * data, and it participates in consensus exactly as the RC4.6 merge lets a
   * missing value contradict a stated one. Readings that are superseded or
   * carry an unknown status are kept (described, never dropped) but set
   * aside from consensus.
   */
  current: boolean;
  /**
   * Whether the reading states an absence — the source was read and the
   * value was not there (`unavailable`). A stated absence compares by its
   * signature alone: unit, currency, and language comparability apply only
   * to value-carrying readings, because an absence declares none.
   */
  statesAbsence: boolean;
  /** Whether the caller registered the reading's source. */
  registered: boolean;
  /** The RC4.4 authority standing behind the source, when registered with one. */
  authority?: CrossSourceAuthority;
  /** The RC4.4 standing of the registered source document, when registered. */
  sourceStatus?: ProjectSourceStatus;
}

/** Options accepted by {@link describeCrossSourceReading}. */
export interface DescribeCrossSourceReadingOptions {
  /** The RC4.4 registered sources authority and status resolve against. */
  sources?: readonly ProjectSourceDefinition[];
}

/**
 * The currency a fact's structured value states, when that value is an RC3.0
 * `Money` — read, never derived: any other representation states no currency
 * and none is invented. Total over malformed values.
 */
export function crossSourceReadingCurrency(fact: ExtractionFact): string | undefined {
  const value = fact?.structuredValue;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as { currency?: unknown };
  return typeof candidate.currency === "string" ? candidate.currency : undefined;
}

/**
 * Describe one fact as a {@link CrossSourceReading}.
 *
 * Pure and deterministic: the same fact and options always yield an equal
 * reading, a malformed fact is described around (its absent parts stay
 * absent, its status judged unknown counts as non-current) rather than
 * dereferenced into a throw, and nothing is invented — the authority and
 * source status appear only when the caller registered the source, and an
 * unassessed confidence is the explicit `unknown` grade. A declared-but-empty
 * unit, currency, or language carries no information and is viewed as
 * undeclared (the RC4.5 fact validators judge the fact's own malformation),
 * and a registered attribution that fails the reused RC4.4 guards stays
 * absent — an unresolvable authority or standing is never propagated as if
 * it resolved. The result is deep-copied so a reading never aliases the fact
 * or a registered source; like the sibling describe builders, an exotic
 * uncloneable input part is the one thing that can fail the copy — the
 * examination engine guards that seam and reports such a fact as an issue
 * instead of letting it escape.
 */
export function describeCrossSourceReading(
  fact: ExtractionFact,
  options: DescribeCrossSourceReadingOptions = {},
): CrossSourceReading {
  const status = fact?.status;
  const reading: CrossSourceReading = {
    factId: typeof fact?.id === "string" ? fact.id : String(fact?.id ?? ""),
    sourceId: typeof fact?.sourceId === "string" ? fact.sourceId : String(fact?.sourceId ?? ""),
    sourceVersion: fact?.sourceVersion,
    signature: crossSourceReadingSignature(fact),
    confidence: isAbsent(fact?.confidence) ? unknownCrossValidationConfidence() : fact.confidence,
    current: isKnownExtractionFactStatus(status) && isCurrentExtractionFactStatus(status),
    statesAbsence: isKnownExtractionFactStatus(status) && !extractionFactStatusCarriesValue(status),
    registered: false,
  };
  if (isNonEmptyString(fact?.unit)) reading.unit = fact.unit;
  const currency = crossSourceReadingCurrency(fact);
  if (isNonEmptyString(currency)) reading.currency = currency;
  if (isNonEmptyString(fact?.language)) reading.language = fact.language;

  const definition = resolveCrossValidationSource(options.sources, reading.sourceId);
  if (definition !== undefined) {
    reading.registered = true;
    // Attributions are attached only when they pass the reused RC4.4 guards:
    // a garbled authority or standing cannot masquerade as a resolved one.
    if (
      !isAbsent(definition.authority) &&
      validateProjectSourceAuthority(definition.authority).length === 0
    ) {
      reading.authority = definition.authority;
    }
    if (isKnownProjectSourceStatus(definition.status)) {
      reading.sourceStatus = definition.status;
    }
  }
  // Deep-copy so the described reading never aliases the fact or a source.
  return structuredClone(reading);
}

/**
 * A copy of the readings in the module's one deterministic order: by source
 * id, then received revision (through the total version comparison), then
 * fact id.
 *
 * Stable and immutable: fully tied readings keep their input order and the
 * input list is never mutated. String tiers compare by code unit — no locale.
 */
export function sortCrossSourceReadings(
  readings: readonly CrossSourceReading[],
): CrossSourceReading[] {
  return [...readings].sort(
    (a, b) =>
      compareCrossValidationStrings(a?.sourceId, b?.sourceId) ||
      compareCrossValidationSourceVersionTotal(a?.sourceVersion, b?.sourceVersion) ||
      compareCrossValidationStrings(a?.factId, b?.factId),
  );
}
