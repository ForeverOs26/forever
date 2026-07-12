/**
 * Forever Knowledge Graph (RC4.8) — the Forever Project Knowledge Graph
 * foundation.
 *
 * The connective layer above the intake chain: RC4.4 catalogued the documents
 * a project receives, RC4.5 described how those documents produce structured
 * extracted facts, RC4.6 described the canonical database those facts settle
 * into, RC4.7 described the cross-source examination between them — and
 * RC4.8 describes the *graph* they add up to: every identity the project's
 * knowledge speaks about (the project, its catalogued sources, its extracted
 * facts, the claims those facts state, the canonical fields and revisions
 * they settle into, the validation findings that examine them, and the
 * caller-declared entities — developers, locations, unit types, amenities,
 * payment plans, legal claims) and every relationship between them, each one
 * traceable to the artifact or declaration that states it, and each one
 * carrying exactly the certainty the underlying evidence carries — never
 * more. A disputed subject stays two claims with a `contradicts` edge
 * between them, a superseded reading stays `stale`, a stated absence stays
 * `unavailable`, an unaddressed expectation stays `missing`, and everything
 * nothing judged stays explicitly `unverified` — preserving uncertainty is
 * the point and manufacturing certainty is the failure mode.
 *
 * This module is architecture only. It ships no parser, OCR, AI or LLM call,
 * HTTP or API client, Supabase access, database write, filesystem access,
 * queue, worker, scheduler, publication, approval runtime, route, or React.
 * It reads no clock, opens no connection, holds no credential, persists no
 * byte, normalizes no value, resolves no identity, and settles no
 * disagreement. Nothing here invents anything: an entity exists only because
 * a caller declared it with grounding, a domain relationship only because a
 * caller stated one, a standing above `unverified` only because a reused
 * RC4.5 status or RC4.7 consensus states it, and a timestamp only because a
 * caller supplied one.
 *
 * It defines the graph, node, and edge identity and the deterministic
 * id-naming conventions, the {@link KnowledgeRef} traceability reference, the
 * {@link KnowledgeStanding} uncertainty vocabulary with its RC4.7 consensus
 * mapping, the {@link KnowledgeNode} kinds (artifact kinds derived from the
 * neighbouring foundations, entity kinds admitted only by declaration), the
 * {@link KnowledgeEdge} vocabulary with its endpoint grammar, origins, and
 * standings, the caller {@link KnowledgeEntityDeclaration} and
 * {@link KnowledgeRelationDeclaration} statements, the reused
 * {@link KnowledgeGraphPolicy} behavioural contract, the
 * {@link KnowledgeGraphContext} that threads the reused RC4.4 sources, RC4.6
 * record and merge, RC4.7 report, and a caller-supplied clock, the
 * deterministic {@link describeKnowledgeGraph} description engine and its
 * {@link KnowledgeGraphResult}, the pure graph query helpers, the
 * {@link KnowledgeGraphHistory} log, the catalogue data model and a
 * deterministic in-memory {@link KnowledgeGraphRegistry}, a pluggable
 * {@link KnowledgeGraphProvider} contract, the pure helpers the module
 * shares, and a validation pipeline that never throws.
 *
 * It reuses — never restates — the neighbouring foundations: the Forever
 * Database (RC3.0) identity primitives and ISO date types, the Forever Import
 * (RC3.1) severity vocabulary carried through RC3.3/RC4.4/RC4.5/RC4.6, the
 * Forever Sync (RC3.2) retry shape, the Forever Source Registry (RC3.3) id,
 * issue, trust, and version machinery, the Forever Project Integration
 * (RC4.0) policy and state/outcome/stats machinery, the Forever Project
 * Template (RC4.2) slug and `proj_` project-id conventions, the Forever
 * Project Sources (RC4.4) definitions, statuses, and relationship
 * declarations, the Forever Extraction Pipeline (RC4.5) facts, subject keys,
 * statuses, confidence machinery, and validators, the Forever Canonical
 * Project Database (RC4.6) records, fields, values, revisions, conflicts,
 * and issue machinery, and the Forever Cross-Source Validation (RC4.7)
 * reports, assessments, findings, consensus semantics, signature bridge, and
 * total version comparison. It changes no existing file.
 */

export * from "./types";
export * from "./version";
export * from "./identity";
export * from "./standing";
export * from "./reference";
export * from "./node";
export * from "./edge";
export * from "./declaration";
export * from "./policy";
export * from "./context";
export * from "./result";
export * from "./graph";
export * from "./history";
export * from "./catalog";
export * from "./registry";
export * from "./helpers";
export * from "./contracts";
export * from "./validation";
