/**
 * Forever Project Factory (RC4.3) — the standard project generation engine.
 *
 * RC4.2 generalized the RC4.1 Coralina proof into one canonical template that
 * describes how a project integration package is structured. RC4.3 adds the
 * standard engine that builds any Forever project from that template: a
 * {@link FactoryDefinition} declares the {@link FactoryRecipe}s (ordered
 * {@link FactoryStage}s of {@link FactoryStep}s) a factory can generate, and
 * {@link planFactoryBuild} deterministically *describes* — never executes — the
 * package a build would produce from a verified project slug.
 *
 * This module is architecture only. It ships no parser, OCR, reader, scraper,
 * HTTP or API client, Supabase access, database write, queue, worker,
 * scheduler, route, React, AI, scoring, recommendation, report, or passport
 * logic. It reads no clock, opens no connection, holds no credential, and
 * moves no record. It *describes* deterministic project generation — never a
 * running generator.
 *
 * It defines the factory identity and the deterministic id-naming conventions,
 * the step/stage/recipe vocabulary of generation, the {@link FactoryDefinition}
 * and the canonical {@link buildForeverProjectFactory}, the reused
 * {@link FactoryPolicy} behavioural contract, the {@link FactoryContext} that
 * threads a caller-supplied clock, the {@link FactoryResult} and the
 * deterministic {@link planFactoryBuild} planner, the {@link FactoryHistory}
 * build log, the catalogue data model and a deterministic in-memory
 * {@link FactoryRegistry}, a pluggable {@link FactoryProvider} contract, the
 * pure helpers the module shares, and a validation pipeline that never throws.
 *
 * It reuses — never restates — the neighbouring foundations: the Forever
 * Database (RC3.0) identity primitives and slug rule, the Forever Import
 * (RC3.1) entity taxonomy and severity vocabulary, the Forever Sync (RC3.2)
 * retry shape, the Forever Source Registry (RC3.3), Forever Connector (RC3.4),
 * and Forever Pipeline (RC3.5) vocabularies carried through the RC4.0/RC4.2
 * descriptors, the Forever Project Integration (RC4.0) scope, version,
 * metadata, policy, state/outcome/stats machinery, and the whole
 * issue/severity/partition machinery, and the Forever Project Template (RC4.2)
 * template, package, bundle, layout, identity helpers, and validation
 * pipeline. It changes no existing file.
 */

export * from "./types";
export * from "./identity";
export * from "./step";
export * from "./stage";
export * from "./recipe";
export * from "./policy";
export * from "./definition";
export * from "./context";
export * from "./result";
export * from "./build";
export * from "./history";
export * from "./catalog";
export * from "./registry";
export * from "./helpers";
export * from "./contracts";
export * from "./validation";
