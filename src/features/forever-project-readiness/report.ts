/**
 * Forever Project Readiness — the deterministic examination engine.
 *
 * This is the engine of RC4.9: {@link describeProjectReadiness} takes the
 * requirements a caller states (inline, through a reusable profile, or both)
 * and *describes* the readiness examination a gate runtime would perform —
 * which statements the RC4.6 canonical record, the RC4.7 cross-source
 * validation report, and the RC4.4 registered sources satisfy, which they
 * leave unsatisfied, which no supplied input can judge at all, and what
 * therefore stands between the project and readiness. It is a pure function:
 * no clock, no randomness, no IO, no hidden state — identical context and
 * request always yield an identical report, and the input record, report,
 * sources, profile, and requirements are never mutated.
 *
 * Nothing is ever decided: a `ready` standing is a description a human or a
 * future runtime acts on, an unmet requirement is a described blocker that
 * is never waived, and RC4.9 imports, publishes, and approves nothing.
 * Nothing is ever invented: a bar exists only because the caller stated it,
 * a judgement exists only because a supplied input supports it (an absent
 * record, report, or source roster settles the statements it would judge
 * into an explicit `indeterminate` — never a fabricated verdict), a subject
 * standing is the reused RC4.8 mapping of the reused RC4.7 consensus, and a
 * timestamp appears only because the caller supplied one. Corroboration and
 * contest are judged through the examination the RC4.7 report already
 * describes, so this gate can never disagree with the judgement the
 * cross-source examination made over the same facts.
 */

import type {
  CrossValidationAssessment,
  CrossValidationReport,
} from "@/features/forever-cross-validation";
import { crossValidationFindingRequiresReview } from "@/features/forever-cross-validation";
import type { ISODateTime, Slug } from "@/features/forever-database";
import type { ProjectField, ProjectRecord } from "@/features/forever-project-database";
import { currentProjectFieldValue } from "@/features/forever-project-database";
import type { ProjectSourceDefinition } from "@/features/forever-project-sources";
import {
  isCurrentProjectSourceStatus,
  isKnownProjectSourceStatus,
} from "@/features/forever-project-sources";

import type { ReadinessContext } from "./context";
import type { ReadinessEvaluation, ReadinessReference } from "./evaluation";
import { isAdvisoryReadinessEvaluation, isBlockingReadinessEvaluation } from "./evaluation";
import { isAbsent, isNonEmptyString } from "./helpers";
import {
  normalizeReadinessSlug,
  readinessEvaluationIdFor,
  readinessProjectId,
  readinessReportIdFor,
} from "./identity";
import type { ReadinessProfile } from "./profile";
import type { ReadinessRequirement } from "./requirement";
import {
  compareReadinessRequirements,
  isKnownReadinessDocumentType,
  isKnownReadinessNecessity,
  isKnownReadinessRequirementKind,
  isKnownReadinessTrustLevel,
  isReadinessFieldRequirementKind,
  meetsReadinessTrust,
  readinessRequirementSignature,
} from "./requirement";
import { createReadinessResult, emptyReadinessStats } from "./result";
import type { ReadinessResult, ReadinessRunMetadata } from "./result";
import {
  isKnownReadinessConfidenceLevel,
  meetsReadinessConfidence,
  readinessError,
  readinessWarning,
} from "./types";
import type { ReadinessIssue, ReadinessSourceRef } from "./types";
import type { ReadinessStanding, ReadinessSubjectStanding, ReadinessVerdict } from "./verdict";
import {
  pickReadinessSubjectStanding,
  readinessStandingFor,
  readinessSubjectStandingForConsensus,
  readinessSubjectStandingRequiresReview,
  isSettledReadinessSubjectStanding,
} from "./verdict";
import { isWellFormedReadinessSourceVersion } from "./version";

/**
 * The request one examination is described from.
 *
 * Requirements arrive inline, through a reusable {@link ReadinessProfile},
 * or both (the profile's statements are evaluated first, then the inline
 * ones). The optional batch is a caller-stated discriminator that
 * participates in the report id so repeated examinations of one project
 * never collide — stated, never invented.
 */
export interface ReadinessRequest {
  /** The verified slug of the project the examination concerns. */
  projectSlug: string;
  /** The inline stated requirements, in declared order. */
  requirements?: ReadinessRequirement[];
  /** A reusable profile whose statements are evaluated before the inline ones. */
  profile?: ReadinessProfile;
  /** Caller-stated batch discriminator, when the caller distinguishes runs. */
  batch?: string;
}

/** How one stated requirement slot settled at intake. */
export type ReadinessAdmissibility = "evaluated" | "inadmissible";

/**
 * One stated requirement slot, accounted for exactly once — a statement is
 * either evaluated (and points at its evaluation) or inadmissible (and says
 * why); nothing vanishes silently.
 */
export interface ReadinessSlot {
  /** Where the statement was made, e.g. `requirements.0` or `profile.requirements.2`. */
  statement: string;
  /** Whether the statement could be evaluated at all. */
  admissibility: ReadinessAdmissibility;
  /** The evaluation the statement settled into, when it was admissible. */
  evaluationId?: string;
  /** Why the statement could not be evaluated, when it could not. */
  reason?: string;
}

/** The full description of one readiness examination. */
export interface ReadinessReport {
  /** Stable surrogate id, e.g. `rrep_coralina` or `rrep_coralina-2026-07`. */
  id: string;
  /** Canonical id of the examined project, e.g. `proj_coralina`. */
  projectId: string;
  /** The verified, normalized project slug, e.g. `coralina`. */
  projectSlug: Slug;
  /** The caller-stated batch discriminator, when one was stated. */
  batch?: string;
  /** The profile that stated requirements, when a coherent one was named. */
  profileId?: string;
  /** What the evaluations amount to — a description, never a go. */
  standing: ReadinessStanding;
  /** Every judged statement, in the module's one deterministic order. */
  evaluations: ReadinessEvaluation[];
  /** One slot per stated requirement, in statement order — every slot accounted. */
  slots: ReadinessSlot[];
  /** The distinct RC4.4 sources the evaluations trace to, first-seen order. */
  sourceIds: ReadinessSourceRef[];
  /** When the examination was described, supplied by the caller. */
  describedAt?: ISODateTime;
}

/** Every evaluation of one requirement kind, in the report's order. */
export function listReadinessEvaluationsByKind(
  report: ReadinessReport,
  kind: ReadinessRequirement["kind"],
): ReadinessEvaluation[] {
  return (Array.isArray(report?.evaluations) ? report.evaluations : []).filter(
    (evaluation) => evaluation?.requirement?.kind === kind,
  );
}

/** The evaluation with one id, or `undefined`. */
export function findReadinessEvaluation(
  report: ReadinessReport,
  evaluationId: string,
): ReadinessEvaluation | undefined {
  return (Array.isArray(report?.evaluations) ? report.evaluations : []).find(
    (evaluation) => evaluation?.id === evaluationId,
  );
}

/**
 * Every described blocker, in the report's evaluation order: the required
 * statements standing anything but met. This is the list the repository's
 * readiness audits keep by hand today — described here, never resolved.
 */
export function listReadinessBlockers(report: ReadinessReport): ReadinessEvaluation[] {
  return (Array.isArray(report?.evaluations) ? report.evaluations : []).filter((evaluation) =>
    isBlockingReadinessEvaluation(evaluation),
  );
}

/** Every advisory (explicitly `recommended`) unmet or unjudgeable statement. */
export function listReadinessAdvisories(report: ReadinessReport): ReadinessEvaluation[] {
  return (Array.isArray(report?.evaluations) ? report.evaluations : []).filter(
    (evaluation) => isAdvisoryReadinessEvaluation(evaluation) && evaluation?.verdict !== "met",
  );
}

/** Whether the report describes a project whose stated bar is fully met. */
export function readinessReportIsReady(report: ReadinessReport): boolean {
  return report?.standing === "ready";
}

/** Whether the report describes at least one unmet required statement. */
export function readinessReportIsBlocked(report: ReadinessReport): boolean {
  return report?.standing === "blocked";
}

/** A statement gathered from the request, pinned to where it was made. */
interface StatedSlot {
  raw: unknown;
  locator: string;
}

/** An evaluation drafted before ids are assigned. */
interface DraftEvaluation {
  requirement: ReadinessRequirement;
  verdict: ReadinessVerdict;
  reason: string;
  references: ReadinessReference[];
  findingIds?: string[];
  standing?: ReadinessSubjectStanding;
  statementIndex: number;
}

/** The judgement one admissible statement settles into. */
interface Judgement {
  verdict: ReadinessVerdict;
  reason: string;
  references: ReadinessReference[];
  findingIds?: string[];
  standing?: ReadinessSubjectStanding;
}

/**
 * Describe the readiness examination of one project against the stated
 * requirements.
 *
 * Pure and deterministic: it mutates neither the context nor the request,
 * performs no IO, and never throws — an absent request, a malformed
 * requirements list, a malformed context artifact, or a deeply malformed
 * statement is reported as issues on the result (and, per statement, as an
 * `inadmissible` slot), never dereferenced or thrown out of. Each stated
 * requirement slot classifies into exactly one {@link ReadinessSlot}:
 *
 * - `inadmissible` — the slot is absent or not an object, declares no known
 *   kind, misses or malforms a kind-essential parameter (a field statement
 *   without a path, a source statement without a known document type, a
 *   confidence statement without a known rung, a stated-but-unknown trust
 *   rung, an empty findings scope), or restates a demand already stated in
 *   the request; recorded with a reason, never silently dropped.
 * - `evaluated` — the statement settles into exactly one
 *   {@link ReadinessEvaluation} whose verdict is `met`, `unmet`, or
 *   `indeterminate`.
 *
 * Context artifacts are honoured only where coherent and only for this
 * project: a non-object record, report, or non-list sources value — or one
 * belonging to another project — is set aside with a warning and the
 * statements it would judge settle into `indeterminate`, exactly as if it
 * had never been supplied (a malformed input judges nothing). The caller's
 * clock is honoured only when it is an actual timestamp string; a malformed
 * clock stamps nothing. Corroboration, contest, and finding review are read
 * from the reused RC4.7 report and re-expressed through the reused RC4.8
 * standing mapping — never re-judged.
 *
 * The returned report is deep-copied, so it never aliases the context or the
 * request (anti-aliasing), and it always passes the module's own
 * {@link import("./validation/report").validateReadinessReport} with no
 * issues — the engine admits nothing its own validators would reject. One
 * deterministic completion rule feeds the reused RC4.0 lifecycle: each met
 * statement completes, each unmet or indeterminate statement is skipped
 * (described, not settled), and each inadmissible statement fails.
 */
export function describeProjectReadiness(
  context: ReadinessContext,
  request: ReadinessRequest,
): ReadinessResult<ReadinessReport> {
  // The outer never-throw net: the examination reads caller-supplied
  // structures, and a sufficiently hostile input (a throwing property
  // accessor, an exotic proxy) can fail in ways no structural guard
  // anticipates. Such input still settles into a structured failure result —
  // deterministically, for the same hostile behaviour — never a throw.
  try {
    return describeProjectReadinessGuarded(context, request);
  } catch {
    return createReadinessResult({
      data: [],
      issues: [
        readinessError(
          "unassessable_input",
          "The request or context behaved in a way that could not be examined",
          "request",
        ),
      ],
      stats: emptyReadinessStats(),
      metadata: {
        requirementCount: 0,
        evaluationCount: 0,
        metCount: 0,
        unmetCount: 0,
        indeterminateCount: 0,
        blockerCount: 0,
      },
    });
  }
}

function describeProjectReadinessGuarded(
  context: ReadinessContext,
  request: ReadinessRequest,
): ReadinessResult<ReadinessReport> {
  const emptyCounts = {
    requirementCount: 0,
    evaluationCount: 0,
    metCount: 0,
    unmetCount: 0,
    indeterminateCount: 0,
    blockerCount: 0,
  };
  const failure = (issue: ReadinessIssue): ReadinessResult<ReadinessReport> => {
    const metadata: ReadinessRunMetadata = { ...emptyCounts };
    if (isNonEmptyString(context?.now)) metadata.describedAt = context.now;
    return createReadinessResult({
      data: [],
      issues: [issue],
      stats: emptyReadinessStats(),
      metadata,
    });
  };

  if (isAbsent(request) || !isNonEmptyString(request.projectSlug)) {
    return failure(
      readinessError(
        "missing_readiness_project",
        "Readiness request names no project to examine",
        "projectSlug",
      ),
    );
  }
  const slug = normalizeReadinessSlug(request.projectSlug);
  if (slug === "") {
    return failure(
      readinessError(
        "missing_readiness_project",
        "Readiness request names no usable project slug — nothing survives normalization",
        "projectSlug",
      ),
    );
  }
  if (request.requirements !== undefined && !Array.isArray(request.requirements)) {
    return failure(
      readinessError(
        "invalid_readiness_requirements",
        "Readiness request declares a non-list requirements value",
        "requirements",
      ),
    );
  }

  const issues: ReadinessIssue[] = [];
  const projectId = readinessProjectId(slug);
  const batch = isNonEmptyString(request.batch) ? request.batch : undefined;
  if (request.batch !== undefined && batch === undefined) {
    issues.push(
      readinessWarning(
        "invalid_readiness_batch",
        "Readiness request declares an empty batch discriminator — ignored",
        "batch",
      ),
    );
  }
  const reportId = readinessReportIdFor(slug, batch);
  // The caller's clock is honoured only when it is an actual timestamp
  // string; a stated-but-empty (or non-string) clock stamps nothing — a
  // timestamp is never fabricated from a malformed one.
  const now = isNonEmptyString(context?.now) ? context.now : undefined;
  if (context?.now !== undefined && now === undefined) {
    issues.push(
      readinessWarning(
        "invalid_readiness_now",
        "Context declares a non-timestamp now value — nothing is stamped",
        "now",
      ),
    );
  }

  // ── Statements: profile first, then inline — every slot pinned ───────────
  const statements: StatedSlot[] = [];
  let profileId: string | undefined;
  const rawProfile: ReadinessProfile | undefined = request.profile;
  if (rawProfile !== undefined) {
    if (isAbsent(rawProfile) || typeof rawProfile !== "object") {
      issues.push(
        readinessWarning(
          "invalid_readiness_profile",
          "Request declares a non-object profile — it states nothing",
          "profile",
        ),
      );
    } else if (!Array.isArray(rawProfile.requirements)) {
      issues.push(
        readinessWarning(
          "invalid_readiness_profile",
          "Profile declares a non-list requirements value — it states nothing",
          "profile.requirements",
        ),
      );
    } else {
      for (let index = 0; index < rawProfile.requirements.length; index += 1) {
        statements.push({
          raw: rawProfile.requirements[index],
          locator: `profile.requirements.${index}`,
        });
      }
      if (isNonEmptyString(rawProfile.id)) {
        profileId = rawProfile.id;
      } else {
        issues.push(
          readinessWarning(
            "invalid_readiness_profile",
            "Profile names no id — its statements are evaluated but the report pins no profile",
            "profile.id",
          ),
        );
      }
    }
  }
  if (Array.isArray(request.requirements)) {
    for (let index = 0; index < request.requirements.length; index += 1) {
      statements.push({ raw: request.requirements[index], locator: `requirements.${index}` });
    }
  }
  if (statements.length === 0) {
    return failure(
      readinessError(
        "missing_readiness_requirements",
        "Readiness request states no requirements — readiness is never presumed from silence",
        "requirements",
      ),
    );
  }

  // ── Registered sources: read defensively, first registration wins ────────
  // Matching the RC4.4 registry's wiring rule and the RC4.7/RC4.8 intake:
  // every malformation is reported, never dereferenced, and a source
  // belonging to another project is set aside rather than consulted.
  let sources: ProjectSourceDefinition[] | undefined;
  const rawSources = context?.sources;
  if (rawSources !== undefined && !Array.isArray(rawSources)) {
    issues.push(
      readinessWarning(
        "invalid_registered_sources",
        "Context declares a non-list sources value — examined as if none were supplied",
        "sources",
      ),
    );
  } else if (Array.isArray(rawSources)) {
    sources = [];
    const seenSourceIds = new Set<string>();
    // Iterated by index — never by a hole-skipping iterator — so a hole is
    // set aside as a malformed source instead of vanishing silently.
    for (let index = 0; index < rawSources.length; index += 1) {
      const source = rawSources[index];
      if (isAbsent(source) || !isNonEmptyString(source.identity?.id)) {
        issues.push(
          readinessWarning(
            "malformed_registered_source",
            "Registered source carries no identity and cannot be consulted",
            `sources.${index}`,
          ),
        );
        continue;
      }
      if (seenSourceIds.has(source.identity.id)) {
        issues.push(
          readinessWarning(
            "duplicate_registered_source",
            `Registered source "${source.identity.id}" appears more than once — the first registration resolves`,
            `sources.${index}`,
          ),
        );
        continue;
      }
      if (isNonEmptyString(source.identity.projectId) && source.identity.projectId !== projectId) {
        issues.push(
          readinessWarning(
            "foreign_registered_source",
            `Registered source "${source.identity.id}" belongs to "${source.identity.projectId}", not "${projectId}" — set aside`,
            `sources.${index}`,
          ),
        );
        continue;
      }
      seenSourceIds.add(source.identity.id);
      sources.push(source);
    }
  }

  // ── Canonical record and examination report: this project's, coherent ────
  let record: ProjectRecord | undefined = context?.record;
  if (record !== undefined) {
    if (isAbsent(record) || typeof record !== "object") {
      issues.push(
        readinessWarning(
          "invalid_readiness_record",
          "Context declares a non-object record value — examined as if none existed",
          "record",
        ),
      );
      record = undefined;
    } else if (record.identity?.projectId !== projectId) {
      issues.push(
        readinessWarning(
          "foreign_record",
          `Context record belongs to "${String(record.identity?.projectId)}", not "${projectId}" — set aside`,
          "record",
        ),
      );
      record = undefined;
    } else if (!Array.isArray(record.fields)) {
      issues.push(
        readinessWarning(
          "invalid_record_fields",
          "Context record declares a non-list fields value — examined as if no record existed",
          "record.fields",
        ),
      );
      record = undefined;
    }
  }

  let report: CrossValidationReport | undefined = context?.report;
  if (report !== undefined) {
    if (isAbsent(report) || typeof report !== "object") {
      issues.push(
        readinessWarning(
          "invalid_examination_report",
          "Context declares a non-object report value — examined as if none existed",
          "report",
        ),
      );
      report = undefined;
    } else if (report.projectId !== projectId) {
      issues.push(
        readinessWarning(
          "foreign_report",
          `Context report belongs to "${String(report.projectId)}", not "${projectId}" — set aside`,
          "report",
        ),
      );
      report = undefined;
    } else if (!Array.isArray(report.subjects) || !Array.isArray(report.findings)) {
      issues.push(
        readinessWarning(
          "invalid_examination_report",
          "Context report declares non-list subjects or findings — examined as if none existed",
          "report",
        ),
      );
      report = undefined;
    }
  }

  // ── Intake: every statement classifies exactly once ──────────────────────
  const admitted: { requirement: ReadinessRequirement; statementIndex: number }[] = [];
  const exclusions = new Map<number, string>();
  const seenSignatures = new Set<string>();
  const exclude = (statementIndex: number, locator: string, reason: string) => {
    exclusions.set(statementIndex, reason);
    issues.push(readinessError("inadmissible_requirement", reason, locator));
  };

  for (let index = 0; index < statements.length; index += 1) {
    const { raw, locator } = statements[index];
    // Each slot's whole intake is guarded so one hostile statement (a
    // throwing accessor) excludes that slot instead of failing the request.
    try {
      if (isAbsent(raw) || typeof raw !== "object") {
        exclude(index, locator, "Stated requirement is malformed: it is absent or not an object");
        continue;
      }
      const stated = raw as ReadinessRequirement;
      if (!isKnownReadinessRequirementKind(stated.kind)) {
        exclude(index, locator, "Stated requirement declares no known requirement kind");
        continue;
      }
      const normalized: ReadinessRequirement = { kind: stated.kind };

      // The canonical path: essential for field statements, an optional
      // scope for findings, never part of a source statement.
      if (isReadinessFieldRequirementKind(stated.kind)) {
        if (!isNonEmptyString(stated.path)) {
          exclude(
            index,
            locator,
            `A "${stated.kind}" requirement must address a canonical field path`,
          );
          continue;
        }
        normalized.path = stated.path;
      } else if (stated.kind === "findings_clear") {
        if (stated.path !== undefined && !isNonEmptyString(stated.path)) {
          exclude(index, locator, `A "findings_clear" requirement declares an empty path scope`);
          continue;
        }
        if (stated.path !== undefined) normalized.path = stated.path;
      } else if (stated.path !== undefined) {
        issues.push(
          readinessWarning(
            "extraneous_requirement_parameter",
            `A "${stated.kind}" requirement addresses no canonical path — the stated path is set aside`,
            `${locator}.path`,
          ),
        );
      }

      // The document type: essential for source statements only.
      if (stated.kind === "source_present") {
        if (!isKnownReadinessDocumentType(stated.documentType)) {
          exclude(index, locator, `A "source_present" requirement must name a known document type`);
          continue;
        }
        normalized.documentType = stated.documentType;
      } else if (stated.documentType !== undefined) {
        issues.push(
          readinessWarning(
            "extraneous_requirement_parameter",
            `A "${stated.kind}" requirement names no document type — the stated type is set aside`,
            `${locator}.documentType`,
          ),
        );
      }

      // The confidence rung: essential for confidence statements only.
      if (stated.kind === "field_confidence") {
        if (!isKnownReadinessConfidenceLevel(stated.minimumConfidence)) {
          exclude(
            index,
            locator,
            `A "field_confidence" requirement must state a known confidence rung`,
          );
          continue;
        }
        normalized.minimumConfidence = stated.minimumConfidence;
      } else if (stated.minimumConfidence !== undefined) {
        issues.push(
          readinessWarning(
            "extraneous_requirement_parameter",
            `A "${stated.kind}" requirement grades no confidence — the stated rung is set aside`,
            `${locator}.minimumConfidence`,
          ),
        );
      }

      // The trust rung: an optional bar for source statements only — but a
      // stated-and-unknown rung is an incoherent demand, never a no-bar.
      if (stated.kind === "source_present") {
        if (stated.minimumTrust !== undefined) {
          if (!isKnownReadinessTrustLevel(stated.minimumTrust)) {
            exclude(index, locator, `A "source_present" requirement demands an unknown trust rung`);
            continue;
          }
          normalized.minimumTrust = stated.minimumTrust;
        }
      } else if (stated.minimumTrust !== undefined) {
        issues.push(
          readinessWarning(
            "extraneous_requirement_parameter",
            `A "${stated.kind}" requirement grades no source trust — the stated rung is set aside`,
            `${locator}.minimumTrust`,
          ),
        );
      }

      // Necessity: the safe posture demands — only an explicit, known
      // `recommended` excuses, and a malformed necessity never quietly does.
      if (stated.necessity === undefined) {
        normalized.necessity = "required";
      } else if (isKnownReadinessNecessity(stated.necessity)) {
        normalized.necessity = stated.necessity;
      } else {
        issues.push(
          readinessWarning(
            "unknown_requirement_necessity",
            `Stated requirement declares an unknown necessity — the demanding "required" posture applies`,
            `${locator}.necessity`,
          ),
        );
        normalized.necessity = "required";
      }

      // The note: preserved verbatim when it says something.
      if (stated.note !== undefined) {
        if (isNonEmptyString(stated.note)) {
          normalized.note = stated.note;
        } else {
          issues.push(
            readinessWarning(
              "invalid_requirement_note",
              "Stated requirement declares an empty note — set aside",
              `${locator}.note`,
            ),
          );
        }
      }

      const signature = readinessRequirementSignature(normalized);
      if (seenSignatures.has(signature)) {
        exclude(
          index,
          locator,
          "Requirement restates a demand already stated in this request — evaluated once",
        );
        continue;
      }
      seenSignatures.add(signature);
      admitted.push({ requirement: normalized, statementIndex: index });
    } catch {
      exclude(index, locator, "Stated requirement behaved in a way that could not be examined");
    }
  }

  // ── Judgement: one verdict per admitted statement ─────────────────────────
  const fieldAtPath = (path: string): ProjectField | undefined => {
    if (record === undefined) return undefined;
    // First match wins — the RC4.6 database validator flags duplicate paths;
    // consulting mirrors registration order rather than electing a winner.
    return record.fields.find((field) => field?.path === path);
  };

  const assessmentsAt = (path: string): CrossValidationAssessment[] => {
    if (report === undefined) return [];
    return report.subjects.filter((assessment) => assessment?.subject?.fieldPath === path);
  };

  const referencesForValue = (path: string): ReadinessReference[] => {
    const references: ReadinessReference[] = [{ path }];
    const field = fieldAtPath(path);
    const current = field === undefined ? undefined : currentProjectFieldValue(field);
    if (current !== undefined) {
      if (isNonEmptyString(current.factId)) references.push({ factId: current.factId });
      for (const sourceId of Array.isArray(current.sourceIds) ? current.sourceIds : []) {
        if (isNonEmptyString(sourceId)) references.push({ sourceId });
      }
    }
    return references;
  };

  const referencesForAssessments = (
    path: string,
    assessments: readonly CrossValidationAssessment[],
  ): ReadinessReference[] => {
    const references: ReadinessReference[] = [{ path }];
    for (const assessment of assessments) {
      for (const reading of Array.isArray(assessment?.readings) ? assessment.readings : []) {
        if (!isNonEmptyString(reading?.factId)) continue;
        const reference: ReadinessReference = { factId: reading.factId };
        if (isNonEmptyString(reading.sourceId)) reference.sourceId = reading.sourceId;
        if (isWellFormedReadinessSourceVersion(reading.sourceVersion)) {
          reference.sourceVersion = reading.sourceVersion;
        }
        references.push(reference);
      }
    }
    return references;
  };

  const findingIdsForAssessments = (
    assessments: readonly CrossValidationAssessment[],
  ): string[] | undefined => {
    const findingIds: string[] = [];
    for (const assessment of assessments) {
      for (const findingId of Array.isArray(assessment?.findingIds) ? assessment.findingIds : []) {
        if (isNonEmptyString(findingId) && !findingIds.includes(findingId)) {
          findingIds.push(findingId);
        }
      }
    }
    return findingIds.length > 0 ? findingIds : undefined;
  };

  const judge = (requirement: ReadinessRequirement): Judgement => {
    switch (requirement.kind) {
      case "field_present": {
        const path = requirement.path!;
        if (record === undefined) {
          return {
            verdict: "indeterminate",
            reason: `No canonical record was supplied — whether "${path}" carries a standing value cannot be judged`,
            references: [],
          };
        }
        const field = fieldAtPath(path);
        if (field === undefined) {
          return {
            verdict: "unmet",
            reason: `The canonical record carries no field at "${path}"`,
            references: [{ path }],
          };
        }
        const current = currentProjectFieldValue(field);
        if (current === undefined) {
          // Distinguish a stated absence from plain silence: the last
          // coherent history entry saying `missing` is the sources' own
          // statement that the value is not there — described, not defaulted.
          // The history is read defensively — a field carrying a non-list
          // history simply states no absence, it is never dereferenced.
          let statedMissing = false;
          const entries = Array.isArray(field.values) ? field.values : [];
          for (let index = entries.length - 1; index >= 0; index -= 1) {
            const entry = entries[index];
            if (isAbsent(entry)) continue;
            statedMissing = entry.status === "missing";
            break;
          }
          return {
            verdict: "unmet",
            reason: statedMissing
              ? `No value stands at "${path}" — the sources themselves state it is absent (missing by statement, not by silence)`
              : `No value currently stands at "${path}" — the field's history holds no current entry`,
            references: [{ path }],
          };
        }
        return {
          verdict: "met",
          reason: `A canonical value currently stands at "${path}"`,
          references: referencesForValue(path),
        };
      }
      case "field_confidence": {
        const path = requirement.path!;
        const bar = requirement.minimumConfidence!;
        if (record === undefined) {
          return {
            verdict: "indeterminate",
            reason: `No canonical record was supplied — the confidence at "${path}" cannot be graded against the required "${bar}"`,
            references: [],
          };
        }
        const field = fieldAtPath(path);
        const current = field === undefined ? undefined : currentProjectFieldValue(field);
        if (current === undefined) {
          return {
            verdict: "unmet",
            reason: `No value currently stands at "${path}" — there is nothing to grade against the required "${bar}" confidence`,
            references: [{ path }],
          };
        }
        // The grade is trusted only as far as it is vocabulary: an
        // out-of-vocabulary level reads as the explicit `unknown`, which
        // clears no bar above `unknown` — never a fabricated grade.
        const statedLevel = current.confidence?.level;
        const level = isKnownReadinessConfidenceLevel(statedLevel) ? statedLevel : "unknown";
        if (meetsReadinessConfidence(level, bar)) {
          return {
            verdict: "met",
            reason: `The standing value at "${path}" carries "${level}" confidence, meeting the required "${bar}"`,
            references: referencesForValue(path),
          };
        }
        return {
          verdict: "unmet",
          reason: `The standing value at "${path}" carries "${level}" confidence, below the required "${bar}"`,
          references: referencesForValue(path),
        };
      }
      case "field_corroborated": {
        const path = requirement.path!;
        if (report === undefined) {
          return {
            verdict: "indeterminate",
            reason: `No examination report was supplied — whether independent sources corroborate "${path}" cannot be judged`,
            references: [],
          };
        }
        const addressing = assessmentsAt(path);
        if (addressing.length === 0) {
          return {
            verdict: "unmet",
            reason: `The examination addressed no reading of "${path}" — independent corroboration is not established`,
            references: [{ path }],
          };
        }
        const standings = addressing.map((assessment) =>
          readinessSubjectStandingForConsensus(assessment.consensus),
        );
        const standing = pickReadinessSubjectStanding(standings);
        const judgement: Judgement = {
          verdict: "unmet",
          reason: "",
          references: referencesForAssessments(path, addressing),
        };
        const findingIds = findingIdsForAssessments(addressing);
        if (findingIds !== undefined) judgement.findingIds = findingIds;
        if (standing !== undefined) judgement.standing = standing;
        if (
          standings.some((entry) => isSettledReadinessSubjectStanding(entry)) &&
          !standings.some((entry) => readinessSubjectStandingRequiresReview(entry))
        ) {
          judgement.verdict = "met";
          judgement.reason = `Independent sources corroborate "${path}" — the examination judged the subject corroborated`;
        } else if (standings.some((entry) => readinessSubjectStandingRequiresReview(entry))) {
          judgement.reason = `The examination judged "${path}" ${String(
            standing,
          )} — every side is preserved and none is chosen, so independent corroboration does not stand`;
        } else {
          judgement.reason = `The examination judged "${path}" ${String(
            standing,
          )} — no independent corroboration stands`;
        }
        return judgement;
      }
      case "field_uncontested": {
        const path = requirement.path!;
        if (report === undefined) {
          return {
            verdict: "indeterminate",
            reason: `No examination report was supplied — whether anything contests "${path}" cannot be judged`,
            references: [],
          };
        }
        const addressing = assessmentsAt(path);
        const standings = addressing.map((assessment) =>
          readinessSubjectStandingForConsensus(assessment.consensus),
        );
        const standing = pickReadinessSubjectStanding(standings);
        const judgement: Judgement = {
          verdict: "met",
          reason: "",
          references: referencesForAssessments(path, addressing),
        };
        const findingIds = findingIdsForAssessments(addressing);
        if (findingIds !== undefined) judgement.findingIds = findingIds;
        if (standing !== undefined) judgement.standing = standing;
        if (standings.some((entry) => readinessSubjectStandingRequiresReview(entry))) {
          judgement.verdict = "unmet";
          judgement.reason = `The examination judged "${path}" ${String(
            standing,
          )} — the disagreement stands described and unresolved`;
        } else {
          judgement.reason =
            addressing.length === 0
              ? `The examination addressed no reading of "${path}" and nothing it judged contests it`
              : `Nothing the examination judged contests "${path}"`;
        }
        return judgement;
      }
      case "source_present": {
        const documentType = requirement.documentType!;
        if (sources === undefined) {
          return {
            verdict: "indeterminate",
            reason: `No registered sources were supplied — whether a current "${documentType}" document exists cannot be judged`,
            references: [],
          };
        }
        const referenceFor = (source: ProjectSourceDefinition): ReadinessReference => {
          const reference: ReadinessReference = { sourceId: source.identity.id };
          if (isWellFormedReadinessSourceVersion(source.version)) {
            reference.sourceVersion = source.version;
          }
          return reference;
        };
        const ofType = sources.filter(
          (source) => source?.descriptor?.documentType === documentType,
        );
        if (ofType.length === 0) {
          return {
            verdict: "unmet",
            reason: `No registered source of type "${documentType}" exists`,
            references: [],
          };
        }
        // The standing is trusted only as far as it is vocabulary: an
        // out-of-vocabulary status is never read as current.
        const current = ofType.filter(
          (source) =>
            isKnownProjectSourceStatus(source.status) &&
            isCurrentProjectSourceStatus(source.status),
        );
        if (current.length === 0) {
          return {
            verdict: "unmet",
            reason: `Every registered "${documentType}" document stands superseded, archived, rejected, or incoherent — none is current`,
            references: ofType.map(referenceFor),
          };
        }
        if (requirement.minimumTrust === undefined) {
          return {
            verdict: "met",
            reason: `A current "${documentType}" document is registered`,
            references: current.map(referenceFor),
          };
        }
        // An unattributed or out-of-vocabulary trust reads as the RC4.4
        // stated safe posture — `unverified` — and so clears no bar above it.
        const qualifying = current.filter((source) =>
          meetsReadinessTrust(
            isKnownReadinessTrustLevel(source.authority?.trust)
              ? source.authority.trust
              : "unverified",
            requirement.minimumTrust!,
          ),
        );
        if (qualifying.length === 0) {
          return {
            verdict: "unmet",
            reason: `No current "${documentType}" document meets the required "${requirement.minimumTrust}" trust`,
            references: current.map(referenceFor),
          };
        }
        return {
          verdict: "met",
          reason: `A current "${documentType}" document meeting "${requirement.minimumTrust}" trust is registered`,
          references: qualifying.map(referenceFor),
        };
      }
      case "findings_clear":
      default: {
        const path = requirement.path;
        if (report === undefined) {
          return {
            verdict: "indeterminate",
            reason:
              path === undefined
                ? "No examination report was supplied — whether findings requiring review stand cannot be judged"
                : `No examination report was supplied — whether findings requiring review stand at "${path}" cannot be judged`,
            references: [],
          };
        }
        const scoped = report.findings.filter((finding) => {
          if (isAbsent(finding)) return false;
          if (path === undefined) return true;
          if (finding.path === path) return true;
          return (
            Array.isArray(finding.references) &&
            finding.references.some((reference) => reference?.path === path)
          );
        });
        const blocking = scoped.filter((finding) => crossValidationFindingRequiresReview(finding));
        const scope = path === undefined ? "" : ` at "${path}"`;
        if (blocking.length === 0) {
          return {
            verdict: "met",
            reason: `No examination finding requiring review stands${scope}`,
            references: path === undefined ? [] : [{ path }],
          };
        }
        const references: ReadinessReference[] = path === undefined ? [] : [{ path }];
        const seenReferences = new Set<string>();
        const findingIds: string[] = [];
        for (const finding of blocking) {
          if (isNonEmptyString(finding.id) && !findingIds.includes(finding.id)) {
            findingIds.push(finding.id);
          }
          for (const raw of Array.isArray(finding.references) ? finding.references : []) {
            if (isAbsent(raw)) continue;
            const reference: ReadinessReference = {};
            if (isNonEmptyString(raw.factId)) reference.factId = raw.factId;
            if (isNonEmptyString(raw.sourceId)) reference.sourceId = raw.sourceId;
            if (isNonEmptyString(raw.path)) reference.path = raw.path;
            if (isWellFormedReadinessSourceVersion(raw.sourceVersion)) {
              reference.sourceVersion = raw.sourceVersion;
            }
            if (
              reference.factId === undefined &&
              reference.sourceId === undefined &&
              reference.path === undefined
            ) {
              continue;
            }
            const key = [
              reference.factId ?? "",
              reference.sourceId ?? "",
              reference.path ?? "",
              reference.sourceVersion === undefined
                ? ""
                : `${reference.sourceVersion.major}.${reference.sourceVersion.minor}.${reference.sourceVersion.patch}`,
            ].join(" ");
            if (seenReferences.has(key)) continue;
            seenReferences.add(key);
            references.push(reference);
          }
        }
        const judgement: Judgement = {
          verdict: "unmet",
          reason: `${blocking.length} examination finding(s) requiring review stand${scope} — described for review, never waived`,
          references,
        };
        if (findingIds.length > 0) judgement.findingIds = findingIds;
        return judgement;
      }
    }
  };

  const drafts: DraftEvaluation[] = [];
  for (const { requirement, statementIndex } of admitted) {
    // Each judgement is additionally guarded: one hostile context artifact
    // (a throwing accessor deep inside a record or report) settles that one
    // statement into an explicit `indeterminate` instead of failing the
    // examination — deterministically, for the same hostile behaviour.
    let judgement: Judgement;
    try {
      judgement = judge(requirement);
    } catch {
      judgement = {
        verdict: "indeterminate",
        reason:
          "The supplied inputs behaved in a way that could not be examined for this statement",
        references: [],
      };
    }
    drafts.push({ requirement, statementIndex, ...judgement });
  }

  // ── Deterministic evaluation order and id assignment ─────────────────────
  drafts.sort(
    (a, b) =>
      compareReadinessRequirements(a.requirement, b.requirement) ||
      a.statementIndex - b.statementIndex,
  );
  const kindCounters = new Map<string, number>();
  const evaluationIdByStatement = new Map<number, string>();
  const evaluations: ReadinessEvaluation[] = drafts.map((draft) => {
    const ordinal = (kindCounters.get(draft.requirement.kind) ?? 0) + 1;
    kindCounters.set(draft.requirement.kind, ordinal);
    const id = readinessEvaluationIdFor(slug, draft.requirement.kind, ordinal);
    evaluationIdByStatement.set(draft.statementIndex, id);
    const evaluation: ReadinessEvaluation = {
      id,
      requirement: draft.requirement,
      verdict: draft.verdict,
      reason: draft.reason,
      references: draft.references,
    };
    if (draft.findingIds !== undefined) evaluation.findingIds = draft.findingIds;
    if (draft.standing !== undefined) evaluation.standing = draft.standing;
    if (now !== undefined) evaluation.evaluatedAt = now;
    return evaluation;
  });

  // ── Slots: one per stated requirement, in statement order ────────────────
  const slots: ReadinessSlot[] = [];
  for (let index = 0; index < statements.length; index += 1) {
    const excluded = exclusions.get(index);
    if (excluded !== undefined) {
      slots.push({
        statement: statements[index].locator,
        admissibility: "inadmissible",
        reason: excluded,
      });
      continue;
    }
    slots.push({
      statement: statements[index].locator,
      admissibility: "evaluated",
      evaluationId: evaluationIdByStatement.get(index)!,
    });
  }

  // ── The distinct sources the evaluations trace to, first-seen order ──────
  const sourceIds: ReadinessSourceRef[] = [];
  for (const evaluation of evaluations) {
    for (const reference of evaluation.references) {
      if (isNonEmptyString(reference.sourceId) && !sourceIds.includes(reference.sourceId)) {
        sourceIds.push(reference.sourceId);
      }
    }
  }

  const standing = readinessStandingFor(evaluations);
  const blockers = evaluations.filter((evaluation) => isBlockingReadinessEvaluation(evaluation));
  const requiredUnmet = blockers.filter((evaluation) => evaluation.verdict === "unmet").length;
  const requiredIndeterminate = blockers.length - requiredUnmet;
  if (requiredUnmet > 0) {
    issues.push(
      readinessWarning(
        "unmet_requirements",
        `${requiredUnmet} required statement(s) stand unmet — readiness is blocked, described, never waived`,
        "evaluations",
      ),
    );
  }
  if (requiredIndeterminate > 0) {
    issues.push(
      readinessWarning(
        "undetermined_requirements",
        `${requiredIndeterminate} required statement(s) could not be judged from the supplied inputs`,
        "evaluations",
      ),
    );
  }
  const advisoriesUnmet = evaluations.filter(
    (evaluation) => isAdvisoryReadinessEvaluation(evaluation) && evaluation.verdict !== "met",
  ).length;
  if (advisoriesUnmet > 0) {
    issues.push(
      readinessWarning(
        "unmet_recommendations",
        `${advisoriesUnmet} recommended statement(s) stand unmet or unjudged — advisory only`,
        "evaluations",
      ),
    );
  }

  const described: ReadinessReport = {
    id: reportId,
    projectId,
    projectSlug: slug,
    standing,
    evaluations,
    slots,
    sourceIds,
  };
  if (batch !== undefined) described.batch = batch;
  if (profileId !== undefined) described.profileId = profileId;
  if (now !== undefined) described.describedAt = now;

  // The report is deep-copied at this boundary so a result never aliases the
  // context's record, report, or sources, or the request's statements:
  // mutating a described report can never reach back into the caller's
  // values. A part that cannot even be copied is reported, never thrown out
  // of.
  let copied: ReadinessReport;
  try {
    copied = structuredClone(described);
  } catch {
    return failure(
      readinessError(
        "uncloneable_report",
        "The described report holds values that cannot be copied for description",
        "report",
      ),
    );
  }

  // One deterministic completion rule: each met statement completes, each
  // unmet or indeterminate statement is skipped (described, not settled),
  // and each inadmissible statement fails.
  const metCount = evaluations.filter((evaluation) => evaluation.verdict === "met").length;
  const unmetCount = evaluations.filter((evaluation) => evaluation.verdict === "unmet").length;
  const indeterminateCount = evaluations.filter(
    (evaluation) => evaluation.verdict === "indeterminate",
  ).length;
  const stats = {
    ...emptyReadinessStats(),
    stages: 1,
    steps: statements.length,
    completed: metCount,
    skipped: unmetCount + indeterminateCount,
    failed: exclusions.size,
  };

  const metadata: ReadinessRunMetadata = {
    reportId,
    projectId,
    requirementCount: statements.length,
    evaluationCount: evaluations.length,
    metCount,
    unmetCount,
    indeterminateCount,
    blockerCount: blockers.length,
  };
  if (now !== undefined) metadata.describedAt = now;

  return createReadinessResult({ data: [copied], issues, stats, metadata });
}
