/**
 * Forever Database — canonical entity registry.
 *
 * A reusable, source-agnostic description of every canonical table: its name,
 * primary key, and a deterministic natural key used to detect duplicate
 * entities. This is the foundation future import pipelines, Discovery,
 * Navigator, and Marketplace consume — it declares *what* the database holds
 * without prescribing *how* any particular store persists it.
 *
 * The natural key is the identity of a real-world entity independent of its
 * surrogate `id`, so two records that describe the same thing collide even if
 * their ids differ. Validation uses these keys to guarantee "no duplicated
 * entities".
 */

import type {
  ForeverConstructionProgress,
  ForeverDatabaseRecord,
  ForeverDeveloper,
  ForeverDocument,
  ForeverInvestmentInformation,
  ForeverLocation,
  ForeverMedia,
  ForeverPaymentPlan,
  ForeverProject,
  ForeverRentalInformation,
  ForeverUnit,
} from "./models";

/** Static description of one canonical table. */
export interface ForeverEntityDescriptor<T> {
  /** Canonical table name a persistence layer would target. */
  tableName: string;
  /** Every canonical record is keyed by a surrogate `id`. */
  primaryKey: "id";
  /** Deterministic real-world identity, used for duplicate detection. */
  naturalKey: (record: T) => string;
}

function descriptor<T>(
  tableName: string,
  naturalKey: (record: T) => string,
): ForeverEntityDescriptor<T> {
  return { tableName, primaryKey: "id", naturalKey };
}

export const developerEntity = descriptor<ForeverDeveloper>("forever_developers", (d) => d.slug);

export const locationEntity = descriptor<ForeverLocation>("forever_locations", (l) => l.slug);

export const projectEntity = descriptor<ForeverProject>("forever_projects", (p) => p.slug);

export const unitEntity = descriptor<ForeverUnit>(
  "forever_units",
  (u) => `${u.projectId}::${u.code}`,
);

export const mediaEntity = descriptor<ForeverMedia>(
  "forever_media",
  (m) => `${m.projectId}::${m.mediaType}::${m.url}`,
);

export const documentEntity = descriptor<ForeverDocument>(
  "forever_documents",
  (d) => `${d.projectId}::${d.documentType}::${d.url}`,
);

export const paymentPlanEntity = descriptor<ForeverPaymentPlan>(
  "forever_payment_plans",
  (p) => p.id,
);

export const constructionProgressEntity = descriptor<ForeverConstructionProgress>(
  "forever_construction_progress",
  (c) => c.id,
);

export const rentalInformationEntity = descriptor<ForeverRentalInformation>(
  "forever_rental_information",
  (r) => r.id,
);

export const investmentInformationEntity = descriptor<ForeverInvestmentInformation>(
  "forever_investment_information",
  (i) => i.id,
);

/** Registry of every canonical entity, keyed by its record collection name. */
export const foreverDatabaseEntities = {
  developer: developerEntity,
  location: locationEntity,
  project: projectEntity,
  unit: unitEntity,
  media: mediaEntity,
  document: documentEntity,
  paymentPlan: paymentPlanEntity,
  constructionProgress: constructionProgressEntity,
  rentalInformation: rentalInformationEntity,
  investmentInformation: investmentInformationEntity,
} as const;

export type ForeverEntityName = keyof typeof foreverDatabaseEntities;

/** Every canonical table name, for schema/tooling that needs the list. */
export const foreverTableNames: readonly string[] = Object.values(foreverDatabaseEntities).map(
  (entity) => entity.tableName,
);

/** Type-safe accessor kept in sync with {@link ForeverDatabaseRecord}. */
export type ForeverDatabaseRecordKey = keyof ForeverDatabaseRecord;
