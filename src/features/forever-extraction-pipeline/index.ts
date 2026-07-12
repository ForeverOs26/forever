/**
 * Forever Extraction Pipeline (RC4.5) — the Forever Extraction Pipeline
 * foundation.
 *
 * The declarative description of how a registered project source produces
 * structured extracted facts. RC4.4 catalogued the documents a project
 * receives; RC4.5 describes how one of those catalogued sources — one price
 * list, brochure, floor plan, contract, or developer update, in one exact
 * received revision — would be read into facts: project name, developer,
 * location, coordinates, areas, prices, ownership, payment plans, completion,
 * amenities, plans, claims, dates, availability, and inventory, each carrying
 * its raw and structured values, unit, language, confidence, evidence, and a
 * mandatory provenance chain.
 *
 * This module is architecture only. It ships no OCR, PDF parser, spreadsheet
 * reader, image or video recognition, AI or LLM call, HTTP or API client,
 * Supabase access, database write, filesystem access, queue, worker,
 * scheduler, normalization, publication, route, or React. It reads no clock,
 * opens no connection, holds no credential, loads no byte of file content,
 * derives no value, and approves no fact. It *describes* extraction — never a
 * running extractor. Nothing here invents a value: missing data stays
 * explicitly absent, unknown confidence stays unknown, and a plan carries
 * targets, never fact values.
 *
 * It defines the extraction identity and the deterministic id-naming
 * conventions (version-addressed plan and fact ids, so repeated attempts and
 * newer revisions never collide), the fact-type, method, locator, confidence,
 * value-kind, and lifecycle vocabularies, the {@link ExtractionFact} and the
 * deterministic {@link describeExtractionFact} descriptor builder, the
 * {@link ExtractionEvidence} and mandatory {@link ExtractionProvenance}
 * chain, the step/stage/recipe vocabulary of extraction, the
 * {@link ExtractionDefinition} and the canonical
 * {@link buildForeverExtractionPipeline}, the reused {@link ExtractionPolicy}
 * behavioural contract, the {@link ExtractionContext} that threads a
 * caller-supplied clock, the {@link ExtractionResult} and the pure
 * {@link planExtraction} planner, the {@link ExtractionHistory} attempt log,
 * the catalogue data model and a deterministic in-memory
 * {@link ExtractionRegistry}, a pluggable {@link ExtractionProvider}
 * contract, the pure helpers the module shares (including the conflict
 * grouping that lets one source produce many facts, many sources produce one
 * fact type, and conflicting readings coexist unresolved), and a validation
 * pipeline that never throws.
 *
 * It reuses — never restates — the neighbouring foundations: the Forever
 * Database (RC3.0) identity primitives, slug rule, ISO date types, and
 * Money/GeoPoint value shapes, the Forever Import (RC3.1) severity vocabulary
 * carried through RC3.3/RC4.4, the Forever Sync (RC3.2) retry shape, the
 * Forever Source Registry (RC3.3) id, issue, and version machinery carried
 * through RC4.4, the Forever Project Integration (RC4.0) policy,
 * state/outcome/stats machinery, and their guards, the Forever Project
 * Template (RC4.2) slug and `proj_` project-id conventions, and the Forever
 * Project Sources (RC4.4) source ids, versions, document/file vocabularies,
 * document keys, and definition validation. It changes no existing file.
 */

export * from "./types";
export * from "./version";
export * from "./identity";
export * from "./facttype";
export * from "./method";
export * from "./confidence";
export * from "./value";
export * from "./evidence";
export * from "./provenance";
export * from "./status";
export * from "./fact";
export * from "./step";
export * from "./stage";
export * from "./recipe";
export * from "./policy";
export * from "./definition";
export * from "./context";
export * from "./result";
export * from "./plan";
export * from "./history";
export * from "./catalog";
export * from "./registry";
export * from "./helpers";
export * from "./contracts";
export * from "./validation";
