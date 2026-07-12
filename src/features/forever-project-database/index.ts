/**
 * Forever Project Database (RC4.6) — the Forever Canonical Project Database
 * foundation.
 *
 * The canonical destination of the whole intake chain: RC4.4 catalogued the
 * documents a project receives, RC4.5 described how those documents produce
 * structured extracted facts, and RC4.6 describes where those facts settle —
 * the single source of truth for every Forever project. Every project has
 * exactly one canonical {@link ProjectRecord}: its fields organized under the
 * canonical sections (General, Developer, Location, Construction, Units,
 * Pricing, Payment, Investment, Rental, Amenities, Legal, Facilities,
 * Timeline, Documents, Media, Notes, Unknown), each field carrying its
 * standing value and its full append-only value history — current,
 * superseded, removed, missing, and unknown values all stated explicitly —
 * with confidence, evidence, provenance, and source references reused from
 * RC4.5 verbatim. This record is the foundation the Forever Website, Forever
 * Intelligence, Forever Passport, Forever Advisory, Search, Compare, the
 * Recommendation Engine, and the AI Advisor will read from.
 *
 * This module is architecture only. It ships no database, persistence,
 * parser, OCR, AI or LLM call, HTTP or API client, Supabase access,
 * filesystem access, queue, worker, scheduler, publication, route, or React.
 * It reads no clock, opens no connection, holds no credential, persists no
 * byte, derives no value, and — above all — resolves no conflict: when two
 * sources disagree, both readings are described side by side in a
 * {@link ProjectConflict}, unresolved, for a future runtime or a human to
 * settle. Nothing here invents a value: missing data stays explicitly
 * absent, unknown confidence stays unknown, and every timestamp is
 * caller-supplied.
 *
 * It defines the record identity and the deterministic id-naming conventions
 * (record, field, revision, snapshot, and merge ids that never collide
 * across repeated revisions), the canonical section vocabulary and
 * descriptors, the {@link ProjectField} with its append-only
 * {@link ProjectFieldValue} history and the deterministic
 * {@link describeProjectField} builder, the {@link ProjectRevision} and
 * {@link ProjectChange} description of every edit, the
 * {@link ProjectSnapshot} frozen views and {@link ProjectTimeline} audit
 * trail, the {@link ProjectRecord} and the deterministic
 * {@link describeProjectRecord} builder, the {@link ProjectDatabase} data
 * model, the reused {@link ProjectDatabasePolicy} behavioural contract, the
 * {@link ProjectContext} that threads a caller-supplied clock, the
 * {@link ProjectResult} and the pure {@link describeProjectMerge} merge
 * description (new, unchanged, updated, removed, rejected, and conflicting
 * readings — described, never applied), the {@link ProjectHistory} log, the
 * catalogue data model and a deterministic in-memory
 * {@link ProjectRegistry}, a pluggable {@link ProjectProvider} contract, the
 * pure helpers the module shares, and a validation pipeline that never
 * throws.
 *
 * It reuses — never restates — the neighbouring foundations: the Forever
 * Database (RC3.0) identity primitives, slug rule, ISO date types, and
 * Money/GeoPoint value shapes, the Forever Import (RC3.1) severity
 * vocabulary carried through RC3.3/RC4.4/RC4.5, the Forever Sync (RC3.2)
 * retry shape, the Forever Source Registry (RC3.3) id, issue, and version
 * machinery, the Forever Project Integration (RC4.0) policy,
 * state/outcome/stats machinery, and their guards, the Forever Project
 * Template (RC4.2) slug and `proj_` project-id conventions, the Forever
 * Project Sources (RC4.4) source ids and version handling, and the Forever
 * Extraction Pipeline (RC4.5) facts, provenance, evidence, confidence, and
 * validation guards. It changes no existing file.
 */

export * from "./types";
export * from "./version";
export * from "./identity";
export * from "./section";
export * from "./status";
export * from "./value";
export * from "./field";
export * from "./change";
export * from "./revision";
export * from "./snapshot";
export * from "./timeline";
export * from "./record";
export * from "./database";
export * from "./policy";
export * from "./context";
export * from "./result";
export * from "./merge";
export * from "./history";
export * from "./catalog";
export * from "./registry";
export * from "./helpers";
export * from "./contracts";
export * from "./validation";
