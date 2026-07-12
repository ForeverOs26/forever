/**
 * Forever Knowledge Graph — the graph model and the deterministic
 * description engine.
 *
 * This is the engine of RC4.8: {@link describeKnowledgeGraph} takes the RC4.4
 * registered sources, the RC4.6 canonical record and described merge, and the
 * RC4.7 cross-source validation report a caller has in hand, plus a batch of
 * RC4.5 extracted facts and the caller's grounded entity and relation
 * declarations, and *describes* the knowledge graph they add up to: which
 * identities exist, which relationships the underlying artifacts themselves
 * declare, which relationships the caller states, and what the graph actually
 * knows about each statement. It is a pure function: no clock, no randomness,
 * no IO, no hidden state — identical context and request always yield an
 * identical graph, and the inputs are never mutated or aliased.
 *
 * Nothing is ever resolved: a disputed claim keeps every side standing as its
 * own claim node with `contradicts` edges between them, a superseded reading
 * stays in the graph marked `stale`, and a stated absence stays `unavailable`.
 * Nothing is ever invented: every node and edge carries references back to
 * the artifact or declaration that states it, entity identities enter only as
 * caller declarations (RC4.8 performs no identity resolution), a standing
 * above `unverified` exists only because a reused RC4.5 status or RC4.7
 * consensus states it, and a timestamp appears only because the caller
 * supplied one. Claim signatures are the reused RC4.6 value fingerprint
 * carried through the RC4.7 reading bridge, so what this graph calls one
 * reading can never disagree with what the canonical merge or the
 * cross-source examination calls one reading.
 */

import type { CrossValidationConsensus } from "@/features/forever-cross-validation";
import { crossSourceReadingSignature } from "@/features/forever-cross-validation";
import type { ISODateTime, Slug } from "@/features/forever-database";
import {
  extractionFactSubjectKey,
  isKnownExtractionFactType,
  validateExtractionConfidence,
} from "@/features/forever-extraction-pipeline";
import type { ProjectSourceDefinition } from "@/features/forever-project-sources";

import type { KnowledgeGraphContext } from "./context";
import type { KnowledgeEntityDeclaration, KnowledgeRelationDeclaration } from "./declaration";
import type { KnowledgeEdge, KnowledgeEdgeKind, KnowledgeEdgeOptions } from "./edge";
import {
  KNOWLEDGE_EDGE_ENDPOINTS,
  isDeclarableKnowledgeEdgeKind,
  knowledgeEdge,
  sortKnowledgeEdges,
} from "./edge";
import { compareKnowledgeStrings, isAbsent, isNonEmptyString } from "./helpers";
import {
  knowledgeEdgeIdFor,
  knowledgeGraphIdFor,
  knowledgeNodeIdFor,
  knowledgeProjectId,
  normalizeKnowledgeSlug,
} from "./identity";
import type { KnowledgeNode, KnowledgeNodeKind, KnowledgeNodeOptions } from "./node";
import { isKnownKnowledgeEntityKind, knowledgeNode, sortKnowledgeNodes } from "./node";
import type { KnowledgeRef } from "./reference";
import { isAnchoredKnowledgeRef } from "./reference";
import { validateKnowledgeRef } from "./validation/reference";
import { createKnowledgeGraphResult, emptyKnowledgeGraphStats } from "./result";
import type { KnowledgeGraphResult, KnowledgeGraphRunMetadata } from "./result";
import type { KnowledgeStanding } from "./standing";
import { knowledgeStandingForConsensus, knowledgeStandingRequiresReview } from "./standing";
import { isKnowledgeStructuredValue, knowledgeError, knowledgeWarning } from "./types";
import type { KnowledgeFact, KnowledgeIssue, KnowledgeSourceRef } from "./types";
import { isWellFormedKnowledgeSourceVersion } from "./version";

/**
 * The request one knowledge graph is described from.
 *
 * Only the verified project slug is required. The optional batch is a
 * caller-stated discriminator that participates in the graph id so repeated
 * descriptions of one project never collide — stated, never invented. Facts
 * are the reused RC4.5 shape; entities and relations are the caller's
 * grounded declarations.
 */
export interface KnowledgeGraphRequest {
  /** The verified slug of the project the graph belongs to. */
  projectSlug: string;
  /** Caller-stated batch discriminator, when the caller distinguishes runs. */
  batch?: string;
  /** The incoming RC4.5 extracted facts to represent, in input order. */
  facts?: KnowledgeFact[];
  /** The caller's grounded entity declarations, in input order. */
  entities?: KnowledgeEntityDeclaration[];
  /** The caller's grounded relation declarations, in input order. */
  relations?: KnowledgeRelationDeclaration[];
}

/** The full description of one project knowledge graph. */
export interface KnowledgeGraph {
  /** Stable surrogate id, e.g. `kgr_coralina` or `kgr_coralina-2026-07`. */
  id: string;
  /** Canonical id of the project, e.g. `proj_coralina`. */
  projectId: string;
  /** The verified, normalized project slug, e.g. `coralina`. */
  projectSlug: Slug;
  /** The caller-stated batch discriminator, when one was stated. */
  batch?: string;
  /** Every node, in the module's one deterministic order. */
  nodes: KnowledgeNode[];
  /** Every edge, in the module's one deterministic order. */
  edges: KnowledgeEdge[];
  /** The distinct RC4.4 sources the graph speaks about, in node order. */
  sourceIds: KnowledgeSourceRef[];
  /** When the graph was described, supplied by the caller. */
  describedAt?: ISODateTime;
}

// ── Pure query helpers over a described graph ───────────────────────────────

/** The node of one kind and canonical key, or `undefined`. */
export function findKnowledgeNode(
  graph: KnowledgeGraph,
  kind: KnowledgeNodeKind,
  key: string,
): KnowledgeNode | undefined {
  return (Array.isArray(graph?.nodes) ? graph.nodes : []).find(
    (node) => node?.kind === kind && node?.key === key,
  );
}

/** Every node of one kind, in the graph's node order. */
export function listKnowledgeNodesByKind(
  graph: KnowledgeGraph,
  kind: KnowledgeNodeKind,
): KnowledgeNode[] {
  return (Array.isArray(graph?.nodes) ? graph.nodes : []).filter((node) => node?.kind === kind);
}

/** Every edge of one kind, in the graph's edge order. */
export function listKnowledgeEdgesByKind(
  graph: KnowledgeGraph,
  kind: KnowledgeEdgeKind,
): KnowledgeEdge[] {
  return (Array.isArray(graph?.edges) ? graph.edges : []).filter((edge) => edge?.kind === kind);
}

/** Every edge pointing from a node, in the graph's edge order. */
export function listKnowledgeEdgesFrom(graph: KnowledgeGraph, nodeId: string): KnowledgeEdge[] {
  return (Array.isArray(graph?.edges) ? graph.edges : []).filter((edge) => edge?.fromId === nodeId);
}

/** Every edge pointing to a node, in the graph's edge order. */
export function listKnowledgeEdgesTo(graph: KnowledgeGraph, nodeId: string): KnowledgeEdge[] {
  return (Array.isArray(graph?.edges) ? graph.edges : []).filter((edge) => edge?.toId === nodeId);
}

/** Every claim node of one reused RC4.5 subject key, in the graph's node order. */
export function listKnowledgeClaims(graph: KnowledgeGraph, subjectKey: string): KnowledgeNode[] {
  return (Array.isArray(graph?.nodes) ? graph.nodes : []).filter(
    (node) => node?.kind === "claim" && node?.subjectKey === subjectKey,
  );
}

/** The ids of the sources with a `supports` edge to a claim, in edge order. */
export function listKnowledgeSourcesSupportingClaim(
  graph: KnowledgeGraph,
  claimNodeId: string,
): string[] {
  const sourceNodeIds = new Set(listKnowledgeNodesByKind(graph, "source").map((node) => node.id));
  const supporters: string[] = [];
  for (const edge of listKnowledgeEdgesByKind(graph, "supports")) {
    if (edge.toId === claimNodeId && sourceNodeIds.has(edge.fromId)) {
      if (!supporters.includes(edge.fromId)) supporters.push(edge.fromId);
    }
  }
  return supporters;
}

/**
 * The ids of the sources that stand against a claim: sources supporting a
 * claim the given claim `contradicts` (in either direction). A derived
 * answer over described edges — the graph itself never says "X is wrong",
 * it says "X and Y contradict each other and these sources stand behind Y".
 */
export function listKnowledgeSourcesContradictingClaim(
  graph: KnowledgeGraph,
  claimNodeId: string,
): string[] {
  const opposing = new Set<string>();
  for (const edge of listKnowledgeEdgesByKind(graph, "contradicts")) {
    if (edge.fromId === claimNodeId) opposing.add(edge.toId);
    if (edge.toId === claimNodeId) opposing.add(edge.fromId);
  }
  const contradicting: string[] = [];
  for (const opposingClaimId of opposing) {
    for (const sourceId of listKnowledgeSourcesSupportingClaim(graph, opposingClaimId)) {
      if (!contradicting.includes(sourceId)) contradicting.push(sourceId);
    }
  }
  return contradicting;
}

/** Every claim whose standing marks an unresolved disagreement, in node order. */
export function listKnowledgeClaimsRequiringReview(graph: KnowledgeGraph): KnowledgeNode[] {
  return (Array.isArray(graph?.nodes) ? graph.nodes : []).filter(
    (node) =>
      node?.kind === "claim" &&
      node.standing !== undefined &&
      knowledgeStandingRequiresReview(node.standing),
  );
}

/** Every edge whose standing marks an unresolved disagreement, in edge order. */
export function listKnowledgeEdgesRequiringReview(graph: KnowledgeGraph): KnowledgeEdge[] {
  return (Array.isArray(graph?.edges) ? graph.edges : []).filter(
    (edge) => edge?.standing !== undefined && knowledgeStandingRequiresReview(edge.standing),
  );
}

/** Whether any node or edge of a graph marks an unresolved disagreement. */
export function knowledgeGraphRequiresReview(graph: KnowledgeGraph): boolean {
  return (
    listKnowledgeClaimsRequiringReview(graph).length > 0 ||
    listKnowledgeEdgesRequiringReview(graph).length > 0
  );
}

// ── The description engine ──────────────────────────────────────────────────

/** An edge not yet assigned its deterministic id. */
interface DraftEdge {
  kind: KnowledgeEdgeKind;
  fromId: string;
  toId: string;
  origin: "derived" | "declared";
  standing: KnowledgeStanding;
  options: KnowledgeEdgeOptions;
}

/** One representable input fact with its derived views. */
interface RepresentedFact {
  fact: KnowledgeFact;
  subjectKey: string;
  signature: string;
}

/**
 * Describe the knowledge graph a project's artifacts and declarations add up
 * to.
 *
 * Pure and deterministic: it mutates neither the context nor the request,
 * performs no IO, and never throws — an absent request, a malformed list, a
 * malformed registered source, or a deeply malformed fact is reported as
 * issues on the result, never dereferenced or thrown out of. What the engine
 * derives:
 *
 * - a `project` node, and `source` nodes for every accepted registered
 *   source (with `describes` edges to the project) and for every source a
 *   fact names (grounded in the fact that names it, warned as unregistered
 *   when a registry was supplied but does not hold it);
 * - RC4.4 relationship edges (`supersedes`, `derived_from`, `translation_of`,
 *   `related_to`) exactly as each source definition declares them;
 * - `fact` nodes for every representable fact, `extracted_from` edges to
 *   their sources, and `claim` nodes — one per distinct reused RC4.6 value
 *   signature per reused RC4.5 subject — with `states` edges from the facts,
 *   `supports` edges from the sources that state them, and `addresses` edges
 *   to the canonical fields they would settle into;
 * - `contradicts` edges between the claims of a subject **only** when the
 *   reused RC4.7 consensus judged that subject contested — signature
 *   difference alone never manufactures a contradiction, because the
 *   examination may have judged the readings incomparable instead;
 * - `field` and `revision` nodes from the RC4.6 record, `supports` edges
 *   from the facts its values settled from, `supersedes` edges along the
 *   declared value and revision chains, and `conflicts_with` edges for the
 *   RC4.6 merge's unresolved conflicts and the facts' own declared
 *   conflicts;
 * - `finding` nodes from the RC4.7 report with `affects` edges to the
 *   facts, sources, fields, and claims their references name;
 * - entity nodes and domain edges **only** from the caller's grounded
 *   declarations — an ungrounded or unresolvable declaration is excluded
 *   with a structured issue, never repaired or invented.
 *
 * Standings never exceed the evidence: `corroborated` and `disputed` trace
 * to the reused RC4.7 consensus, `stale` and `unavailable` to the reused
 * RC4.5 statuses and RC4.6 value statuses, `missing` to subjects nothing
 * addresses, and everything else stays the explicit `unverified` default.
 *
 * The returned graph is deep-copied, so it never aliases the sources, the
 * record, the report, or the facts (anti-aliasing), and it always passes the
 * module's own {@link import("./validation/graph").validateKnowledgeGraph}
 * with no issues — the engine admits nothing its own validators would
 * reject.
 */
export function describeKnowledgeGraph(
  context: KnowledgeGraphContext,
  request: KnowledgeGraphRequest,
): KnowledgeGraphResult<KnowledgeGraph> {
  // The outer never-throw net: the description reads caller-supplied
  // structures, and a sufficiently hostile input (a throwing property
  // accessor, an exotic proxy) can fail in ways no structural guard
  // anticipates. Such input still settles into a structured failure result —
  // deterministically, for the same hostile behaviour — never a throw.
  try {
    return describeKnowledgeGraphGuarded(context, request);
  } catch {
    return createKnowledgeGraphResult({
      data: [],
      issues: [
        knowledgeError(
          "undescribable_input",
          "The request or context behaved in a way that could not be described",
          "request",
        ),
      ],
      stats: emptyKnowledgeGraphStats(),
      metadata: {
        nodeCount: 0,
        edgeCount: 0,
        factCount: 0,
        sourceCount: 0,
        claimCount: 0,
        unresolvedCount: 0,
      },
    });
  }
}

function describeKnowledgeGraphGuarded(
  context: KnowledgeGraphContext,
  request: KnowledgeGraphRequest,
): KnowledgeGraphResult<KnowledgeGraph> {
  const emptyCounts = {
    nodeCount: 0,
    edgeCount: 0,
    factCount: 0,
    sourceCount: 0,
    claimCount: 0,
    unresolvedCount: 0,
  };
  const failure = (issue: KnowledgeIssue): KnowledgeGraphResult<KnowledgeGraph> => {
    const metadata: KnowledgeGraphRunMetadata = { ...emptyCounts };
    if (isNonEmptyString(context?.now)) metadata.describedAt = context.now;
    return createKnowledgeGraphResult({
      data: [],
      issues: [issue],
      stats: emptyKnowledgeGraphStats(),
      metadata,
    });
  };

  if (isAbsent(request) || !isNonEmptyString(request.projectSlug)) {
    return failure(
      knowledgeError(
        "missing_graph_project",
        "Knowledge-graph request names no project to describe",
        "projectSlug",
      ),
    );
  }
  if (request.facts !== undefined && !Array.isArray(request.facts)) {
    return failure(
      knowledgeError(
        "invalid_graph_facts",
        "Knowledge-graph request declares a non-list facts value",
        "facts",
      ),
    );
  }
  if (request.entities !== undefined && !Array.isArray(request.entities)) {
    return failure(
      knowledgeError(
        "invalid_graph_entities",
        "Knowledge-graph request declares a non-list entities value",
        "entities",
      ),
    );
  }
  if (request.relations !== undefined && !Array.isArray(request.relations)) {
    return failure(
      knowledgeError(
        "invalid_graph_relations",
        "Knowledge-graph request declares a non-list relations value",
        "relations",
      ),
    );
  }

  const slug = normalizeKnowledgeSlug(request.projectSlug);
  if (slug === "") {
    return failure(
      knowledgeError(
        "missing_graph_project",
        "Knowledge-graph request names no usable project slug — nothing survives normalization",
        "projectSlug",
      ),
    );
  }

  const issues: KnowledgeIssue[] = [];
  const projectId = knowledgeProjectId(slug);
  let batch = isNonEmptyString(request.batch) ? request.batch : undefined;
  if (request.batch !== undefined && batch === undefined) {
    issues.push(
      knowledgeWarning(
        "invalid_graph_batch",
        "Knowledge-graph request declares an empty batch discriminator — ignored",
        "batch",
      ),
    );
  }
  // A batch that survives as prose but not as a slug would derive a malformed
  // graph id every all-punctuation batch collides onto — ignored and said so,
  // never silently truncated into the name.
  if (batch !== undefined && normalizeKnowledgeSlug(batch) === "") {
    issues.push(
      knowledgeWarning(
        "invalid_graph_batch",
        "Knowledge-graph request declares a batch discriminator nothing of which survives normalization — ignored",
        "batch",
      ),
    );
    batch = undefined;
  }
  const graphId = knowledgeGraphIdFor(slug, batch);
  // The caller's clock is honoured only when it is an actual timestamp
  // string; a stated-but-empty (or non-string) clock stamps nothing — a
  // timestamp is never fabricated from a malformed one.
  const now = isNonEmptyString(context?.now) ? context.now : undefined;
  if (context?.now !== undefined && now === undefined) {
    issues.push(
      knowledgeWarning(
        "invalid_graph_now",
        "Context declares a non-timestamp now value — nothing is stamped",
        "now",
      ),
    );
  }

  // ── Registered sources: read defensively, first registration wins ────────
  let sources: ProjectSourceDefinition[] | undefined;
  const rawSources = context?.sources;
  if (rawSources !== undefined && !Array.isArray(rawSources)) {
    issues.push(
      knowledgeWarning(
        "invalid_registered_sources",
        "Context declares a non-list sources value — described as if none were registered",
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
          knowledgeWarning(
            "malformed_registered_source",
            "Registered source carries no identity and cannot be represented",
            `sources.${index}`,
          ),
        );
        continue;
      }
      if (seenSourceIds.has(source.identity.id)) {
        issues.push(
          knowledgeWarning(
            "duplicate_registered_source",
            `Registered source "${source.identity.id}" appears more than once — the first registration resolves`,
            `sources.${index}`,
          ),
        );
        continue;
      }
      if (isNonEmptyString(source.identity.projectId) && source.identity.projectId !== projectId) {
        issues.push(
          knowledgeWarning(
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
  const sourceCount = sources?.length ?? 0;

  // ── Canonical record, merge, and report: accepted only for this project ──
  let record = context?.record;
  if (record !== undefined) {
    if (isAbsent(record) || typeof record !== "object") {
      issues.push(
        knowledgeWarning(
          "invalid_graph_record",
          "Context declares a non-object record value — described as if none existed",
          "record",
        ),
      );
      record = undefined;
    } else if (record.identity?.projectId !== projectId) {
      issues.push(
        knowledgeWarning(
          "foreign_record",
          `Context record belongs to "${String(record.identity?.projectId)}", not "${projectId}" — set aside`,
          "record",
        ),
      );
      record = undefined;
    }
  }

  let merge = context?.merge;
  if (merge !== undefined) {
    if (isAbsent(merge) || typeof merge !== "object") {
      issues.push(
        knowledgeWarning(
          "invalid_graph_merge",
          "Context declares a non-object merge value — described as if none existed",
          "merge",
        ),
      );
      merge = undefined;
    } else if (merge.projectId !== projectId) {
      issues.push(
        knowledgeWarning(
          "foreign_merge",
          `Context merge belongs to "${String(merge.projectId)}", not "${projectId}" — set aside`,
          "merge",
        ),
      );
      merge = undefined;
    }
  }

  let report = context?.report;
  if (report !== undefined) {
    if (isAbsent(report) || typeof report !== "object") {
      issues.push(
        knowledgeWarning(
          "invalid_graph_report",
          "Context declares a non-object report value — described as if none existed",
          "report",
        ),
      );
      report = undefined;
    } else if (report.projectId !== projectId) {
      issues.push(
        knowledgeWarning(
          "foreign_report",
          `Context report belongs to "${String(report.projectId)}", not "${projectId}" — set aside`,
          "report",
        ),
      );
      report = undefined;
    }
  }

  // The reused RC4.7 judgements, read defensively: consensus per subject,
  // the signatures the examination actually judged (so a consensus is never
  // stretched over a reading the examination never saw), the assessment's
  // finding trail, and the subject's declared field path.
  const consensusBySubject = new Map<string, CrossValidationConsensus>();
  const judgedSignaturesBySubject = new Map<string, Set<string>>();
  const findingIdsBySubject = new Map<string, string[]>();
  const fieldPathBySubject = new Map<string, string>();
  if (report !== undefined) {
    const assessments = Array.isArray(report.subjects) ? report.subjects : [];
    if (!Array.isArray(report.subjects)) {
      issues.push(
        knowledgeWarning(
          "invalid_report_subjects",
          "Context report declares a non-list subjects value — no consensus is read",
          "report.subjects",
        ),
      );
    }
    for (let index = 0; index < assessments.length; index += 1) {
      const assessment = assessments[index];
      const key = assessment?.subject?.key;
      if (!isNonEmptyString(key)) {
        issues.push(
          knowledgeWarning(
            "malformed_report_assessment",
            "Report assessment names no subject key — set aside",
            `report.subjects.${index}`,
          ),
        );
        continue;
      }
      if (consensusBySubject.has(key)) continue;
      consensusBySubject.set(key, assessment.consensus);
      if (Array.isArray(assessment.readings)) {
        const judged = new Set<string>();
        for (const reading of assessment.readings) {
          if (typeof reading?.signature === "string") judged.add(reading.signature);
        }
        judgedSignaturesBySubject.set(key, judged);
      }
      if (Array.isArray(assessment.findingIds)) {
        findingIdsBySubject.set(key, assessment.findingIds.filter(isNonEmptyString));
      }
      if (isNonEmptyString(assessment.subject?.fieldPath)) {
        fieldPathBySubject.set(key, assessment.subject.fieldPath);
      }
    }
  }

  // ── Fact intake: every input slot represents exactly once or is excluded ─
  const facts = Array.isArray(request.facts) ? request.facts : [];
  const represented: RepresentedFact[] = [];
  const factById = new Map<string, RepresentedFact>();
  let excludedCount = 0;
  const exclude = (index: number, reason: string) => {
    excludedCount += 1;
    issues.push(knowledgeError("unrepresentable_fact", reason, `facts.${index}`));
  };
  for (let index = 0; index < facts.length; index += 1) {
    const fact = facts[index];
    try {
      if (
        isAbsent(fact) ||
        !isNonEmptyString(fact.id) ||
        !isNonEmptyString(fact.projectId) ||
        !isNonEmptyString(fact.sourceId)
      ) {
        exclude(index, "Incoming fact is malformed: it carries no id, project, or source");
        continue;
      }
      if (factById.has(fact.id)) {
        exclude(index, `Incoming fact "${fact.id}" is already represented in this batch`);
        continue;
      }
      if (fact.projectId !== projectId) {
        exclude(index, `Incoming fact belongs to "${fact.projectId}", not "${projectId}"`);
        continue;
      }
      if (!isKnownExtractionFactType(fact.factType)) {
        exclude(
          index,
          "Incoming fact declares no known fact type and cannot be represented by subject",
        );
        continue;
      }
      if (fact.fieldPath !== undefined && !isNonEmptyString(fact.fieldPath)) {
        exclude(index, "Incoming fact declares an empty or non-string field path");
        continue;
      }
      if (fact.structuredValue !== undefined && !isKnowledgeStructuredValue(fact.structuredValue)) {
        exclude(index, "Incoming fact carries a malformed structured value");
        continue;
      }
      // Copied at intake, so one uncloneable part excludes this slot alone —
      // never the whole batch — and a fact that turns hostile after intake
      // can no longer reach the description.
      const safe = structuredClone(fact);
      const entry: RepresentedFact = {
        fact: safe,
        subjectKey: extractionFactSubjectKey(safe),
        // The reused RC4.7 bridge over the reused RC4.6 signature rule — the
        // very fingerprint the canonical merge compares by. Total: an exotic
        // value collapses to a stable marker instead of throwing.
        signature: crossSourceReadingSignature(safe),
      };
      represented.push(entry);
      factById.set(safe.id, entry);
    } catch {
      exclude(index, "Incoming fact behaved in a way that could not be represented or copied");
    }
  }

  // The reused RC4.5 confidence, attached only where the fact stated a
  // coherent one — a garbled grade is never propagated as if it resolved.
  const coherentConfidence = (fact: KnowledgeFact) =>
    !isAbsent(fact.confidence) && validateExtractionConfidence(fact.confidence).length === 0
      ? fact.confidence
      : undefined;

  // The reused RC4.5 status, mapped to the standing it states — and nothing
  // more: `superseded` is stale knowledge, `unavailable` is a stated absence,
  // and `disputed` is the extraction pipeline's own declared disagreement.
  const factStatusStanding = (fact: KnowledgeFact): KnowledgeStanding | undefined => {
    if (fact.status === "superseded") return "stale";
    if (fact.status === "unavailable") return "unavailable";
    if (fact.status === "disputed") return "disputed";
    return undefined;
  };

  // ── Node assembly ─────────────────────────────────────────────────────────
  const nodesByKindKey = new Map<string, KnowledgeNode>();
  const usedNodeIds = new Set<string>();
  const nodeKey = (kind: KnowledgeNodeKind, key: string) => `${kind}\u0000${key}`;
  const ensureNode = (
    kind: KnowledgeNodeKind,
    key: string,
    options: KnowledgeNodeOptions,
  ): KnowledgeNode => {
    const existing = nodesByKindKey.get(nodeKey(kind, key));
    if (existing !== undefined) return existing;
    // The reused slug rule is lossy, so two distinct canonical keys can
    // derive one id. Distinct identities are never silently conflated: a
    // colliding id is deterministically disambiguated by ordinal and the
    // collision is reported — never merged, never thrown.
    let id = knowledgeNodeIdFor(slug, kind, key);
    if (usedNodeIds.has(id)) {
      issues.push(
        knowledgeWarning(
          "colliding_node_identity",
          `Two distinct ${kind} keys derive the node id "${id}" under the reused slug rule — disambiguated by ordinal`,
          "graph",
        ),
      );
      const base = id;
      for (let ordinal = 2; usedNodeIds.has(id); ordinal += 1) {
        id = `${base}-${ordinal}`;
      }
    }
    usedNodeIds.add(id);
    const node = knowledgeNode(id, kind, key, projectId, options);
    nodesByKindKey.set(nodeKey(kind, key), node);
    return node;
  };

  // The project node — the one node every graph carries.
  const projectNodeOptions: KnowledgeNodeOptions = { refs: [{ projectId }] };
  if (record !== undefined && isNonEmptyString(record.identity?.name)) {
    projectNodeOptions.label = record.identity.name;
  }
  const projectNode = ensureNode("project", slug, projectNodeOptions);

  // Source nodes from the registry — the RC4.4 definition is the ground.
  for (const definition of sources ?? []) {
    const ref: KnowledgeRef = { sourceId: definition.identity.id };
    if (isWellFormedKnowledgeSourceVersion(definition.version)) {
      ref.sourceVersion = definition.version;
    }
    const options: KnowledgeNodeOptions = { refs: [ref] };
    if (isNonEmptyString(definition.identity.name)) options.label = definition.identity.name;
    ensureNode("source", definition.identity.id, options);
  }

  // Field and revision nodes from the canonical record.
  if (record !== undefined) {
    const recordFields = Array.isArray(record.fields) ? record.fields : [];
    if (!Array.isArray(record.fields)) {
      issues.push(
        knowledgeWarning(
          "invalid_record_fields",
          "Context record declares a non-list fields value — no field nodes are described",
          "record.fields",
        ),
      );
    }
    for (let index = 0; index < recordFields.length; index += 1) {
      const field = recordFields[index];
      if (isAbsent(field) || !isNonEmptyString(field.path)) {
        issues.push(
          knowledgeWarning(
            "malformed_record_field",
            "Record field declares no path and cannot be represented",
            `record.fields.${index}`,
          ),
        );
        continue;
      }
      const ref: KnowledgeRef = { path: field.path };
      if (isNonEmptyString(field.id)) ref.fieldId = field.id;
      const options: KnowledgeNodeOptions = { refs: [ref] };
      if (isNonEmptyString(field.name)) options.label = field.name;
      ensureNode("field", field.path, options);
    }

    const recordRevisions = Array.isArray(record.revisions) ? record.revisions : [];
    if (!Array.isArray(record.revisions)) {
      issues.push(
        knowledgeWarning(
          "invalid_record_revisions",
          "Context record declares a non-list revisions value — no revision nodes are described",
          "record.revisions",
        ),
      );
    }
    for (let index = 0; index < recordRevisions.length; index += 1) {
      const revision = recordRevisions[index];
      if (isAbsent(revision) || !isNonEmptyString(revision.id)) {
        issues.push(
          knowledgeWarning(
            "malformed_record_revision",
            "Record revision declares no id and cannot be represented",
            `record.revisions.${index}`,
          ),
        );
        continue;
      }
      ensureNode("revision", revision.id, {
        refs: [{ revisionId: revision.id, projectId }],
      });
    }
  }

  // Fact nodes — and source nodes for the sources facts name. A source the
  // caller registered resolves to its registered node; a source the caller
  // did not register is represented as the facts' own statement — grounded in
  // *every* fact that names it, in sorted fact-id order, so the node's
  // content never depends on batch order — and, when a registry was
  // supplied, reported as unregistered.
  const namingFactIds = new Map<string, string[]>();
  for (const { fact } of represented) {
    const factRef: KnowledgeRef = { factId: fact.id, sourceId: fact.sourceId };
    if (isWellFormedKnowledgeSourceVersion(fact.sourceVersion)) {
      factRef.sourceVersion = fact.sourceVersion;
    }
    ensureNode("fact", fact.id, { refs: [factRef] });
    if (nodesByKindKey.get(nodeKey("source", fact.sourceId)) === undefined) {
      const naming = namingFactIds.get(fact.sourceId);
      if (naming === undefined) namingFactIds.set(fact.sourceId, [fact.id]);
      else naming.push(fact.id);
    }
  }
  for (const sourceId of [...namingFactIds.keys()].sort(compareKnowledgeStrings)) {
    const naming = namingFactIds.get(sourceId)!.sort(compareKnowledgeStrings);
    ensureNode("source", sourceId, {
      refs: naming.map((factId) => ({ sourceId, factId })),
    });
    if (sources !== undefined) {
      issues.push(
        knowledgeWarning(
          "unregistered_source",
          `Facts trace to "${sourceId}", which is not among the registered sources — represented as the facts' own statement`,
          "facts",
        ),
      );
    }
  }

  // Claim nodes: one per distinct reused value signature per reused subject.
  const factsBySubject = new Map<string, RepresentedFact[]>();
  for (const entry of represented) {
    const group = factsBySubject.get(entry.subjectKey);
    if (group === undefined) factsBySubject.set(entry.subjectKey, [entry]);
    else group.push(entry);
  }
  const subjectKeys = [...factsBySubject.keys()].sort(compareKnowledgeStrings);
  const claimKeyByFactId = new Map<string, string>();
  const claimStandingByKey = new Map<string, KnowledgeStanding>();
  // Whether the reused RC4.7 assessment actually judged this exact reading:
  // the consensus is applied to a claim only when the claim's signature is
  // among the signatures the examination recorded — a judgement is never
  // stretched over a reading the examination never saw.
  const consensusJudged = (subjectKey: string, signature: string): boolean => {
    const judged = judgedSignaturesBySubject.get(subjectKey);
    return judged !== undefined && judged.has(signature);
  };
  const claimStanding = (
    statingFacts: readonly KnowledgeFact[],
    consensus: CrossValidationConsensus | undefined,
  ): KnowledgeStanding => {
    if (consensus !== undefined) {
      const mapped = knowledgeStandingForConsensus(consensus);
      // A judged disagreement outranks staleness — an unresolved dispute
      // must never slip out of the review set just because its readings
      // aged.
      if (knowledgeStandingRequiresReview(mapped)) return mapped;
      if (statingFacts.length > 0 && statingFacts.every((fact) => fact.status === "superseded")) {
        return "stale";
      }
      return mapped;
    }
    if (statingFacts.length > 0 && statingFacts.every((fact) => fact.status === "superseded")) {
      return "stale";
    }
    if (statingFacts.length > 0 && statingFacts.every((fact) => fact.status === "disputed")) {
      return "disputed";
    }
    if (statingFacts.length > 0 && statingFacts.every((fact) => fact.status === "unavailable")) {
      return "unavailable";
    }
    return "unverified";
  };
  for (const subjectKey of subjectKeys) {
    const group = factsBySubject.get(subjectKey)!;
    const signatures = [...new Set(group.map((entry) => entry.signature))].sort(
      compareKnowledgeStrings,
    );
    const consensus = consensusBySubject.get(subjectKey);
    signatures.forEach((signature, index) => {
      const claimKey = `${subjectKey}#${index + 1}`;
      const stating = group.filter((entry) => entry.signature === signature);
      const statingIds = stating.map((entry) => entry.fact.id).sort(compareKnowledgeStrings);
      for (const factId of statingIds) claimKeyByFactId.set(factId, claimKey);
      const standing = claimStanding(
        stating.map((entry) => entry.fact),
        consensusJudged(subjectKey, signature) ? consensus : undefined,
      );
      claimStandingByKey.set(claimKey, standing);
      ensureNode("claim", claimKey, {
        subjectKey,
        signature,
        standing,
        refs: [{ subjectKey }, ...statingIds.map((factId) => ({ factId }))],
      });
    });
  }

  // Claims for subjects the report assessed but no representable fact
  // states — the examination's own statement that knowledge is missing (or
  // was judged over readings the caller did not resend). Stated, not
  // invented: the claim carries no signature because nothing stated one. The
  // reserved `#0` ordinal keeps these keys disjoint from the fact-stated
  // claims' `#1`..`#n` even when a hostile subject key itself contains `#`.
  const assessedOnlyClaimKey = (subjectKey: string) => `${subjectKey}#0`;
  const assessedOnly = [...consensusBySubject.keys()]
    .filter((subjectKey) => !factsBySubject.has(subjectKey))
    .sort(compareKnowledgeStrings);
  for (const subjectKey of assessedOnly) {
    const standing = knowledgeStandingForConsensus(consensusBySubject.get(subjectKey)!);
    claimStandingByKey.set(assessedOnlyClaimKey(subjectKey), standing);
    ensureNode("claim", assessedOnlyClaimKey(subjectKey), {
      subjectKey,
      standing,
      refs: [
        { subjectKey },
        ...(findingIdsBySubject.get(subjectKey) ?? []).map((findingId) => ({ findingId })),
      ],
    });
  }

  // Finding nodes from the report, read defensively.
  interface AcceptedFinding {
    id: string;
    subjectKey?: string;
    references: KnowledgeRef[];
  }
  const acceptedFindings: AcceptedFinding[] = [];
  if (report !== undefined) {
    const reportFindings = Array.isArray(report.findings) ? report.findings : [];
    if (!Array.isArray(report.findings)) {
      issues.push(
        knowledgeWarning(
          "invalid_report_findings",
          "Context report declares a non-list findings value — no finding nodes are described",
          "report.findings",
        ),
      );
    }
    for (let index = 0; index < reportFindings.length; index += 1) {
      const finding = reportFindings[index];
      if (isAbsent(finding) || !isNonEmptyString(finding.id)) {
        issues.push(
          knowledgeWarning(
            "malformed_report_finding",
            "Report finding declares no id and cannot be represented",
            `report.findings.${index}`,
          ),
        );
        continue;
      }
      const references: KnowledgeRef[] = [];
      for (const reference of Array.isArray(finding.references) ? finding.references : []) {
        if (isAbsent(reference)) continue;
        const ref: KnowledgeRef = {};
        if (isNonEmptyString(reference.factId)) ref.factId = reference.factId;
        if (isNonEmptyString(reference.sourceId)) ref.sourceId = reference.sourceId;
        if (isWellFormedKnowledgeSourceVersion(reference.sourceVersion)) {
          ref.sourceVersion = reference.sourceVersion;
        }
        if (isNonEmptyString(reference.path)) ref.path = reference.path;
        if (isAnchoredKnowledgeRef(ref)) references.push(ref);
      }
      const accepted: AcceptedFinding = { id: finding.id, references };
      if (isNonEmptyString(finding.subjectKey)) accepted.subjectKey = finding.subjectKey;
      acceptedFindings.push(accepted);
      ensureNode("finding", finding.id, {
        refs: [
          { findingId: finding.id },
          ...references,
          ...(accepted.subjectKey !== undefined ? [{ subjectKey: accepted.subjectKey }] : []),
        ],
      });
    }
  }

  // Field nodes for canonical paths only facts declare — the path is the
  // facts' own statement of where their reading would settle.
  for (const subjectKey of subjectKeys) {
    const group = factsBySubject.get(subjectKey)!;
    const fieldPath = group[0].fact.fieldPath;
    if (fieldPath === undefined) continue;
    if (nodesByKindKey.get(nodeKey("field", fieldPath)) === undefined) {
      const statingIds = group.map((entry) => entry.fact.id).sort(compareKnowledgeStrings);
      ensureNode("field", fieldPath, {
        refs: [{ path: fieldPath }, ...statingIds.map((factId) => ({ factId }))],
      });
    }
  }
  for (const subjectKey of assessedOnly) {
    const fieldPath = fieldPathBySubject.get(subjectKey);
    if (fieldPath === undefined) continue;
    if (nodesByKindKey.get(nodeKey("field", fieldPath)) === undefined) {
      ensureNode("field", fieldPath, { refs: [{ path: fieldPath, subjectKey }] });
    }
  }

  // Entity nodes from the caller's grounded declarations. Grounding is
  // admitted reference by reference through the module's own reference
  // validator, so the engine never emits a ref its own validation would
  // reject — an incoherent reference is dropped with a warning, and a
  // declaration left with no coherent reference is excluded, never invented.
  const coherentRefs = (refs: unknown, path: string): KnowledgeRef[] | undefined => {
    if (!Array.isArray(refs)) return undefined;
    const kept: KnowledgeRef[] = [];
    let dropped = 0;
    for (let index = 0; index < refs.length; index += 1) {
      const ref = refs[index] as KnowledgeRef;
      if (isAnchoredKnowledgeRef(ref) && validateKnowledgeRef(ref, "ref").length === 0) {
        kept.push(ref);
      } else {
        dropped += 1;
      }
    }
    if (dropped > 0) {
      issues.push(
        knowledgeWarning(
          "dropped_incoherent_ref",
          "Declaration carries references that anchor to nothing or are malformed — dropped from grounding",
          path,
        ),
      );
    }
    return kept.length > 0 ? kept : undefined;
  };
  const entities = Array.isArray(request.entities) ? request.entities : [];
  const seenEntityKeys = new Set<string>();
  for (let index = 0; index < entities.length; index += 1) {
    const path = `entities.${index}`;
    // Each declaration is copied and processed inside its own net, so one
    // hostile or uncloneable declaration excludes that declaration alone —
    // never the whole graph.
    try {
      const declaration = structuredClone(entities[index]);
      if (isAbsent(declaration)) {
        excludedCount += 1;
        issues.push(
          knowledgeError("malformed_entity_declaration", "Entity declaration is absent", path),
        );
        continue;
      }
      if (!isKnownKnowledgeEntityKind(declaration.kind)) {
        excludedCount += 1;
        issues.push(
          knowledgeError(
            "unknown_entity_kind",
            `Entity declaration states an unknown kind "${String(declaration.kind)}"`,
            `${path}.kind`,
          ),
        );
        continue;
      }
      if (!isNonEmptyString(declaration.slug)) {
        excludedCount += 1;
        issues.push(
          knowledgeError(
            "missing_entity_slug",
            "Entity declaration states no slug",
            `${path}.slug`,
          ),
        );
        continue;
      }
      const key = normalizeKnowledgeSlug(declaration.slug);
      if (key === "") {
        excludedCount += 1;
        issues.push(
          knowledgeError(
            "missing_entity_slug",
            "Entity declaration states no usable slug — nothing survives normalization",
            `${path}.slug`,
          ),
        );
        continue;
      }
      const refs = coherentRefs(declaration.refs, `${path}.refs`);
      if (refs === undefined) {
        excludedCount += 1;
        issues.push(
          knowledgeError(
            "ungrounded_entity",
            `Entity declaration "${key}" is grounded in no coherent reference — excluded, never invented`,
            `${path}.refs`,
          ),
        );
        continue;
      }
      if (seenEntityKeys.has(nodeKey(declaration.kind, key))) {
        issues.push(
          knowledgeWarning(
            "duplicate_entity_declaration",
            `Entity "${key}" is declared more than once — the first declaration resolves`,
            path,
          ),
        );
        continue;
      }
      seenEntityKeys.add(nodeKey(declaration.kind, key));
      const options: KnowledgeNodeOptions = { refs };
      if (isNonEmptyString(declaration.name)) options.label = declaration.name;
      ensureNode(declaration.kind, key, options);
    } catch {
      excludedCount += 1;
      issues.push(
        knowledgeError(
          "malformed_entity_declaration",
          "Entity declaration behaved in a way that could not be represented or copied",
          path,
        ),
      );
    }
  }

  // ── Edge assembly ─────────────────────────────────────────────────────────
  const drafts: DraftEdge[] = [];
  const draftKeys = new Set<string>();
  const draft = (
    kind: KnowledgeEdgeKind,
    fromId: string,
    toId: string,
    origin: "derived" | "declared",
    standing: KnowledgeStanding,
    options: KnowledgeEdgeOptions,
  ): boolean => {
    const key = `${kind}\u0000${fromId}\u0000${toId}`;
    if (draftKeys.has(key)) return false;
    draftKeys.add(key);
    drafts.push({ kind, fromId, toId, origin, standing, options });
    return true;
  };
  const nodeOf = (kind: KnowledgeNodeKind, key: string): KnowledgeNode | undefined =>
    nodesByKindKey.get(nodeKey(kind, key));

  // Source → project and the RC4.4 relationship chains, exactly as declared.
  for (const definition of sources ?? []) {
    const sourceId = definition.identity.id;
    const fromNode = nodeOf("source", sourceId)!;
    draft(
      "describes",
      fromNode.id,
      projectNode.id,
      "derived",
      definition.status === "superseded" ? "stale" : "unverified",
      {
        refs: [{ sourceId }],
      },
    );
    const relationships = definition.relationships;
    if (isAbsent(relationships)) continue;
    const relationshipEdge = (
      kind: KnowledgeEdgeKind,
      fromSourceId: string,
      toSourceId: string,
    ) => {
      if (fromSourceId === toSourceId) {
        issues.push(
          knowledgeWarning(
            "self_relationship_reference",
            `Registered source "${fromSourceId}" declares a ${kind} relationship to itself — set aside`,
            "sources",
          ),
        );
        return;
      }
      const from = ensureNode("source", fromSourceId, {
        refs: [{ sourceId: fromSourceId }],
      });
      const to = ensureNode("source", toSourceId, { refs: [{ sourceId: toSourceId }] });
      draft(kind, from.id, to.id, "derived", "unverified", {
        refs: [{ sourceId: fromSourceId }, { sourceId: toSourceId }],
      });
    };
    if (isNonEmptyString(relationships.supersedes)) {
      relationshipEdge("supersedes", sourceId, relationships.supersedes);
    }
    if (isNonEmptyString(relationships.supersededBy)) {
      relationshipEdge("supersedes", relationships.supersededBy, sourceId);
    }
    if (isNonEmptyString(relationships.derivedFrom)) {
      relationshipEdge("derived_from", sourceId, relationships.derivedFrom);
    }
    if (isNonEmptyString(relationships.translationOf)) {
      relationshipEdge("translation_of", sourceId, relationships.translationOf);
    }
    for (const related of Array.isArray(relationships.related) ? relationships.related : []) {
      if (isNonEmptyString(related)) relationshipEdge("related_to", sourceId, related);
    }
  }

  // Fact → source, fact → claim, and the facts' own declared chains.
  for (const { fact, subjectKey } of represented) {
    const factNode = nodeOf("fact", fact.id)!;
    const sourceNode = nodeOf("source", fact.sourceId)!;
    const statusStanding = factStatusStanding(fact);
    const confidence = coherentConfidence(fact);
    const factRef: KnowledgeRef = { factId: fact.id, sourceId: fact.sourceId };
    if (isWellFormedKnowledgeSourceVersion(fact.sourceVersion)) {
      factRef.sourceVersion = fact.sourceVersion;
    }
    const extractedOptions: KnowledgeEdgeOptions = { refs: [factRef] };
    if (confidence !== undefined) extractedOptions.confidence = confidence;
    draft(
      "extracted_from",
      factNode.id,
      sourceNode.id,
      "derived",
      statusStanding ?? "unverified",
      extractedOptions,
    );

    const claimKey = claimKeyByFactId.get(fact.id)!;
    const claimNode = nodeOf("claim", claimKey)!;
    const statesOptions: KnowledgeEdgeOptions = { refs: [{ factId: fact.id, subjectKey }] };
    if (confidence !== undefined) statesOptions.confidence = confidence;
    draft(
      "states",
      factNode.id,
      claimNode.id,
      "derived",
      statusStanding ?? claimStandingByKey.get(claimKey) ?? "unverified",
      statesOptions,
    );

    if (isNonEmptyString(fact.supersededBy) && fact.supersededBy !== fact.id) {
      const successor = ensureNode("fact", fact.supersededBy, {
        refs: [{ factId: fact.supersededBy }],
      });
      draft("supersedes", successor.id, factNode.id, "derived", "unverified", {
        refs: [{ factId: fact.supersededBy }, { factId: fact.id }],
      });
    }
    for (const other of Array.isArray(fact.conflictsWith) ? fact.conflictsWith : []) {
      if (!isNonEmptyString(other) || other === fact.id) continue;
      const otherNode = ensureNode("fact", other, { refs: [{ factId: other }] });
      draft("conflicts_with", factNode.id, otherNode.id, "derived", "disputed", {
        refs: [{ factId: fact.id }, { factId: other }],
      });
    }
    const derivedFrom = fact.provenance?.derivedFrom;
    for (const parent of Array.isArray(derivedFrom) ? derivedFrom : []) {
      if (!isNonEmptyString(parent) || parent === fact.id) continue;
      const parentNode = ensureNode("fact", parent, { refs: [{ factId: parent }] });
      draft("derived_from", factNode.id, parentNode.id, "derived", "unverified", {
        refs: [{ factId: fact.id }, { factId: parent }],
      });
    }
  }

  // Claim → field, source → claim, and claim ↔ claim contradiction — the
  // last only where the reused RC4.7 consensus judged the subject contested:
  // signature difference alone may be incomparability, and RC4.8 never
  // manufactures a contradiction the examination refused to judge.
  for (const subjectKey of subjectKeys) {
    const group = factsBySubject.get(subjectKey)!;
    const fieldPath = group[0].fact.fieldPath;
    const signatures = [...new Set(group.map((entry) => entry.signature))].sort(
      compareKnowledgeStrings,
    );
    const claimKeys = signatures.map((_, index) => `${subjectKey}#${index + 1}`);

    for (const claimKey of claimKeys) {
      const claimNode = nodeOf("claim", claimKey)!;
      if (fieldPath !== undefined) {
        const fieldNode = nodeOf("field", fieldPath)!;
        draft(
          "addresses",
          claimNode.id,
          fieldNode.id,
          "derived",
          claimStandingByKey.get(claimKey) ?? "unverified",
          { refs: [{ subjectKey, path: fieldPath }] },
        );
      }
    }

    // Source → claim support: the source stands behind the reading its own
    // facts state. Support from only superseded readings is stale support.
    // Grouped through a value-carrying map — the composite key is never
    // parsed back apart, so a hostile source id containing any separator can
    // never smear two groups into one.
    const bySourceAndClaim = new Map<
      string,
      { sourceId: string; claimKey: string; stating: RepresentedFact[] }
    >();
    for (const entry of group) {
      const claimKey = claimKeyByFactId.get(entry.fact.id)!;
      const key = `${entry.fact.sourceId}\u0000${claimKey}`;
      const existing = bySourceAndClaim.get(key);
      if (existing === undefined) {
        bySourceAndClaim.set(key, { sourceId: entry.fact.sourceId, claimKey, stating: [entry] });
      } else {
        existing.stating.push(entry);
      }
    }
    const supportKeys = [...bySourceAndClaim.keys()].sort(compareKnowledgeStrings);
    for (const key of supportKeys) {
      const { sourceId, claimKey, stating } = bySourceAndClaim.get(key)!;
      const sourceNode = nodeOf("source", sourceId)!;
      const claimNode = nodeOf("claim", claimKey)!;
      const standing = stating.every((entry) => entry.fact.status === "superseded")
        ? "stale"
        : (claimStandingByKey.get(claimKey) ?? "unverified");
      const statingIds = stating.map((entry) => entry.fact.id).sort(compareKnowledgeStrings);
      draft("supports", sourceNode.id, claimNode.id, "derived", standing, {
        refs: [{ sourceId }, ...statingIds.map((factId) => ({ factId }))],
      });
    }

    // Contradiction edges connect only the claims the examination actually
    // judged against each other: a reading the report never saw is neither
    // corroborated nor contradicted by it — it stays explicitly unverified.
    const contestedClaimKeys = claimKeys.filter((_, index) =>
      consensusJudged(subjectKey, signatures[index]),
    );
    if (consensusBySubject.get(subjectKey) === "contested" && contestedClaimKeys.length > 1) {
      const conflictFindingRefs = (findingIdsBySubject.get(subjectKey) ?? []).map((findingId) => ({
        findingId,
      }));
      for (let i = 0; i < contestedClaimKeys.length; i += 1) {
        for (let j = i + 1; j < contestedClaimKeys.length; j += 1) {
          const from = nodeOf("claim", contestedClaimKeys[i])!;
          const to = nodeOf("claim", contestedClaimKeys[j])!;
          draft("contradicts", from.id, to.id, "derived", "disputed", {
            refs: [{ subjectKey }, ...conflictFindingRefs],
          });
        }
      }
    }
  }

  // Assessed-only claims still address their declared canonical paths.
  for (const subjectKey of assessedOnly) {
    const fieldPath = fieldPathBySubject.get(subjectKey);
    if (fieldPath === undefined) continue;
    const claimNode = nodeOf("claim", assessedOnlyClaimKey(subjectKey))!;
    const fieldNode = nodeOf("field", fieldPath)!;
    draft(
      "addresses",
      claimNode.id,
      fieldNode.id,
      "derived",
      claimStandingByKey.get(assessedOnlyClaimKey(subjectKey)) ?? "unverified",
      { refs: [{ subjectKey, path: fieldPath }] },
    );
  }

  // Fact → field support and the declared value-succession chains, exactly
  // as the canonical record states them.
  if (record !== undefined && Array.isArray(record.fields)) {
    for (const field of [...record.fields]) {
      if (isAbsent(field) || !isNonEmptyString(field.path)) continue;
      const fieldNode = nodeOf("field", field.path);
      if (fieldNode === undefined) continue;
      const values = Array.isArray(field.values) ? field.values : [];
      for (const value of values) {
        if (isAbsent(value) || !isNonEmptyString(value.factId)) continue;
        const factNode = ensureNode("fact", value.factId, { refs: [{ factId: value.factId }] });
        const standing: KnowledgeStanding =
          value.status === "superseded" || value.status === "removed"
            ? "stale"
            : value.status === "missing"
              ? "unavailable"
              : "unverified";
        const ref: KnowledgeRef = { factId: value.factId, path: field.path };
        if (isNonEmptyString(field.id)) ref.fieldId = field.id;
        if (isNonEmptyString(value.revisionId)) ref.revisionId = value.revisionId;
        draft("supports", factNode.id, fieldNode.id, "derived", standing, { refs: [ref] });
        if (isNonEmptyString(value.supersededBy) && value.supersededBy !== value.factId) {
          const successor = ensureNode("fact", value.supersededBy, {
            refs: [{ factId: value.supersededBy }],
          });
          draft("supersedes", successor.id, factNode.id, "derived", "unverified", {
            refs: [
              { factId: value.supersededBy, path: field.path },
              { factId: value.factId, path: field.path },
            ],
          });
        }
      }
    }
  }

  // Revision → revision succession, exactly as the declared basedOn chain
  // states it — never inferred from sequence numbers.
  if (record !== undefined && Array.isArray(record.revisions)) {
    for (const revision of [...record.revisions]) {
      if (isAbsent(revision) || !isNonEmptyString(revision.id)) continue;
      if (!isNonEmptyString(revision.basedOn) || revision.basedOn === revision.id) continue;
      const revisionNode = nodeOf("revision", revision.id)!;
      const basedOnNode = ensureNode("revision", revision.basedOn, {
        refs: [{ revisionId: revision.basedOn, projectId }],
      });
      draft("supersedes", revisionNode.id, basedOnNode.id, "derived", "unverified", {
        refs: [{ revisionId: revision.id }, { revisionId: revision.basedOn }],
      });
    }
  }

  // The RC4.6 merge's unresolved conflicts — represented, never resolved.
  if (merge !== undefined) {
    const conflicts = Array.isArray(merge.conflicts) ? merge.conflicts : [];
    if (!Array.isArray(merge.conflicts)) {
      issues.push(
        knowledgeWarning(
          "invalid_merge_conflicts",
          "Context merge declares a non-list conflicts value — no conflict edges are described",
          "merge.conflicts",
        ),
      );
    }
    for (let index = 0; index < conflicts.length; index += 1) {
      const conflict = conflicts[index];
      if (
        isAbsent(conflict) ||
        !isNonEmptyString(conflict.factId) ||
        !isNonEmptyString(conflict.path)
      ) {
        issues.push(
          knowledgeWarning(
            "malformed_merge_conflict",
            "Merge conflict names no fact and path and cannot be represented",
            `merge.conflicts.${index}`,
          ),
        );
        continue;
      }
      const factNode = ensureNode("fact", conflict.factId, {
        refs: [{ factId: conflict.factId }],
      });
      const fieldRef: KnowledgeRef = { path: conflict.path };
      if (isNonEmptyString(conflict.fieldId)) fieldRef.fieldId = conflict.fieldId;
      const fieldNode = ensureNode("field", conflict.path, { refs: [fieldRef] });
      const edgeRef: KnowledgeRef = { factId: conflict.factId, path: conflict.path };
      if (isNonEmptyString(conflict.fieldId)) edgeRef.fieldId = conflict.fieldId;
      draft("conflicts_with", factNode.id, fieldNode.id, "derived", "disputed", {
        refs: [edgeRef],
      });
    }
  }

  // Finding → affected elements, exactly as each finding's references state.
  for (const finding of acceptedFindings) {
    const findingNode = nodeOf("finding", finding.id)!;
    for (const reference of finding.references) {
      if (isNonEmptyString(reference.factId)) {
        const target = ensureNode("fact", reference.factId, {
          refs: [{ factId: reference.factId, findingId: finding.id }],
        });
        draft("affects", findingNode.id, target.id, "derived", "unverified", {
          refs: [{ findingId: finding.id, factId: reference.factId }],
        });
      }
      if (isNonEmptyString(reference.sourceId)) {
        const target = ensureNode("source", reference.sourceId, {
          refs: [{ sourceId: reference.sourceId, findingId: finding.id }],
        });
        draft("affects", findingNode.id, target.id, "derived", "unverified", {
          refs: [{ findingId: finding.id, sourceId: reference.sourceId }],
        });
      }
      if (isNonEmptyString(reference.path)) {
        const target = ensureNode("field", reference.path, {
          refs: [{ path: reference.path, findingId: finding.id }],
        });
        draft("affects", findingNode.id, target.id, "derived", "unverified", {
          refs: [{ findingId: finding.id, path: reference.path }],
        });
      }
    }
    if (finding.subjectKey !== undefined) {
      for (const [claimKey] of claimStandingByKey) {
        const claimNode = nodeOf("claim", claimKey);
        if (claimNode?.subjectKey === finding.subjectKey) {
          draft("affects", findingNode.id, claimNode.id, "derived", "unverified", {
            refs: [{ findingId: finding.id, subjectKey: finding.subjectKey }],
          });
        }
      }
    }
  }

  // Declared relations — admitted only when declarable, grounded, and
  // resolvable against nodes the graph actually contains.
  const relations = Array.isArray(request.relations) ? request.relations : [];
  // What the graph knows about a declared relation: never more than the
  // grounding evidence says about *the evidence itself*. Nothing anywhere
  // judges the relation — RC4.7 corroborates values, not relationships — so
  // a declared relation is never marked corroborated: `unverified` is its
  // ceiling, and the grounding evidence can only pull it *down* (a contested
  // or incomparable grounding subject, or grounding that is wholly
  // superseded or states absence, flags the relation's evidentiary basis as
  // unsettled). Preserving doubt is admissible; manufacturing certainty is
  // not.
  const deriveDeclaredStanding = (refs: readonly KnowledgeRef[]): KnowledgeStanding => {
    const groundedFacts: KnowledgeFact[] = [];
    const groundedSubjects = new Set<string>();
    for (const ref of refs) {
      if (isNonEmptyString(ref.subjectKey)) groundedSubjects.add(ref.subjectKey);
      if (!isNonEmptyString(ref.factId)) continue;
      const entry = factById.get(ref.factId);
      if (entry === undefined) continue;
      groundedFacts.push(entry.fact);
      groundedSubjects.add(entry.subjectKey);
    }
    const consensuses = [...groundedSubjects]
      .map((subjectKey) => consensusBySubject.get(subjectKey))
      .filter((consensus): consensus is CrossValidationConsensus => consensus !== undefined);
    if (consensuses.includes("contested")) return "disputed";
    if (consensuses.includes("incomparable")) return "incomparable";
    if (groundedFacts.length > 0 && groundedFacts.every((fact) => fact.status === "superseded")) {
      return "stale";
    }
    if (groundedFacts.length > 0 && groundedFacts.every((fact) => fact.status === "unavailable")) {
      return "unavailable";
    }
    return "unverified";
  };
  for (let index = 0; index < relations.length; index += 1) {
    const path = `relations.${index}`;
    // Each declaration is copied and processed inside its own net, so one
    // hostile or uncloneable declaration excludes that declaration alone —
    // never the whole graph.
    try {
      const declaration = structuredClone(relations[index]);
      if (isAbsent(declaration)) {
        excludedCount += 1;
        issues.push(
          knowledgeError("malformed_relation_declaration", "Relation declaration is absent", path),
        );
        continue;
      }
      if (!isDeclarableKnowledgeEdgeKind(declaration.kind)) {
        excludedCount += 1;
        issues.push(
          knowledgeError(
            "undeclarable_relation",
            `Relation declaration states a kind "${String(declaration.kind)}" a caller cannot declare`,
            `${path}.kind`,
          ),
        );
        continue;
      }
      const refs = coherentRefs(declaration.refs, `${path}.refs`);
      if (refs === undefined) {
        excludedCount += 1;
        issues.push(
          knowledgeError(
            "ungrounded_relation",
            "Relation declaration is grounded in no coherent reference — excluded, never invented",
            `${path}.refs`,
          ),
        );
        continue;
      }
      const resolveLocator = (
        locator: { kind?: unknown; key?: unknown } | null | undefined,
      ): KnowledgeNode | undefined => {
        if (isAbsent(locator) || !isNonEmptyString(locator.key)) return undefined;
        const kind = locator.kind as KnowledgeNodeKind;
        return nodeOf(kind, locator.key) ?? nodeOf(kind, normalizeKnowledgeSlug(locator.key));
      };
      const fromNode = resolveLocator(declaration.from);
      const toNode = resolveLocator(declaration.to);
      if (fromNode === undefined || toNode === undefined) {
        excludedCount += 1;
        issues.push(
          knowledgeError(
            "unresolved_relation_endpoint",
            "Relation declaration names an endpoint the graph does not contain — excluded, never invented",
            fromNode === undefined ? `${path}.from` : `${path}.to`,
          ),
        );
        continue;
      }
      const endpoints = KNOWLEDGE_EDGE_ENDPOINTS[declaration.kind];
      if (!endpoints.from.includes(fromNode.kind) || !endpoints.to.includes(toNode.kind)) {
        excludedCount += 1;
        issues.push(
          knowledgeError(
            "incompatible_relation_endpoints",
            `Relation "${declaration.kind}" cannot connect a ${fromNode.kind} to a ${toNode.kind}`,
            path,
          ),
        );
        continue;
      }
      const options: KnowledgeEdgeOptions = { refs };
      if (isNonEmptyString(declaration.note)) options.note = declaration.note;
      const added = draft(
        declaration.kind,
        fromNode.id,
        toNode.id,
        "declared",
        deriveDeclaredStanding(refs),
        options,
      );
      if (!added) {
        issues.push(
          knowledgeWarning(
            "duplicate_relation_declaration",
            `Relation "${declaration.kind}" between these endpoints is declared more than once — the first declaration resolves`,
            path,
          ),
        );
      }
    } catch {
      excludedCount += 1;
      issues.push(
        knowledgeError(
          "malformed_relation_declaration",
          "Relation declaration behaved in a way that could not be represented or copied",
          path,
        ),
      );
    }
  }

  // ── Deterministic order and id assignment ─────────────────────────────────
  const nodes = sortKnowledgeNodes([...nodesByKindKey.values()]);
  const provisional = drafts.map((entry) =>
    knowledgeEdge(
      "",
      entry.kind,
      entry.fromId,
      entry.toId,
      projectId,
      entry.origin,
      entry.standing,
      entry.options,
    ),
  );
  const ordered = sortKnowledgeEdges(provisional);
  const kindCounters = new Map<string, number>();
  const edges = ordered.map((edge) => {
    const ordinal = (kindCounters.get(edge.kind) ?? 0) + 1;
    kindCounters.set(edge.kind, ordinal);
    return { ...edge, id: knowledgeEdgeIdFor(slug, edge.kind, ordinal) };
  });

  const unresolvedCount =
    nodes.filter(
      (node) => node.standing !== undefined && knowledgeStandingRequiresReview(node.standing),
    ).length + edges.filter((edge) => knowledgeStandingRequiresReview(edge.standing)).length;
  if (unresolvedCount > 0) {
    issues.push(
      knowledgeWarning(
        "unresolved_knowledge",
        `${unresolvedCount} element(s) carry a disputed or incomparable standing — described, not resolved`,
        "graph",
      ),
    );
  }

  const graph: KnowledgeGraph = {
    id: graphId,
    projectId,
    projectSlug: slug,
    nodes,
    edges,
    sourceIds: nodes.filter((node) => node.kind === "source").map((node) => node.key),
  };
  if (batch !== undefined) graph.batch = batch;
  if (now !== undefined) graph.describedAt = now;

  // The graph is deep-copied at this boundary so a result never aliases the
  // context's sources, record, or report, or the request's facts and
  // declarations: mutating a described graph can never reach back into the
  // caller's values. A part that cannot even be copied is reported, never
  // thrown out of.
  let copied: KnowledgeGraph;
  try {
    copied = structuredClone(graph);
  } catch {
    return failure(
      knowledgeError(
        "uncloneable_graph",
        "The described graph holds values that cannot be copied for description",
        "graph",
      ),
    );
  }

  // One deterministic completion rule: every represented element completes,
  // every excluded input fails — described work, never a run.
  const stats = {
    ...emptyKnowledgeGraphStats(),
    stages: 1,
    steps: copied.nodes.length + copied.edges.length + excludedCount,
    completed: copied.nodes.length + copied.edges.length,
    skipped: 0,
    failed: excludedCount,
  };

  const metadata: KnowledgeGraphRunMetadata = {
    graphId,
    projectId,
    nodeCount: copied.nodes.length,
    edgeCount: copied.edges.length,
    factCount: represented.length,
    sourceCount,
    claimCount: copied.nodes.filter((node) => node.kind === "claim").length,
    unresolvedCount,
  };
  if (now !== undefined) metadata.describedAt = now;

  return createKnowledgeGraphResult({ data: [copied], issues, stats, metadata });
}
