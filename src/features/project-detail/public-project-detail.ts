/**
 * Removes values that the public Decision Deck does not need or is not
 * permitted to expose. This runs before route data enters the query cache, so
 * withholding is not merely a DOM decision: conflicting speakers, ownership
 * claims and source-facing metadata never cross the loader boundary.
 */

import { developerIdentity } from "./developer-identity";
import {
  locationMapDocument,
  projectBrochures,
  projectFloorPlans,
  projectMasterPlan,
  projectPhotographs,
  projectUnitPlans,
  projectVideos,
  publicProjectDocuments,
} from "./project-sections";
import type {
  ProjectDetail,
  ProjectDetailDocument,
  ProjectDetailMediaItem,
} from "./project-detail-types";
import { publicRecordedText } from "./public-value";
import { publicHttpUrl } from "./public-url";

function publicMedia(item: ProjectDetailMediaItem): ProjectDetailMediaItem {
  return {
    id: item.id,
    type: item.type,
    // Free-text media titles can contain source filenames, campaign language
    // or a developer identity that the truth layer has withheld.
    title: "",
    url: item.url.trim(),
    sortOrder: item.sortOrder,
    semanticRole: item.semanticRole,
  };
}

function publicDocument(
  document: ProjectDetailDocument,
  mapDocument: ProjectDetailDocument | null,
): ProjectDetailDocument {
  return {
    ...publicMedia(document),
    // The Decision Deck regenerates both labels from a closed type vocabulary.
    label: "",
    note: "",
    semanticRole:
      mapDocument && mapDocument.id === document.id && mapDocument.url === document.url
        ? "map"
        : document.semanticRole,
  };
}

export function publicProjectDetail(project: ProjectDetail): ProjectDetail {
  const identity = developerIdentity(project);
  const hasCanonicalDeveloper =
    identity.state === "named" && Boolean(project.developer?.name.trim());
  const photographs = projectPhotographs(project).map(publicMedia);
  const masterPlan = projectMasterPlan(project);
  const mapDocument = locationMapDocument(project);
  const finiteNumber = (value: number | null): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const coordinate = (value: number | null, minimum: number, maximum: number): number | null => {
    const number = finiteNumber(value);
    return number !== null && number >= minimum && number <= maximum ? number : null;
  };
  const publicList = (values: readonly string[]): string[] =>
    values.map(publicRecordedText).filter(Boolean);

  return {
    core: {
      id: project.core.id,
      slug: project.core.slug.trim(),
      name: project.core.name.trim(),
      type: publicRecordedText(project.core.type),
      status: publicRecordedText(project.core.status),
      constructionStatus: publicRecordedText(project.core.constructionStatus),
      ownershipType: "",
      location: publicRecordedText(project.core.location),
      address: publicRecordedText(project.core.address),
      // Promotional prose is not part of the evidence-based overview or
      // metadata. Keeping it in hydrated route data would still publish it.
      tagline: "",
      description: "",
      highlights: [],
      beds: "",
      area: "",
      isFeatured: Boolean(project.core.isFeatured),
      isActive: Boolean(project.core.isActive),
      isDemoPreview: project.core.isDemoPreview,
      usesLocalPreviewData: project.core.usesLocalPreviewData,
      developerNameRaw:
        identity.state === "named" && !hasCanonicalDeveloper
          ? publicRecordedText(identity.name)
          : "",
      locationNameRaw: "",
      developerIdentityState: identity.state === "withheld" ? "conflicting" : undefined,
      // Ownership is globally unapproved for public presentation, so the
      // anonymous query does not retrieve it at all.
      ownershipPresentationState: "withheld",
    },
    pricing: {
      startingPriceTHB:
        Number.isFinite(project.pricing.startingPriceTHB) && project.pricing.startingPriceTHB > 0
          ? project.pricing.startingPriceTHB
          : 0,
      displayPrice: "",
      priceRange: "",
      pricePerSqm: "",
      verifiedPrice: "",
      promotion: "",
      lastPriceUpdate: publicRecordedText(project.pricing.lastPriceUpdate),
    },
    // These legacy scalars have no published evidence contract. The database
    // mapper already suppresses them; this also protects demo/adaptor inputs.
    trust: {
      foreverVerified: false,
      trustScore: 0,
      trustNote: "",
      marketPosition: "",
      verdict: "",
      lastInspection: "",
    },
    investment: {
      investmentValue: 0,
      rentalYield: "",
      rentalDemand: "",
      capitalGrowthEstimate: "",
      rows: [],
    },
    location: {
      area: publicRecordedText(project.location.area),
      latitude: coordinate(project.location.latitude, -90, 90),
      longitude: coordinate(project.location.longitude, -180, 180),
      distanceToBeach: publicRecordedText(project.location.distanceToBeach),
      distanceToAirport: publicRecordedText(project.location.distanceToAirport),
      nearbySchools: publicList(project.location.nearbySchools),
      nearbyHospitals: publicList(project.location.nearbyHospitals),
      lifestyle: publicList(project.location.lifestyle),
    },
    developer:
      identity.state === "named" && hasCanonicalDeveloper && project.developer
        ? {
            id: project.developer.id,
            name: publicRecordedText(project.developer.name),
            description: publicRecordedText(project.developer.description),
            website: publicHttpUrl(project.developer.website),
            contactName: "",
            contactPhone: "",
            contactEmail: "",
            logoUrl: publicHttpUrl(project.developer.logoUrl),
          }
        : null,
    media: {
      hero: photographs[0] ?? null,
      gallery: photographs.slice(1),
      floorPlans: projectFloorPlans(project).map(publicMedia),
      masterPlan: masterPlan ? publicMedia(masterPlan) : null,
      unitPlans: projectUnitPlans(project).map(publicMedia),
      brochures: projectBrochures(project).map(publicMedia),
      videos: projectVideos(project).map(publicMedia),
      documents: publicProjectDocuments(project).map((document) =>
        publicDocument(document, mapDocument),
      ),
    },
    units: project.units.map((unit) => ({
      id: unit.id,
      code: unit.code.trim(),
      ...(unit.buildingCode ? { buildingCode: unit.buildingCode.trim() } : {}),
      type: publicRecordedText(unit.type),
      bedrooms: finiteNumber(unit.bedrooms),
      bathrooms: finiteNumber(unit.bathrooms),
      sizeSqm: finiteNumber(unit.sizeSqm),
      floor: finiteNumber(unit.floor),
      viewType: publicRecordedText(unit.viewType),
      ownershipType: "",
      basePriceTHB: finiteNumber(unit.basePriceTHB),
      discountedPriceTHB: finiteNumber(unit.discountedPriceTHB),
      pricePerSqm: finiteNumber(unit.pricePerSqm),
      availabilityStatus: unit.availabilityStatus.trim(),
      paymentPlan: "",
      furniturePackage: "",
      rentalGuarantee: "",
      roiEstimate: "",
      notes: "",
    })),
    amenities: project.amenities.map((amenity) => ({
      id: amenity.id,
      slug: amenity.slug,
      name: publicRecordedText(amenity.name),
      category: publicRecordedText(amenity.category),
      icon: publicRecordedText(amenity.icon),
      note: publicRecordedText(amenity.note),
      isFeatured: Boolean(amenity.isFeatured),
      sortOrder: Number.isFinite(amenity.sortOrder) ? amenity.sortOrder : 0,
    })),
  };
}
