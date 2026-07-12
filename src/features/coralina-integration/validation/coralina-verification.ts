/**
 * Coralina integration verification — deterministic data-readiness result.
 *
 * Assembles a single, deterministic verification result for the Coralina
 * vertical slice: which source definitions are present, which canonical entities
 * were created, whether every reference resolves, which verified facts are
 * available, which data gaps remain, and whether the slice is ready for
 * preliminary Advisory consumption.
 *
 * This is data-readiness verification only. It invents no score and no quality
 * verdict — the advisory readiness it reports is the existing Forever Passport
 * verdict, surfaced verbatim, and the `readyForPreliminaryAdvisory` flag is a
 * structural gate (required evidence present and every validation passing), never
 * a judgement about the project.
 */

import { validateForeverDatabaseRecord } from "@/features/forever-database";
import {
  partitionProjectIntegrationIssues,
  validateProjectIntegrationDefinition,
} from "@/features/forever-project-integration";
import {
  partitionSourceIssues,
  validateSourceDefinition,
} from "@/features/forever-source-registry";

import {
  CORALINA_AREA,
  CORALINA_BEACH_DISTANCE,
  CORALINA_BUILDINGS,
  CORALINA_DATA_GAPS,
  CORALINA_DOCUMENT_FACTS,
  CORALINA_MEDIA_FACTS,
  CORALINA_PRICE_LIST_DATE,
  CORALINA_PROJECT_NAME,
  CORALINA_PROJECT_TYPE,
  CORALINA_PROVINCE,
  CORALINA_UNIT_FACTS,
  CORALINA_UNIT_TYPES,
} from "../data";
import { CORALINA_PROJECT_ID, CORALINA_SLUG } from "../identity";
import { buildCoralinaRecord } from "../adapters/coralina-canonical";
import { validateCoralinaImportPayload } from "../adapters/coralina-import-payload";
import { deriveCoralinaAdvisory } from "../integration/coralina-advisory";
import {
  buildCoralinaIntegrationBundle,
  CORALINA_INTEGRATION_DEFINITION,
} from "../integration/coralina-integration";
import { CORALINA_SOURCE_DEFINITIONS } from "../sources";
import { resolveCoralinaReferences } from "./coralina-references";

/** Presence of one registered source definition. */
export interface CoralinaSourcePresence {
  id: string;
  name: string;
  present: boolean;
}

/** Presence and count of one canonical entity collection. */
export interface CoralinaEntityPresence {
  entity: string;
  count: number;
  present: boolean;
  /** Why an entity is absent, when it is. */
  note?: string;
}

/** The complete Coralina data-readiness verification result. */
export interface CoralinaVerificationResult {
  project: { id: string; slug: string; name: string };
  sources: CoralinaSourcePresence[];
  sourcesValid: boolean;
  entities: CoralinaEntityPresence[];
  canonicalValid: boolean;
  canonicalIssueCount: number;
  importPayloadValid: boolean;
  integrationValid: boolean;
  integrationWarningCount: number;
  referencesResolved: boolean;
  unresolvedReferenceCount: number;
  verifiedFacts: string[];
  dataGaps: string[];
  /** The existing Forever Passport readiness verdict, surfaced verbatim. */
  advisoryReadinessVerdict: string;
  /** Structural gate: required evidence present and every validation passing. */
  readyForPreliminaryAdvisory: boolean;
}

/**
 * Build the Coralina verification result. Pure and deterministic: identical
 * committed source data always yields an equal result.
 */
export function buildCoralinaVerification(): CoralinaVerificationResult {
  const record = buildCoralinaRecord();
  const bundle = buildCoralinaIntegrationBundle();

  // Source definitions present and structurally valid.
  const sources: CoralinaSourcePresence[] = CORALINA_SOURCE_DEFINITIONS.map((definition) => ({
    id: definition.identity.id,
    name: definition.identity.name,
    present: true,
  }));
  const sourcesValid = CORALINA_SOURCE_DEFINITIONS.every(
    (definition) => partitionSourceIssues(validateSourceDefinition(definition)).errors.length === 0,
  );

  // Canonical entities created (present) vs. absent (no verified evidence).
  const entities: CoralinaEntityPresence[] = [
    { entity: "project", count: 1, present: true },
    {
      entity: "developer",
      count: 0,
      present: false,
      note: "No verified developer (manifest: SOURCE_PENDING).",
    },
    { entity: "location", count: record.location ? 1 : 0, present: record.location !== null },
    { entity: "units", count: record.units.length, present: record.units.length > 0 },
    { entity: "media", count: record.media.length, present: record.media.length > 0 },
    { entity: "documents", count: record.documents.length, present: record.documents.length > 0 },
    {
      entity: "paymentPlans",
      count: record.paymentPlans.length,
      present: false,
      note: "No verified payment plan or terms.",
    },
    {
      entity: "constructionProgress",
      count: record.constructionProgress.length,
      present: false,
      note: "No verified construction status.",
    },
    {
      entity: "rentalInformation",
      count: record.rentalInformation.length,
      present: false,
      note: "No verified rental figures.",
    },
    {
      entity: "investmentInformation",
      count: record.investmentInformation.length,
      present: false,
      note: "No verified investment figures.",
    },
  ];

  const canonical = validateForeverDatabaseRecord(record);
  const importValidation = validateCoralinaImportPayload();
  const integrationIssues = validateProjectIntegrationDefinition(CORALINA_INTEGRATION_DEFINITION);
  const { errors: integrationErrors, warnings: integrationWarnings } =
    partitionProjectIntegrationIssues(integrationIssues);
  const references = resolveCoralinaReferences(bundle, record);

  const verifiedFacts: string[] = [
    `Project name: ${CORALINA_PROJECT_NAME.value}`,
    `Project type: ${CORALINA_PROJECT_TYPE.value}`,
    `Area / province: ${CORALINA_AREA.value}, ${CORALINA_PROVINCE.value}`,
    `Beach distance: ${CORALINA_BEACH_DISTANCE.value}`,
    `Buildings: ${CORALINA_BUILDINGS.length} (${CORALINA_BUILDINGS.join(", ")})`,
    `Unit types: ${CORALINA_UNIT_TYPES.length}`,
    `Units in price list: ${CORALINA_UNIT_FACTS.length}`,
    `Price list date: ${CORALINA_PRICE_LIST_DATE}`,
    `Classified documents: ${CORALINA_DOCUMENT_FACTS.length}`,
    `Media assets: ${CORALINA_MEDIA_FACTS.length}`,
  ];

  const advisory = deriveCoralinaAdvisory();
  const advisoryReadinessVerdict = advisory.passport.overallVerdict.readinessVerdict;

  const requiredEvidencePresent =
    record.documents.some((d) => d.documentType === "brochure") && record.units.length > 0;

  const readyForPreliminaryAdvisory =
    requiredEvidencePresent &&
    canonical.valid &&
    importValidation.valid &&
    integrationErrors.length === 0 &&
    references.valid;

  return {
    project: { id: CORALINA_PROJECT_ID, slug: CORALINA_SLUG, name: CORALINA_PROJECT_NAME.value },
    sources,
    sourcesValid,
    entities,
    canonicalValid: canonical.valid,
    canonicalIssueCount: canonical.issues.length,
    importPayloadValid: importValidation.valid,
    integrationValid: integrationErrors.length === 0,
    integrationWarningCount: integrationWarnings.length,
    referencesResolved: references.valid,
    unresolvedReferenceCount: references.unresolved.length,
    verifiedFacts,
    dataGaps: [...CORALINA_DATA_GAPS],
    advisoryReadinessVerdict,
    readyForPreliminaryAdvisory,
  };
}
