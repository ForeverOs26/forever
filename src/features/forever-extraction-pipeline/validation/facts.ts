/**
 * Forever Extraction Pipeline — the fact-set validation pipeline.
 *
 * Composes the fact guard into one deterministic pass over a list of
 * {@link ExtractionFact}s. This is the single entry point a caller uses
 * before treating extracted facts as coherent. It never throws — it returns a
 * structured {@link ExtractionFactsValidation} verdict, and a structurally
 * absent part (`null` or `undefined`) is reported as missing, never
 * dereferenced.
 *
 * Cross-fact integrity is resolved here: no two facts may share a surrogate
 * id. Everything else that spans facts is deliberately *legal*: one source
 * producing many facts, many sources producing the same fact type, repeated
 * attempts, and conflicting readings all coexist — the conflict helpers
 * describe them, and a future runtime resolves them. Issues from every check
 * are merged in a stable order, so identical input always yields identical
 * issues in an identical order.
 */

import type { ExtractionFact } from "../fact";
import { isAbsent, isNonEmptyString } from "../helpers";
import { extractionError, partitionExtractionIssues } from "../types";
import type { ExtractionError, ExtractionIssue, ExtractionWarning } from "../types";
import { validateExtractionFact } from "./fact";

/** The structured verdict of {@link validateExtractionFacts}. */
export interface ExtractionFactsValidation {
  valid: boolean;
  issues: ExtractionIssue[];
  errors: ExtractionError[];
  warnings: ExtractionWarning[];
}

/**
 * Run the full validation suite over a list of facts.
 *
 * Validates the list shape, every fact, and the uniqueness of surrogate ids
 * across facts. Issues from every check are merged in a stable order.
 */
export function validateExtractionFacts(
  facts: readonly ExtractionFact[],
): ExtractionFactsValidation {
  const issues: ExtractionIssue[] = [];

  if (!Array.isArray(facts)) {
    issues.push(extractionError("invalid_facts_list", "Extracted facts must be a list", "facts"));
  }

  const seenIds = new Set<string>();
  const entries = Array.isArray(facts) ? facts : [];
  entries.forEach((fact, index) => {
    if (isAbsent(fact)) {
      issues.push(
        extractionError("missing_fact", "Fact list entry is missing its fact", `facts.${index}`),
      );
      return;
    }
    issues.push(...validateExtractionFact(fact, `facts.${index}`));

    const id = fact.id;
    if (isNonEmptyString(id)) {
      if (seenIds.has(id)) {
        issues.push(
          extractionError(
            "duplicate_fact_id",
            `Fact id "${id}" appears more than once`,
            `facts.${index}.id`,
          ),
        );
      }
      seenIds.add(id);
    }
  });

  const { errors, warnings } = partitionExtractionIssues(issues);
  return { valid: errors.length === 0, issues, errors, warnings };
}
