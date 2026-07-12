/**
 * Forever Cross-Validation (RC4.7) — the Forever Cross-Source Validation
 * foundation.
 *
 * The judgement seam of the intake chain: RC4.4 catalogued the documents a
 * project receives, RC4.5 described how those documents produce structured
 * extracted facts, RC4.6 described the canonical database those facts settle
 * into — and RC4.7 describes the examination *between* them: whether a batch
 * of extracted facts can be trusted into the canonical record, judged across
 * every registered source that speaks. Agreement between independent sources,
 * conflicting readings, outdated revisions, duplicated facts, missing or
 * inconsistent evidence and provenance, unsupported claims, uncovered
 * expectations, and readings below a caller-stated trust or confidence bar
 * are all *described* — as findings with dispositions, per-subject consensus
 * assessments, and per-fact admissibility standings — and none of them is
 * ever resolved: a contested subject keeps every side standing and marks all
 * of them for future human review, because preserving uncertainty is the
 * point and manufacturing certainty is the failure mode.
 *
 * This module is architecture only. It ships no parser, OCR, AI or LLM call,
 * HTTP or API client, Supabase access, database write, filesystem access,
 * queue, worker, scheduler, publication, approval runtime, route, or React.
 * It reads no clock, opens no connection, holds no credential, persists no
 * byte, normalizes no value, and elects no winner between disagreeing
 * sources. Nothing here invents anything: an unregistered source stays
 * unresolved, an unassessed confidence stays `unknown`, a timestamp appears
 * only because a caller supplied one, and a validation bar exists only
 * because a caller stated it.
 *
 * It defines the report and finding identity and the deterministic id-naming
 * conventions, the {@link CrossValidationSubject} over the reused RC4.5
 * subject rule, the {@link CrossSourceReading} view of one fact with the
 * reused RC4.6 value-signature bridge (so agreement here can never disagree
 * with the canonical merge there), the reused RC4.4 authority and
 * independence judgement, the {@link CrossValidationFinding} vocabulary with
 * its dispositions, dimensions, and traceability references, the
 * {@link CrossValidationAssessment} per-subject consensus that preserves
 * uncertainty, the {@link CrossFactStanding} admissibility bridge into
 * RC4.6, the caller-stated {@link CrossValidationRequirements}, the reused
 * {@link CrossValidationPolicy} behavioural contract, the
 * {@link CrossValidationContext} that threads a caller-supplied clock, the
 * deterministic {@link describeCrossSourceValidation} examination engine and
 * its {@link CrossValidationResult}, the {@link CrossValidationHistory} log,
 * the catalogue data model and a deterministic in-memory
 * {@link CrossValidationRegistry}, a pluggable {@link CrossValidationProvider}
 * contract, the pure helpers the module shares, and a validation pipeline
 * that never throws.
 *
 * It reuses — never restates — the neighbouring foundations: the Forever
 * Database (RC3.0) identity primitives and ISO date types, the Forever Import
 * (RC3.1) severity vocabulary carried through RC3.3/RC4.4/RC4.5/RC4.6, the
 * Forever Sync (RC3.2) retry shape, the Forever Source Registry (RC3.3) id,
 * issue, trust, and version machinery, the Forever Project Integration
 * (RC4.0) policy and state/outcome/stats machinery, the Forever Project
 * Template (RC4.2) slug and `proj_` project-id conventions, the Forever
 * Project Sources (RC4.4) definitions, authority, status, and relationship
 * machinery, the Forever Extraction Pipeline (RC4.5) facts, subject keys,
 * status predicates, confidence machinery, and validators, and the Forever
 * Canonical Project Database (RC4.6) value bridge, signature rule, and issue
 * machinery. It changes no existing file.
 */

export * from "./types";
export * from "./version";
export * from "./identity";
export * from "./subject";
export * from "./authority";
export * from "./reading";
export * from "./finding";
export * from "./assessment";
export * from "./standing";
export * from "./requirements";
export * from "./policy";
export * from "./context";
export * from "./result";
export * from "./report";
export * from "./history";
export * from "./catalog";
export * from "./registry";
export * from "./helpers";
export * from "./contracts";
export * from "./validation";
