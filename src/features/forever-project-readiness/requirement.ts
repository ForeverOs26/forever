/**
 * Forever Project Readiness — the stated requirement.
 *
 * A {@link ReadinessRequirement} is one caller-stated condition a project's
 * accumulated knowledge must satisfy before the project may be treated as
 * ready: a canonical field must carry a standing value, that value must meet
 * a stated RC4.5 confidence rung, the RC4.7 examination must have judged the
 * field independently corroborated or at least uncontested, a registered
 * RC4.4 document of a stated type (optionally meeting a stated RC3.3 trust
 * rung) must be current, or no examination finding requiring review may
 * stand. Every bar is the caller's statement — RC4.9 never invents a
 * threshold, and an unstated requirement demands nothing (anti-fabrication).
 *
 * Requirements never act: an unmet statement is described as a blocker for a
 * human or a future runtime — never auto-waived, never auto-enforced. The
 * confidence and trust rungs are judged through the reused RC4.5
 * `meetsExtractionConfidence` and RC4.4/RC3.3 `meetsTrustLevel` rules (both
 * reached through their RC4.7 aliases) — one ladder each across the whole
 * system, never a local restatement.
 */

import type { CrossSourceTrustLevel } from "@/features/forever-cross-validation";
import type { ProjectSourceDocumentType } from "@/features/forever-project-sources";

import { compareReadinessStrings, isNonEmptyString } from "./helpers";
import type { ReadinessConfidenceLevel } from "./types";

/**
 * The reused RC4.4/RC3.3 trust ladder (through the RC4.7 alias), under a
 * readiness name — the rung a `source_present` requirement may demand.
 */
export type ReadinessTrustLevel = CrossSourceTrustLevel;

// Reuse the RC4.4/RC3.3 trust machinery through the RC4.7 aliases — the very
// same functions the cross-source examination applies its trust bars with,
// so a readiness trust bar can never disagree with an examination one.
export {
  CROSS_SOURCE_TRUST_LEVELS as READINESS_TRUST_LEVELS,
  meetsCrossSourceTrust as meetsReadinessTrust,
  isKnownCrossSourceTrustLevel as isKnownReadinessTrustLevel,
} from "@/features/forever-cross-validation";

// Reuse the RC4.4 document-type vocabulary and guard — a `source_present`
// requirement names exactly the type the source registry catalogues under,
// never a parallel taxonomy.
export {
  PROJECT_SOURCE_DOCUMENT_TYPES as READINESS_DOCUMENT_TYPES,
  isKnownProjectSourceDocumentType as isKnownReadinessDocumentType,
} from "@/features/forever-project-sources";

/** The RC4.4 document type a `source_present` requirement names. Reused. */
export type ReadinessDocumentType = ProjectSourceDocumentType;

/** The closed vocabulary of conditions a requirement can state. */
export type ReadinessRequirementKind =
  | "field_present"
  | "field_confidence"
  | "field_corroborated"
  | "field_uncontested"
  | "source_present"
  | "findings_clear";

/** Every {@link ReadinessRequirementKind}, in a stable declared order. */
export const READINESS_REQUIREMENT_KINDS = [
  "field_present",
  "field_confidence",
  "field_corroborated",
  "field_uncontested",
  "source_present",
  "findings_clear",
] as const satisfies readonly ReadinessRequirementKind[];

/** Runtime guard: whether a value is a known {@link ReadinessRequirementKind}. */
export function isKnownReadinessRequirementKind(value: unknown): value is ReadinessRequirementKind {
  return (
    typeof value === "string" && (READINESS_REQUIREMENT_KINDS as readonly string[]).includes(value)
  );
}

/** The requirement kinds addressed at one canonical field path. */
export const READINESS_FIELD_REQUIREMENT_KINDS = [
  "field_present",
  "field_confidence",
  "field_corroborated",
  "field_uncontested",
] as const satisfies readonly ReadinessRequirementKind[];

/** Whether a kind addresses one canonical field path (path is essential). */
export function isReadinessFieldRequirementKind(kind: ReadinessRequirementKind): boolean {
  return (READINESS_FIELD_REQUIREMENT_KINDS as readonly ReadinessRequirementKind[]).includes(kind);
}

/**
 * Whether failing the statement blocks readiness (`required`) or merely
 * advises (`recommended`). The safe posture is `required`: only an explicit
 * `recommended` demotes a statement — an absent or malformed necessity
 * demands, it never quietly excuses.
 */
export type ReadinessNecessity = "required" | "recommended";

/** Every {@link ReadinessNecessity}, in a stable declared order. */
export const READINESS_NECESSITIES = [
  "required",
  "recommended",
] as const satisfies readonly ReadinessNecessity[];

/** Runtime guard: whether a value is a known {@link ReadinessNecessity}. */
export function isKnownReadinessNecessity(value: unknown): value is ReadinessNecessity {
  return typeof value === "string" && (READINESS_NECESSITIES as readonly string[]).includes(value);
}

/** One caller-stated condition a project's knowledge must satisfy. */
export interface ReadinessRequirement {
  /** What kind of condition the statement makes. */
  kind: ReadinessRequirementKind;
  /**
   * The dotted canonical field path the statement addresses. Essential for
   * every `field_*` kind; an optional scope for `findings_clear` (an
   * unscoped `findings_clear` addresses the whole examination); never stated
   * for `source_present`.
   */
  path?: string;
  /**
   * The RC4.4 document type at least one registered source must carry.
   * Essential for `source_present`; never stated for the other kinds.
   */
  documentType?: ReadinessDocumentType;
  /**
   * The reused RC3.3 trust rung at least one qualifying source's authority
   * must meet. Optional for `source_present`; never stated for the other
   * kinds.
   */
  minimumTrust?: ReadinessTrustLevel;
  /**
   * The reused RC4.5 confidence rung the standing canonical value must meet.
   * Essential for `field_confidence`; never stated for the other kinds.
   */
  minimumConfidence?: ReadinessConfidenceLevel;
  /** Blocking (`required`, the default posture) or advisory (`recommended`). */
  necessity?: ReadinessNecessity;
  /** Free-text rationale, preserved verbatim. */
  note?: string;
}

/** Options accepted by {@link readinessRequirement}. */
export interface ReadinessRequirementOptions {
  path?: string;
  documentType?: ReadinessDocumentType;
  minimumTrust?: ReadinessTrustLevel;
  minimumConfidence?: ReadinessConfidenceLevel;
  necessity?: ReadinessNecessity;
  note?: string;
}

/**
 * Build a {@link ReadinessRequirement}; optional statements are attached only
 * when supplied so an unstated bar stays unstated (anti-fabrication). The
 * result is deep-copied from the input, so it never aliases a caller value.
 */
export function readinessRequirement(
  kind: ReadinessRequirementKind,
  options: ReadinessRequirementOptions = {},
): ReadinessRequirement {
  const requirement: ReadinessRequirement = { kind };
  if (options.path !== undefined) requirement.path = options.path;
  if (options.documentType !== undefined) requirement.documentType = options.documentType;
  if (options.minimumTrust !== undefined) requirement.minimumTrust = options.minimumTrust;
  if (options.minimumConfidence !== undefined) {
    requirement.minimumConfidence = options.minimumConfidence;
  }
  if (options.necessity !== undefined) requirement.necessity = options.necessity;
  if (options.note !== undefined) requirement.note = options.note;
  // Deep-copy so the built requirement never aliases the caller's input.
  return structuredClone(requirement);
}

/**
 * The necessity a requirement effectively states: only an explicit
 * `recommended` is advisory — the absent (and any malformed) case reads as
 * the demanding safe posture, never as a quiet excuse.
 */
export function readinessRequirementNecessity(
  requirement: ReadinessRequirement | undefined,
): ReadinessNecessity {
  return requirement?.necessity === "recommended" ? "recommended" : "required";
}

/**
 * The subject string a requirement addresses — the canonical path for field
 * and scoped-findings statements, the document type for source statements,
 * and the empty string for an unscoped statement. Used only for the module's
 * deterministic ordering; never an identity.
 */
export function readinessRequirementSubject(requirement: ReadinessRequirement): string {
  if (isNonEmptyString(requirement?.path)) return requirement.path;
  if (isNonEmptyString(requirement?.documentType)) return requirement.documentType;
  return "";
}

/**
 * The deterministic demand signature of a requirement: kind, subject, bars,
 * and effective necessity — everything that makes two statements the *same
 * demand* — joined by a separator no vocabulary value contains. Notes do not
 * participate: restating one demand with a different rationale is still a
 * duplicate demand. Used to set duplicate statements aside deterministically;
 * never an identity.
 */
export function readinessRequirementSignature(requirement: ReadinessRequirement): string {
  return [
    String(requirement?.kind ?? ""),
    isNonEmptyString(requirement?.path) ? requirement.path : "",
    isNonEmptyString(requirement?.documentType) ? requirement.documentType : "",
    isNonEmptyString(requirement?.minimumTrust) ? requirement.minimumTrust : "",
    isNonEmptyString(requirement?.minimumConfidence) ? requirement.minimumConfidence : "",
    readinessRequirementNecessity(requirement),
  ].join("\u0000");
}

/**
 * Compare two requirements in the module's one deterministic order: kind in
 * declared vocabulary order, then subject, then confidence bar, then trust
 * bar, then effective necessity (`required` first). Ties are left to the
 * caller's stable sort — the engine breaks them by statement position.
 */
export function compareReadinessRequirements(
  a: ReadinessRequirement,
  b: ReadinessRequirement,
): number {
  const rankOf = (requirement: ReadinessRequirement): number => {
    const rank = (READINESS_REQUIREMENT_KINDS as readonly string[]).indexOf(
      String(requirement?.kind),
    );
    return rank === -1 ? READINESS_REQUIREMENT_KINDS.length : rank;
  };
  const byKind = rankOf(a) - rankOf(b);
  if (byKind !== 0) return byKind;
  const bySubject = compareReadinessStrings(
    readinessRequirementSubject(a),
    readinessRequirementSubject(b),
  );
  if (bySubject !== 0) return bySubject;
  const byConfidence = compareReadinessStrings(
    isNonEmptyString(a?.minimumConfidence) ? a.minimumConfidence : "",
    isNonEmptyString(b?.minimumConfidence) ? b.minimumConfidence : "",
  );
  if (byConfidence !== 0) return byConfidence;
  const byTrust = compareReadinessStrings(
    isNonEmptyString(a?.minimumTrust) ? a.minimumTrust : "",
    isNonEmptyString(b?.minimumTrust) ? b.minimumTrust : "",
  );
  if (byTrust !== 0) return byTrust;
  return compareReadinessStrings(
    readinessRequirementNecessity(a),
    readinessRequirementNecessity(b),
  );
}
