/**
 * Who developed a project, stated only when Forever's sources agree
 * (FOREVER-PR116-RELEASE-STABILIZATION-001, finding F2).
 *
 * The linked developer row and the project's own raw source name are
 * independent speakers. One speaker may be stated. When both speak, their
 * safely normalized core names must be exactly equal; otherwise every public
 * consumer withholds the identity.
 */

import type { ProjectDetail } from "./project-detail-types";

/**
 * Explicit legal-form suffixes, longest first.
 *
 * These may be removed only from the END of a name. Words such as `property`,
 * `development`, `group`, `holding`, `the`, and `and` remain identifying
 * company-name tokens wherever they occur. Removing them broadly made
 * materially different companies look equal.
 */
const LEGAL_FORM_SUFFIXES: readonly (readonly string[])[] = [
  ["public", "company", "limited"],
  ["private", "company", "limited"],
  ["public", "limited", "company"],
  ["company", "limited"],
  ["co", "limited"],
  ["co", "ltd"],
  ["pte", "ltd"],
  ["pty", "ltd"],
  ["sdn", "bhd"],
  ["incorporated"],
  ["corporation"],
  ["limited"],
  ["company"],
  ["corp"],
  ["inc"],
  ["ltd"],
  ["llc"],
  ["llp"],
  ["plc"],
  ["pcl"],
  ["gmbh"],
  ["ojsc"],
  ["jsc"],
  ["srl"],
  ["ag"],
  ["sa"],
  ["nv"],
  ["bv"],
  ["kk"],
];

/**
 * Normalize only safe equivalences: Unicode accents, case, ordinary
 * punctuation, repeated whitespace and recognized trailing legal forms.
 *
 * Suffix removal may never erase the whole name. An input made only of
 * legal-form words is still a speaking source, not silence.
 */
export function normaliseDeveloperName(value: string | null | undefined): string[] {
  if (!value) return [];

  const cleaned = value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return [];

  const original = cleaned.split(" ").filter(Boolean);
  let core = original;

  while (core.length > 1) {
    const suffix = LEGAL_FORM_SUFFIXES.find(
      (candidate) =>
        candidate.length < core.length &&
        candidate.every((token, index) => token === core[core.length - candidate.length + index]),
    );
    if (!suffix) break;
    core = core.slice(0, -suffix.length);
  }

  return core.length > 0 ? core : original;
}

/**
 * Whether two named developers are materially different.
 *
 * Compatibility is equality-only after safe normalization. Substrings, token
 * subsets, edit distance, prefixes, token reordering and similarity thresholds
 * are not evidence that two sources name the same legal entity.
 */
export function developersMateriallyDisagree(
  canonical: string | null | undefined,
  raw: string | null | undefined,
): boolean {
  const a = normaliseDeveloperName(canonical);
  const b = normaliseDeveloperName(raw);

  // One source speaking is not a disagreement.
  if (a.length === 0 || b.length === 0) return false;

  return a.length !== b.length || a.some((token, index) => token !== b[index]);
}

export type DeveloperIdentity =
  | { state: "named"; name: string; verified: boolean }
  | { state: "absent" }
  | { state: "withheld" };

/**
 * The one decision every developer surface and adapter must consult.
 */
export function developerIdentity(project: ProjectDetail): DeveloperIdentity {
  if (project.core.developerIdentityState === "conflicting") {
    return { state: "withheld" };
  }
  const canonical = project.developer?.name?.trim() ?? "";
  const raw = project.core.developerNameRaw?.trim() ?? "";

  if (developersMateriallyDisagree(canonical, raw)) return { state: "withheld" };
  if (canonical) return { state: "named", name: canonical, verified: true };
  if (raw) return { state: "named", name: raw, verified: false };
  return { state: "absent" };
}

/** The name to print, or `null` when there is nothing safe to print. */
export function presentableDeveloperName(project: ProjectDetail): string | null {
  const identity = developerIdentity(project);
  return identity.state === "named" ? identity.name : null;
}
