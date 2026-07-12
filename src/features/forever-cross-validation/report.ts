/**
 * Forever Cross-Source Validation — the deterministic examination engine.
 *
 * This is the engine of RC4.7: {@link describeCrossSourceValidation} takes
 * the RC4.4 registered sources a caller has in hand and a batch of RC4.5
 * extracted facts and *describes* the cross-source examination a runtime
 * would perform — which subjects independent sources corroborate, which they
 * contest, which readings come from outdated revisions, which facts are
 * duplicated, where evidence and provenance fall short, which claims nothing
 * supports, which expected information is missing, and which facts may
 * therefore proceed toward the RC4.6 canonical database, which require human
 * review first, and which are too malformed to examine at all. It is a pure
 * function: no clock, no randomness, no IO, no hidden state — identical
 * context and request always yield an identical report, and the input
 * sources and facts are never mutated.
 *
 * Nothing is ever resolved: a contested subject keeps every side standing
 * and marks *all* of them for review — preferring a source, trusting the
 * higher authority, or averaging readings stays a future runtime's (or a
 * human's) concern. Nothing is ever invented: an unregistered source stays
 * unresolved, an unassessed confidence stays `unknown`, a timestamp appears
 * only because the caller supplied one, and a bar exists only because the
 * caller stated it. Value equality is judged through the reused RC4.6
 * signature bridge, so this examination can never disagree with the
 * judgement the canonical merge will make when the same facts arrive there.
 */

import type { ISODateTime, Slug } from "@/features/forever-database";
import type { ExtractionFact } from "@/features/forever-extraction-pipeline";
import {
  extractionFactStatusCarriesValue,
  isKnownExtractionFactType,
  validateExtractionConfidence,
} from "@/features/forever-extraction-pipeline";
import type { ProjectSourceDefinition } from "@/features/forever-project-sources";
import { isTerminalProjectSourceStatus } from "@/features/forever-project-sources";

import type { CrossValidationAssessment } from "./assessment";
import { judgeCrossValidationConsensus } from "./assessment";
import { areIndependentCrossSources } from "./authority";
import type { CrossValidationContext } from "./context";
import type {
  CrossValidationDisposition,
  CrossValidationFinding,
  CrossValidationFindingKind,
  CrossValidationFindingOptions,
  CrossValidationReference,
} from "./finding";
import {
  crossValidationDimensionForFactType,
  crossValidationFinding,
  crossValidationFindingRequiresReview,
  sortCrossValidationFindings,
} from "./finding";
import {
  compareCrossValidationStrings,
  distinctCrossSourceRefs,
  isAbsent,
  isNonEmptyString,
} from "./helpers";
import {
  crossValidationFindingIdFor,
  crossValidationProjectId,
  crossValidationReportIdFor,
  normalizeCrossValidationSlug,
} from "./identity";
import type { CrossSourceReading } from "./reading";
import { describeCrossSourceReading, sortCrossSourceReadings } from "./reading";
import { meetsCrossValidationConfidence } from "./requirements";
import type { CrossValidationRequirements } from "./requirements";
import { isKnownCrossSourceTrustLevel, meetsCrossSourceTrust } from "./authority";
import { createCrossValidationResult, emptyCrossValidationStats } from "./result";
import type { CrossValidationResult, CrossValidationRunMetadata } from "./result";
import type { CrossFactStanding } from "./standing";
import type { CrossValidationSubject } from "./subject";
import { crossValidationExpectedSubjectFor, crossValidationSubjectFor } from "./subject";
import {
  crossValidationError,
  crossValidationWarning,
  isCrossValidationStructuredValue,
  isKnownCrossValidationConfidenceLevel,
} from "./types";
import type { CrossSourceRef, CrossValidationIssue } from "./types";
import {
  compareCrossValidationSourceVersionTotal,
  formatCrossValidationSourceVersion,
  isWellFormedCrossValidationSourceVersion,
} from "./version";

/**
 * One incoming RC4.5 extracted fact, reused directly — the examination
 * consumes the very shape the extraction pipeline produces, never a
 * re-described copy.
 */
export type CrossValidationFact = ExtractionFact;

/**
 * The request one examination is described from.
 *
 * Only the verified project slug and the facts are required. The optional
 * batch is a caller-stated discriminator that participates in the report id
 * so repeated examinations of one project never collide — stated, never
 * invented.
 */
export interface CrossValidationRequest {
  /** The verified slug of the project the batch belongs to. */
  projectSlug: string;
  /** The incoming extracted facts to examine, in input order. */
  facts: CrossValidationFact[];
  /** Caller-stated batch discriminator, when the caller distinguishes runs. */
  batch?: string;
}

/** The full description of one cross-source examination. */
export interface CrossValidationReport {
  /** Stable surrogate id, e.g. `xrep_coralina` or `xrep_coralina-2026-07`. */
  id: string;
  /** Canonical id of the examined project, e.g. `proj_coralina`. */
  projectId: string;
  /** The verified, normalized project slug, e.g. `coralina`. */
  projectSlug: Slug;
  /** The caller-stated batch discriminator, when one was stated. */
  batch?: string;
  /** Every assessed subject, sorted by subject key. */
  subjects: CrossValidationAssessment[];
  /** Every described finding, in the module's one deterministic order. */
  findings: CrossValidationFinding[];
  /** One standing per input fact slot, in input order — every slot accounted. */
  standings: CrossFactStanding[];
  /** The distinct RC4.4 sources the examined facts trace to, first-seen order. */
  sourceIds: CrossSourceRef[];
  /** When the examination was described, supplied by the caller. */
  describedAt?: ISODateTime;
}

/** Every finding of one kind, in the report's finding order. */
export function listCrossValidationFindingsByKind(
  report: CrossValidationReport,
  kind: CrossValidationFindingKind,
): CrossValidationFinding[] {
  return (Array.isArray(report?.findings) ? report.findings : []).filter(
    (finding) => finding?.kind === kind,
  );
}

/** Every finding requiring future human review, in the report's finding order. */
export function listCrossValidationFindingsRequiringReview(
  report: CrossValidationReport,
): CrossValidationFinding[] {
  return (Array.isArray(report?.findings) ? report.findings : []).filter((finding) =>
    crossValidationFindingRequiresReview(finding),
  );
}

/** The assessment of one subject key, or `undefined`. */
export function findCrossValidationAssessment(
  report: CrossValidationReport,
  subjectKey: string,
): CrossValidationAssessment | undefined {
  return (Array.isArray(report?.subjects) ? report.subjects : []).find(
    (assessment) => assessment?.subject?.key === subjectKey,
  );
}

/** A finding not yet assigned its deterministic id. */
interface DraftFinding {
  kind: CrossValidationFindingKind;
  disposition: CrossValidationDisposition;
  message: string;
  options: CrossValidationFindingOptions;
}

/** One analyzable input fact with its derived views. */
interface ExaminedFact {
  fact: CrossValidationFact;
  index: number;
  subject: CrossValidationSubject;
  reading: CrossSourceReading;
}

function referenceFor(reading: CrossSourceReading): CrossValidationReference {
  const reference: CrossValidationReference = {
    factId: reading.factId,
    sourceId: reading.sourceId,
  };
  if (isWellFormedCrossValidationSourceVersion(reading.sourceVersion)) {
    reference.sourceVersion = reading.sourceVersion;
  }
  return reference;
}

function hasIndependentPair(
  sourceIds: readonly CrossSourceRef[],
  sources?: readonly ProjectSourceDefinition[],
): boolean {
  for (let i = 0; i < sourceIds.length; i += 1) {
    for (let j = i + 1; j < sourceIds.length; j += 1) {
      if (areIndependentCrossSources(sourceIds[i], sourceIds[j], sources)) return true;
    }
  }
  return false;
}

/**
 * Describe the cross-source examination of a batch of extracted facts.
 *
 * Pure and deterministic: it mutates neither the context nor the request,
 * performs no IO, and never throws — an absent request, a malformed facts
 * list, a malformed registered source, or a deeply malformed fact is reported
 * as issues on the result (and, per fact, as an `inadmissible` standing),
 * never dereferenced or thrown out of. Each input fact slot classifies into
 * exactly one {@link CrossFactStanding}:
 *
 * - `inadmissible` — the slot is absent or the fact carries no usable id,
 *   project, source, or fact type, repeats an id already examined in the
 *   batch, belongs to another project, declares an empty field path, pins no
 *   well-formed received revision, or carries a representation or confidence
 *   the reused guards judge incoherent; recorded with a reason, never
 *   silently dropped.
 * - `requires_review` — at least one `requires_review` finding involves the
 *   fact: a conflict, an incomparability, an outdated revision that
 *   disagrees, a declared supersession cycle, a missing or inconsistent
 *   provenance chain, an unsupported claim, a stated bar it does not clear,
 *   an unregistered or inactive source. Every side of a disagreement is
 *   marked — no winner is elected.
 * - `admissible` — nothing observed stands in its way.
 *
 * A stated absence (an `unavailable` fact) is a current statement and
 *  participates in consensus: a source stating "the value is not there"
 * against a source stating a value is a described conflict, exactly as the
 * RC4.6 merge will treat the same pair — stated absence is data, never
 * silence. The caller's clock and stated bars are honoured only when they
 * are coherent vocabulary values; a malformed clock stamps nothing and a
 * malformed bar demands nothing (reported as warnings, never repaired into
 * invented values).
 *
 * The returned report is deep-copied, so it never aliases the sources or the
 * facts (anti-aliasing), and it always passes the module's own
 * {@link import("./validation/report").validateCrossValidationReport} with no
 * issues — the engine admits nothing its own validators would reject. One
 * deterministic completion rule feeds the reused RC4.0 lifecycle: each
 * admissible fact completes, each fact requiring review is skipped
 * (described, not settled), and each inadmissible fact fails.
 */
export function describeCrossSourceValidation(
  context: CrossValidationContext,
  request: CrossValidationRequest,
): CrossValidationResult<CrossValidationReport> {
  // The outer never-throw net: the examination reads caller-supplied
  // structures, and a sufficiently hostile input (a throwing property
  // accessor, an exotic proxy) can fail in ways no structural guard
  // anticipates. Such input still settles into a structured failure result —
  // deterministically, for the same hostile behaviour — never a throw.
  try {
    return describeCrossSourceValidationGuarded(context, request);
  } catch {
    return createCrossValidationResult({
      data: [],
      issues: [
        crossValidationError(
          "unexaminable_input",
          "The request or context behaved in a way that could not be examined",
          "request",
        ),
      ],
      stats: emptyCrossValidationStats(),
      metadata: { factCount: 0, sourceCount: 0, subjectCount: 0, findingCount: 0, reviewCount: 0 },
    });
  }
}

function describeCrossSourceValidationGuarded(
  context: CrossValidationContext,
  request: CrossValidationRequest,
): CrossValidationResult<CrossValidationReport> {
  const emptyCounts = {
    factCount: 0,
    sourceCount: 0,
    subjectCount: 0,
    findingCount: 0,
    reviewCount: 0,
  };
  const failure = (issue: CrossValidationIssue): CrossValidationResult<CrossValidationReport> => {
    const metadata: CrossValidationRunMetadata = { ...emptyCounts };
    if (isNonEmptyString(context?.now)) metadata.describedAt = context.now;
    return createCrossValidationResult({
      data: [],
      issues: [issue],
      stats: emptyCrossValidationStats(),
      metadata,
    });
  };

  if (isAbsent(request) || !isNonEmptyString(request.projectSlug)) {
    return failure(
      crossValidationError(
        "missing_validation_project",
        "Cross-validation request names no project to examine",
        "projectSlug",
      ),
    );
  }
  if (!Array.isArray(request.facts)) {
    return failure(
      crossValidationError(
        "invalid_validation_facts",
        "Cross-validation request declares a non-list facts value",
        "facts",
      ),
    );
  }

  const slug = normalizeCrossValidationSlug(request.projectSlug);
  if (slug === "") {
    return failure(
      crossValidationError(
        "missing_validation_project",
        "Cross-validation request names no usable project slug — nothing survives normalization",
        "projectSlug",
      ),
    );
  }

  const issues: CrossValidationIssue[] = [];
  const projectId = crossValidationProjectId(slug);
  const batch = isNonEmptyString(request.batch) ? request.batch : undefined;
  if (request.batch !== undefined && batch === undefined) {
    issues.push(
      crossValidationWarning(
        "invalid_validation_batch",
        "Cross-validation request declares an empty batch discriminator — ignored",
        "batch",
      ),
    );
  }
  const reportId = crossValidationReportIdFor(slug, batch);
  // The caller's clock is honoured only when it is an actual timestamp
  // string; a stated-but-empty (or non-string) clock stamps nothing — a
  // timestamp is never fabricated from a malformed one.
  const now = isNonEmptyString(context?.now) ? context.now : undefined;
  if (context?.now !== undefined && now === undefined) {
    issues.push(
      crossValidationWarning(
        "invalid_validation_now",
        "Context declares a non-timestamp now value — nothing is stamped",
        "now",
      ),
    );
  }

  // Registered sources: read defensively, first registration of an id wins —
  // matching the RC4.4 registry's wiring rule — and every malformation is
  // reported, never dereferenced.
  let sources: ProjectSourceDefinition[] | undefined;
  const rawSources = context?.sources;
  if (rawSources !== undefined && !Array.isArray(rawSources)) {
    issues.push(
      crossValidationWarning(
        "invalid_registered_sources",
        "Context declares a non-list sources value — examined as if none were registered",
        "sources",
      ),
    );
  } else if (Array.isArray(rawSources)) {
    sources = [];
    const seenSourceIds = new Set<string>();
    rawSources.forEach((source, index) => {
      if (isAbsent(source) || !isNonEmptyString(source.identity?.id)) {
        issues.push(
          crossValidationWarning(
            "malformed_registered_source",
            "Registered source carries no identity and cannot be resolved against",
            `sources.${index}`,
          ),
        );
        return;
      }
      if (seenSourceIds.has(source.identity.id)) {
        issues.push(
          crossValidationWarning(
            "duplicate_registered_source",
            `Registered source "${source.identity.id}" appears more than once — the first registration resolves`,
            `sources.${index}`,
          ),
        );
        return;
      }
      seenSourceIds.add(source.identity.id);
      sources!.push(source);
    });
  }
  const sourceCount = sources?.length ?? 0;

  // Requirements: honoured only where coherent; a malformed bar is reported
  // and demands nothing — a threshold is never invented from a broken one.
  let requirements: CrossValidationRequirements = {};
  const rawRequirements = context?.requirements;
  if (
    rawRequirements !== undefined &&
    (typeof rawRequirements !== "object" || rawRequirements === null)
  ) {
    issues.push(
      crossValidationWarning(
        "invalid_validation_requirements",
        "Context declares a non-object requirements value — examined as if none were stated",
        "requirements",
      ),
    );
  } else if (rawRequirements !== undefined) {
    requirements = rawRequirements;
  }

  // Each stated bar is honoured only when it is a known vocabulary value; an
  // out-of-vocabulary bar is reported and demands nothing.
  const minimumTrust = isKnownCrossSourceTrustLevel(requirements.minimumTrust)
    ? requirements.minimumTrust
    : undefined;
  if (requirements.minimumTrust !== undefined && minimumTrust === undefined) {
    issues.push(
      crossValidationWarning(
        "unknown_required_trust",
        "Requirements demand an unknown trust level — no trust bar is applied",
        "requirements.minimumTrust",
      ),
    );
  }
  const minimumConfidence = isKnownCrossValidationConfidenceLevel(requirements.minimumConfidence)
    ? requirements.minimumConfidence
    : undefined;
  if (requirements.minimumConfidence !== undefined && minimumConfidence === undefined) {
    issues.push(
      crossValidationWarning(
        "unknown_required_confidence",
        "Requirements demand an unknown confidence level — no confidence bar is applied",
        "requirements.minimumConfidence",
      ),
    );
  }
  const requireIndependentCorroboration = requirements.requireIndependentCorroboration === true;
  const requireLocatedEvidence = requirements.requireLocatedEvidence === true;

  const expectedPaths: string[] = [];
  if (requirements.expectedPaths !== undefined) {
    if (!Array.isArray(requirements.expectedPaths)) {
      issues.push(
        crossValidationWarning(
          "invalid_expected_paths",
          "Requirements declare a non-list expectedPaths value — no coverage is expected",
          "requirements.expectedPaths",
        ),
      );
    } else {
      requirements.expectedPaths.forEach((path, index) => {
        if (!isNonEmptyString(path)) {
          issues.push(
            crossValidationWarning(
              "invalid_expected_path",
              "Expected path is not a non-empty string — ignored",
              `requirements.expectedPaths.${index}`,
            ),
          );
          return;
        }
        if (!expectedPaths.includes(path)) expectedPaths.push(path);
      });
    }
  }

  // ── Intake: every input slot classifies exactly once ─────────────────────
  const examined: ExaminedFact[] = [];
  const exclusions = new Map<number, { reason: string; factId: string }>();
  const seenFactIds = new Set<string>();
  const exclude = (index: number, fact: CrossValidationFact, reason: string) => {
    // The excluded slot's id is captured defensively at exclusion time so
    // the standings pass never has to touch the hostile value again.
    let factId = "";
    try {
      if (isNonEmptyString(fact?.id)) factId = fact.id;
    } catch {
      factId = "";
    }
    exclusions.set(index, { reason, factId });
    issues.push(crossValidationError("inadmissible_fact", reason, `facts.${index}`));
  };

  // Iterated by index — never by a hole-skipping iterator — so every slot of
  // the batch is accounted for, and a hole is excluded as a malformed fact
  // instead of vanishing silently. Each slot's whole intake is additionally
  // guarded so one hostile fact (a throwing accessor) excludes that slot
  // instead of failing the batch.
  for (let index = 0; index < request.facts.length; index += 1) {
    const fact = request.facts[index];
    try {
      if (
        isAbsent(fact) ||
        !isNonEmptyString(fact.id) ||
        !isNonEmptyString(fact.projectId) ||
        !isNonEmptyString(fact.sourceId)
      ) {
        exclude(index, fact, "Incoming fact is malformed: it carries no id, project, or source");
        continue;
      }
      if (seenFactIds.has(fact.id)) {
        exclude(index, fact, `Incoming fact "${fact.id}" is already examined in this batch`);
        continue;
      }
      seenFactIds.add(fact.id);
      if (fact.projectId !== projectId) {
        exclude(index, fact, `Incoming fact belongs to "${fact.projectId}", not "${projectId}"`);
        continue;
      }
      if (!isKnownExtractionFactType(fact.factType)) {
        exclude(
          index,
          fact,
          "Incoming fact declares no known fact type and cannot be examined by subject",
        );
        continue;
      }
      if (fact.fieldPath !== undefined && !isNonEmptyString(fact.fieldPath)) {
        exclude(index, fact, "Incoming fact declares an empty or non-string field path");
        continue;
      }
      if (!isWellFormedCrossValidationSourceVersion(fact.sourceVersion)) {
        exclude(index, fact, "Incoming fact pins no well-formed received revision");
        continue;
      }
      if (
        fact.structuredValue !== undefined &&
        !isCrossValidationStructuredValue(fact.structuredValue)
      ) {
        exclude(index, fact, "Incoming fact carries a malformed structured value");
        continue;
      }
      if (
        !isAbsent(fact.confidence) &&
        validateExtractionConfidence(fact.confidence, "confidence").length > 0
      ) {
        // Judged by the reused RC4.5 confidence guard — never a local rule.
        exclude(index, fact, "Incoming fact carries an incoherent confidence");
        continue;
      }
      let reading: CrossSourceReading;
      try {
        reading = describeCrossSourceReading(fact, sources === undefined ? {} : { sources });
      } catch {
        exclude(index, fact, "Incoming fact could not be described as a cross-source reading");
        continue;
      }
      examined.push({ fact, index, subject: crossValidationSubjectFor(fact), reading });
    } catch {
      exclude(index, fact, "Incoming fact behaved in a way that could not be examined");
    }
  }

  // ── Fact-level findings ───────────────────────────────────────────────────
  const drafts: DraftFinding[] = [];
  const draft = (
    kind: CrossValidationFindingKind,
    disposition: CrossValidationDisposition,
    message: string,
    options: CrossValidationFindingOptions,
  ) => {
    const withTime = now === undefined ? options : { ...options, detectedAt: now };
    drafts.push({ kind, disposition, message, options: withTime });
  };

  for (const { fact, subject, reading } of examined) {
    const base: CrossValidationFindingOptions = {
      subjectKey: subject.key,
      references: [referenceFor(reading)],
    };
    if (subject.fieldPath !== undefined) base.path = subject.fieldPath;

    if (sources !== undefined && !reading.registered) {
      draft(
        "unregistered_source",
        "requires_review",
        `Fact "${fact.id}" traces to "${reading.sourceId}", which is not among the registered sources — the claim cannot be attributed`,
        base,
      );
    }
    if (reading.sourceStatus !== undefined && isTerminalProjectSourceStatus(reading.sourceStatus)) {
      draft(
        "inactive_source",
        "requires_review",
        `Fact "${fact.id}" traces to source "${reading.sourceId}", whose registered standing is "${reading.sourceStatus}"`,
        base,
      );
    }

    // Registry staleness: the fact was read from an older received revision
    // than the one the registered source currently describes.
    const definition = sources?.find((source) => source.identity?.id === reading.sourceId);
    if (
      definition !== undefined &&
      isWellFormedCrossValidationSourceVersion(definition.version) &&
      isWellFormedCrossValidationSourceVersion(fact.sourceVersion) &&
      compareCrossValidationSourceVersionTotal(fact.sourceVersion, definition.version) < 0
    ) {
      draft(
        "stale_revision",
        "advisory",
        `Fact "${fact.id}" was extracted from revision ${formatCrossValidationSourceVersion(
          fact.sourceVersion,
        )} of "${reading.sourceId}", but the registered source describes revision ${formatCrossValidationSourceVersion(
          definition.version,
        )}`,
        base,
      );
    }
    // The fact itself declares it was superseded by a later reading.
    if (fact.status === "superseded") {
      const references = [referenceFor(reading)];
      if (isNonEmptyString(fact.supersededBy)) references.push({ factId: fact.supersededBy });
      draft(
        "stale_revision",
        "requires_review",
        `Fact "${fact.id}" is marked superseded and cannot settle as canonical without review`,
        { ...base, references },
      );
    }
    // The fact itself declares it is disputed by other readings.
    if (
      fact.status === "disputed" ||
      (Array.isArray(fact.conflictsWith) && fact.conflictsWith.length > 0)
    ) {
      const references = [
        referenceFor(reading),
        ...(Array.isArray(fact.conflictsWith) ? fact.conflictsWith : [])
          .filter(isNonEmptyString)
          .map((factId) => ({ factId })),
      ];
      draft(
        "conflict",
        "requires_review",
        `Fact "${fact.id}" is declared in dispute by the extraction pipeline — the disagreement is preserved, not resolved`,
        { ...base, dimension: crossValidationDimensionForFactType(subject.factType), references },
      );
    }

    // Provenance completeness and internal reference consistency.
    const provenance = fact.provenance;
    if (isAbsent(provenance)) {
      draft(
        "provenance_gap",
        "requires_review",
        `Fact "${fact.id}" carries no provenance chain — it cannot be traced to a source, revision, method, and time`,
        base,
      );
    } else {
      if (!isNonEmptyString(provenance.extractedAt)) {
        draft(
          "provenance_gap",
          "requires_review",
          `Fact "${fact.id}" carries a provenance chain without an extraction time`,
          base,
        );
      }
      if (isAbsent(provenance.method)) {
        draft(
          "provenance_gap",
          "requires_review",
          `Fact "${fact.id}" carries a provenance chain without a method`,
          base,
        );
      }
      if (isNonEmptyString(provenance.sourceId) && provenance.sourceId !== fact.sourceId) {
        draft(
          "inconsistency",
          "requires_review",
          `Fact "${fact.id}" traces to "${fact.sourceId}" but its provenance names "${provenance.sourceId}"`,
          { ...base, dimension: "reference" },
        );
      }
      if (
        isWellFormedCrossValidationSourceVersion(provenance.sourceVersion) &&
        isWellFormedCrossValidationSourceVersion(fact.sourceVersion) &&
        compareCrossValidationSourceVersionTotal(provenance.sourceVersion, fact.sourceVersion) !== 0
      ) {
        draft(
          "inconsistency",
          "requires_review",
          `Fact "${fact.id}" pins revision ${formatCrossValidationSourceVersion(
            fact.sourceVersion,
          )} but its provenance names revision ${formatCrossValidationSourceVersion(
            provenance.sourceVersion,
          )}`,
          { ...base, dimension: "reference" },
        );
      }
    }

    // Evidence completeness and internal reference consistency.
    const evidence = fact.evidence;
    if (isAbsent(evidence)) {
      draft(
        "evidence_gap",
        "requires_review",
        `Fact "${fact.id}" records no evidence of where it was observed`,
        base,
      );
    } else {
      if (isNonEmptyString(evidence.sourceId) && evidence.sourceId !== fact.sourceId) {
        draft(
          "inconsistency",
          "requires_review",
          `Fact "${fact.id}" traces to "${fact.sourceId}" but its evidence names "${evidence.sourceId}"`,
          { ...base, dimension: "reference" },
        );
      }
      if (
        isWellFormedCrossValidationSourceVersion(evidence.sourceVersion) &&
        isWellFormedCrossValidationSourceVersion(fact.sourceVersion) &&
        compareCrossValidationSourceVersionTotal(evidence.sourceVersion, fact.sourceVersion) !== 0
      ) {
        draft(
          "inconsistency",
          "requires_review",
          `Fact "${fact.id}" pins revision ${formatCrossValidationSourceVersion(
            fact.sourceVersion,
          )} but its evidence names revision ${formatCrossValidationSourceVersion(
            evidence.sourceVersion,
          )}`,
          { ...base, dimension: "reference" },
        );
      }
      if (!isNonEmptyString(evidence.excerpt) && isAbsent(evidence.locator)) {
        draft(
          "evidence_gap",
          requireLocatedEvidence ? "requires_review" : "advisory",
          `Fact "${fact.id}" records evidence without an excerpt or locator — the observation cannot be pointed at`,
          base,
        );
      }
    }

    // Unsupported claims: a typed statement with no observed text behind it,
    // or a declared derivation with no chain to what it was derived from.
    if (
      fact.structuredValue !== undefined &&
      !isNonEmptyString(fact.rawValue) &&
      !isNonEmptyString(evidence?.excerpt)
    ) {
      draft(
        "unsupported_claim",
        "requires_review",
        `Fact "${fact.id}" carries a structured claim with no observed raw value or excerpt supporting it`,
        base,
      );
    }
    if (
      fact.valueKind === "derived" &&
      (!Array.isArray(provenance?.derivedFrom) || provenance.derivedFrom.length === 0)
    ) {
      draft(
        "unsupported_claim",
        "requires_review",
        `Fact "${fact.id}" is declared derived but its provenance chains to no facts it was derived from`,
        base,
      );
    }

    // Caller-stated bars. A bar never rejects — it flags for review.
    if (minimumTrust !== undefined) {
      const trust = reading.authority?.trust ?? "unverified";
      if (!meetsCrossSourceTrust(trust, minimumTrust)) {
        draft(
          "authority_below_bar",
          "requires_review",
          `Fact "${fact.id}" stands on "${trust}" source trust, below the required "${minimumTrust}"`,
          base,
        );
      }
    }
    if (minimumConfidence !== undefined) {
      const level = reading.confidence?.level ?? "unknown";
      if (!meetsCrossValidationConfidence(level, minimumConfidence)) {
        draft(
          "confidence_below_bar",
          "requires_review",
          `Fact "${fact.id}" carries "${String(level)}" confidence, below the required "${minimumConfidence}"`,
          base,
        );
      }
    }
  }

  // ── Subject-level findings and assessments ────────────────────────────────
  const subjectGroups = new Map<string, ExaminedFact[]>();
  for (const entry of examined) {
    const group = subjectGroups.get(entry.subject.key);
    if (group === undefined) subjectGroups.set(entry.subject.key, [entry]);
    else group.push(entry);
  }
  const subjectKeys = [...subjectGroups.keys()].sort(compareCrossValidationStrings);

  const assessments: CrossValidationAssessment[] = [];
  for (const key of subjectKeys) {
    const group = subjectGroups.get(key)!;
    const subject = group[0].subject;
    const readings = sortCrossSourceReadings(group.map((entry) => entry.reading));
    const subjectBase: CrossValidationFindingOptions = { subjectKey: key };
    if (subject.fieldPath !== undefined) subjectBase.path = subject.fieldPath;

    // In-batch revision staleness: within one source, a reading from an older
    // received revision than the newest one present is outdated — RC4.6 will
    // treat the newer reading as that source's own later statement. If the
    // outdated reading disagrees it needs review; if it agrees it is merely
    // redundant. Outdated readings are set aside from consensus but stay
    // described in the assessment.
    const outdatedFactIds = new Set<string>();
    const bySource = new Map<string, CrossSourceReading[]>();
    for (const reading of readings) {
      if (!reading.current || !isWellFormedCrossValidationSourceVersion(reading.sourceVersion)) {
        continue;
      }
      const list = bySource.get(reading.sourceId);
      if (list === undefined) bySource.set(reading.sourceId, [reading]);
      else list.push(reading);
    }
    for (const [, sourceReadings] of bySource) {
      let newest = sourceReadings[0];
      for (const reading of sourceReadings) {
        if (
          compareCrossValidationSourceVersionTotal(reading.sourceVersion, newest.sourceVersion) > 0
        ) {
          newest = reading;
        }
      }
      for (const reading of sourceReadings) {
        if (
          reading !== newest &&
          compareCrossValidationSourceVersionTotal(reading.sourceVersion, newest.sourceVersion) < 0
        ) {
          outdatedFactIds.add(reading.factId);
          const disagrees = reading.signature !== newest.signature;
          draft(
            "stale_revision",
            disagrees ? "requires_review" : "advisory",
            disagrees
              ? `Fact "${reading.factId}" reads revision ${formatCrossValidationSourceVersion(
                  reading.sourceVersion,
                )} of "${reading.sourceId}" and disagrees with the newer revision ${formatCrossValidationSourceVersion(
                  newest.sourceVersion,
                )} reading "${newest.factId}" — both readings are preserved`
              : `Fact "${reading.factId}" reads revision ${formatCrossValidationSourceVersion(
                  reading.sourceVersion,
                )} of "${reading.sourceId}" and agrees with the newer revision ${formatCrossValidationSourceVersion(
                  newest.sourceVersion,
                )} reading "${newest.factId}"`,
            { ...subjectBase, references: [referenceFor(reading), referenceFor(newest)] },
          );
        }
      }
    }

    // Cross-catalogue revision chains: RC4.4 catalogues each received
    // revision as its own source, chained by `supersedes`/`supersededBy`. A
    // reading whose registered source is superseded — declared on either end
    // of the chain — by another catalogued source that also speaks on this
    // subject is outdated: its disagreement with the successor is staleness,
    // never a manufactured cross-source conflict. Chains are walked link by
    // link (cycle-guarded) so a skipped intermediate revision still resolves.
    const relationshipsOf = (sourceId: string) =>
      sources?.find((source) => source.identity?.id === sourceId)?.relationships;
    const chainReaches = (
      fromId: string,
      toId: string,
      link: "supersedes" | "supersededBy",
    ): boolean => {
      const walked = new Set<string>([fromId]);
      let cursor = relationshipsOf(fromId)?.[link];
      while (isNonEmptyString(cursor) && !walked.has(cursor)) {
        if (cursor === toId) return true;
        walked.add(cursor);
        cursor = relationshipsOf(cursor)?.[link];
      }
      return false;
    };
    const succeedsSource = (successorId: string, oldId: string): boolean =>
      chainReaches(oldId, successorId, "supersededBy") ||
      chainReaches(successorId, oldId, "supersedes");

    // A supersession *cycle* (each source declared to succeed the other)
    // states no revision order at all: neither reading is set aside — that
    // would elect a loser from a contradiction — and the contradictory chain
    // itself is described as a reference inconsistency for review.
    const currentSourceIds = [
      ...new Set(readings.filter((reading) => reading.current).map((reading) => reading.sourceId)),
    ];
    const cyclicSources = new Set<string>();
    for (let i = 0; i < currentSourceIds.length; i += 1) {
      for (let j = i + 1; j < currentSourceIds.length; j += 1) {
        const [a, b] = [currentSourceIds[i], currentSourceIds[j]];
        if (succeedsSource(a, b) && succeedsSource(b, a)) {
          cyclicSources.add(a);
          cyclicSources.add(b);
          const readingA = readings.find((reading) => reading.current && reading.sourceId === a)!;
          const readingB = readings.find((reading) => reading.current && reading.sourceId === b)!;
          draft(
            "inconsistency",
            "requires_review",
            `Sources "${a}" and "${b}" declare a supersession cycle — the revision order cannot be judged, and neither reading is set aside`,
            {
              ...subjectBase,
              dimension: "reference",
              references: [referenceFor(readingA), referenceFor(readingB)],
            },
          );
        }
      }
    }

    for (const reading of readings) {
      if (
        !reading.current ||
        outdatedFactIds.has(reading.factId) ||
        cyclicSources.has(reading.sourceId)
      ) {
        continue;
      }
      const successor = readings.find(
        (candidate) =>
          candidate.current &&
          candidate.sourceId !== reading.sourceId &&
          !cyclicSources.has(candidate.sourceId) &&
          succeedsSource(candidate.sourceId, reading.sourceId) &&
          !succeedsSource(reading.sourceId, candidate.sourceId),
      );
      if (successor !== undefined) {
        outdatedFactIds.add(reading.factId);
        const disagrees = reading.signature !== successor.signature;
        draft(
          "stale_revision",
          disagrees ? "requires_review" : "advisory",
          disagrees
            ? `Fact "${reading.factId}" reads "${reading.sourceId}", which is superseded by "${successor.sourceId}", and disagrees with its successor reading "${successor.factId}" — both readings are preserved`
            : `Fact "${reading.factId}" reads "${reading.sourceId}", which is superseded by "${successor.sourceId}", and agrees with its successor reading "${successor.factId}"`,
          { ...subjectBase, references: [referenceFor(reading), referenceFor(successor)] },
        );
      }
    }

    // Redundant duplicates: the same source, the same received revision, the
    // same value — stated more than once.
    const duplicateGroups = new Map<string, CrossSourceReading[]>();
    for (const reading of readings) {
      const duplicateKey = `${reading.sourceId}|${formatCrossValidationSourceVersion(
        reading.sourceVersion ?? { major: NaN, minor: NaN, patch: NaN },
      )}|${reading.signature}`;
      const list = duplicateGroups.get(duplicateKey);
      if (list === undefined) duplicateGroups.set(duplicateKey, [reading]);
      else list.push(reading);
    }
    for (const [, duplicates] of duplicateGroups) {
      if (duplicates.length > 1) {
        draft(
          "duplicate_fact",
          "advisory",
          `Facts ${duplicates
            .map((reading) => `"${reading.factId}"`)
            .join(
              ", ",
            )} state the same reading from the same source and revision — redundant, not corroborating`,
          { ...subjectBase, references: duplicates.map(referenceFor) },
        );
      }
    }

    // Consensus over the current, non-outdated readings — judged, never
    // resolved.
    const consensusReadings = readings.filter(
      (reading) => reading.current && !outdatedFactIds.has(reading.factId),
    );
    const verdict = judgeCrossValidationConsensus(consensusReadings, sources);
    const involved = consensusReadings.filter((reading) => reading.current);
    const involvedSources = [...new Set(involved.map((reading) => reading.sourceId))];
    const consensusOptions: CrossValidationFindingOptions = {
      ...subjectBase,
      references: involved.map(referenceFor),
    };

    if (verdict.consensus === "contested") {
      const distinctSignatures = new Set(involved.map((reading) => reading.signature)).size;
      const absenceCount = group.filter(
        (entry) =>
          entry.fact.status === "unavailable" && !outdatedFactIds.has(entry.reading.factId),
      ).length;
      const shape =
        absenceCount > 0
          ? `${involved.length} readings carry ${distinctSignatures} distinct statements, including ${absenceCount} that state the value is absent`
          : `${involved.length} readings carry ${distinctSignatures} distinct values`;
      draft(
        "conflict",
        "requires_review",
        involvedSources.length === 1
          ? `Source "${involvedSources[0]}" disagrees with itself about "${key}": ${shape} — every side is preserved and none is chosen`
          : `Sources disagree about "${key}": ${shape} — every side is preserved and none is chosen`,
        {
          ...consensusOptions,
          dimension: crossValidationDimensionForFactType(subject.factType),
          independentSources: hasIndependentPair(involvedSources, sources),
        },
      );
    } else if (verdict.consensus === "incomparable") {
      draft(
        "inconsistency",
        "requires_review",
        `Readings of "${key}" are not mutually comparable over their ${verdict.dimension ?? "value"} — agreement cannot be judged without normalization, which is never performed here`,
        { ...consensusOptions, dimension: verdict.dimension ?? "value" },
      );
    } else if (verdict.consensus === "corroborated") {
      draft(
        "agreement",
        "informational",
        `Independent sources agree about "${key}": ${involvedSources.length} sources state the same reading`,
        { ...consensusOptions, independentSources: true },
      );
    } else if (verdict.consensus === "uncorroborated" && involved.length > 0) {
      draft(
        "single_source",
        requireIndependentCorroboration ? "requires_review" : "informational",
        involvedSources.length > 1
          ? `Only mutually dependent sources state "${key}" — the reading is not independently corroborated`
          : `Only one source states "${key}" — the reading is not independently corroborated`,
        {
          ...consensusOptions,
          independentSources: involvedSources.length > 1 ? false : undefined,
        },
      );
    }

    assessments.push({ subject, readings, consensus: verdict.consensus, findingIds: [] });
  }

  // ── Missing information: expected paths no value-carrying reading covers ─
  for (const path of expectedPaths) {
    const covering = examined.filter((entry) => entry.subject.fieldPath === path);
    if (covering.some((entry) => extractionFactStatusCarriesValue(entry.fact.status))) continue;
    if (covering.length > 0) {
      // The path is addressed, but only by stated absences: the information
      // is missing by the sources' own statement — described, not defaulted,
      // and anchored to the facts that stated it.
      draft(
        "missing_information",
        "requires_review",
        `Every examinable reading of the expected canonical path "${path}" states the information is absent — missing by the sources' own statement, not defaulted`,
        { path, references: [{ path }, ...covering.map((entry) => referenceFor(entry.reading))] },
      );
      continue;
    }
    const subject = crossValidationExpectedSubjectFor(projectId, path);
    draft(
      "missing_information",
      "requires_review",
      `No examinable incoming fact covers the expected canonical path "${path}" — the information is missing, not defaulted`,
      { subjectKey: subject.key, path, references: [{ path }] },
    );
    assessments.push({ subject, readings: [], consensus: "unaddressed", findingIds: [] });
  }
  assessments.sort((a, b) => compareCrossValidationStrings(a.subject.key, b.subject.key));

  // ── Deterministic finding order and id assignment ─────────────────────────
  const provisional = drafts.map((entry) =>
    crossValidationFinding(
      "",
      entry.kind,
      entry.disposition,
      projectId,
      entry.message,
      entry.options,
    ),
  );
  const ordered = sortCrossValidationFindings(provisional);
  const kindCounters = new Map<string, number>();
  const findings = ordered.map((finding) => {
    const ordinal = (kindCounters.get(finding.kind) ?? 0) + 1;
    kindCounters.set(finding.kind, ordinal);
    return { ...finding, id: crossValidationFindingIdFor(slug, finding.kind, ordinal) };
  });

  // Backfill traceability indexes: subject → findings and fact → findings.
  const findingIdsBySubject = new Map<string, string[]>();
  const findingIdsByFact = new Map<string, string[]>();
  for (const finding of findings) {
    if (finding.subjectKey !== undefined) {
      const list = findingIdsBySubject.get(finding.subjectKey);
      if (list === undefined) findingIdsBySubject.set(finding.subjectKey, [finding.id]);
      else list.push(finding.id);
    }
    for (const reference of finding.references) {
      if (!isNonEmptyString(reference.factId)) continue;
      const list = findingIdsByFact.get(reference.factId);
      if (list === undefined) findingIdsByFact.set(reference.factId, [finding.id]);
      else if (!list.includes(finding.id)) list.push(finding.id);
    }
  }
  for (const assessment of assessments) {
    assessment.findingIds = findingIdsBySubject.get(assessment.subject.key) ?? [];
  }

  const requiresReviewIds = new Set(
    findings.filter(crossValidationFindingRequiresReview).map((finding) => finding.id),
  );

  // ── Standings: one verdict per input slot, in input order ────────────────
  const standings: CrossFactStanding[] = [];
  const examinedByIndex = new Map<number, ExaminedFact>();
  for (const entry of examined) examinedByIndex.set(entry.index, entry);
  for (let index = 0; index < request.facts.length; index += 1) {
    const excluded = exclusions.get(index);
    if (excluded !== undefined) {
      standings.push({
        factId: excluded.factId,
        admissibility: "inadmissible",
        findingIds: [],
        reason: excluded.reason,
      });
      continue;
    }
    const entry = examinedByIndex.get(index)!;
    const findingIds = findingIdsByFact.get(entry.fact.id) ?? [];
    standings.push({
      factId: entry.fact.id,
      subjectKey: entry.subject.key,
      admissibility: findingIds.some((id) => requiresReviewIds.has(id))
        ? "requires_review"
        : "admissible",
      findingIds,
    });
  }

  const reviewCount = requiresReviewIds.size;
  if (reviewCount > 0) {
    issues.push(
      crossValidationWarning(
        "unresolved_findings",
        `${reviewCount} finding(s) require future human review — described, not resolved`,
        "findings",
      ),
    );
  }

  const report: CrossValidationReport = {
    id: reportId,
    projectId,
    projectSlug: slug,
    subjects: assessments,
    findings,
    standings,
    sourceIds: distinctCrossSourceRefs(examined.map((entry) => entry.fact)),
  };
  if (batch !== undefined) report.batch = batch;
  if (now !== undefined) report.describedAt = now;

  // The report is deep-copied at this boundary so a result never aliases the
  // context's sources or the request's facts: mutating a described report can
  // never reach back into the caller's values. A part that cannot even be
  // copied is reported, never thrown out of.
  let copied: CrossValidationReport;
  try {
    copied = structuredClone(report);
  } catch {
    return failure(
      crossValidationError(
        "uncloneable_report",
        "The described report holds values that cannot be copied for description",
        "report",
      ),
    );
  }

  // One deterministic completion rule: each admissible fact completes, each
  // fact requiring review is skipped (described, not settled), and each
  // inadmissible fact fails.
  const admissible = standings.filter((standing) => standing.admissibility === "admissible").length;
  const review = standings.filter(
    (standing) => standing.admissibility === "requires_review",
  ).length;
  const inadmissible = standings.filter(
    (standing) => standing.admissibility === "inadmissible",
  ).length;
  const stats = {
    ...emptyCrossValidationStats(),
    stages: 1,
    steps: request.facts.length,
    completed: admissible,
    skipped: review,
    failed: inadmissible,
  };

  const metadata: CrossValidationRunMetadata = {
    reportId,
    projectId,
    factCount: request.facts.length,
    sourceCount,
    subjectCount: copied.subjects.length,
    findingCount: copied.findings.length,
    reviewCount,
  };
  if (now !== undefined) metadata.describedAt = now;

  return createCrossValidationResult({ data: [copied], issues, stats, metadata });
}
