/**
 * Forever Database — ProjectDetail adapter.
 *
 * Maps the existing, display-oriented `ProjectDetail` view model into the
 * normalized canonical Forever Database record. This is the bridge between
 * RC2 (which produces `ProjectDetail`) and the future database foundation.
 *
 * The mapping is pure and deterministic: identical `ProjectDetail` input
 * always yields an identical `ForeverDatabaseRecord`. It never mutates its
 * input, invents facts, or reads a clock/RNG. Absent facts stay absent, and
 * the original free-text status values are preserved on `raw`/`*Raw` fields
 * so nothing is lost and RC2 keeps working unchanged.
 */

import type {
  ProjectDetail,
  ProjectDetailDocument,
  ProjectDetailInvestmentRow,
  ProjectDetailMediaItem,
  ProjectDetailUnit,
} from "@/features/project-detail/project-detail-types";

import type {
  ForeverConstructionProgress,
  ForeverDatabaseRecord,
  ForeverDeveloper,
  ForeverDocument,
  ForeverDocumentType,
  ForeverInvestmentInformation,
  ForeverLocation,
  ForeverMedia,
  ForeverMediaType,
  ForeverPaymentPlan,
  ForeverProject,
  ForeverRentalInformation,
  ForeverUnit,
} from "../domain/models";
import {
  normalizeAvailabilityStatus,
  normalizeConstructionStatus,
  normalizeOwnershipType,
  normalizePublicStatus,
  normalizeSalesStatus,
  optionalMoney,
  optionalNumber,
  optionalPositiveNumber,
  optionalString,
  slugify,
} from "../domain/normalizers";

function mapDeveloper(project: ProjectDetail): ForeverDeveloper | null {
  const source = project.developer;
  if (!source) return null;
  const name = optionalString(source.name) ?? source.name;
  const slug = slugify(name) || `${project.core.slug}-developer`;
  return {
    id: source.id,
    slug,
    name,
    description: optionalString(source.description),
    website: optionalString(source.website),
    logoUrl: optionalString(source.logoUrl),
    contactName: optionalString(source.contactName),
    contactPhone: optionalString(source.contactPhone),
    contactEmail: optionalString(source.contactEmail),
    verificationStatus: "unverified",
  };
}

function mapLocation(project: ProjectDetail): ForeverLocation | null {
  const source = project.location;
  const areaName = optionalString(source.area);
  if (!areaName) return null;
  const latitude = optionalNumber(source.latitude);
  const longitude = optionalNumber(source.longitude);
  return {
    id: `${project.core.id}::location`,
    slug: slugify(areaName),
    areaName,
    geo: latitude !== undefined && longitude !== undefined ? { latitude, longitude } : undefined,
    distanceToBeach: optionalString(source.distanceToBeach),
    distanceToAirport: optionalString(source.distanceToAirport),
    nearbySchools: [...source.nearbySchools],
    nearbyHospitals: [...source.nearbyHospitals],
    lifestyle: [...source.lifestyle],
  };
}

function mapProject(
  project: ProjectDetail,
  developer: ForeverDeveloper | null,
  location: ForeverLocation | null,
): ForeverProject {
  const { core, pricing, trust } = project;
  const hero = project.media.hero;
  const brochure = project.media.brochures[0];
  return {
    id: core.id,
    slug: core.slug,
    name: core.name,
    developerId: developer?.id,
    locationId: location?.id,
    projectType: core.type,
    publicStatus: normalizePublicStatus(core.status),
    salesStatus: normalizeSalesStatus(core.status),
    constructionStatus: normalizeConstructionStatus(core.constructionStatus),
    ownershipType: normalizeOwnershipType(core.ownershipType),
    raw: {
      publicStatus: core.status,
      salesStatus: core.status,
      constructionStatus: core.constructionStatus,
      ownershipType: core.ownershipType,
    },
    area: optionalString(core.location),
    address: optionalString(core.address),
    tagline: optionalString(core.tagline),
    fullDescription: optionalString(core.description),
    highlights: [...core.highlights],
    bedsLabel: optionalString(core.beds),
    areaLabel: optionalString(core.area),
    mainImageUrl: hero ? optionalString(hero.url) : undefined,
    brochureUrl: brochure ? optionalString(brochure.url) : undefined,
    pricing: {
      startingPrice: optionalMoney(pricing.startingPriceTHB),
      priceRangeLabel: optionalString(pricing.priceRange),
      pricePerSqmLabel: optionalString(pricing.pricePerSqm),
      verifiedPriceLabel: optionalString(pricing.verifiedPrice),
      promotion: optionalString(pricing.promotion),
      lastPriceUpdate: optionalString(pricing.lastPriceUpdate),
    },
    trust: {
      foreverVerified: trust.foreverVerified,
      trustScore: optionalPositiveNumber(trust.trustScore),
      trustNote: optionalString(trust.trustNote),
      marketPosition: optionalString(trust.marketPosition),
      verdict: optionalString(trust.verdict),
      lastInspectionDate: optionalString(trust.lastInspection),
    },
    isFeatured: core.isFeatured,
    isActive: core.isActive,
  };
}

function mapUnit(unit: ProjectDetailUnit, projectId: string): ForeverUnit {
  return {
    id: unit.id,
    projectId,
    code: unit.code,
    unitType: unit.type,
    availabilityStatus: normalizeAvailabilityStatus(unit.availabilityStatus),
    availabilityStatusRaw: unit.availabilityStatus,
    ownershipType: normalizeOwnershipType(unit.ownershipType),
    ownershipTypeRaw: unit.ownershipType,
    bedrooms: optionalNumber(unit.bedrooms),
    bathrooms: optionalNumber(unit.bathrooms),
    sizeSqm: optionalPositiveNumber(unit.sizeSqm),
    floor: optionalNumber(unit.floor),
    viewType: optionalString(unit.viewType),
    basePrice: optionalMoney(unit.basePriceTHB),
    discountedPrice: optionalMoney(unit.discountedPriceTHB),
    pricePerSqm: optionalPositiveNumber(unit.pricePerSqm),
    paymentPlanLabel: optionalString(unit.paymentPlan),
    furniturePackage: optionalString(unit.furniturePackage),
    rentalGuarantee: optionalString(unit.rentalGuarantee),
    roiEstimate: optionalString(unit.roiEstimate),
    notes: optionalString(unit.notes),
  };
}

function mapPaymentPlans(units: ProjectDetailUnit[], projectId: string): ForeverPaymentPlan[] {
  const plans: ForeverPaymentPlan[] = [];
  for (const unit of units) {
    const label = optionalString(unit.paymentPlan);
    if (!label) continue;
    plans.push({
      id: `${unit.id}::payment-plan`,
      projectId,
      unitId: unit.id,
      name: label,
      milestones: [],
    });
  }
  return plans;
}

function mapConstructionProgress(project: ProjectDetail): ForeverConstructionProgress[] {
  const raw = optionalString(project.core.constructionStatus);
  if (!raw) return [];
  return [
    {
      id: `${project.core.id}::construction`,
      projectId: project.core.id,
      status: normalizeConstructionStatus(raw),
      statusRaw: raw,
    },
  ];
}

function toMedia(
  item: ProjectDetailMediaItem,
  projectId: string,
  mediaType: ForeverMediaType,
): ForeverMedia {
  return {
    id: item.id,
    projectId,
    mediaType,
    title: item.title,
    url: item.url,
    sortOrder: item.sortOrder,
    isPublic: true,
  };
}

function mapMedia(project: ProjectDetail): ForeverMedia[] {
  const projectId = project.core.id;
  const media = project.media;
  const out: ForeverMedia[] = [];
  if (media.hero) out.push(toMedia(media.hero, projectId, "cover_image"));
  for (const item of media.gallery) out.push(toMedia(item, projectId, "gallery_image"));
  for (const item of media.floorPlans) out.push(toMedia(item, projectId, "floor_plan_image"));
  if (media.masterPlan) out.push(toMedia(media.masterPlan, projectId, "master_plan_image"));
  for (const item of media.unitPlans) out.push(toMedia(item, projectId, "unit_plan_image"));
  for (const item of media.videos) out.push(toMedia(item, projectId, "video"));
  return out;
}

const DOCUMENT_TYPE_MAP: Record<string, ForeverDocumentType> = {
  brochure: "brochure",
  price_list: "price_list",
  payment_plan: "payment_plan",
  unit_plan: "unit_plan",
  floor_plan: "floor_plan",
  master_plan: "master_plan",
};

function mapDocumentType(type: string): ForeverDocumentType {
  return DOCUMENT_TYPE_MAP[type] ?? "other";
}

function mapDocuments(project: ProjectDetail): ForeverDocument[] {
  const projectId = project.core.id;
  const media = project.media;
  const out: ForeverDocument[] = [];
  for (const item of media.brochures) {
    out.push({
      id: item.id,
      projectId,
      documentType: "brochure",
      title: item.title,
      url: item.url,
      sortOrder: item.sortOrder,
      isPublic: true,
    });
  }
  for (const doc of media.documents as ProjectDetailDocument[]) {
    out.push({
      id: doc.id,
      projectId,
      documentType: mapDocumentType(doc.type),
      title: doc.title,
      url: doc.url,
      label: optionalString(doc.label),
      note: optionalString(doc.note),
      sortOrder: doc.sortOrder,
      isPublic: true,
    });
  }
  return out;
}

function mapRentalInformation(
  project: ProjectDetail,
  unitIds: Set<string>,
): ForeverRentalInformation[] {
  const projectId = project.core.id;
  const out: ForeverRentalInformation[] = [];

  for (const row of project.investment.rows) {
    const record = rentalFromRow(row, projectId, unitIds);
    if (record) out.push(record);
  }

  const rentalYieldLabel = optionalString(project.investment.rentalYield);
  const rentalDemand = optionalString(project.investment.rentalDemand);
  if (rentalYieldLabel || rentalDemand) {
    out.push({
      id: `${projectId}::rental-summary`,
      projectId,
      rentalYieldLabel,
      rentalDemand,
    });
  }

  return out;
}

function rentalFromRow(
  row: ProjectDetailInvestmentRow,
  projectId: string,
  unitIds: Set<string>,
): ForeverRentalInformation | null {
  const expectedDailyRate = optionalMoney(row.expectedDailyRate);
  const expectedMonthlyRent = optionalMoney(row.expectedMonthlyRent);
  const expectedYearlyRent = optionalMoney(row.expectedYearlyRent);
  const occupancyRatePercent = optionalNumber(row.occupancyRate);
  const guaranteedRentalPercent = optionalNumber(row.guaranteedRentalPercent);
  const guaranteeYears = optionalNumber(row.guaranteeYears);
  const managementCompany = optionalString(row.managementCompany);
  const notes = optionalString(row.notes);

  const hasRentalFact =
    expectedDailyRate !== undefined ||
    expectedMonthlyRent !== undefined ||
    expectedYearlyRent !== undefined ||
    occupancyRatePercent !== undefined ||
    guaranteedRentalPercent !== undefined ||
    guaranteeYears !== undefined ||
    managementCompany !== undefined;
  if (!hasRentalFact) return null;

  return {
    id: `${row.id}::rental`,
    projectId,
    unitId: resolveUnitId(row.unitId, unitIds),
    expectedDailyRate,
    expectedMonthlyRent,
    expectedYearlyRent,
    occupancyRatePercent,
    guaranteedRentalPercent,
    guaranteeYears,
    managementCompany,
    notes,
  };
}

function mapInvestmentInformation(
  project: ProjectDetail,
  unitIds: Set<string>,
): ForeverInvestmentInformation[] {
  const projectId = project.core.id;
  const out: ForeverInvestmentInformation[] = [];

  for (const row of project.investment.rows) {
    const annualRoiPercent = optionalNumber(row.annualRoiPercent);
    if (annualRoiPercent === undefined) continue;
    out.push({
      id: `${row.id}::investment`,
      projectId,
      unitId: resolveUnitId(row.unitId, unitIds),
      annualRoiPercent,
    });
  }

  const investmentValue = optionalMoney(project.investment.investmentValue);
  const capitalGrowthEstimate = optionalString(project.investment.capitalGrowthEstimate);
  if (investmentValue || capitalGrowthEstimate) {
    out.push({
      id: `${projectId}::investment-summary`,
      projectId,
      investmentValue,
      capitalGrowthEstimate,
    });
  }

  return out;
}

/** Keep a unit reference only when it points at a unit in this record. */
function resolveUnitId(unitId: string | null, unitIds: Set<string>): string | undefined {
  if (unitId && unitIds.has(unitId)) return unitId;
  return undefined;
}

/**
 * Deterministically map a `ProjectDetail` view model into the canonical
 * Forever Database record. Pure: the input is never mutated.
 */
export function projectDetailToForeverRecord(project: ProjectDetail): ForeverDatabaseRecord {
  const developer = mapDeveloper(project);
  const location = mapLocation(project);
  const projectRecord = mapProject(project, developer, location);
  const units = project.units.map((unit) => mapUnit(unit, project.core.id));
  const unitIds = new Set(units.map((unit) => unit.id));

  return {
    project: projectRecord,
    developer,
    location,
    units,
    media: mapMedia(project),
    documents: mapDocuments(project),
    paymentPlans: mapPaymentPlans(project.units, project.core.id),
    constructionProgress: mapConstructionProgress(project),
    rentalInformation: mapRentalInformation(project, unitIds),
    investmentInformation: mapInvestmentInformation(project, unitIds),
  };
}
