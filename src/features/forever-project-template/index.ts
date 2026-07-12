/**
 * Forever Project Template (RC4.2) — the reusable project integration template.
 *
 * RC4.1 proved the Forever architecture end-to-end using one real project
 * (Coralina), wired together by hand. RC4.2 generalizes that proof into one
 * canonical template so every future project can be integrated by providing only
 * verified source data — everything else follows the same structure.
 *
 * This module is architecture only. It ships no parser, OCR, reader, scraper,
 * HTTP or API client, Supabase access, database write, queue, worker, scheduler,
 * route, React, AI, scoring, recommendation, report, or passport logic. It reads
 * no clock, opens no connection, holds no credential, and moves no record. It
 * *describes* how a project integration package is structured — never a running
 * integration.
 *
 * It defines the vocabulary of {@link ProjectComponent}s a package is composed of
 * and the {@link ProjectFoundation}s that supply them, the template/package
 * identities and the deterministic id-naming conventions, the
 * {@link ProjectLayout} a package follows, the {@link ProjectReference} contract
 * it must resolve, the {@link ProjectTemplate} and the canonical
 * {@link buildForeverProjectTemplate} factory, the {@link ProjectPackage}
 * descriptor and its deterministic builder, the {@link ProjectBundle} that
 * measures a package against a template, the catalogue data model and its
 * immutable helpers, a deterministic in-memory {@link ProjectPackageRegistry}, a
 * pluggable provider contract, the pure helpers the module shares, and a
 * validation pipeline that never throws.
 *
 * It reuses — never restates — the neighbouring foundations: the Forever Database
 * (RC3.0) identity primitives and `slugify`, the Forever Import (RC3.1) entity
 * taxonomy, and the Forever Project Integration (RC4.0) scope, version, metadata,
 * and the whole issue/severity/partition machinery. It changes no existing file.
 */

export * from "./types";
export * from "./component";
export * from "./identity";
export * from "./layout";
export * from "./reference";
export * from "./template";
export * from "./package";
export * from "./bundle";
export * from "./catalog";
export * from "./registry";
export * from "./helpers";
export * from "./contracts";
export * from "./validation";
