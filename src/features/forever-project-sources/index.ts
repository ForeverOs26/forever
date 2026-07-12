/**
 * Forever Project Sources (RC4.4) — the Forever Source Registry foundation.
 *
 * The canonical catalogue of every source that enters the Forever ecosystem:
 * each price list, brochure, floor plan, master plan, unit plan, contract,
 * legal document, marketing material, specification, and developer update a
 * project receives — in every version it was received in. RC3.3 described the
 * source *systems* facts arrive through; RC4.4 catalogues the *documents*
 * those systems deliver, per project, without ever touching one.
 *
 * This module is architecture only. It ships no import engine, parser, OCR,
 * reader, scraper, extractor, normalizer, HTTP or API client, Supabase access,
 * database write, filesystem access, queue, worker, scheduler, publication,
 * route, React, or AI. It reads no clock, opens no connection, holds no
 * credential, loads no byte of file content, and moves no record. It
 * *describes* project sources — never a running pipeline.
 *
 * It defines the source identity and the deterministic id-naming conventions,
 * the descriptor vocabularies (document type, file format, language, dates)
 * with deterministic bridges onto the RC3.0 document/media and RC3.1 import
 * vocabularies, the {@link ProjectSourceAuthority} attribution over the reused
 * RC3.3 trust ladder, the {@link ProjectSourceStatus} standing vocabulary, the
 * reused version shape that lets one document hold many catalogued revisions,
 * the {@link ProjectSourceRelationships} id references that chain revisions
 * and link back to the RC3.3 registered systems, the
 * {@link ProjectSourceDefinition} and the deterministic
 * {@link describeProjectSource} descriptor builder, the reused
 * {@link ProjectSourcePolicy} behavioural contract, the
 * {@link ProjectSourceHistory} standing log, the catalogue data model and a
 * deterministic in-memory {@link ProjectSourceRegistry}, a pluggable
 * {@link ProjectSourceProvider} contract, the pure helpers the module shares,
 * and a validation pipeline that never throws.
 *
 * It reuses — never restates — the neighbouring foundations: the Forever
 * Database (RC3.0) identity primitives, slug rule, and document/media
 * vocabularies, the Forever Import (RC3.1) format vocabulary, the Forever
 * Source Registry (RC3.3) id, issue, origin-type, trust, version, and metadata
 * machinery, the Forever Project Integration (RC4.0) policy and its guard, and
 * the Forever Project Template (RC4.2) slug and project-id conventions. It
 * changes no existing file.
 */

export * from "./types";
export * from "./version";
export * from "./identity";
export * from "./descriptor";
export * from "./authority";
export * from "./status";
export * from "./relationships";
export * from "./policy";
export * from "./definition";
export * from "./history";
export * from "./catalog";
export * from "./registry";
export * from "./helpers";
export * from "./contracts";
export * from "./validation";
