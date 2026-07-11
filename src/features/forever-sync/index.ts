/**
 * Forever Sync (RC3.2) — the synchronization foundation.
 *
 * This module is the architecture every future synchronization path will stand
 * on. It is not a synchronizer itself: it ships no HTTP client, scheduler, cron,
 * queue, worker, or Supabase access, and it never reads a clock or writes a
 * record. It defines the canonical sync types (jobs, sources, targets, results,
 * metadata, history), the status/policy/schedule/trigger vocabularies, a
 * pluggable connector contract with a registry, a deterministic validation
 * pipeline, and the pure helpers the whole module shares.
 *
 * It builds additively on the Forever Database (RC3.0) canonical models and the
 * Forever Import (RC3.1) contracts — reusing their entity identity and payload
 * validation rather than duplicating them — and changes no existing behaviour.
 *
 * The architecture is shaped to support future synchronization for the Website,
 * CRM, Forever Database, Marketplace, AI Agents, Manual Sync, and future API
 * providers, all through the same connector seam.
 */

export * from "./types";
export * from "./status";
export * from "./derive";
export * from "./policy";
export * from "./schedule";
export * from "./history";
export * from "./result";
export * from "./helpers";
export * from "./contracts";
export * from "./registry";
export * from "./validation";
