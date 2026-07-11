/**
 * Forever Database — validation helpers.
 *
 * Deterministic checks over canonical records: schema validation, duplicate
 * entity detection, and referential integrity. These are the guardrails
 * future import pipelines run before persisting a record. They never throw on
 * invalid data — they return a structured result so callers decide how to
 * react.
 */

import type { ZodType } from "zod";

import { foreverDatabaseEntities, type ForeverEntityDescriptor } from "./entities";
import type { ForeverDatabaseRecord } from "./models";
import { foreverDatabaseRecordSchema } from "./schemas";

export interface ValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

const ok: ValidationResult = { valid: true, issues: [] };

function result(issues: ValidationIssue[]): ValidationResult {
  return issues.length === 0 ? ok : { valid: false, issues };
}

/**
 * Return the natural keys that appear more than once in a set of records.
 *
 * Order-stable and deterministic: keys are returned in first-duplicate order.
 */
export function findDuplicateEntities<T>(
  records: readonly T[],
  descriptor: ForeverEntityDescriptor<T>,
): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const reported = new Set<string>();
  for (const record of records) {
    const key = descriptor.naturalKey(record);
    if (seen.has(key)) {
      if (!reported.has(key)) {
        duplicates.push(key);
        reported.add(key);
      }
    } else {
      seen.add(key);
    }
  }
  return duplicates;
}

/** Validate a single value against a schema, returning a {@link ValidationResult}. */
export function validateWith<T>(
  schema: ZodType<T>,
  value: unknown,
  label: string,
): ValidationResult {
  const parsed = schema.safeParse(value);
  if (parsed.success) return ok;
  const issues = parsed.error.issues.map((issue) => ({
    code: "schema",
    message: issue.message,
    path: [label, ...issue.path.map(String)].join("."),
  }));
  return result(issues);
}

/** Detect duplicate entities across every collection in a record. */
export function validateNoDuplicateEntities(record: ForeverDatabaseRecord): ValidationResult {
  const issues: ValidationIssue[] = [];

  const collect = <T>(
    key: keyof ForeverDatabaseRecord,
    records: readonly T[],
    descriptor: ForeverEntityDescriptor<T>,
  ) => {
    for (const duplicate of findDuplicateEntities(records, descriptor)) {
      issues.push({
        code: "duplicate_entity",
        message: `Duplicate ${String(key)} entity: ${duplicate}`,
        path: String(key),
      });
    }
  };

  collect("units", record.units, foreverDatabaseEntities.unit);
  collect("media", record.media, foreverDatabaseEntities.media);
  collect("documents", record.documents, foreverDatabaseEntities.document);
  collect("paymentPlans", record.paymentPlans, foreverDatabaseEntities.paymentPlan);
  collect(
    "constructionProgress",
    record.constructionProgress,
    foreverDatabaseEntities.constructionProgress,
  );
  collect("rentalInformation", record.rentalInformation, foreverDatabaseEntities.rentalInformation);
  collect(
    "investmentInformation",
    record.investmentInformation,
    foreverDatabaseEntities.investmentInformation,
  );

  return result(issues);
}

/** Verify every child record links back to the project and known units. */
export function validateReferentialIntegrity(record: ForeverDatabaseRecord): ValidationResult {
  const issues: ValidationIssue[] = [];
  const projectId = record.project.id;
  const unitIds = new Set(record.units.map((unit) => unit.id));

  const checkProjectId = (collection: string, id: string, ownerProjectId: string) => {
    if (ownerProjectId !== projectId) {
      issues.push({
        code: "orphan_reference",
        message: `${collection} ${id} references project ${ownerProjectId}, expected ${projectId}`,
        path: collection,
      });
    }
  };

  const checkUnitId = (collection: string, id: string, unitId: string | undefined) => {
    if (unitId !== undefined && !unitIds.has(unitId)) {
      issues.push({
        code: "orphan_reference",
        message: `${collection} ${id} references unknown unit ${unitId}`,
        path: collection,
      });
    }
  };

  if (record.developer && record.project.developerId !== record.developer.id) {
    issues.push({
      code: "orphan_reference",
      message: `project.developerId ${String(record.project.developerId)} does not match developer ${record.developer.id}`,
      path: "developer",
    });
  }
  if (record.location && record.project.locationId !== record.location.id) {
    issues.push({
      code: "orphan_reference",
      message: `project.locationId ${String(record.project.locationId)} does not match location ${record.location.id}`,
      path: "location",
    });
  }

  for (const unit of record.units) checkProjectId("units", unit.id, unit.projectId);
  for (const media of record.media) checkProjectId("media", media.id, media.projectId);
  for (const doc of record.documents) checkProjectId("documents", doc.id, doc.projectId);
  for (const plan of record.paymentPlans) {
    checkProjectId("paymentPlans", plan.id, plan.projectId);
    checkUnitId("paymentPlans", plan.id, plan.unitId);
  }
  for (const progress of record.constructionProgress) {
    checkProjectId("constructionProgress", progress.id, progress.projectId);
  }
  for (const rental of record.rentalInformation) {
    checkProjectId("rentalInformation", rental.id, rental.projectId);
    checkUnitId("rentalInformation", rental.id, rental.unitId);
  }
  for (const investment of record.investmentInformation) {
    checkProjectId("investmentInformation", investment.id, investment.projectId);
    checkUnitId("investmentInformation", investment.id, investment.unitId);
  }

  return result(issues);
}

/**
 * Run the full validation suite over a canonical record: schema, duplicate
 * entities, and referential integrity. Issues from every check are merged.
 */
export function validateForeverDatabaseRecord(record: ForeverDatabaseRecord): ValidationResult {
  const schema = validateWith(foreverDatabaseRecordSchema, record, "record");
  const duplicates = validateNoDuplicateEntities(record);
  const integrity = validateReferentialIntegrity(record);
  const issues = [...schema.issues, ...duplicates.issues, ...integrity.issues];
  return result(issues);
}
