/**
 * Forever Extraction Pipeline — the extracted fact.
 *
 * An {@link ExtractionFact} is the unit the pipeline exists to describe: one
 * structured statement a registered source produced — its id, the project and
 * RC4.4 source (and exact received revision) it belongs to, its fact type and
 * canonical field path, its raw and structured values kept clearly apart, the
 * unit and language where applicable, its confidence, the evidence it was
 * observed in, its mandatory provenance chain, and its lifecycle standing.
 *
 * {@link describeExtractionFact} is the deterministic entry point that builds
 * a fact from the observations the caller can prove. It is pure — it reads no
 * clock and holds no shared state, so every call with equal input returns an
 * equal, independent value that is safe to mutate, diff, and validate. It
 * never invents a value: an unsupplied raw or structured value stays absent,
 * an unsupplied confidence defaults to the explicit `unknown` (never a
 * fabricated grade), and the lifecycle defaults are the stated safe posture
 * (`extracted`/`unreviewed`/`unvalidated`) — a stated convention, never an
 * invented fact. RC4.5 also never resolves anything: conflicting facts,
 * repeated attempts, and superseded readings all coexist as separate facts,
 * chained by id, for a future runtime to reconcile.
 */

import type { ISODateTime } from "@/features/forever-database";
import type { ProjectSourceId } from "@/features/forever-project-sources";

import type { ExtractionConfidence } from "./confidence";
import { unknownExtractionConfidence } from "./confidence";
import type { ExtractionEvidence, ExtractionLocator } from "./evidence";
import { extractionEvidence } from "./evidence";
import type { ExtractionFactType } from "./facttype";
import { extractionFactIdFor, extractionProjectId } from "./identity";
import type { ExtractionMethodDescriptor } from "./method";
import type { ExtractionProvenance } from "./provenance";
import { extractionProvenance } from "./provenance";
import type {
  ExtractionFactStatus,
  ExtractionReviewStatus,
  ExtractionValidationStatus,
} from "./status";
import type { ExtractionFactId, ExtractionIssue } from "./types";
import type { ExtractionStructuredValue, ExtractionValueKind } from "./value";
import type { ExtractionSourceVersion } from "./version";

/** One structured fact a registered source produced. */
export interface ExtractionFact {
  /** Stable surrogate id, e.g. `xfact_coralina-price-1br-v1-0-0`. */
  id: ExtractionFactId;
  /** Canonical id of the project the fact belongs to, e.g. `proj_coralina`. */
  projectId: string;
  /** The RC4.4 catalogued source that produced the fact. Reused directly. */
  sourceId: ProjectSourceId;
  /** The received revision the fact was extracted from. Reused RC4.4 shape. */
  sourceVersion: ExtractionSourceVersion;
  factType: ExtractionFactType;
  /** Dotted canonical field the fact populates, e.g. `pricing.basePrice`. */
  fieldPath?: string;
  /** How the carried value came to be: raw, structured, or derived. */
  valueKind: ExtractionValueKind;
  /** The value exactly as observed in the source, verbatim. */
  rawValue?: string;
  /** The typed counterpart of the raw value, when one was structured. */
  structuredValue?: ExtractionStructuredValue;
  /** Unit of the value where applicable, e.g. `sqm`. */
  unit?: string;
  /** Language of the observed value, e.g. `en` or `th`, when known. */
  language?: string;
  /** How sure the extraction was; explicitly `unknown` when never assessed. */
  confidence: ExtractionConfidence;
  /** Where the fact was observed. Mandatory — validation flags its absence. */
  evidence: ExtractionEvidence;
  /** The mandatory chain back to the source, revision, method, and time. */
  provenance: ExtractionProvenance;
  status: ExtractionFactStatus;
  reviewStatus: ExtractionReviewStatus;
  validationStatus: ExtractionValidationStatus;
  /** The fact that replaced this reading, when it was superseded. */
  supersededBy?: ExtractionFactId;
  /** The facts this one is in conflict with, in declared order. */
  conflictsWith?: ExtractionFactId[];
  /**
   * Structured issues recorded against the fact — warnings and errors both
   * live here and partition by the reused RC3.3 severity rule.
   */
  issues?: ExtractionIssue[];
}

/**
 * Stable subject key for a fact: `projectId:factType` with the field path
 * appended when one is declared, e.g. `proj_coralina:price:pricing.basePrice`.
 * Facts sharing a subject key describe the same statement — possibly from
 * different sources, revisions, or attempts — which is how one subject can
 * hold multiple, even conflicting, readings without any resolution here.
 */
export function extractionFactSubjectKey(fact: ExtractionFact): string {
  const base = `${fact.projectId}:${fact.factType}`;
  return fact.fieldPath === undefined ? base : `${base}:${fact.fieldPath}`;
}

/** The observations {@link describeExtractionFact} builds a fact from. */
export interface DescribeExtractionFactInput {
  /** The verified slug of the project the fact belongs to. */
  projectSlug: string;
  /** The fact's slug within the project, e.g. `price-1br`. */
  factSlug: string;
  factType: ExtractionFactType;
  /** The RC4.4 catalogued source that produced the fact. */
  sourceId: ProjectSourceId;
  /** The received revision the fact was extracted from. */
  sourceVersion: ExtractionSourceVersion;
  /** How the reading would have been performed. */
  method: ExtractionMethodDescriptor;
  /** When the extraction happened, supplied by the caller. */
  extractedAt: ISODateTime;
  fieldPath?: string;
  rawValue?: string;
  structuredValue?: ExtractionStructuredValue;
  unit?: string;
  language?: string;
  /**
   * How the carried value came to be; defaults to `structured` when a
   * structured value was supplied and `raw` otherwise. `derived` is never
   * assumed — a derivation must be declared.
   */
  valueKind?: ExtractionValueKind;
  /** Confidence; defaults to the explicit `unknown` grade. */
  confidence?: ExtractionConfidence;
  /** Where inside the source the fact was observed, when known. */
  locator?: ExtractionLocator;
  /** The observed text, preserved verbatim. */
  excerpt?: string;
  /** Standing; defaults to `extracted`. */
  status?: ExtractionFactStatus;
  /** Review standing; defaults to `unreviewed`. */
  reviewStatus?: ExtractionReviewStatus;
  /** Validation standing; defaults to `unvalidated`. */
  validationStatus?: ExtractionValidationStatus;
  /** The recipe the attempt followed, when one was resolved. */
  recipeId?: string;
  /** The step that produced the fact, when one was resolved. */
  stepId?: string;
  /** The facts a derived fact was computed from. */
  derivedFrom?: ExtractionFactId[];
  supersededBy?: ExtractionFactId;
  conflictsWith?: ExtractionFactId[];
  issues?: ExtractionIssue[];
}

/**
 * Describe one extracted fact deterministically from the observations the
 * caller can prove.
 *
 * Pure and total: the same input always yields a byte-identical fact. The id
 * is derived through the module's own naming rule with the source revision
 * participating (so repeated attempts against newer revisions never collide),
 * the project id through the reused RC4.2 `proj_` convention, and the
 * evidence and provenance through the module's own builders — every optional
 * observation is attached only when supplied, and no value, confidence, or
 * timestamp is ever invented. The result is deep-copied from the input, so it
 * never aliases a caller value: mutating a described fact can never reach
 * back into the input, and two facts described from one input share no state.
 */
export function describeExtractionFact(input: DescribeExtractionFactInput): ExtractionFact {
  const fact: ExtractionFact = {
    id: extractionFactIdFor(input.projectSlug, input.factSlug, input.sourceVersion),
    projectId: extractionProjectId(input.projectSlug),
    sourceId: input.sourceId,
    sourceVersion: input.sourceVersion,
    factType: input.factType,
    valueKind: input.valueKind ?? (input.structuredValue !== undefined ? "structured" : "raw"),
    confidence: input.confidence ?? unknownExtractionConfidence(),
    evidence: extractionEvidence(input.sourceId, {
      sourceVersion: input.sourceVersion,
      locator: input.locator,
      excerpt: input.excerpt,
    }),
    provenance: extractionProvenance(
      input.sourceId,
      input.sourceVersion,
      input.method,
      input.extractedAt,
      { recipeId: input.recipeId, stepId: input.stepId, derivedFrom: input.derivedFrom },
    ),
    status: input.status ?? "extracted",
    reviewStatus: input.reviewStatus ?? "unreviewed",
    validationStatus: input.validationStatus ?? "unvalidated",
  };
  if (input.fieldPath !== undefined) fact.fieldPath = input.fieldPath;
  if (input.rawValue !== undefined) fact.rawValue = input.rawValue;
  if (input.structuredValue !== undefined) fact.structuredValue = input.structuredValue;
  if (input.unit !== undefined) fact.unit = input.unit;
  if (input.language !== undefined) fact.language = input.language;
  if (input.supersededBy !== undefined) fact.supersededBy = input.supersededBy;
  if (input.conflictsWith !== undefined) fact.conflictsWith = input.conflictsWith;
  if (input.issues !== undefined) fact.issues = input.issues;
  // Deep-copy so the described fact never aliases the caller's input.
  return structuredClone(fact);
}
