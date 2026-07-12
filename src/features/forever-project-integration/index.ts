/**
 * Forever Project Integration (RC4.0) — the first integration foundation.
 *
 * This module is the first *Integration* layer of Forever. It is not an
 * integration runtime itself: it ships no parser, OCR, PDF extraction, Excel
 * reader, HTTP client, API client, website crawler, CRM integration, Supabase
 * access, AI, background worker, queue, scheduler, execution runtime, or
 * synchronization runtime. It never reads a clock, opens a connection, runs a
 * stage, drives a pipeline, or moves a record. It defines the canonical
 * integration vocabulary (scope, stage and step kinds, execution and error
 * strategies, lifecycle state), the identity/version/metadata descriptors, the
 * {@link ProjectIntegrationDefinition} that composes stages and steps, the
 * policy, context, result, and history models, the registry models and a
 * pluggable provider contract, a deterministic in-memory registry, a validation
 * pipeline, and the pure helpers the whole module shares.
 *
 * It connects the existing foundations together while remaining architecture
 * only. It builds additively on — and reuses rather than duplicates — the Forever
 * Database (RC3.0) canonical id/slug/time types, the Forever Import (RC3.1) entity
 * taxonomy and severity vocabulary, the Forever Sync (RC3.2) system, direction,
 * and retry vocabularies, the Forever Source Registry (RC3.3) source ids, the
 * Forever Connectors (RC3.4) connector ids, and the Forever Pipeline (RC3.5)
 * pipeline ids and execution/error vocabularies. It changes no existing
 * behaviour.
 *
 * The architecture is shaped to describe every future project integration:
 * bringing a single project end-to-end from its sources through its pipelines to
 * the Forever systems, wiring a developer's whole project set, or composing a
 * portfolio — all through the same definition and provider seam.
 */

export * from "./types";
export * from "./state";
export * from "./version";
export * from "./identity";
export * from "./step";
export * from "./stage";
export * from "./policy";
export * from "./metadata";
export * from "./definition";
export * from "./context";
export * from "./derive";
export * from "./result";
export * from "./history";
export * from "./entry";
export * from "./helpers";
export * from "./registry";
export * from "./contracts";
export * from "./validation";
