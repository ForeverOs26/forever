/**
 * Forever Project Readiness — report validation.
 *
 * Structural guards over one {@link ReadinessReport}: the identity
 * references must be present, every evaluation must be individually coherent
 * with a unique id and an unrepeated demand, the standing must be vocabulary
 * *and* must equal what the evaluations amount to (a report can never claim
 * a standing its own evaluations do not support), every stated requirement
 * slot must be accounted for exactly once (an evaluated slot resolves to an
 * evaluation this report carries, an inadmissible slot says why, and every
 * evaluation is pointed at by exactly one slot), and the source roster must
 * mirror the sources the evaluations actually reference. A structurally
 * absent part is reported as missing, never dereferenced. All checks return
 * issues; none throw.
 */

import { isAbsent, isNonEmptyString } from "../helpers";
import type { ReadinessReport, ReadinessSlot } from "../report";
import { readinessRequirementSignature } from "../requirement";
import { readinessError } from "../types";
import type { ReadinessIssue } from "../types";
import { isKnownReadinessStanding, readinessStandingFor } from "../verdict";
import { validateReadinessEvaluation } from "./evaluation";

/**
 * Validate a whole report. `base` locates it; empty when standalone.
 *
 * Never throws: a report so hostile it cannot even be read settles into one
 * structured issue.
 */
export function validateReadinessReport(report: ReadinessReport, base = ""): ReadinessIssue[] {
  try {
    return validateReadinessReportUnguarded(report, base);
  } catch {
    return [
      readinessError(
        "unvalidatable_input",
        "Readiness report behaved in a way that could not be validated",
        base === "" ? "report" : base,
      ),
    ];
  }
}

function validateReadinessReportUnguarded(report: ReadinessReport, base: string): ReadinessIssue[] {
  const at = (path: string) => (base === "" ? path : `${base}.${path}`);
  if (isAbsent(report)) {
    return [
      readinessError("missing_report", "Readiness report is absent", base === "" ? "report" : base),
    ];
  }
  const issues: ReadinessIssue[] = [];

  if (!isNonEmptyString(report.id)) {
    issues.push(readinessError("missing_report_id", "Report is missing an id", at("id")));
  }
  if (!isNonEmptyString(report.projectId)) {
    issues.push(
      readinessError(
        "missing_report_project",
        "Report names no canonical project",
        at("projectId"),
      ),
    );
  }
  if (!isNonEmptyString(report.projectSlug)) {
    issues.push(
      readinessError("missing_report_slug", "Report carries no project slug", at("projectSlug")),
    );
  }
  if (report.batch !== undefined && !isNonEmptyString(report.batch)) {
    issues.push(
      readinessError(
        "empty_report_batch",
        "Report declares an empty batch discriminator",
        at("batch"),
      ),
    );
  }
  if (report.profileId !== undefined && !isNonEmptyString(report.profileId)) {
    issues.push(
      readinessError(
        "empty_report_profile",
        "Report declares an empty profile reference",
        at("profileId"),
      ),
    );
  }
  if (report.describedAt !== undefined && !isNonEmptyString(report.describedAt)) {
    issues.push(
      readinessError(
        "empty_report_time",
        "Report declares an empty description time",
        at("describedAt"),
      ),
    );
  }

  // ── Evaluations: individually coherent, unique ids, unrepeated demands ───
  const evaluationIds = new Set<string>();
  if (!Array.isArray(report.evaluations)) {
    issues.push(
      readinessError(
        "invalid_report_evaluations",
        "Report evaluations must be a list",
        at("evaluations"),
      ),
    );
  } else {
    const seenSignatures = new Set<string>();
    for (let index = 0; index < report.evaluations.length; index += 1) {
      const evaluation = report.evaluations[index];
      const evaluationBase = at(`evaluations.${index}`);
      issues.push(...validateReadinessEvaluation(evaluation, evaluationBase));
      if (isAbsent(evaluation)) continue;
      if (isNonEmptyString(evaluation.id)) {
        if (evaluationIds.has(evaluation.id)) {
          issues.push(
            readinessError(
              "duplicate_evaluation_id",
              `Report carries the evaluation id "${evaluation.id}" more than once`,
              `${evaluationBase}.id`,
            ),
          );
        }
        evaluationIds.add(evaluation.id);
      }
      if (!isAbsent(evaluation.requirement)) {
        const signature = readinessRequirementSignature(evaluation.requirement);
        if (seenSignatures.has(signature)) {
          issues.push(
            readinessError(
              "duplicate_requirement",
              "Report judges a demand it already judges",
              `${evaluationBase}.requirement`,
            ),
          );
        }
        seenSignatures.add(signature);
      }
    }
  }

  // ── Standing: vocabulary, and exactly what the evaluations amount to ─────
  if (!isKnownReadinessStanding(report.standing)) {
    issues.push(
      readinessError(
        "unknown_report_standing",
        `Report has an unknown standing "${String(report.standing)}"`,
        at("standing"),
      ),
    );
  } else if (Array.isArray(report.evaluations)) {
    const derived = readinessStandingFor(report.evaluations);
    if (report.standing !== derived) {
      issues.push(
        readinessError(
          "inconsistent_report_standing",
          `Report claims the standing "${report.standing}" but its evaluations amount to "${derived}"`,
          at("standing"),
        ),
      );
    }
  }

  // ── Slots: every stated requirement accounted for exactly once ───────────
  if (!Array.isArray(report.slots)) {
    issues.push(readinessError("invalid_report_slots", "Report slots must be a list", at("slots")));
  } else {
    const referencedEvaluationIds = new Set<string>();
    for (let index = 0; index < report.slots.length; index += 1) {
      const slot: ReadinessSlot = report.slots[index];
      const slotBase = at(`slots.${index}`);
      if (isAbsent(slot)) {
        issues.push(readinessError("missing_slot", "Slot is absent", slotBase));
        continue;
      }
      if (!isNonEmptyString(slot.statement)) {
        issues.push(
          readinessError(
            "missing_slot_statement",
            "Slot names no statement locator",
            `${slotBase}.statement`,
          ),
        );
      }
      if (slot.admissibility === "evaluated") {
        if (!isNonEmptyString(slot.evaluationId)) {
          issues.push(
            readinessError(
              "missing_slot_evaluation",
              "Evaluated slot points at no evaluation",
              `${slotBase}.evaluationId`,
            ),
          );
        } else {
          if (Array.isArray(report.evaluations) && !evaluationIds.has(slot.evaluationId)) {
            issues.push(
              readinessError(
                "unknown_evaluation_reference",
                `Slot points at "${slot.evaluationId}", which the report does not carry`,
                `${slotBase}.evaluationId`,
              ),
            );
          }
          if (referencedEvaluationIds.has(slot.evaluationId)) {
            issues.push(
              readinessError(
                "duplicate_evaluation_reference",
                `Slot points at "${slot.evaluationId}", which another slot already points at`,
                `${slotBase}.evaluationId`,
              ),
            );
          }
          referencedEvaluationIds.add(slot.evaluationId);
        }
      } else if (slot.admissibility === "inadmissible") {
        if (!isNonEmptyString(slot.reason)) {
          issues.push(
            readinessError(
              "missing_slot_reason",
              "Inadmissible slot states no reason",
              `${slotBase}.reason`,
            ),
          );
        }
        if (slot.evaluationId !== undefined) {
          issues.push(
            readinessError(
              "inadmissible_slot_evaluation",
              "Inadmissible slot points at an evaluation",
              `${slotBase}.evaluationId`,
            ),
          );
        }
      } else {
        issues.push(
          readinessError(
            "unknown_slot_admissibility",
            `Slot has an unknown admissibility "${String(slot.admissibility)}"`,
            `${slotBase}.admissibility`,
          ),
        );
      }
    }
    // Every evaluation must be pointed at by exactly one slot — an
    // evaluation nothing stated is an invention, and the duplicate direction
    // is flagged per slot above.
    if (Array.isArray(report.evaluations)) {
      for (let index = 0; index < report.evaluations.length; index += 1) {
        const evaluationId = report.evaluations[index]?.id;
        if (isNonEmptyString(evaluationId) && !referencedEvaluationIds.has(evaluationId)) {
          issues.push(
            readinessError(
              "unstated_evaluation",
              `Evaluation "${evaluationId}" is pointed at by no slot — no statement produced it`,
              at(`evaluations.${index}.id`),
            ),
          );
        }
      }
    }
  }

  // ── Source roster: mirrors what the evaluations actually reference ───────
  if (!Array.isArray(report.sourceIds)) {
    issues.push(
      readinessError("invalid_report_sources", "Report source ids must be a list", at("sourceIds")),
    );
  } else {
    const referencedSources = new Set<string>();
    if (Array.isArray(report.evaluations)) {
      for (const evaluation of report.evaluations) {
        for (const reference of Array.isArray(evaluation?.references)
          ? evaluation.references
          : []) {
          if (isNonEmptyString(reference?.sourceId)) referencedSources.add(reference.sourceId);
        }
      }
    }
    const seenSources = new Set<string>();
    for (let index = 0; index < report.sourceIds.length; index += 1) {
      const sourceId = report.sourceIds[index];
      if (!isNonEmptyString(sourceId)) {
        issues.push(
          readinessError(
            "empty_source_reference",
            "Report references an empty source id",
            at(`sourceIds.${index}`),
          ),
        );
        continue;
      }
      if (seenSources.has(sourceId)) {
        issues.push(
          readinessError(
            "duplicate_source_reference",
            `Report references source "${sourceId}" more than once`,
            at(`sourceIds.${index}`),
          ),
        );
      }
      seenSources.add(sourceId);
      if (Array.isArray(report.evaluations) && !referencedSources.has(sourceId)) {
        issues.push(
          readinessError(
            "unknown_source_reference",
            `Report references source "${sourceId}", which no evaluation traces to`,
            at(`sourceIds.${index}`),
          ),
        );
      }
    }
  }

  return issues;
}
