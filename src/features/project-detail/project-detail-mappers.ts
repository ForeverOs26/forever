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
  UnitRowWithBuilding,
  InvestmentDataRow,
} from "./project-detail-types";
import {
  isPublicPhotograph,
  isPubliclyPresentable,
  neverPublicUrls,
  presentableCoverUrl,
  prohibitedPhotographUrls,
} from "@/lib/public-media-policy";

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
    // Read directly. `ProjectMediaRow` declares `semantic_role` as required
    // precisely so this needs no widening cast — a cast here would silently
    // tolerate the column disappearing from the projection, which is the one way
    // this contract can fail open. The migration must be applied before any build
    // requesting `semantic_role` is deployed — see the note on
    // PROJECT_DETAIL_SELECT.
    semanticRole: row.semantic_role ?? null,
  };
}

function mapProjectUrlMedia({
  id,
  type,
  title,
  url,
  sortOrder,
  semanticRole = null,
}: {
  id: string;
  type: string;
  title: string;
  url: string | null | undefined;
  sortOrder: number;
  /**
   * The role the project's own `project_media` row records for this URL, when
   * one does. A project column carries no role of its own; `null` means nothing
   * is recorded, which means "show it".
   */
  semanticRole?: string | null;
}): ProjectDetailMediaItem | null {
  const cleanUrl = text(url).trim();
  if (!cleanUrl) return null;

  return { id, type, title, url: cleanUrl, sortOrder, semanticRole };
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

/**
 * The photographs a project gallery may show
 * (FOREVER-MEDIA-SEMANTIC-PUBLIC-CONTRACT-001).
 *
 * This is what closes the gap the reconciliation report raised as F7: the
 * gallery had no way to exclude a launch-party photograph, a staff group shot,
 * a seasonal advertisement or a logo, because the browser received a
 * content-addressed URL and an empty title and nothing else. Sierra's five logo
 * files and its "HOLIDAY MOMENTS" graphic, and Coralina's launch-event group
 * photograph, all still reach the public photo strip today.
 *
 * The decision is made from the role the Factory recorded, never from the URL,
 * the filename or the slug — see `@/lib/public-media-policy`, which every other
 * public reader asks the same question of.
 *
 * Two properties matter:
 *
 *   1. **Exclusion requires positive evidence.** A row with no role, an empty
 *      role, or a role this client does not recognise is shown. Written the
 *      other way round — as an include-list — the first deploy would empty
 *      every gallery Forever has published, because no existing row has a role.
 *      This, and not any floor, is what makes the pre-backfill rollout safe.
 *   2. **An all-prohibited gallery is empty, and that is the correct answer.**
 *      An earlier draft returned the *unfiltered* set whenever filtering removed
 *      everything, on the reasoning that a contract may improve a gallery but
 *      not delete one. That floor re-published exactly the media this contract
 *      exists to remove: Villa Kirara's twenty-four launch-party photographs are
 *      the entire gallery, so every row was excluded and every row came back.
 *      A project whose only photographs depict something other than the property
 *      has no photographs of the property, and the honest way to say so is to
 *      show none and let the surface render its neutral empty state.
 */
export function galleryEligible(items: ProjectDetailMediaItem[]): ProjectDetailMediaItem[] {
  return items.filter((item) =>
    isPublicPhotograph({ mediaType: item.type, semanticRole: item.semanticRole }),
  );
}

/**
 * The role the project's own rows record for one exact URL.
 *
 * A join on a recorded identifier — never an inference from the text of the
 * link. `projects.main_image_url` is a bare column with no role of its own; the
 * role that describes that image lives on the `project_media` row for the same
 * URL, and without this lookup the cover would be the one image nothing filters.
 */
function recordedRoleForUrl(url: string, rows: readonly ProjectDetailMediaItem[]): string | null {
  const target = url.trim();
  for (const row of rows) {
    if (row.url.trim() === target && row.semanticRole) return row.semanticRole;
  }
  return null;
}

export function groupProjectMedia(
  rows: ProjectMediaRow[] | null | undefined,
  projectMedia: {
    projectId: string;
    mainImageUrl?: string | null;
    brochureUrl?: string | null;
  },
): ProjectDetailMedia {
  const allRecorded = (rows ?? []).map(mapProjectMedia);

  // `main_image_url` is resolved against EVERY recorded row, retired ones
  // included. A retired row is the evidence that its URL is no longer the
  // cover, so dropping those rows before this lookup would leave the column
  // pointing at a retired image with nothing left to contradict it — which is
  // how a retired cover would come back through the one reader that does not
  // read `media_type` at all.
  const coverUrl = presentableCoverUrl(
    projectMedia.mainImageUrl,
    allRecorded.map((item) => ({
      mediaType: item.type,
      url: item.url,
      semanticRole: item.semanticRole,
    })),
  );

  // The floor for EVERY section, applied once.
  //
  // Retired covers never enter the presentation model — they are kept in the
  // database so a correction stays auditable and no storage object is orphaned,
  // but they are not media this page may consider. Nor does anything whose
  // recorded subject is people: `ProjectFloorPlans` and `ProjectLocation` render
  // their rows as `<img>` tiles, so a launch-party photograph misfiled as a
  // floor plan would be a photograph of a launch party on the project page,
  // reached through a section the gallery contract never covered.
  //
  // Deliberately NOT the gallery deny-list, which would delete every plan, map
  // and brochure — see `NEVER_PUBLIC_ROLES`.
  //
  // Applied per URL, not per row. A re-published project holds the same URL as
  // both a `cover` row and a `gallery` row, so a per-row filter lets a
  // prohibited image back in through its sibling — the exact shape Sierra has.
  const asPolicyRows = allRecorded.map((item) => ({
    mediaType: item.type,
    url: item.url,
    semanticRole: item.semanticRole,
  }));
  const barredEverywhere = neverPublicUrls(asPolicyRows);
  const recorded = allRecorded.filter(
    (item) =>
      isPubliclyPresentable({ mediaType: item.type, semanticRole: item.semanticRole }) &&
      !barredEverywhere.has(item.url.trim()),
  );
  const barredPhotographs = prohibitedPhotographUrls(asPolicyRows);
  const projectMainImage = mapProjectUrlMedia({
    id: `${projectMedia.projectId}:main-image`,
    type: "cover",
    title: "Cover",
    url: coverUrl,
    sortOrder: -20,
    // The column carries no role, but the project's own row for the same image
    // does. Without carrying it across, `uniqueMedia` would let this synthesised
    // item shadow the recorded one and the role would be silently discarded.
    semanticRole: coverUrl ? recordedRoleForUrl(coverUrl, allRecorded) : null,
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
      ...recorded,
      ...(projectBrochure ? [projectBrochure] : []),
    ]),
  );
  // The cover is filtered by exactly the rule the gallery uses. It used to be
  // exempt — "it is the image the hero policy already passed" — which was true
  // only of a cover this contract's publish lane chose. A legacy `cover` row, or
  // a `main_image_url` written before the hero policy existed, carries whatever
  // it carries, and Sierra's is a seasonal advertisement.
  const cover =
    media.find(
      (item) =>
        item.type === "cover" &&
        !barredPhotographs.has(item.url.trim()) &&
        isPublicPhotograph({ mediaType: item.type, semanticRole: item.semanticRole }),
    ) ?? null;
  const gallery = galleryEligible(
    media.filter(
      (item) =>
        (item.type === "gallery" || item.type === "cover") &&
        !barredPhotographs.has(item.url.trim()),
    ),
  );
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
    // Developer contacts have no public-source contract. They remain
    // server-held until a dedicated public-contact decision is recorded.
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    logoUrl: text(row.logo_url),
  };
}

export function mapProjectUnit(row: UnitRowWithBuilding) {
  const buildingCode = text(row.building?.building_code);
  return {
    id: row.id,
    code: text(row.unit_code),
    // Absent rather than empty: the Inventory table renders "—" for a unit
    // whose building the record does not state.
    ...(buildingCode ? { buildingCode } : {}),
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
      developerNameRaw: text(row.developer_name_raw),
      locationNameRaw: text(row.location_name_raw),
    },
    pricing: {
      startingPriceTHB,
      displayPrice: formatStartingPriceTHB(startingPriceTHB),
      priceRange: text(row.price_range),
      pricePerSqm: text(row.price_per_sqm_display),
      // Suppressed evidence-unproven legacy scalars (FOREVER-TRUTH-001A, see
      // EVIDENCE_UNPROVEN_ADVISORY_COLUMNS in `@/lib/public-truth`): no code
      // binds these columns to a source, inspection record, or Owner-recorded
      // verification, and the canonical Modeva seed proves they are
      // placeholders. The raw values stay in the database; the public claim
      // is withheld until a real evidence contract exists.
      verifiedPrice: "",
      promotion: "",
      lastPriceUpdate: text(row.last_price_update),
    },
    trust: {
      // Suppressed evidence-unproven legacy scalars (see pricing note above).
      foreverVerified: false,
      trustScore: 0,
      trustNote: "",
      marketPosition: "",
      verdict: "",
      lastInspection: "",
    },
    investment: {
      // Suppressed evidence-unproven legacy scalars (see pricing note above).
      // `rows` are recorded per-row data and continue to map through; the
      // Advisory derivations already handle their gaps with "Not available".
      investmentValue: 0,
      rentalYield: "",
      rentalDemand: "",
      capitalGrowthEstimate: "",
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
