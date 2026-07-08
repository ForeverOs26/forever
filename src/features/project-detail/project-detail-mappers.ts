import type {
  DeveloperRow,
  ProjectDetail,
  ProjectDetailDocument,
  ProjectDetailMedia,
  ProjectDetailMediaItem,
  ProjectDetailRecord,
  ProjectDetailInvestmentRow,
  ProjectMediaRow,
  UnitRow,
  InvestmentDataRow,
} from "./project-detail-types";

const DOCUMENT_LABELS: Record<string, string> = {
  brochure: "Brochure",
  price_list: "Price List",
  master_plan: "Master Plan",
  unit_plan: "Unit Plans",
  payment_plan: "Payment Plan",
  document: "Document",
};

function text(value: string | null | undefined): string {
  return value ?? "";
}

function numberValue(value: number | null | undefined): number {
  return Number(value ?? 0);
}

function sortByOrder<T extends { sortOrder: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder);
}

function byCreatedAt(a: { created_at: string }, b: { created_at: string }): number {
  return a.created_at.localeCompare(b.created_at);
}

function byUnitCode(a: UnitRow, b: UnitRow): number {
  return text(a.unit_code).localeCompare(text(b.unit_code), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function formatStartingPriceTHB(value: number | null | undefined): string {
  const price = numberValue(value);
  if (!price) return "";
  const millions = price / 1_000_000;
  const fractionDigits = price % 1_000_000 === 0 ? 0 : 1;
  return `From THB ${millions.toFixed(fractionDigits)}M`;
}

export function mapProjectMedia(row: ProjectMediaRow): ProjectDetailMediaItem {
  return {
    id: row.id,
    type: row.media_type,
    title: row.title ?? "",
    url: row.url,
    sortOrder: row.sort_order,
  };
}

function mapProjectUrlMedia({
  id,
  type,
  title,
  url,
  sortOrder,
}: {
  id: string;
  type: string;
  title: string;
  url: string | null | undefined;
  sortOrder: number;
}): ProjectDetailMediaItem | null {
  const cleanUrl = text(url).trim();
  if (!cleanUrl) return null;

  return {
    id,
    type,
    title,
    url: cleanUrl,
    sortOrder,
  };
}

function mapProjectDocument(item: ProjectDetailMediaItem): ProjectDetailDocument {
  const label = (DOCUMENT_LABELS[item.type] ?? item.title) || "Document";
  return {
    ...item,
    label,
    note: item.url ? "Available" : "Available on request",
  };
}

function uniqueMedia(items: ProjectDetailMediaItem[]): ProjectDetailMediaItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.type}:${item.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function groupProjectMedia(
  rows: ProjectMediaRow[] | null | undefined,
  projectMedia: {
    projectId: string;
    mainImageUrl?: string | null;
    brochureUrl?: string | null;
  },
): ProjectDetailMedia {
  const projectMainImage = mapProjectUrlMedia({
    id: `${projectMedia.projectId}:main-image`,
    type: "cover",
    title: "Cover",
    url: projectMedia.mainImageUrl,
    sortOrder: -20,
  });
  const projectBrochure = mapProjectUrlMedia({
    id: `${projectMedia.projectId}:brochure`,
    type: "brochure",
    title: "Brochure",
    url: projectMedia.brochureUrl,
    sortOrder: 10_000,
  });
  const media = sortByOrder(
    uniqueMedia([
      ...(projectMainImage ? [projectMainImage] : []),
      ...(rows ?? []).map(mapProjectMedia),
      ...(projectBrochure ? [projectBrochure] : []),
    ]),
  );
  const cover = media.find((item) => item.type === "cover") ?? null;
  const gallery = media.filter((item) => item.type === "gallery" || item.type === "cover");
  const masterPlan = media.find((item) => item.type === "master_plan") ?? null;
  const brochures = media.filter((item) => item.type === "brochure");
  const unitPlans = media.filter((item) => item.type === "unit_plan");
  const floorPlans = media.filter((item) => item.type === "floor_plan");
  const videos = media.filter((item) => item.type === "video");
  const documentTypes = new Set([
    "brochure",
    "price_list",
    "master_plan",
    "unit_plan",
    "payment_plan",
    "document",
  ]);

  return {
    hero: cover ?? gallery[0] ?? null,
    gallery,
    floorPlans,
    masterPlan,
    unitPlans,
    brochures,
    videos,
    documents: media.filter((item) => documentTypes.has(item.type)).map(mapProjectDocument),
  };
}

export function mapProjectDeveloper(row: DeveloperRow | null | undefined) {
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    description: text(row.description),
    website: text(row.website),
    contactName: text(row.contact_name),
    contactPhone: text(row.contact_phone),
    contactEmail: text(row.contact_email),
    logoUrl: text(row.logo_url),
  };
}

export function mapProjectUnit(row: UnitRow) {
  return {
    id: row.id,
    code: text(row.unit_code),
    type: text(row.unit_type),
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    sizeSqm: row.size_sqm,
    floor: row.floor,
    viewType: text(row.view_type),
    ownershipType: text(row.ownership_type),
    basePriceTHB: row.base_price_thb,
    discountedPriceTHB: row.discounted_price_thb,
    pricePerSqm: row.price_per_sqm,
    availabilityStatus: row.availability_status,
    paymentPlan: text(row.payment_plan),
    furniturePackage: text(row.furniture_package),
    rentalGuarantee: text(row.rental_guarantee),
    roiEstimate: text(row.roi_estimate),
    notes: text(row.notes),
  };
}

export function mapProjectInvestmentRow(row: InvestmentDataRow): ProjectDetailInvestmentRow {
  return {
    id: row.id,
    projectId: row.project_id,
    unitId: row.unit_id,
    expectedDailyRate: row.expected_daily_rate,
    expectedMonthlyRent: row.expected_monthly_rent,
    expectedYearlyRent: row.expected_yearly_rent,
    occupancyRate: row.occupancy_rate,
    annualRoiPercent: row.annual_roi_percent,
    guaranteedRentalPercent: row.guaranteed_rental_percent,
    guaranteeYears: row.guarantee_years,
    managementCompany: text(row.management_company),
    notes: text(row.notes),
  };
}

export function mapProjectDetail(row: ProjectDetailRecord): ProjectDetail {
  const media = groupProjectMedia(row.media, {
    projectId: row.id,
    mainImageUrl: row.main_image_url,
    brochureUrl: row.brochure_url,
  });
  const startingPriceTHB = numberValue(row.starting_price_thb);
  const investmentRows = [...(row.investment ?? [])].sort(byCreatedAt).map(mapProjectInvestmentRow);

  return {
    core: {
      id: row.id,
      slug: row.slug,
      name: row.name,
      type: text(row.project_type),
      status: text(row.sales_status),
      constructionStatus: text(row.construction_status),
      ownershipType: text(row.ownership_type),
      location: text(row.location_area),
      address: text(row.address),
      tagline: text(row.tagline),
      description: text(row.full_description) || text(row.short_description),
      highlights: row.highlights ?? [],
      beds: text(row.beds_display),
      area: text(row.area_range),
      isFeatured: row.is_featured,
      isActive: row.is_active,
    },
    pricing: {
      startingPriceTHB,
      displayPrice: formatStartingPriceTHB(startingPriceTHB),
      priceRange: text(row.price_range),
      pricePerSqm: text(row.price_per_sqm_display),
      verifiedPrice: text(row.verified_price) || text(row.price_range),
      promotion: text(row.promotion),
      lastPriceUpdate: text(row.last_price_update),
    },
    trust: {
      foreverVerified: row.forever_verified,
      trustScore: numberValue(row.trust_score),
      trustNote: text(row.trust_note),
      marketPosition: text(row.market_position),
      verdict: text(row.verdict),
      lastInspection: text(row.last_inspection),
    },
    investment: {
      investmentValue: numberValue(row.investment_value),
      rentalYield: text(row.rental_yield),
      rentalDemand: text(row.rental_demand),
      capitalGrowthEstimate: text(row.capital_growth_estimate),
      rows: investmentRows,
    },
    location: {
      area: text(row.location_area),
      latitude: row.latitude,
      longitude: row.longitude,
      distanceToBeach: text(row.distance_to_beach),
      distanceToAirport: text(row.distance_to_airport),
      nearbySchools: row.nearby_schools ?? [],
      nearbyHospitals: row.nearby_hospitals ?? [],
      lifestyle: row.lifestyle ?? [],
    },
    developer: mapProjectDeveloper(row.developer),
    media,
    units: [...(row.units ?? [])].sort(byUnitCode).map(mapProjectUnit),
  };
}
