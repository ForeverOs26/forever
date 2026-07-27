/**
 * Canonical completion-status model for public Discovery (F-001).
 *
 * The database stores construction status as free text, and the values that
 * actually exist there do not match the labels Discovery used to offer:
 * `Under construction` was compared against the option `Under Construction`,
 * and `Completed` against the option `Ready`. Every comparison was an exact,
 * case-sensitive string equality, so the filter returned an empty catalogue
 * for every real status except `Planning`.
 *
 * The fix is a canonical model rather than a data migration: stored records
 * are never rewritten. Both sides of the comparison are folded to a canonical
 * token at read time, so `Under construction`, `UNDER CONSTRUCTION` and
 * `under_construction` all answer the same filter.
 *
 * Two rules keep this honest, and both are load-bearing:
 *
 * 1. **Unknown never disappears.** A status this module does not recognise
 *    maps to `null`, not to a guessed bucket. A `null` project is withheld
 *    from every specific status filter — claiming a build stage the record
 *    does not state would be an invented fact — but it is always present
 *    under "All statuses", so no project is ever unreachable.
 * 2. **Only real statuses are offered.** `deriveCompletionStatuses` reads the
 *    canonical statuses out of the catalogue that is actually loaded, so a
 *    filter option exists only when at least one project answers it. That is
 *    what removes the dead `Nearing Completion` / `Pre-Launch` / `Sold Out`
 *    options the audit found, and what makes a newly published status appear
 *    without a code change.
 */

/** Canonical internal completion status. Never stored, never displayed raw. */
export type CompletionStatus =
  | "planning"
  | "pre-launch"
  | "under-construction"
  | "nearing-completion"
  | "completed"
  | "sold-out";

/** Build-stage order, used to sort the filter options predictably. */
export const COMPLETION_STATUS_ORDER: readonly CompletionStatus[] = [
  "planning",
  "pre-launch",
  "under-construction",
  "nearing-completion",
  "completed",
  "sold-out",
];

/**
 * Public labels. "Completed / Ready" names both vocabularies deliberately: the
 * database says `Completed`, the earlier filter said `Ready`, and a buyer
 * should not have to know which one this catalogue happens to use.
 */
export const COMPLETION_STATUS_LABELS: Record<CompletionStatus, string> = {
  planning: "Planning",
  "pre-launch": "Pre-launch",
  "under-construction": "Under construction",
  "nearing-completion": "Nearing completion",
  completed: "Completed / Ready",
  "sold-out": "Sold out",
};

/** The reset option. Selecting it must never remove a project from the list. */
export const ALL_COMPLETION_STATUSES = "All statuses" as const;

/**
 * Fold a stored value to a comparison token: lowercase, and any run of
 * whitespace, underscores or hyphens collapsed to one space. This is what
 * makes `Under construction`, `under_construction` and `Under  Construction`
 * a single status.
 */
function normalizeToken(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
}

/**
 * Stored spellings, grouped by the canonical status they mean.
 *
 * Entries are recorded synonyms, not guesses. The values Forever actually
 * stores today (`Planning`, `Under construction`, `Completed`) are here
 * alongside the labels the UI historically offered (`Ready`, `Pre-Launch`,
 * `Nearing Completion`, `Sold Out`), so both vocabularies resolve to the same
 * canonical token and neither side can drift again.
 */
const STORED_VARIANTS: Record<CompletionStatus, readonly string[]> = {
  planning: ["planning", "planned", "in planning", "pre construction", "preconstruction"],
  "pre-launch": ["pre launch", "prelaunch", "pre sale", "presale", "pre selling"],
  "under-construction": ["under construction", "in construction", "construction", "building"],
  "nearing-completion": ["nearing completion", "near completion", "nearly complete", "finishing"],
  completed: [
    "completed",
    "complete",
    "ready",
    "ready to move in",
    "ready to move-in",
    "finished",
    "handover",
    "delivered",
  ],
  "sold-out": ["sold out", "soldout", "fully sold"],
};

const CANONICAL_BY_TOKEN: ReadonlyMap<string, CompletionStatus> = new Map(
  Object.entries(STORED_VARIANTS).flatMap(([status, variants]) =>
    variants.map((variant) => [normalizeToken(variant), status as CompletionStatus]),
  ),
);

/**
 * Canonical status for a stored value, or `null` when the record does not
 * state a status this model recognises.
 *
 * `null` is a real answer, not a failure: the caller must keep the project in
 * the catalogue and withhold it only from specific status filters.
 */
export function toCompletionStatus(raw: string | null | undefined): CompletionStatus | null {
  if (!raw) return null;
  const token = normalizeToken(raw);
  if (!token) return null;
  // "Not available" is the model's own absence sentinel, not a build stage.
  if (token === "not available" || token === "unknown" || token === "n a") return null;
  return CANONICAL_BY_TOKEN.get(token) ?? null;
}

/**
 * The canonical statuses present in this catalogue, in build-stage order.
 *
 * Projects whose status is unrecognised contribute no option — offering a
 * filter that can only return them would advertise a build stage the record
 * never stated.
 */
export function deriveCompletionStatuses(
  statuses: readonly (string | null | undefined)[],
): CompletionStatus[] {
  const present = new Set<CompletionStatus>();
  for (const raw of statuses) {
    const canonical = toCompletionStatus(raw);
    if (canonical) present.add(canonical);
  }
  return COMPLETION_STATUS_ORDER.filter((status) => present.has(status));
}
