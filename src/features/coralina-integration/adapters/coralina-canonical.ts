/**
 * Coralina canonical mapping — verified facts → Forever Database record (RC3.0).
 *
 * Builds the one canonical {@link ForeverDatabaseRecord} for Coralina purely
 * from the verified data in `../data`. The mapping is deterministic and never
 * mutates its inputs: the same committed source always yields a byte-identical
 * record.
 *
 * Anti-fabrication is enforced structurally, not by convention:
 *
 * - Developer and country are asserted from RC5.4 official corporate and SEC
 *   evidence with their web provenance retained.
 * - No coordinates, construction status, ownership tenure, payment
 *   plan, rental, or investment fact is emitted — the source states none, so the
 *   corresponding fields/collections stay absent or empty.
 * - Unit prices use the explicit country-default policy. THB is inferred from
 *   source-verified Thailand with medium confidence and remains distinguishable
 *   from a source-verified currency in provenance.
 */

import {
  normalizeAvailabilityStatus,
  slugify,
  type ForeverDatabaseRecord,
  type ForeverDeveloper,
  type ForeverDocument,
  type ForeverDocumentType,
  type ForeverLocation,
  type ForeverMedia,
  type ForeverProject,
  type ForeverUnit,
} from "@/features/forever-database";

import {
  CORALINA_AREA,
  CORALINA_AREA_DETAIL,
  CORALINA_BEACH_DISTANCE,
  CORALINA_BROCHURE_SOURCE_FILE,
  CORALINA_DESCRIPTION,
  CORALINA_COUNTRY,
  CORALINA_DEVELOPER,
  CORALINA_DOCUMENT_FACTS,
  CORALINA_HIGHLIGHTS,
  CORALINA_MEDIA_FACTS,
  CORALINA_NEARBY_DESTINATIONS,
  CORALINA_NEARBY_HOSPITALS,
  CORALINA_PRICE_LIST_DATE,
  CORALINA_PRICE_CURRENCY_DECISION,
  CORALINA_PRICE_LIST_SOURCE_FILE,
  CORALINA_PROJECT_NAME,
  CORALINA_PROJECT_TYPE,
  CORALINA_PROVINCE,
  CORALINA_TAGLINE,
  CORALINA_UNIT_FACTS,
  type CoralinaDocumentFact,
  type CoralinaMediaFact,
  type CoralinaUnitFact,
} from "../data";
import {
  CORALINA_LOCATION_ID,
  CORALINA_DEVELOPER_ID,
  CORALINA_PROJECT_ID,
  CORALINA_SLUG,
  coralinaAssetId,
  coralinaUnitId,
} from "../identity";

/** Provenance label for the developer price list, per the Data Standard. */
const PRICE_LIST_LABEL = "developer_price_list";

function parsePrice(value: string): number {
  return Number(value.replace(/,/g, ""));
}

function mapProject(): ForeverProject {
  return {
    id: CORALINA_PROJECT_ID,
    slug: CORALINA_SLUG,
    name: CORALINA_PROJECT_NAME.value,
    developerId: CORALINA_DEVELOPER_ID,
    locationId: CORALINA_LOCATION_ID,
    projectType: CORALINA_PROJECT_TYPE.value,
    // The project is in source intake, not published, so it is a draft with no
    // Forever-verified sales/construction posture. Raw strings stay empty
    // because the source provides none (absent facts remain absent).
    publicStatus: "draft",
    salesStatus: "available",
    constructionStatus: "unknown",
    ownershipType: "unknown",
    raw: {
      publicStatus: "",
      salesStatus: "Available",
      constructionStatus: "",
      ownershipType: "",
    },
    country: CORALINA_COUNTRY.value,
    province: CORALINA_PROVINCE.value,
    area: CORALINA_AREA.value,
    tagline: CORALINA_TAGLINE.value,
    fullDescription: CORALINA_DESCRIPTION.value,
    highlights: CORALINA_HIGHLIGHTS.map((h) => h.value),
    brochureUrl: CORALINA_BROCHURE_SOURCE_FILE,
    pricing: {
      startingPrice: {
        amount: Math.min(...CORALINA_UNIT_FACTS.map((unit) => parsePrice(unit.price))),
        currency: CORALINA_PRICE_CURRENCY_DECISION.value,
      },
      lastPriceUpdate: CORALINA_PRICE_LIST_DATE,
    },
    trust: {
      // Not yet Forever-verified: the project is a blocked intake, no inspection
      // or verdict has been produced.
      foreverVerified: false,
    },
    isFeatured: false,
    isActive: false,
    source: {
      sourceLabel: "coralina_source_package",
      sourceFile: CORALINA_BROCHURE_SOURCE_FILE,
      sourcePage: CORALINA_PROJECT_NAME.page ?? undefined,
    },
  };
}

function mapDeveloper(): ForeverDeveloper {
  return {
    id: CORALINA_DEVELOPER_ID,
    slug: "rhom-bho-property-public-company-limited",
    name: CORALINA_DEVELOPER.value,
    legalName: CORALINA_DEVELOPER.value,
    country: CORALINA_COUNTRY.value,
    website: "https://www.thetitleresidence.com/",
    verificationStatus: "verified",
    lastVerifiedDate: "2026-07-13",
    notes:
      "AssetWise is an indirect major shareholder through 39 Estate; it is not recorded as Coralina's developer.",
    source: {
      sourceLabel: "official_sec_filing",
      sourceFile: CORALINA_DEVELOPER.sourceFile,
      sourcePage: CORALINA_DEVELOPER.page ?? undefined,
    },
  };
}

function mapLocation(): ForeverLocation {
  return {
    id: CORALINA_LOCATION_ID,
    slug: slugify(CORALINA_AREA.value),
    areaName: CORALINA_AREA.value,
    country: CORALINA_COUNTRY.value,
    province: CORALINA_PROVINCE.value,
    // geo omitted — no coordinates in any source.
    description: CORALINA_AREA_DETAIL.value,
    distanceToBeach: CORALINA_BEACH_DISTANCE.value,
    // distanceToAirport omitted — not stated.
    nearbySchools: [],
    nearbyHospitals: [...CORALINA_NEARBY_HOSPITALS],
    lifestyle: CORALINA_NEARBY_DESTINATIONS.map((d) => d.value),
    source: {
      sourceLabel: "coralina_source_package",
      sourceFile: CORALINA_AREA.sourceFile,
    },
  };
}

function mapUnit(fact: CoralinaUnitFact): ForeverUnit {
  return {
    id: coralinaUnitId(fact.unitNumber),
    projectId: CORALINA_PROJECT_ID,
    code: fact.unitNumber,
    unitType: fact.unitType,
    availabilityStatus: normalizeAvailabilityStatus(fact.availabilityStatus),
    availabilityStatusRaw: fact.availabilityStatus,
    // No verified ownership tenure for units; raw stays empty.
    ownershipType: "unknown",
    ownershipTypeRaw: "",
    bedrooms: fact.bedrooms ?? undefined,
    // bathrooms omitted — not recorded in the price list.
    sizeSqm: fact.sizeSqm,
    floor: fact.floor,
    basePrice: {
      amount: parsePrice(fact.price),
      currency: CORALINA_PRICE_CURRENCY_DECISION.value,
    },
    pricePerSqm: parsePrice(fact.pricePerSqm),
    source: {
      sourceLabel: PRICE_LIST_LABEL,
      sourceFile: CORALINA_PRICE_LIST_SOURCE_FILE,
      sourceDate: CORALINA_PRICE_LIST_DATE,
      raw: {
        unitCode: fact.unitCode,
        building: fact.building,
        price: fact.price,
        pricePerSqm: fact.pricePerSqm,
        sourceCurrency: null,
        currencyDecision: CORALINA_PRICE_CURRENCY_DECISION,
        priceListDate: CORALINA_PRICE_LIST_DATE,
      },
    },
  };
}

const DOCUMENT_TYPE_BY_CATEGORY: Record<string, ForeverDocumentType> = {
  brochure: "brochure",
  price_list: "price_list",
};

function mapDocument(fact: CoralinaDocumentFact, sortOrder: number): ForeverDocument {
  return {
    id: coralinaAssetId("document", fact.sourceFile),
    projectId: CORALINA_PROJECT_ID,
    documentType: DOCUMENT_TYPE_BY_CATEGORY[fact.category] ?? "other",
    title: fact.title,
    url: fact.sourceFile,
    fileExtension: fact.extension,
    verificationStatus: "verified",
    sortOrder,
    isPublic: false,
    source: {
      sourceLabel: "coralina_source_package",
      sourceFile: fact.sourceFile,
      raw: { category: fact.category },
    },
  };
}

function mapMediaAsset(fact: CoralinaMediaFact, sortOrder: number): ForeverMedia {
  return {
    id: coralinaAssetId("media", fact.sourceFile),
    projectId: CORALINA_PROJECT_ID,
    mediaType: fact.mediaType,
    title: fact.title,
    url: fact.sourceFile,
    sortOrder,
    isPublic: false,
    source: {
      sourceLabel: "coralina_source_package",
      sourceFile: fact.sourceFile,
      raw: {
        collection: fact.collection,
        subcategory: fact.subcategory,
        width: fact.width,
        height: fact.height,
      },
    },
  };
}

/**
 * Build the canonical Forever Database record for Coralina.
 *
 * Pure and deterministic. Collections with no verified evidence
 * (`paymentPlans`, `constructionProgress`, `rentalInformation`,
 * `investmentInformation`) are returned empty.
 */
export function buildCoralinaRecord(): ForeverDatabaseRecord {
  return {
    project: mapProject(),
    developer: mapDeveloper(),
    location: mapLocation(),
    units: CORALINA_UNIT_FACTS.map(mapUnit),
    media: CORALINA_MEDIA_FACTS.map(mapMediaAsset),
    documents: CORALINA_DOCUMENT_FACTS.map(mapDocument),
    paymentPlans: [],
    constructionProgress: [],
    rentalInformation: [],
    investmentInformation: [],
  };
}
