/**
 * Forever Pipeline (RC3.5) — the pipeline foundation.
 *
 * This module is the architecture every future data pipeline will be built with.
 * It is not a pipeline runtime itself: it ships no HTTP client, API client,
 * OAuth or authentication, Supabase access, CRM/website/marketplace/AI
 * integration, queue, worker, scheduler, network communication, execution
 * engine, persistence, database write, route, or UI. It never reads a clock,
 * opens a connection, runs a stage, or moves a record. It defines the canonical
 * pipeline vocabulary (modes, stage and step kinds, execution and error
 * strategies, lifecycle state), the identity/version/metadata descriptors, the
 * {@link PipelineDefinition} that composes stages and steps, the policy, context,
 * result, and history models, the registry models and a pluggable provider
 * contract, a deterministic in-memory registry, a validation pipeline, and the
 * pure helpers the whole module shares.
 *
 * It builds additively on the Forever Database (RC3.0) canonical id/slug/time
 * types, the Forever Import (RC3.1) entity taxonomy and severity vocabulary, the
 * Forever Sync (RC3.2) direction and retry vocabularies, the Forever Source
 * Registry (RC3.3) source ids, and the Forever Connectors (RC3.4) connector ids
 * — reusing them rather than duplicating them — and changes no existing
 * behaviour.
 *
 * The architecture is shaped to describe every future pipeline: importing a
 * developer's project set, synchronizing Forever with a CRM or marketplace,
 * exporting canonical data to a website, and future composite flows, all through
 * the same definition and provider seam.
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
