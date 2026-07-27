/**
 * Who developed a project — stated only when Forever's sources agree
 * (FOREVER-PR116-RELEASE-STABILIZATION-001, finding F2).
 *
 * Two sources can name a developer: the linked `developers` row
 * (`project.developer.name`) and the raw name the project's own source carried
 * (`project.core.developerNameRaw`). For eight of the nine public projects only
 * one of them speaks, and the page should say what it says.
 *
 * For Modeva both speak and they contradict each other: the linked row is named
 * **"Title"**, while Modeva's own official source says **"Rhom Bho Property"**.
 * PR #116 prints the linked name unconditionally, so the page asserts one side
 * of a contradiction the data audit marks as needing an Owner decision. That is
 * the defect. The rule below is per-project and derived from the data, not from
 * a slug list: state the name when exactly one source speaks or the two agree;
 * state nothing when two sources materially disagree.
 *
 * That keeps the Developer row and section visible on the other eight projects.
 * Hiding Developer globally would be its own kind of dishonesty.
 *
 * Resolving the contradiction is a Factory/data dependency, not a UI one. This
 * module deliberately neither creates nor edits a canonical developer record.
 */

import type { ProjectDetail } from "./project-detail-types";

/**
 * Legal-form and filler words that carry no identifying information.
 *
 * Frozen and explicit: fuzzy similarity scoring has no place in a decision
 * about whether to publish a factual claim, because a threshold that is right
 * for one pair of names is wrong for the next. Dropping a known finite set of
 * corporate-form words is inspectable and gives the same answer every run.
 */
const NON_IDENTIFYING_TOKENS: ReadonlySet<string> = new Set([
  "the",
  "and",
  "co",
  "company",
  "companies",
  "corp",
  "corporation",
  "inc",
  "incorporated",
  "ltd",
  "limited",
  "llc",
  "llp",
  "plc",
  "pcl",
  "public",
  "group",
  "holding",
  "holdings",
  "development",
  "developments",
  "developer",
  "developers",
  "property",
  "properties",
  "pte",
  "pty",
  "sdn",
  "bhd",
  "gmbh",
  "ag",
  "sa",
  "srl",
  "nv",
  "bv",
  "kk",
  "jsc",
  "ojsc",
]);

/**
 * A developer name reduced to its identifying tokens.
 *
 * Returns an empty array when the input names nobody — that is "this source is
 * silent", which is different from "this source disagrees".
 */
export function normaliseDeveloperName(value: string | null | undefined): string[] {
  if (!value) return [];

  const cleaned = value
    .normalize("NFKD")
    // Strip combining marks, so "Ãœ" and "U" cannot read as different developers.
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    // Punctuation and symbols become separators: "Co., Ltd." -> "co ltd".
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return [];

  const tokens = cleaned.split(" ").filter(Boolean);
  const identifying = tokens.filter((token) => !NON_IDENTIFYING_TOKENS.has(token));

  // A name made entirely of corporate-form words still identifies that name and
  // must not collapse to "silent".
  return identifying.length > 0 ? identifying : tokens;
}

/** Whether `shorter` appears inside `longer` as an ordered subsequence. */
function isOrderedSubsequence(shorter: readonly string[], longer: readonly string[]): boolean {
  let index = 0;
  for (const token of longer) {
    if (token === shorter[index]) index += 1;
    if (index === shorter.length) return true;
  }
  return false;
}

/**
 * Whether two named developers are materially different.
 *
 * "Rhom Bho Property Public Company Limited" and "Rhom Bho Property" are the
 * same developer written two ways — a trivial difference, not a material one.
 * "Title" and "Rhom Bho Property" share nothing and are material.
 *
 * The two-token floor on subsequence matching is deliberate: a single shared
 * word is too weak to conclude two names mean the same company.
 */
export function developersMateriallyDisagree(
  canonical: string | null | undefined,
  raw: string | null | undefined,
): boolean {
  const a = normaliseDeveloperName(canonical);
  const b = normaliseDeveloperName(raw);

  // Only one source speaking is not a disagreement.
  if (a.length === 0 || b.length === 0) return false;

  if (a.length === b.length && a.every((token, index) => token === b[index])) return false;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length >= 2 && isOrderedSubsequence(shorter, longer)) return false;

  return true;
}

export type DeveloperIdentity =
  | { state: "named"; name: string; verified: boolean }
  | { state: "absent" }
  | { state: "withheld" };

/**
 * The one decision every developer surface must consult.
 *
 * `verified` distinguishes a linked canonical record from a raw source name, so
 * a caller can keep the existing "as stated by the source, not yet verified"
 * caption rather than presenting the two identically.
 */
export function developerIdentity(project: ProjectDetail): DeveloperIdentity {
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
