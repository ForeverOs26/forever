/**
 * Forever Knowledge Graph — catalogue validation.
 *
 * Structural guards over the catalogue data model: an entry must carry a
 * coherent graph, a boolean enablement, and coherent optional registration
 * facts; a catalogue must carry an id and must not catalogue the same graph
 * id twice. A structurally absent part is reported as missing, never
 * dereferenced. All checks return issues; none throw.
 */

import type { KnowledgeGraphCatalog, KnowledgeGraphCatalogEntry } from "../catalog";
import { isAbsent, isNonEmptyString } from "../helpers";
import { knowledgeError } from "../types";
import type { KnowledgeIssue } from "../types";
import { validateKnowledgeGraph } from "./graph";

/**
 * Validate one catalogue entry. `base` locates it; e.g. `entries.0`.
 *
 * Never throws: an entry so hostile it cannot even be read settles into one
 * structured issue.
 */
export function validateKnowledgeGraphCatalogEntry(
  entry: KnowledgeGraphCatalogEntry,
  base = "entry",
): KnowledgeIssue[] {
  try {
    return validateKnowledgeGraphCatalogEntryUnguarded(entry, base);
  } catch {
    return [
      knowledgeError(
        "unvalidatable_input",
        "Catalog entry behaved in a way that could not be validated",
        base,
      ),
    ];
  }
}

function validateKnowledgeGraphCatalogEntryUnguarded(
  entry: KnowledgeGraphCatalogEntry,
  base: string,
): KnowledgeIssue[] {
  if (isAbsent(entry)) {
    return [knowledgeError("missing_entry", "Catalog entry is absent", base)];
  }
  const issues: KnowledgeIssue[] = [];

  if (isAbsent(entry.graph)) {
    issues.push(
      knowledgeError("missing_entry_graph", "Catalog entry carries no graph", `${base}.graph`),
    );
  } else {
    issues.push(...validateKnowledgeGraph(entry.graph, `${base}.graph`));
  }
  if (typeof entry.enabled !== "boolean") {
    issues.push(
      knowledgeError(
        "invalid_entry_enabled",
        "Catalog entry does not state whether it is enabled",
        `${base}.enabled`,
      ),
    );
  }
  if (entry.registeredAt !== undefined && !isNonEmptyString(entry.registeredAt)) {
    issues.push(
      knowledgeError(
        "empty_entry_time",
        "Catalog entry declares an empty registration time",
        `${base}.registeredAt`,
      ),
    );
  }
  if (entry.notes !== undefined && !isNonEmptyString(entry.notes)) {
    issues.push(
      knowledgeError("empty_entry_notes", "Catalog entry declares empty notes", `${base}.notes`),
    );
  }

  return issues;
}

/**
 * Validate a whole catalogue. `base` locates it; empty when standalone.
 *
 * Never throws: a catalogue so hostile it cannot even be read settles into
 * one structured issue.
 */
export function validateKnowledgeGraphCatalog(
  catalog: KnowledgeGraphCatalog,
  base = "",
): KnowledgeIssue[] {
  try {
    return validateKnowledgeGraphCatalogUnguarded(catalog, base);
  } catch {
    return [
      knowledgeError(
        "unvalidatable_input",
        "Knowledge-graph catalogue behaved in a way that could not be validated",
        base === "" ? "catalog" : base,
      ),
    ];
  }
}

function validateKnowledgeGraphCatalogUnguarded(
  catalog: KnowledgeGraphCatalog,
  base: string,
): KnowledgeIssue[] {
  const at = (path: string) => (base === "" ? path : `${base}.${path}`);
  if (isAbsent(catalog)) {
    return [
      knowledgeError(
        "missing_catalog",
        "Knowledge-graph catalogue is absent",
        base === "" ? "catalog" : base,
      ),
    ];
  }
  const issues: KnowledgeIssue[] = [];

  if (!isNonEmptyString(catalog.id)) {
    issues.push(knowledgeError("missing_catalog_id", "Catalog is missing an id", at("id")));
  }
  if (!Array.isArray(catalog.entries)) {
    issues.push(
      knowledgeError("invalid_catalog_entries", "Catalog entries must be a list", at("entries")),
    );
    return issues;
  }

  const seenGraphIds = new Set<string>();
  // Indexed — never a hole-skipping iterator — so an absent slot is reported
  // as a missing entry instead of vanishing silently.
  for (let index = 0; index < catalog.entries.length; index += 1) {
    const entry = catalog.entries[index];
    const entryBase = at(`entries.${index}`);
    issues.push(...validateKnowledgeGraphCatalogEntry(entry, entryBase));
    const graphId = entry?.graph?.id;
    if (isNonEmptyString(graphId)) {
      if (seenGraphIds.has(graphId)) {
        issues.push(
          knowledgeError(
            "duplicate_graph_id",
            `Catalog registers the graph "${graphId}" more than once`,
            `${entryBase}.graph.id`,
          ),
        );
      }
      seenGraphIds.add(graphId);
    }
  }

  return issues;
}
