/**
 * Project Knowledge definition (RC5.1) — the declarative seam that turns the
 * RC4.4–RC4.9 foundation chain into a per-project capability.
 *
 * RC5.0 proved the chain end-to-end for one project (Coralina) with the
 * orchestration hardcoded to that project. This module extracts the shape of
 * everything that was project-specific in that slice — identity, sources,
 * plan targets, facts, declared gaps, graph declarations, readiness profile,
 * and provenance strings — into one plain, declarative object. Onboarding a
 * project onto the foundation chain is now the act of stating a
 * {@link ProjectKnowledgeDefinition}; no orchestration code is written per
 * project.
 *
 * The definition carries STATEMENTS, never judgements: consensus, standings,
 * admissibility, and readiness verdicts still come exclusively from the
 * foundations when the engine (`buildProjectKnowledgeSlice`) runs the
 * definition through the chain. The anti-fabrication rule therefore lives
 * here structurally: a value a project's committed sources do not state must
 * not appear as a fact — it belongs in {@link ProjectKnowledgeDefinition.gaps}
 * so RC4.7 reports it as explicit `missing_information`.
 *
 * Like the foundations, this module is pure: no I/O, no clock, no network,
 * no persistence.
 */

import type { ExtractionFact, ExtractionFactType } from "@/features/forever-extraction-pipeline";
import type {
  KnowledgeEntityDeclaration,
  KnowledgeRelationDeclaration,
} from "@/features/forever-knowledge-graph";
import {
  isNonEmptyString,
  projectSourceError,
  type ProjectSourceDefinition,
  type ProjectSourceIssue,
} from "@/features/forever-project-sources";
import type { ReadinessProfile } from "@/features/forever-project-readiness";

/** A canonical field path a project's committed sources genuinely do not address. */
export interface ProjectKnowledgeGap {
  path: string;
  reason: string;
  /**
   * True when the project's committed intake record marks this gap an import
   * blocker (e.g. a manifest `SOURCE_PENDING` field). Readiness profiles
   * derive required gap statements from this flag so the two encodings
   * cannot drift.
   */
  manifestBlocker?: boolean;
}

/** One RC4.5 extraction plan target: a registered source and the fact types stated from it. */
export interface ProjectKnowledgePlanTarget {
  source: ProjectSourceDefinition;
  factTypes: ExtractionFactType[];
}

/**
 * Caller-stated identity and clocks. The foundations never read a wall
 * clock; `describedAt` is the definition's stated description instant, so
 * building the same definition twice yields byte-identical artifacts.
 */
export interface ProjectKnowledgeIdentity {
  projectSlug: string;
  projectId: string;
  /** The project name exactly as the canonical-record base states it. */
  projectName: string;
  /** ISO instant used as the stated clock for every chain stage. */
  describedAt: string;
}

/**
 * Provenance strings stamped onto the RC4.6 merge and timeline — stated by
 * the definition so the canonical record says who settled it and why, in the
 * project's own words.
 */
export interface ProjectKnowledgeProvenance {
  /** RC4.6 merge author, e.g. `"coralina-knowledge (RC5.0)"`. */
  mergeAuthor: string;
  /** RC4.6 merge reason, verbatim. */
  mergeReason: string;
  /** Description for the timeline `created` event. */
  createdNote: string;
}

/**
 * Optional page copy for the inspection view. Every field has an honest
 * generic default; projects state these to preserve their own wording
 * (e.g. which sources deliberately do not exist in their package).
 */
export interface ProjectKnowledgeCopy {
  /** Kicker above the page title, e.g. "Internal inspection — RC5.0 vertical slice". */
  kicker?: string;
  /** Intro paragraph under the page title. */
  intro?: string;
  /** Note under "Registered sources". */
  sourcesNote?: string;
  /** Note under "Missing information". */
  missingNote?: string;
  /** Note under "Readiness". */
  readinessNote?: string;
  /** Footer paragraph. */
  footer?: string;
}

/**
 * Everything the RC4.4→RC4.9 chain needs to know about one project, stated
 * declaratively. The engine adds NO parallel judgement logic on top of it.
 */
export interface ProjectKnowledgeDefinition {
  identity: ProjectKnowledgeIdentity;
  /** RC4.4 — every catalogued source artifact, in declared order. */
  sources: readonly ProjectSourceDefinition[];
  /** RC4.5 — extraction plan targets, only for fact types actually stated. */
  planTargets: readonly ProjectKnowledgePlanTarget[];
  /** RC4.5 — every source-backed fact, verbatim transcriptions only. */
  facts: readonly ExtractionFact[];
  /** RC4.7 — the field paths the sources genuinely do not state. */
  gaps: readonly ProjectKnowledgeGap[];
  /** RC4.8 — caller-declared entities, each grounded in a stated fact. */
  entities: readonly KnowledgeEntityDeclaration[];
  /** RC4.8 — caller-declared relations, each grounded in a stated fact. */
  relations: readonly KnowledgeRelationDeclaration[];
  /** RC4.9 — the caller-stated intake profile the record is judged against. */
  readinessProfile: ReadinessProfile;
  provenance: ProjectKnowledgeProvenance;
  copy?: ProjectKnowledgeCopy;
}

/**
 * One structural issue found in a stated definition — the chain's shared
 * issue shape (RC3.3 `SourceIssue` lineage), reused so definition issues can
 * flow through the same severity/code tooling every other foundation's
 * issues do.
 */
export type ProjectKnowledgeIssue = ProjectSourceIssue;

/**
 * The RC5.0 identity clocks are full ISO instants (`…T00:00:00.000Z`); the
 * check is strict because `describedAt` is stamped verbatim onto every chain
 * artifact — `Date.parse` alone would accept engine-dependent non-ISO forms.
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/**
 * Non-throwing structural validation of a stated definition, mirroring the
 * foundations' validation posture: report, never repair. The engine gates on
 * the returned errors (`buildProjectKnowledgeSlice` refuses a malformed
 * definition) because one invariant only this validator sees: RC4.7 silently
 * skips an expected path that a fact also states, so a stated-and-declared-
 * missing path would otherwise render a self-contradicting inspection.
 */
export function validateProjectKnowledgeDefinition(
  definition: ProjectKnowledgeDefinition,
): ProjectKnowledgeIssue[] {
  const issues: ProjectKnowledgeIssue[] = [];
  const { identity } = definition;
  if (!isNonEmptyString(identity.projectSlug)) {
    issues.push(
      projectSourceError(
        "missing_project_slug",
        "project slug must be stated",
        "identity.projectSlug",
      ),
    );
  }
  if (!isNonEmptyString(identity.projectId)) {
    issues.push(
      projectSourceError("missing_project_id", "project id must be stated", "identity.projectId"),
    );
  }
  if (!isNonEmptyString(identity.projectName)) {
    issues.push(
      projectSourceError(
        "missing_project_name",
        "project name must be stated",
        "identity.projectName",
      ),
    );
  }
  if (!ISO_INSTANT.test(identity.describedAt)) {
    issues.push(
      projectSourceError(
        "invalid_described_at",
        `describedAt must be a full ISO instant (e.g. 2026-07-12T00:00:00.000Z), got "${identity.describedAt}"`,
        "identity.describedAt",
      ),
    );
  }
  if (definition.sources.length === 0) {
    issues.push(
      projectSourceError("missing_sources", "at least one source must be registered", "sources"),
    );
  }

  const sourceIds = new Set(definition.sources.map((source) => source.identity.id));
  definition.sources.forEach((source, index) => {
    if (source.identity.projectId !== identity.projectId) {
      issues.push(
        projectSourceError(
          "source_project_mismatch",
          `source ${source.identity.id} belongs to project "${source.identity.projectId}", not "${identity.projectId}"`,
          `sources[${index}]`,
        ),
      );
    }
  });
  definition.planTargets.forEach((target, index) => {
    if (!sourceIds.has(target.source.identity.id)) {
      issues.push(
        projectSourceError(
          "plan_target_unregistered_source",
          `plan target source ${target.source.identity.id} is not a registered source`,
          `planTargets[${index}]`,
        ),
      );
    }
    if (target.factTypes.length === 0) {
      issues.push(
        projectSourceError(
          "plan_target_missing_fact_types",
          "a plan target must state at least one fact type",
          `planTargets[${index}].factTypes`,
        ),
      );
    }
  });
  definition.facts.forEach((fact, index) => {
    if (!sourceIds.has(fact.sourceId)) {
      issues.push(
        projectSourceError(
          "fact_unregistered_source",
          `fact ${fact.id} cites unregistered source ${fact.sourceId}`,
          `facts[${index}]`,
        ),
      );
    }
    if (fact.projectId !== identity.projectId) {
      issues.push(
        projectSourceError(
          "fact_project_mismatch",
          `fact ${fact.id} belongs to project "${fact.projectId}", not "${identity.projectId}"`,
          `facts[${index}]`,
        ),
      );
    }
  });

  const statedPaths = new Set(
    definition.facts.map((fact) => fact.fieldPath).filter((path) => path !== undefined),
  );
  definition.gaps.forEach((gap, index) => {
    if (!isNonEmptyString(gap.path)) {
      issues.push(
        projectSourceError(
          "missing_gap_path",
          "a gap must state its field path",
          `gaps[${index}].path`,
        ),
      );
    }
    if (!isNonEmptyString(gap.reason)) {
      issues.push(
        projectSourceError(
          "missing_gap_reason",
          "a gap must state its reason",
          `gaps[${index}].reason`,
        ),
      );
    }
    if (statedPaths.has(gap.path)) {
      issues.push(
        projectSourceError(
          "gap_also_stated",
          `"${gap.path}" is declared missing but a fact states it — a path cannot be both`,
          `gaps[${index}]`,
        ),
      );
    }
  });

  if (!isNonEmptyString(definition.provenance.mergeAuthor)) {
    issues.push(
      projectSourceError(
        "missing_merge_author",
        "merge author must be stated",
        "provenance.mergeAuthor",
      ),
    );
  }
  if (!isNonEmptyString(definition.provenance.mergeReason)) {
    issues.push(
      projectSourceError(
        "missing_merge_reason",
        "merge reason must be stated",
        "provenance.mergeReason",
      ),
    );
  }
  if (!isNonEmptyString(definition.provenance.createdNote)) {
    issues.push(
      projectSourceError(
        "missing_created_note",
        "created note must be stated",
        "provenance.createdNote",
      ),
    );
  }
  return issues;
}
