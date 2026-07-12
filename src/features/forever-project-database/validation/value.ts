/**
 * Forever Canonical Project Database — canonical value validation.
 *
 * Composes the reused RC4.5 confidence, evidence, and provenance guards and
 * adds the checks that span one {@link ProjectFieldValue}: the standing must
 * be a known vocabulary value, a stated absence (removed, missing, unknown)
 * may carry no value representation while a current entry must carry one,
 * the raw and structured representations must be well-formed (the reused
 * RC4.5 structured-value guard judges the latter), the reference lists must
 * be coherent, and a superseded entry should say what replaced it — a
 * missing reference is reported, never fabricated. A structurally absent
 * part (`null` or `undefined`) is reported as missing, never dereferenced.
 * All checks return issues; none throw.
 */

import {
  validateExtractionConfidence,
  validateExtractionEvidence,
  validateExtractionProvenance,
} from "@/features/forever-extraction-pipeline";

import { isAbsent, isNonEmptyString } from "../helpers";
import { isKnownProjectValueStatus, projectValueStatusCarriesValue } from "../status";
import { isProjectStructuredValue, projectDatabaseError, projectDatabaseWarning } from "../types";
import type { ProjectDatabaseIssue } from "../types";
import type { ProjectFieldValue } from "../value";

/**
 * Conventional ISO-8601 timestamp prefix: `2026-01-01T00:00:00`. Mirrors the
 * RC4.5/RC4.4 convention (the pattern is internal there, so direct reuse is
 * impossible); deviations warn, they never block.
 */
export const PROJECT_ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/**
 * Conventional language-tag shape: `en`, `th`, `en-GB`. Mirrors the RC4.5
 * convention (the pattern is internal there, so direct reuse is impossible);
 * deviations warn, they never block.
 */
const LANGUAGE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/**
 * Warn when a caller-supplied timestamp deviates from the conventional
 * ISO-8601 shape. Shared by the value, revision, snapshot, timeline, history,
 * and catalogue guards so every timestamp is judged by one rule.
 */
export function projectTimestampIssues(
  value: unknown,
  code: string,
  message: string,
  path: string,
): ProjectDatabaseIssue[] {
  if (!isNonEmptyString(value)) {
    return [projectDatabaseError(code, message, path)];
  }
  if (!PROJECT_ISO_DATE_TIME_PATTERN.test(value)) {
    return [
      projectDatabaseWarning(
        `unconventional_${code}`,
        `Timestamp "${value}" is not an ISO-8601 timestamp`,
        path,
      ),
    ];
  }
  return [];
}

/** Validate one canonical value. `base` locates it, e.g. `values.0`. */
export function validateProjectFieldValue(
  value: ProjectFieldValue,
  base = "value",
): ProjectDatabaseIssue[] {
  if (isAbsent(value)) {
    return [projectDatabaseError("missing_value", "Canonical value is absent", base)];
  }
  const issues: ProjectDatabaseIssue[] = [];

  if (!isKnownProjectValueStatus(value.status)) {
    issues.push(
      projectDatabaseError(
        "unknown_value_status",
        `Canonical value has an unknown status "${String(value.status)}"`,
        `${base}.status`,
      ),
    );
  } else if (!projectValueStatusCarriesValue(value.status)) {
    // A stated absence must remain absent: a value representation on a
    // removed, missing, or unknown entry is a fabrication.
    if (value.rawValue !== undefined || value.structuredValue !== undefined) {
      issues.push(
        projectDatabaseError(
          "absent_with_value",
          `Canonical value is ${value.status} but carries a value — stated absence must remain absent`,
          `${base}.status`,
        ),
      );
    }
  } else if (
    value.status === "current" &&
    value.rawValue === undefined &&
    value.structuredValue === undefined
  ) {
    issues.push(
      projectDatabaseError(
        "current_without_value",
        "Canonical value stands current but carries no representation at all",
        `${base}.status`,
      ),
    );
  }

  if (value.rawValue !== undefined && typeof value.rawValue !== "string") {
    issues.push(
      projectDatabaseError(
        "invalid_raw_value",
        "Canonical raw value must be the observed text, verbatim",
        `${base}.rawValue`,
      ),
    );
  }
  if (value.structuredValue !== undefined && !isProjectStructuredValue(value.structuredValue)) {
    issues.push(
      projectDatabaseError(
        "invalid_structured_value",
        "Canonical structured value is not a scalar, scalar list, Money, or GeoPoint",
        `${base}.structuredValue`,
      ),
    );
  }
  if (value.unit !== undefined && !isNonEmptyString(value.unit)) {
    issues.push(
      projectDatabaseError("empty_unit", "Canonical value declares an empty unit", `${base}.unit`),
    );
  }
  if (value.language !== undefined) {
    if (!isNonEmptyString(value.language)) {
      issues.push(
        projectDatabaseError(
          "empty_language",
          "Canonical value declares an empty language",
          `${base}.language`,
        ),
      );
    } else if (!LANGUAGE_PATTERN.test(value.language)) {
      issues.push(
        projectDatabaseWarning(
          "unconventional_language",
          `Canonical value language "${value.language}" does not match the conventional tag shape`,
          `${base}.language`,
        ),
      );
    }
  }

  if (isAbsent(value.confidence)) {
    issues.push(
      projectDatabaseError(
        "missing_confidence",
        "Canonical value carries no confidence — an unassessed confidence must say `unknown` explicitly",
        `${base}.confidence`,
      ),
    );
  } else {
    issues.push(...validateExtractionConfidence(value.confidence, `${base}.confidence`));
  }

  if (value.factId !== undefined && !isNonEmptyString(value.factId)) {
    issues.push(
      projectDatabaseError(
        "empty_fact_reference",
        "Canonical value declares an empty fact reference",
        `${base}.factId`,
      ),
    );
  }

  if (value.sourceIds !== undefined && !Array.isArray(value.sourceIds)) {
    issues.push(
      projectDatabaseError(
        "invalid_source_refs",
        "Canonical value declares a non-list sourceIds value",
        `${base}.sourceIds`,
      ),
    );
  } else if (value.sourceIds !== undefined) {
    const seen = new Set<string>();
    value.sourceIds.forEach((id, index) => {
      if (!isNonEmptyString(id)) {
        issues.push(
          projectDatabaseError(
            "empty_source_reference",
            "Canonical value declares an empty source reference",
            `${base}.sourceIds.${index}`,
          ),
        );
        return;
      }
      if (seen.has(id)) {
        issues.push(
          projectDatabaseError(
            "duplicate_source_reference",
            `Canonical value repeats the source reference "${id}"`,
            `${base}.sourceIds.${index}`,
          ),
        );
      }
      seen.add(id);
    });
  }

  if (value.evidence !== undefined && !Array.isArray(value.evidence)) {
    issues.push(
      projectDatabaseError(
        "invalid_evidence",
        "Canonical value declares a non-list evidence value",
        `${base}.evidence`,
      ),
    );
  } else if (value.evidence !== undefined) {
    value.evidence.forEach((entry, index) => {
      if (isAbsent(entry)) {
        issues.push(
          projectDatabaseError(
            "missing_evidence_entry",
            "Canonical value declares an absent evidence entry",
            `${base}.evidence.${index}`,
          ),
        );
        return;
      }
      issues.push(...validateExtractionEvidence(entry, {}, `${base}.evidence.${index}`));
    });
  }

  if (value.provenance !== undefined) {
    if (isAbsent(value.provenance)) {
      issues.push(
        projectDatabaseError(
          "missing_provenance",
          "Canonical value declares an absent provenance chain",
          `${base}.provenance`,
        ),
      );
    } else {
      issues.push(
        ...validateExtractionProvenance(
          value.provenance,
          isNonEmptyString(value.factId) ? { factId: value.factId } : {},
          `${base}.provenance`,
        ),
      );
    }
  }

  if (value.revisionId !== undefined && !isNonEmptyString(value.revisionId)) {
    issues.push(
      projectDatabaseError(
        "empty_revision_reference",
        "Canonical value declares an empty revision reference",
        `${base}.revisionId`,
      ),
    );
  }
  if (value.recordedAt !== undefined) {
    issues.push(
      ...projectTimestampIssues(
        value.recordedAt,
        "recorded_time",
        "Canonical value declares an empty recorded time",
        `${base}.recordedAt`,
      ),
    );
  }

  if (value.supersededBy !== undefined) {
    if (!isNonEmptyString(value.supersededBy)) {
      issues.push(
        projectDatabaseError(
          "empty_fact_reference",
          "Canonical value declares an empty supersededBy reference",
          `${base}.supersededBy`,
        ),
      );
    } else {
      if (value.supersededBy === value.factId) {
        issues.push(
          projectDatabaseError(
            "self_superseding_reference",
            "Canonical value names its own fact as its superseding fact",
            `${base}.supersededBy`,
          ),
        );
      }
      if (
        isKnownProjectValueStatus(value.status) &&
        value.status !== "superseded" &&
        value.status !== "removed"
      ) {
        issues.push(
          projectDatabaseWarning(
            "superseding_reference_on_standing",
            `Canonical value is ${value.status} but names a superseding fact`,
            `${base}.supersededBy`,
          ),
        );
      }
    }
  } else if (value.status === "superseded") {
    issues.push(
      projectDatabaseWarning(
        "superseded_without_reference",
        "Canonical value is superseded but names no superseding fact",
        `${base}.supersededBy`,
      ),
    );
  }

  if (value.note !== undefined && !isNonEmptyString(value.note)) {
    issues.push(
      projectDatabaseError(
        "empty_value_note",
        "Canonical value declares an empty note",
        `${base}.note`,
      ),
    );
  }

  return issues;
}
