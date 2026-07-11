/**
 * Forever Connectors (RC3.4) — the connector foundation.
 *
 * This module is the architecture every future connector will be built with. It
 * is not a connector itself: it ships no HTTP client, API client, OAuth or
 * authentication, Supabase access, CRM/website/marketplace/AI integration, queue,
 * worker, network communication, runtime synchronization, persistence, database
 * write, route, or UI. It never reads a clock, opens a connection, sends a
 * request, or holds a credential. It defines the canonical connector vocabulary
 * (capabilities, status, health, configuration schema), the
 * identity/version/metadata descriptors, the {@link ConnectorDefinition} that
 * ties them together, the registry models and a pluggable provider contract, a
 * deterministic in-memory registry, a validation pipeline, and the pure helpers
 * the whole module shares.
 *
 * It builds additively on the Forever Database (RC3.0) canonical id/slug types,
 * the Forever Import (RC3.1) entity taxonomy and severity vocabulary, the
 * Forever Sync (RC3.2) protocol/system/direction vocabularies, and the Forever
 * Source Registry (RC3.3) source ids — reusing them rather than duplicating them
 * — and changes no existing behaviour.
 *
 * The architecture is shaped to describe every future connector: the Developer
 * Website, CRM, Marketplace, Forever Database, Manual, PDF, Excel, CSV, JSON,
 * API, AI Agent, and future transports, all through the same definition and
 * provider seam.
 */

export * from "./types";
export * from "./capability";
export * from "./status";
export * from "./health";
export * from "./identity";
export * from "./version";
export * from "./configuration";
export * from "./metadata";
export * from "./definition";
export * from "./entry";
export * from "./result";
export * from "./helpers";
export * from "./registry";
export * from "./contracts";
export * from "./validation";
