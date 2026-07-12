/**
 * Forever Project Readiness (RC4.9) — the Forever Project Readiness
 * foundation.
 *
 * The exit gate of the intake chain: RC4.4 catalogued the documents a
 * project receives, RC4.5 described how those documents produce structured
 * extracted facts, RC4.6 described the canonical database those facts settle
 * into, RC4.7 described the cross-source examination between them, RC4.8
 * described the knowledge graph they add up to — and RC4.9 describes the
 * *judgement* the chain has been building toward: whether a project's
 * accumulated knowledge satisfies the requirements a caller states, and
 * exactly what stands in the way when it does not. It formalizes the
 * readiness audits the repository keeps by hand today (required facts
 * present, confidence and trust bars met, corroboration established,
 * conflicts examined, blockers named) into one deterministic, traceable
 * description — a `ready` standing is something a human or a future runtime
 * acts on, never an action, and an unmet requirement is a described blocker,
 * never a waived one.
 *
 * This module is architecture only. It ships no parser, OCR, AI or LLM call,
 * HTTP or API client, Supabase access, database write, filesystem access,
 * queue, worker, scheduler, publication, approval runtime, route, or React.
 * It reads no clock, opens no connection, holds no credential, persists no
 * byte, imports no project, and approves nothing. Nothing here invents
 * anything: a bar exists only because a caller stated it, a judgement exists
 * only because a supplied reused artifact supports it — an absent RC4.6
 * record, RC4.7 report, or RC4.4 source roster settles the statements it
 * would judge into an explicit `indeterminate`, never a fabricated verdict —
 * and a timestamp appears only because a caller supplied one.
 *
 * It defines the report, evaluation, and profile identity and the
 * deterministic id-naming conventions, the {@link ReadinessRequirement}
 * statement vocabulary with its kind-essential parameter grammar and the
 * `required`/`recommended` necessity posture, the reusable
 * {@link ReadinessProfile}, the {@link ReadinessVerdict} and
 * {@link ReadinessStanding} vocabularies with the reused RC4.8 subject
 * standing, the {@link ReadinessEvaluation} with its reused RC4.7
 * traceability references, the reused {@link ReadinessPolicy} behavioural
 * contract, the {@link ReadinessContext} that threads the reused RC4.4
 * sources, RC4.6 record, RC4.7 report, and a caller-supplied clock, the
 * deterministic {@link describeProjectReadiness} examination engine and its
 * {@link ReadinessResult}, the pure report query helpers, the
 * {@link ReadinessHistory} log, the catalogue data model and a deterministic
 * in-memory {@link ReadinessRegistry}, a pluggable {@link ReadinessProvider}
 * contract, the pure helpers the module shares, and a validation pipeline
 * that never throws.
 *
 * It reuses — never restates — the neighbouring foundations: the Forever
 * Database (RC3.0) identity primitives and ISO date types, the Forever
 * Import (RC3.1) severity vocabulary carried through
 * RC3.3/RC4.4/RC4.5/RC4.6, the Forever Sync (RC3.2) retry shape, the Forever
 * Source Registry (RC3.3) id, issue, trust, and version machinery, the
 * Forever Project Integration (RC4.0) policy and state/outcome/stats
 * machinery, the Forever Project Template (RC4.2) slug and `proj_`
 * project-id conventions, the Forever Project Sources (RC4.4) definitions,
 * document types, statuses, and trust ladder, the Forever Extraction
 * Pipeline (RC4.5) confidence machinery and version shape, the Forever
 * Canonical Project Database (RC4.6) records, fields, current-value rule,
 * and issue machinery, the Forever Cross-Source Validation (RC4.7) reports,
 * assessments, findings, references, review rule, bar judgements, total
 * version guards, and string comparison, and the Forever Knowledge Graph
 * (RC4.8) standing vocabulary and consensus mapping. It changes no existing
 * file.
 */

export * from "./types";
export * from "./version";
export * from "./identity";
export * from "./verdict";
export * from "./requirement";
export * from "./evaluation";
export * from "./profile";
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
