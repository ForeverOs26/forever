/**
 * Launcher-only project data for the Partner Demo.
 *
 * Modeva is reconstructed from committed repository evidence: the FDB-001
 * canonical seed, the reviewed FDB-002C price-list import, and the committed
 * Modeva brochure/price-list artifacts. Coralina continues through its existing
 * local preview adapter. This module is reached only by DEV-gated dynamic
 * imports and is absent from production builds.
 */
import modevaBrochureImage from "../../../forever-data/projects/modeva/source/brochure/MODEVA E BROCHURE-05.jpg";
import modevaBrochurePdf from "../../../forever-data/projects/modeva/source/brochure/THE MODEVA E-BROCHURE_ENGLISH_UPDATED.pdf";
import modevaPriceListPdf from "../../../forever-data/projects/modeva/source/price-list/MOB - Price list V.2. - Updated 03.07.2026.pdf";
import modevaPriceList from "../../../forever-data/projects/modeva/extracted/price-list.json";

import { isPartnerDemoModeEnabled } from "@/lib/partner-demo-mode";
import type { Property } from "@/lib/data";
import { getDemoPreviewProjectDetail, mapProjectDetailToProperty } from "./demo-preview";
import type { ProjectDetail, ProjectDetailUnit } from "./project-detail-types";

type SourcedValue = { value: string | null };
type ModevaPriceListRow = {
  source_row: number;
  unit_number: SourcedValue;
  unit_code: SourcedValue;
  building: SourcedValue;
  floor: SourcedValue;
  unit_type: SourcedValue;
  bedrooms: SourcedValue;
  bathrooms: SourcedValue;
  size_sqm: SourcedValue;
  price: SourcedValue;
  price_per_sqm: SourcedValue;
  availability_status: SourcedValue;
  payment_terms: SourcedValue;
  promotion_discount_notes: SourcedValue;
};

function numberOrNull(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function modevaUnit(row: ModevaPriceListRow): ProjectDetailUnit {
  const code = row.unit_number.value ?? `source-row-${row.source_row}`;
  return {
    id: `partner-demo-modeva-${code}`,
    code,
    buildingCode: row.building.value ?? undefined,
    type: row.unit_type.value ?? row.unit_code.value ?? "",
    bedrooms: numberOrNull(row.bedrooms.value),
    bathrooms: numberOrNull(row.bathrooms.value),
    sizeSqm: numberOrNull(row.size_sqm.value),
    floor: numberOrNull(row.floor.value),
    viewType: "",
    ownershipType: "",
    // FDB-002C records the reviewed import policy and persisted amounts as THB.
    basePriceTHB: numberOrNull(row.price.value),
    discountedPriceTHB: null,
    pricePerSqm: numberOrNull(row.price_per_sqm.value),
    availabilityStatus: row.availability_status.value ?? "",
    paymentPlan: row.payment_terms.value ?? "",
    furniturePackage: "",
    rentalGuarantee: "",
    roiEstimate: "",
    notes: row.promotion_discount_notes.value ?? "",
  };
}

export function buildModevaPartnerDemoProjectDetail(): ProjectDetail {
  const rows = modevaPriceList.unit_inventory as ModevaPriceListRow[];

  return {
    core: {
      id: "partner-demo-modeva",
      slug: "modeva",
      name: "Modeva",
      type: "Condominium",
      status: "Available",
      constructionStatus: "Planning",
      ownershipType: "Freehold",
      location: "Bang Tao",
      address: "Bang Tao, Phuket, Thailand",
      tagline: "Published project record for guided review",
      description:
        "Modeva is a published project record in the Forever Core Database. This presentation shows only fields supported by committed project sources.",
      highlights: ["Bang Tao, Phuket", "Freehold recorded", "Planning status recorded"],
      beds: "1–3 bedrooms represented in the reviewed inventory",
      area: "29–148 sq.m. represented in the reviewed inventory",
      isFeatured: true,
      isActive: true,
    },
    pricing: {
      // The project seed intentionally has no project-level starting price.
      startingPriceTHB: 0,
      displayPrice: "",
      priceRange: "",
      pricePerSqm: "",
      verifiedPrice: "",
      promotion: "",
      lastPriceUpdate: "2026-07-03",
    },
    trust: {
      // The seed says full inspection data is still awaited; do not turn its
      // historical boolean placeholder into a partner-facing verification.
      foreverVerified: false,
      trustScore: 0,
      trustNote: "Full Forever inspection data is not recorded.",
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
      area: "Bang Tao",
      latitude: null,
      longitude: null,
      distanceToBeach: "",
      distanceToAirport: "",
      nearbySchools: [],
      nearbyHospitals: [],
      lifestyle: [],
    },
    developer: {
      id: "partner-demo-title",
      name: "Title",
      description: "Developer name recorded for Modeva.",
      website: "",
      contactName: "",
      contactPhone: "",
      contactEmail: "",
      logoUrl: "",
    },
    media: {
      hero: {
        id: "modeva-brochure-image",
        type: "cover",
        title: "Modeva brochure image",
        url: modevaBrochureImage,
        sortOrder: 0,
      },
      gallery: [],
      floorPlans: [],
      masterPlan: null,
      unitPlans: [],
      brochures: [
        {
          id: "modeva-brochure",
          type: "brochure",
          title: "Modeva brochure",
          url: modevaBrochurePdf,
          sortOrder: 0,
        },
      ],
      videos: [],
      documents: [
        {
          id: "modeva-price-list",
          type: "price_list",
          title: "Modeva price list dated 2026-07-03",
          label: "Price list",
          note: "Committed source document",
          url: modevaPriceListPdf,
          sortOrder: 1,
        },
      ],
    },
    units: rows.map(modevaUnit),
  };
}

export async function getPartnerDemoProjectDetail(slug: string): Promise<ProjectDetail | null> {
  if (!isPartnerDemoModeEnabled()) return null;
  if (slug === "modeva") return buildModevaPartnerDemoProjectDetail();
  if (slug === "coralina") return getDemoPreviewProjectDetail(slug);
  return null;
}

export async function listPartnerDemoProperties(): Promise<Property[] | null> {
  if (!isPartnerDemoModeEnabled()) return null;
  const projects = await Promise.all([
    getPartnerDemoProjectDetail("modeva"),
    getPartnerDemoProjectDetail("coralina"),
  ]);
  return projects
    .filter((project): project is ProjectDetail => Boolean(project))
    .map(mapProjectDetailToProperty);
}
