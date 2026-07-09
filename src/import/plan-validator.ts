import type { PriceHistoryInput } from "./database";
import type { ImportPlan } from "./types";
import type { ValidationIssue } from "./validator";

function countBy<T>(items: T[], key: (item: T) => string | undefined) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = key(item);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function duplicateIssues(entity: string, counts: Map<string, number>): ValidationIssue[] {
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({
      severity: "error" as const,
      code: `${entity}_duplicate_key`,
      message: `${entity} key "${key}" appears ${count} times in the import plan.`,
    }));
}

function priceHistoryKey(row: PriceHistoryInput) {
  return [
    row.unitNumber,
    row.priceSource,
    row.sourceFile ?? "unknown",
    row.sourcePage ?? "none",
    row.priceListDate ?? "none",
    row.sourceRow ?? "none",
  ].join(":");
}

export function validateImportPlanRelationships(plan: ImportPlan): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const buildingCodes = new Set(plan.buildings.map((building) => building.buildingCode));
  const unitCodes = new Set(plan.units.map((unit) => unit.unitNumber));

  issues.push(
    ...duplicateIssues(
      "unit",
      countBy(plan.units, (unit) => unit.unitNumber),
    ),
  );
  issues.push(...duplicateIssues("price_history", countBy(plan.priceHistoryRows, priceHistoryKey)));
  issues.push(
    ...duplicateIssues(
      "building",
      countBy(plan.buildings, (building) => building.buildingCode),
    ),
  );

  for (const unit of plan.units) {
    if (!unit.unitNumber.trim()) {
      issues.push({
        severity: "error",
        code: "unit_code_missing",
        message: "A unit row is missing unit_number.",
      });
    }

    if (unit.buildingCode && !buildingCodes.has(unit.buildingCode)) {
      issues.push({
        severity: "error",
        code: "orphan_unit_building",
        message: `Unit ${unit.unitNumber} references missing building ${unit.buildingCode}.`,
      });
    }
  }

  for (const row of plan.priceHistoryRows) {
    if (!unitCodes.has(row.unitNumber)) {
      issues.push({
        severity: "error",
        code: "orphan_price_history_unit",
        message: `Price history references missing unit ${row.unitNumber}.`,
      });
    }

    if (row.price == null || !Number.isFinite(row.price)) {
      issues.push({
        severity: "error",
        code: "price_history_price_invalid",
        message: `Price history for unit ${row.unitNumber} is missing a numeric price.`,
      });
    }

    if (!row.recordedDate) {
      issues.push({
        severity: "error",
        code: "price_history_date_missing",
        message: `Price history for unit ${row.unitNumber} is missing a recorded price date.`,
      });
    }

    if (row.currency == null) {
      issues.push({
        severity: "warning",
        code: "price_history_currency_null",
        message: `Price history for unit ${row.unitNumber} has explicit null currency in source extraction.`,
      });
    } else if (!row.currency.trim()) {
      issues.push({
        severity: "error",
        code: "price_history_currency_missing",
        message: `Price history for unit ${row.unitNumber} is missing currency.`,
      });
    }
  }

  return issues;
}
