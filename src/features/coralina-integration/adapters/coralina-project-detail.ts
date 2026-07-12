/**
 * Coralina ProjectDetail view — canonical record → existing advisory input.
 *
 * The existing Advisory derivations (Investment/Rental/Location Intelligence,
 * Forever Passport, Project Summary, Advisor Report, Client Strategy) all consume
 * the `ProjectDetail` view model. This adapter builds that view model
 * deterministically from the canonical Coralina record so the vertical slice can
 * feed the real project into the unchanged advisory architecture — proving
 * consumption without duplicating or rewriting any derivation.
 *
 * Absent facts are mapped to the empty/zero sentinels the advisory already reads
 * as "Not available" (an empty string, `0`, or a `null` coordinate). No fact is
 * fabricated: because the source carries no currency, no verified price, no
 * developer, and no rental/investment figures, those surfaces stay empty and the
 * advisory output therefore stays conservative on its own.
 */

import type { ForeverDatabaseRecord, ForeverUnit } from "@/features/forever-database";
import type {
  ProjectDetail,
  ProjectDetailDocument,
  ProjectDetailMediaItem,
  ProjectDetailUnit,
} from "@/features/project-detail/project-detail-types";

import { buildCoralinaRecord } from "./coralina-canonical";

/** Minimal shape shared by canonical media and document records. */
interface AssetLike {
  id: string;
  title: string;
  url: string;
  sortOrder: number;
}

function toMediaItem(asset: AssetLike, type: string): ProjectDetailMediaItem {
  return { id: asset.id, type, title: asset.title, url: asset.url, sortOrder: asset.sortOrder };
}

function toUnit(unit: ForeverUnit): ProjectDetailUnit {
  return {
    id: unit.id,
    code: unit.code,
    type: unit.unitType,
    bedrooms: unit.bedrooms ?? null,
    bathrooms: unit.bathrooms ?? null,
    sizeSqm: unit.sizeSqm ?? null,
    floor: unit.floor ?? null,
    viewType: unit.viewType ?? "",
    ownershipType: unit.ownershipTypeRaw,
    // No verified currency, so no price is surfaced (kept null, read as absent).
    basePriceTHB: null,
    discountedPriceTHB: null,
    pricePerSqm: null,
    availabilityStatus: unit.availabilityStatusRaw,
    paymentPlan: unit.paymentPlanLabel ?? "",
    furniturePackage: unit.furniturePackage ?? "",
    rentalGuarantee: unit.rentalGuarantee ?? "",
    roiEstimate: unit.roiEstimate ?? "",
    notes: unit.notes ?? "",
  };
}

/**
 * Build the Coralina `ProjectDetail` from its canonical record.
 *
 * Pure and deterministic. This is the seam where the canonical Coralina project
 * meets the existing advisory architecture.
 */
export function buildCoralinaProjectDetail(
  record: ForeverDatabaseRecord = buildCoralinaRecord(),
): ProjectDetail {
  const { project, location, units, media, documents } = record;

  const galleryImages = media.filter((m) => m.mediaType === "gallery_image");
  const videos = media.filter((m) => m.mediaType === "video");
  const unitPlanImages = media.filter((m) => m.mediaType === "unit_plan_image");
  const masterPlanImages = media.filter((m) => m.mediaType === "master_plan_image");
  const brochureDocs = documents.filter((d) => d.documentType === "brochure");
  const otherDocs = documents.filter((d) => d.documentType !== "brochure");

  return {
    core: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      type: project.projectType,
      status: project.raw.salesStatus,
      // No verified construction status/ownership — empty, read as "Not available".
      constructionStatus: "",
      ownershipType: "",
      location: project.area ?? "",
      address: project.address ?? "",
      tagline: project.tagline ?? "",
      description: project.fullDescription ?? "",
      highlights: [...project.highlights],
      beds: "",
      area: "",
      isFeatured: project.isFeatured,
      isActive: project.isActive,
    },
    pricing: {
      // No verified currency → no price surfaced; `0`/"" read as "Not available".
      startingPriceTHB: 0,
      displayPrice: "",
      priceRange: "",
      pricePerSqm: "",
      verifiedPrice: "",
      promotion: "",
      lastPriceUpdate: project.pricing.lastPriceUpdate ?? "",
    },
    trust: {
      foreverVerified: project.trust.foreverVerified,
      trustScore: 0,
      trustNote: "",
      marketPosition: "",
      verdict: "",
      lastInspection: "",
    },
    investment: {
      // No verified investment/rental figures.
      investmentValue: 0,
      rentalYield: "",
      rentalDemand: "",
      capitalGrowthEstimate: "",
      rows: [],
    },
    location: {
      area: location?.areaName ?? "",
      latitude: location?.geo?.latitude ?? null,
      longitude: location?.geo?.longitude ?? null,
      distanceToBeach: location?.distanceToBeach ?? "",
      distanceToAirport: location?.distanceToAirport ?? "",
      nearbySchools: location ? [...location.nearbySchools] : [],
      nearbyHospitals: location ? [...location.nearbyHospitals] : [],
      lifestyle: location ? [...location.lifestyle] : [],
    },
    developer: null,
    media: {
      hero: null,
      gallery: galleryImages.map((m) => toMediaItem(m, "gallery")),
      floorPlans: [],
      masterPlan: masterPlanImages[0] ? toMediaItem(masterPlanImages[0], "master_plan") : null,
      unitPlans: unitPlanImages.map((m) => toMediaItem(m, "unit_plan")),
      brochures: brochureDocs.map((d) => toMediaItem(d, "brochure")),
      videos: videos.map((m) => toMediaItem(m, "video")),
      documents: otherDocs.map(
        (d): ProjectDetailDocument => ({
          id: d.id,
          type: d.documentType,
          title: d.title,
          url: d.url,
          sortOrder: d.sortOrder,
          label: d.label ?? "",
          note: d.note ?? "",
        }),
      ),
    },
    units: units.map(toUnit),
  };
}
