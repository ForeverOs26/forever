/**
 * Forever Database — runtime validation schemas.
 *
 * Zod mirrors of the canonical models. They exist so future import pipelines
 * can validate untrusted extracted data at the boundary before it becomes a
 * canonical record. The schemas are the runtime counterpart of the compile
 * time types in `./models`; the two are kept structurally aligned.
 */

import { z } from "zod";

const idSchema = z.string().min(1);
const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a lowercase slug");
const currencySchema = z.string().length(3);

export const moneySchema = z.object({
  amount: z.number().finite(),
  currency: currencySchema,
});

export const geoPointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const sourceMetadataSchema = z.object({
  sourceLabel: z.string().optional(),
  sourceFile: z.string().optional(),
  sourcePage: z.number().int().nonnegative().optional(),
  sourceDate: z.string().optional(),
  extractedAt: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  raw: z.record(z.unknown()).optional(),
});

const auditFields = {
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
};

const verificationStatusSchema = z.enum(["unverified", "pending", "verified"]);

export const developerSchema = z.object({
  ...auditFields,
  id: idSchema,
  slug: slugSchema,
  name: z.string().min(1),
  country: z.string().optional(),
  legalName: z.string().optional(),
  description: z.string().optional(),
  website: z.string().optional(),
  logoUrl: z.string().optional(),
  headquarters: z.string().optional(),
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().optional(),
  verificationStatus: verificationStatusSchema,
  lastVerifiedDate: z.string().optional(),
  notes: z.string().optional(),
  source: sourceMetadataSchema.optional(),
});

export const locationSchema = z.object({
  ...auditFields,
  id: idSchema,
  slug: slugSchema,
  areaName: z.string().min(1),
  country: z.string().optional(),
  province: z.string().optional(),
  district: z.string().optional(),
  geo: geoPointSchema.optional(),
  description: z.string().optional(),
  marketSummary: z.string().optional(),
  lifestyleSummary: z.string().optional(),
  distanceToBeach: z.string().optional(),
  distanceToAirport: z.string().optional(),
  nearbySchools: z.array(z.string()),
  nearbyHospitals: z.array(z.string()),
  lifestyle: z.array(z.string()),
  source: sourceMetadataSchema.optional(),
});

export const projectSchema = z.object({
  ...auditFields,
  id: idSchema,
  slug: slugSchema,
  name: z.string().min(1),
  developerId: idSchema.optional(),
  locationId: idSchema.optional(),
  projectType: z.string(),
  publicStatus: z.enum(["draft", "active", "archived", "unknown"]),
  salesStatus: z.enum(["available", "sold_out", "coming_soon", "resale", "unknown"]),
  constructionStatus: z.enum(["planning", "under_construction", "completed", "unknown"]),
  ownershipType: z.enum(["freehold", "leasehold", "mixed", "unknown"]),
  raw: z.object({
    publicStatus: z.string(),
    salesStatus: z.string(),
    constructionStatus: z.string(),
    ownershipType: z.string(),
  }),
  country: z.string().optional(),
  province: z.string().optional(),
  area: z.string().optional(),
  address: z.string().optional(),
  code: z.string().optional(),
  tagline: z.string().optional(),
  shortDescription: z.string().optional(),
  fullDescription: z.string().optional(),
  completionDate: z.string().optional(),
  highlights: z.array(z.string()),
  bedsLabel: z.string().optional(),
  areaLabel: z.string().optional(),
  mainImageUrl: z.string().optional(),
  brochureUrl: z.string().optional(),
  pricing: z.object({
    startingPrice: moneySchema.optional(),
    priceRangeLabel: z.string().optional(),
    pricePerSqmLabel: z.string().optional(),
    verifiedPriceLabel: z.string().optional(),
    promotion: z.string().optional(),
    lastPriceUpdate: z.string().optional(),
  }),
  trust: z.object({
    foreverVerified: z.boolean(),
    trustScore: z.number().optional(),
    trustNote: z.string().optional(),
    marketPosition: z.string().optional(),
    verdict: z.string().optional(),
    lastInspectionDate: z.string().optional(),
  }),
  isFeatured: z.boolean(),
  isActive: z.boolean(),
  source: sourceMetadataSchema.optional(),
});

export const unitSchema = z.object({
  ...auditFields,
  id: idSchema,
  projectId: idSchema,
  buildingId: idSchema.optional(),
  code: z.string().min(1),
  unitType: z.string(),
  availabilityStatus: z.enum(["available", "reserved", "sold", "unavailable", "unknown"]),
  availabilityStatusRaw: z.string(),
  ownershipType: z.enum(["freehold", "leasehold", "mixed", "unknown"]),
  ownershipTypeRaw: z.string(),
  bedrooms: z.number().optional(),
  bathrooms: z.number().optional(),
  sizeSqm: z.number().optional(),
  floor: z.number().optional(),
  viewType: z.string().optional(),
  basePrice: moneySchema.optional(),
  discountedPrice: moneySchema.optional(),
  pricePerSqm: z.number().optional(),
  paymentPlanLabel: z.string().optional(),
  furniturePackage: z.string().optional(),
  rentalGuarantee: z.string().optional(),
  roiEstimate: z.string().optional(),
  notes: z.string().optional(),
  source: sourceMetadataSchema.optional(),
});

export const mediaSchema = z.object({
  ...auditFields,
  id: idSchema,
  projectId: idSchema,
  mediaType: z.enum([
    "cover_image",
    "gallery_image",
    "floor_plan_image",
    "master_plan_image",
    "unit_plan_image",
    "image",
    "video",
    "other",
  ]),
  title: z.string(),
  url: z.string().min(1),
  altText: z.string().optional(),
  caption: z.string().optional(),
  sortOrder: z.number().int(),
  isPublic: z.boolean(),
  source: sourceMetadataSchema.optional(),
});

export const documentSchema = z.object({
  ...auditFields,
  id: idSchema,
  projectId: idSchema,
  documentType: z.enum([
    "brochure",
    "price_list",
    "unit_plan",
    "floor_plan",
    "master_plan",
    "payment_plan",
    "legal",
    "other",
  ]),
  title: z.string(),
  url: z.string().min(1),
  description: z.string().optional(),
  label: z.string().optional(),
  note: z.string().optional(),
  fileExtension: z.string().optional(),
  verificationStatus: verificationStatusSchema.optional(),
  sortOrder: z.number().int(),
  isPublic: z.boolean(),
  source: sourceMetadataSchema.optional(),
});

export const paymentMilestoneSchema = z.object({
  label: z.string(),
  percentage: z.number().optional(),
  amount: moneySchema.optional(),
  dueOn: z.string().optional(),
  sortOrder: z.number().int(),
});

export const paymentPlanSchema = z.object({
  ...auditFields,
  id: idSchema,
  projectId: idSchema,
  unitId: idSchema.optional(),
  name: z.string(),
  description: z.string().optional(),
  milestones: z.array(paymentMilestoneSchema),
  source: sourceMetadataSchema.optional(),
});

export const constructionProgressSchema = z.object({
  ...auditFields,
  id: idSchema,
  projectId: idSchema,
  buildingId: idSchema.optional(),
  status: z.enum(["planning", "under_construction", "completed", "unknown"]),
  statusRaw: z.string(),
  phase: z
    .enum(["planning", "foundation", "structure", "finishing", "completed", "unknown"])
    .optional(),
  percentComplete: z.number().min(0).max(100).optional(),
  completionDate: z.string().optional(),
  reportedDate: z.string().optional(),
  notes: z.string().optional(),
  source: sourceMetadataSchema.optional(),
});

export const rentalInformationSchema = z.object({
  ...auditFields,
  id: idSchema,
  projectId: idSchema,
  unitId: idSchema.optional(),
  expectedDailyRate: moneySchema.optional(),
  expectedMonthlyRent: moneySchema.optional(),
  expectedYearlyRent: moneySchema.optional(),
  occupancyRatePercent: z.number().min(0).max(100).optional(),
  guaranteedRentalPercent: z.number().optional(),
  guaranteeYears: z.number().optional(),
  managementCompany: z.string().optional(),
  rentalYieldLabel: z.string().optional(),
  rentalDemand: z.string().optional(),
  notes: z.string().optional(),
  source: sourceMetadataSchema.optional(),
});

export const investmentInformationSchema = z.object({
  ...auditFields,
  id: idSchema,
  projectId: idSchema,
  unitId: idSchema.optional(),
  investmentValue: moneySchema.optional(),
  annualRoiPercent: z.number().optional(),
  capitalGrowthEstimate: z.string().optional(),
  source: sourceMetadataSchema.optional(),
});

export const foreverDatabaseRecordSchema = z.object({
  project: projectSchema,
  developer: developerSchema.nullable(),
  location: locationSchema.nullable(),
  units: z.array(unitSchema),
  media: z.array(mediaSchema),
  documents: z.array(documentSchema),
  paymentPlans: z.array(paymentPlanSchema),
  constructionProgress: z.array(constructionProgressSchema),
  rentalInformation: z.array(rentalInformationSchema),
  investmentInformation: z.array(investmentInformationSchema),
});
