/**
 * One truth-safe presentation model for the Project Detail Decision Deck.
 *
 * This module deliberately contains no JSX and performs no query. It translates
 * the narrow `PublicProjectDetailDTO` once, so section rendering, section navigation,
 * the compact Passport and the detailed Passport cannot make different truth
 * decisions from the same record.
 */

import { listedResidencesPhrase } from "./inventory-scale";
import type {
  PublicProjectAmenityDTO,
  PublicProjectDetailDTO,
  PublicProjectMediaDTO,
  PublicProjectUnitDTO,
} from "./public-project-detail";
import { isAvailable } from "./unit-presentation";
import { publicRecordedText } from "./public-value";
import { publicBrowserUrl, publicHttpUrl } from "./public-url";

export type DecisionDeckValue<T> =
  | { state: "supported"; value: T }
  | { state: "unavailable"; reason: string }
  | { state: "withheld"; reason: string }
  | { state: "conflicting"; reason: string }
  | { state: "empty"; reason: string };

type SupportedValue<T> = Extract<DecisionDeckValue<T>, { state: "supported" }>;

const supported = <T>(value: T): SupportedValue<T> => ({ state: "supported", value });
const unavailable = <T>(reason: string): DecisionDeckValue<T> => ({
  state: "unavailable",
  reason,
});
const withheld = <T>(reason: string): DecisionDeckValue<T> => ({
  state: "withheld",
  reason,
});
const conflicting = <T>(reason: string): DecisionDeckValue<T> => ({
  state: "conflicting",
  reason,
});
const empty = <T>(reason: string): DecisionDeckValue<T> => ({ state: "empty", reason });

function recordedText(value: string | null | undefined): DecisionDeckValue<string> {
  const text = publicRecordedText(value);
  return text ? supported(text) : empty("not-recorded");
}

function recordedList(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values
    .map((value) => value.trim())
    .filter((value) => {
      const key = value.toLowerCase();
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function positiveNumber(value: number | null | undefined): DecisionDeckValue<number> {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? supported(number)
    : empty("positive-value-not-recorded");
}

export const DECISION_DECK_COMPOSITION_ORDER = [
  "media",
  "decision-rail",
  "compact-passport",
  "overview",
  "featured-amenities",
  "units",
  "film",
  "plans",
  "passport",
  "intelligence",
  "amenities",
  "location",
  "developer",
  "updates",
  "documents",
  "related",
] as const;

export const DECISION_DECK_SECTION_ORDER = [
  "overview",
  "featured-amenities",
  "units",
  "film",
  "plans",
  "passport",
  "intelligence",
  "amenities",
  "location",
  "developer",
  "updates",
  "documents",
  "related",
] as const;

export type DecisionDeckCompositionId = (typeof DECISION_DECK_COMPOSITION_ORDER)[number];
export type DecisionDeckSectionId = (typeof DECISION_DECK_SECTION_ORDER)[number];

export interface DecisionDeckSection {
  id: DecisionDeckSectionId;
  label: string;
}

const SECTION_LABELS: Readonly<Record<DecisionDeckSectionId, string>> = {
  overview: "Overview",
  "featured-amenities": "Featured amenities",
  units: "Units & inventory",
  film: "Project film",
  plans: "Plans",
  passport: "Forever Passport",
  intelligence: "Forever Intelligence",
  amenities: "Amenities",
  location: "Location",
  developer: "Developer",
  updates: "Project updates",
  documents: "Documents",
  related: "Related projects",
};

/**
 * Public media projected without its free-text title. Components receive a
 * stable, factual label instead, preventing a stale media title from leaking a
 * developer identity that the developer truth layer withheld.
 */
export interface DecisionDeckMediaAsset {
  id: string;
  type: string;
  url: string;
  sortOrder: number;
  label: string;
  source: "public-project-media";
}

function mediaAsset(item: PublicProjectMediaDTO, label: string): DecisionDeckMediaAsset {
  return {
    id: item.id,
    type: item.type,
    url: item.url.trim(),
    sortOrder: item.sortOrder,
    label,
    source: "public-project-media",
  };
}

function safePhotos(project: PublicProjectDetailDTO): DecisionDeckMediaAsset[] {
  return (project.media?.photographs ?? []).map((item, index) =>
    mediaAsset(item, `${project.name.trim() || "Project"} photograph ${index + 1}`),
  );
}

/**
 * A film is playable by the native browser player only when its recorded URL
 * points directly at a supported file. Social/watch URLs and protocol-relative
 * embeds are deliberately rejected.
 */
export function isDirectPlayableProjectFilmUrl(value: string | null | undefined): boolean {
  const url = publicBrowserUrl(value);
  if (!url) return false;

  const isAbsolute = /^https?:\/\//i.test(url);

  try {
    const pathname = isAbsolute ? new URL(url).pathname : url.split(/[?#]/, 1)[0];
    return /\.(?:mp4|webm|ogg)$/i.test(pathname);
  } catch {
    return false;
  }
}

function projectFilm(project: PublicProjectDetailDTO): DecisionDeckValue<DecisionDeckMediaAsset> {
  const publicVideos = project.media?.videos ?? [];
  const film = publicVideos.find((item) => isDirectPlayableProjectFilmUrl(item.url));

  if (film) return supported(mediaAsset(film, "Project film"));
  if (publicVideos.length > 0) {
    return unavailable("no-direct-playable-recorded-video");
  }
  return empty("no-video-recorded");
}

export interface DecisionDeckInventorySummary {
  listedCount: number;
  availableCount: number;
  listedLabel: string;
}

export interface DecisionDeckUnits {
  /**
   * Canonical rows in their input order. Sorting remains the inventory
   * component's explicit `Listed order`; this model never introduces a hidden
   * ranking or silently rearranges the source.
   */
  rows: readonly PublicProjectUnitDTO[];
  summary: DecisionDeckValue<DecisionDeckInventorySummary>;
}

function projectUnits(project: PublicProjectDetailDTO): DecisionDeckUnits {
  const units = project.units ?? [];
  if (units.length === 0) {
    return {
      rows: units,
      summary: empty("no-listed-inventory"),
    };
  }

  const listedCount = units.length;
  return {
    rows: units,
    summary: supported({
      listedCount,
      availableCount: units.filter(isAvailable).length,
      listedLabel: listedResidencesPhrase(listedCount),
    }),
  };
}

function sortCanonicalAmenities(
  amenities: readonly PublicProjectAmenityDTO[],
): PublicProjectAmenityDTO[] {
  return [...amenities].sort(
    (left, right) =>
      Number(right.isFeatured) - Number(left.isFeatured) ||
      left.sortOrder - right.sortOrder ||
      (left.category ?? "").localeCompare(right.category ?? "", "en") ||
      left.name.localeCompare(right.name, "en") ||
      (left.slug ?? "").localeCompare(right.slug ?? "", "en"),
  );
}

export interface DecisionDeckAmenities {
  featured: DecisionDeckValue<readonly PublicProjectAmenityDTO[]>;
  all: DecisionDeckValue<readonly PublicProjectAmenityDTO[]>;
}

function amenitiesPresentation(project: PublicProjectDetailDTO): DecisionDeckAmenities {
  const all = sortCanonicalAmenities(project.amenities ?? []);
  const featured = all.filter((amenity) => amenity.isFeatured).slice(0, 8);

  return {
    featured: featured.length > 0 ? supported(featured) : empty("no-featured-canonical-amenities"),
    all: all.length > 0 ? supported(all) : empty("no-canonical-amenities"),
  };
}

export type DecisionDeckPlanCategoryId = "master-plan" | "floor-plans" | "unit-plans";

export interface DecisionDeckPlanCategory {
  id: DecisionDeckPlanCategoryId;
  label: string;
  items: readonly DecisionDeckMediaAsset[];
}

export interface DecisionDeckPlans {
  categories: readonly DecisionDeckPlanCategory[];
  all: DecisionDeckValue<readonly DecisionDeckMediaAsset[]>;
}

function plansPresentation(project: PublicProjectDetailDTO): DecisionDeckPlans {
  const seenUrls = new Set<string>();
  const category = (
    id: DecisionDeckPlanCategoryId,
    label: string,
    candidates: readonly PublicProjectMediaDTO[],
  ): DecisionDeckPlanCategory | null => {
    const items: DecisionDeckMediaAsset[] = [];
    for (const item of candidates) {
      const url = item.url.trim();
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);
      items.push(mediaAsset(item, `${label} ${items.length + 1}`));
    }
    return items.length > 0 ? { id, label, items } : null;
  };

  const master = project.media?.masterPlan;
  const categories = [
    category("master-plan", "Master plan", master ? [master] : []),
    category("floor-plans", "Floor plan", project.media?.floorPlans ?? []),
    category("unit-plans", "Unit plan", project.media?.unitPlans ?? []),
  ].filter((item): item is DecisionDeckPlanCategory => item !== null);
  const all = categories.flatMap((item) => item.items);

  return {
    categories,
    all: all.length > 0 ? supported(all) : empty("no-renderable-plan-media"),
  };
}

export interface DecisionDeckDocument {
  id: string;
  type: "brochure" | "price_list" | "payment_plan" | "document";
  url: string;
  label: string;
}

const GENERAL_DOCUMENT_TYPES = new Set<DecisionDeckDocument["type"]>([
  "brochure",
  "price_list",
  "payment_plan",
  "document",
]);

const DOCUMENT_LABELS: Readonly<Record<DecisionDeckDocument["type"], string>> = {
  brochure: "Brochure",
  price_list: "Price list",
  payment_plan: "Payment plan",
  document: "Document",
};

function documentsPresentation(
  project: PublicProjectDetailDTO,
  plans: DecisionDeckPlans,
): DecisionDeckValue<readonly DecisionDeckDocument[]> {
  const planUrls = new Set(
    plans.all.state === "supported" ? plans.all.value.map((item) => item.url) : [],
  );
  const counts = new Map<DecisionDeckDocument["type"], number>();
  const documents: DecisionDeckDocument[] = [];

  for (const document of project.media?.documents ?? []) {
    if (!GENERAL_DOCUMENT_TYPES.has(document.type as DecisionDeckDocument["type"])) continue;
    if (planUrls.has(document.url.trim())) continue;
    if (document.type === "document" && document.isMap) {
      continue;
    }

    const type = document.type as DecisionDeckDocument["type"];
    const occurrence = (counts.get(type) ?? 0) + 1;
    counts.set(type, occurrence);
    const baseLabel = DOCUMENT_LABELS[type];

    documents.push({
      id: document.id,
      type,
      url: document.url.trim(),
      label: occurrence === 1 ? baseLabel : `${baseLabel} ${occurrence}`,
    });
  }

  return documents.length > 0 ? supported(documents) : empty("no-general-public-documents");
}

export interface DecisionDeckDeveloper {
  name: string;
  verified: boolean;
  description: string;
  website: string;
  logoUrl: string;
}

function developerPresentation(
  project: PublicProjectDetailDTO,
): DecisionDeckValue<DecisionDeckDeveloper> {
  const developer = project.developer;
  if (developer?.state === "withheld") {
    return conflicting("developer-sources-disagree");
  }
  if (!developer) return empty("developer-not-recorded");
  const name = publicRecordedText(developer.name);
  if (!name) return empty("developer-not-recorded");

  return supported({
    name,
    verified: developer.verified,
    description: developer.verified ? (developer.description?.trim() ?? "") : "",
    website: developer.verified ? publicHttpUrl(developer.website) : "",
    logoUrl: developer.verified ? publicHttpUrl(developer.logoUrl) : "",
  });
}

export interface DecisionDeckLocation {
  area: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  distanceToBeach: string;
  distanceToAirport: string;
  nearbySchools: readonly string[];
  nearbyHospitals: readonly string[];
  lifestyle: readonly string[];
  mapDocument: PublicProjectMediaDTO | null;
}

function locationPresentation(
  project: PublicProjectDetailDTO,
): DecisionDeckValue<DecisionDeckLocation> {
  const location = project.location;
  const area = publicRecordedText(location?.area);
  const address = publicRecordedText(location?.address);
  const latitude =
    typeof location?.latitude === "number" &&
    Number.isFinite(location.latitude) &&
    location.latitude >= -90 &&
    location.latitude <= 90
      ? location.latitude
      : null;
  const longitude =
    typeof location?.longitude === "number" &&
    Number.isFinite(location.longitude) &&
    location.longitude >= -180 &&
    location.longitude <= 180
      ? location.longitude
      : null;
  const hasCoordinates = latitude !== null && longitude !== null;
  const mapDocument =
    project.media?.documents?.find((document) => document.type === "document" && document.isMap) ??
    null;
  const nearbySchools = recordedList(location?.nearbySchools ?? []);
  const nearbyHospitals = recordedList(location?.nearbyHospitals ?? []);
  const lifestyle = recordedList(location?.lifestyle ?? []);
  const present = Boolean(
    area ||
    address ||
    hasCoordinates ||
    publicRecordedText(location?.distanceToBeach) ||
    publicRecordedText(location?.distanceToAirport) ||
    nearbySchools.length ||
    nearbyHospitals.length ||
    lifestyle.length ||
    mapDocument,
  );

  return present
    ? supported({
        area,
        address,
        latitude,
        longitude,
        distanceToBeach: publicRecordedText(location?.distanceToBeach),
        distanceToAirport: publicRecordedText(location?.distanceToAirport),
        nearbySchools,
        nearbyHospitals,
        lifestyle,
        mapDocument,
      })
    : empty("location-not-recorded");
}

export interface DecisionDeckOverview {
  projectType: DecisionDeckValue<string>;
  constructionContext: DecisionDeckValue<string>;
  location: DecisionDeckValue<string>;
  address: DecisionDeckValue<string>;
  listedInventory: DecisionDeckValue<DecisionDeckInventorySummary>;
}

function overviewPresentation(
  project: PublicProjectDetailDTO,
  units: DecisionDeckUnits,
): DecisionDeckValue<DecisionDeckOverview> {
  const overview: DecisionDeckOverview = {
    projectType: recordedText(project.projectType),
    constructionContext: recordedText(project.constructionStatus),
    location: recordedText(project.location?.area),
    address: recordedText(project.location?.address),
    listedInventory: units.summary,
  };
  const present = Object.values(overview).some((field) => field.state === "supported");
  return present ? supported(overview) : empty("no-structured-overview-facts");
}

export interface DecisionDeckScoreDimension {
  id: "trust" | "investment";
  label: string;
  value: number;
}

export interface DecisionDeckCompactPassport {
  foreverId: DecisionDeckValue<string>;
  overallScore: DecisionDeckValue<number>;
  verdict: DecisionDeckValue<string>;
  coreDimensions: DecisionDeckValue<readonly DecisionDeckScoreDimension[]>;
  buyerProfile: DecisionDeckValue<string>;
  listedAvailability: DecisionDeckValue<DecisionDeckInventorySummary>;
  lastInspection: DecisionDeckValue<string>;
  lastPriceUpdate: DecisionDeckValue<string>;
}

export interface DecisionDeckFullPassport extends DecisionDeckCompactPassport {
  advisorySummary: DecisionDeckValue<string>;
  riskSummary: DecisionDeckValue<string>;
}

export interface DecisionDeckPassport {
  compact: DecisionDeckCompactPassport;
  full: DecisionDeckFullPassport;
}

function passportPresentation(
  project: PublicProjectDetailDTO,
  units: DecisionDeckUnits,
): DecisionDeckPassport {
  const slug = project.slug.trim();
  const foreverId = slug
    ? supported(`FOREVER-${slug.toUpperCase()}`)
    : empty<string>("project-slug-not-recorded");
  // The legacy trust and investment scalars are deliberately suppressed by
  // the public mapper: no published evidence row binds them to a methodology
  // or inspection. Treating a crafted/demo value as supported here would
  // reopen the same claim through a second path.
  const verdict = unavailable<string>("published-verdict-not-recorded");
  const lastInspection = unavailable<string>("published-inspection-not-recorded");
  const lastPriceUpdate = recordedText(project.pricing?.lastPriceUpdate);

  const compact: DecisionDeckCompactPassport = {
    foreverId,
    // ProjectDetail has no authoritative overall Forever Score. Never replace
    // that absence with the client intelligence engine's deterministic total.
    overallScore: unavailable("authoritative-overall-score-not-recorded"),
    verdict,
    coreDimensions: unavailable("published-score-dimensions-not-recorded"),
    // These values exist only in a generated report today. Generation is not
    // evidence, so the presentation model keeps them unavailable.
    buyerProfile: unavailable("published-buyer-profile-not-recorded"),
    listedAvailability: units.summary,
    lastInspection,
    lastPriceUpdate,
  };

  return {
    compact,
    full: {
      ...compact,
      advisorySummary: unavailable("published-advisory-summary-not-recorded"),
      riskSummary: unavailable("published-risk-summary-not-recorded"),
    },
  };
}

export interface DecisionDeckIntelligenceEvidence {
  trustScore: DecisionDeckValue<number>;
  investmentValue: DecisionDeckValue<number>;
  verdict: DecisionDeckValue<string>;
  marketPosition: DecisionDeckValue<string>;
  rentalYield: DecisionDeckValue<string>;
  rentalDemand: DecisionDeckValue<string>;
  capitalGrowthEstimate: DecisionDeckValue<string>;
  strengths: DecisionDeckValue<readonly string[]>;
  weaknesses: DecisionDeckValue<readonly string[]>;
  risks: DecisionDeckValue<readonly string[]>;
  buyerProfile: DecisionDeckValue<string>;
  rentalStrategy: DecisionDeckValue<string>;
  exitConsiderations: DecisionDeckValue<string>;
  decisionHorizon: DecisionDeckValue<string>;
}

function intelligencePresentation(
  _project: PublicProjectDetailDTO,
): DecisionDeckValue<DecisionDeckIntelligenceEvidence> {
  return unavailable("no-direct-published-intelligence-evidence");
}

export interface DecisionDeckDecisionRail {
  verdict: DecisionDeckValue<string>;
  priceFromTHB: DecisionDeckValue<number>;
  currentInventory: DecisionDeckValue<DecisionDeckInventorySummary>;
  buyerProfile: DecisionDeckValue<string>;
  strongestVerifiedReason: DecisionDeckValue<string>;
  principalVerifiedCaution: DecisionDeckValue<string>;
  constructionContext: DecisionDeckValue<string>;
  ownership: DecisionDeckValue<string>;
  lastVerifiedUpdate: DecisionDeckValue<string>;
}

function decisionRailPresentation(
  project: PublicProjectDetailDTO,
  units: DecisionDeckUnits,
  passport: DecisionDeckPassport,
): DecisionDeckDecisionRail {
  return {
    verdict: passport.compact.verdict,
    priceFromTHB: positiveNumber(project.pricing?.startingPriceTHB),
    currentInventory: units.summary,
    buyerProfile: passport.compact.buyerProfile,
    strongestVerifiedReason: unavailable("verified-reason-not-recorded"),
    principalVerifiedCaution: unavailable("verified-caution-not-recorded"),
    constructionContext: recordedText(project.constructionStatus),
    // Ownership has no approved public evidence contract. The DTO contains no
    // ownership property at all; the presentation state is a fixed release
    // policy, not a blank private-schema field.
    ownership: withheld("ownership-not-approved-for-public-presentation"),
    lastVerifiedUpdate: passport.compact.lastPriceUpdate,
  };
}

export interface DecisionDeckUpdate {
  type: "price-list";
  label: "Price list updated";
  date: string;
}

function updatesPresentation(
  project: PublicProjectDetailDTO,
): DecisionDeckValue<readonly DecisionDeckUpdate[]> {
  const date = publicRecordedText(project.pricing?.lastPriceUpdate);
  return date
    ? supported([{ type: "price-list", label: "Price list updated", date }])
    : empty("no-supported-project-updates");
}

export interface DecisionDeckRelatedProjectInput {
  slug: string;
  name: string;
  isPublished: boolean;
  isActive: boolean;
  location?: string;
}

export interface DecisionDeckRelatedProject {
  slug: string;
  name: string;
  location: string;
}

export interface BuildDecisionDeckOptions {
  relatedProjects?: readonly DecisionDeckRelatedProjectInput[];
}

function relatedPresentation(
  project: PublicProjectDetailDTO,
  candidates: readonly DecisionDeckRelatedProjectInput[],
): DecisionDeckValue<readonly DecisionDeckRelatedProject[]> {
  const currentSlug = project.slug.trim().toLowerCase();
  const seen = new Set<string>();
  const related: DecisionDeckRelatedProject[] = [];

  for (const candidate of candidates) {
    const slug = candidate.slug.trim();
    const name = candidate.name.trim();
    const key = slug.toLowerCase();
    if (
      !candidate.isPublished ||
      !candidate.isActive ||
      !slug ||
      !name ||
      key === currentSlug ||
      seen.has(key)
    ) {
      continue;
    }
    seen.add(key);
    related.push({
      slug,
      name,
      location: publicRecordedText(candidate.location),
    });
    if (related.length === 3) break;
  }

  return related.length > 0 ? supported(related) : empty("no-published-related-projects");
}

export interface DecisionDeckModel {
  compositionOrder: typeof DECISION_DECK_COMPOSITION_ORDER;
  media: {
    photos: DecisionDeckValue<readonly DecisionDeckMediaAsset[]>;
    film: DecisionDeckValue<DecisionDeckMediaAsset>;
  };
  decisionRail: DecisionDeckDecisionRail;
  passport: DecisionDeckPassport;
  overview: DecisionDeckValue<DecisionDeckOverview>;
  amenities: DecisionDeckAmenities;
  units: DecisionDeckUnits;
  plans: DecisionDeckPlans;
  intelligence: DecisionDeckValue<DecisionDeckIntelligenceEvidence>;
  location: DecisionDeckValue<DecisionDeckLocation>;
  developer: DecisionDeckValue<DecisionDeckDeveloper>;
  updates: DecisionDeckValue<readonly DecisionDeckUpdate[]>;
  documents: DecisionDeckValue<readonly DecisionDeckDocument[]>;
  related: DecisionDeckValue<readonly DecisionDeckRelatedProject[]>;
  displayable: {
    decisionRail: boolean;
    compactPassport: boolean;
    fullPassport: boolean;
  };
  sectionStates: Readonly<Record<DecisionDeckSectionId, boolean>>;
  sections: readonly DecisionDeckSection[];
  /** The exact same derived list used by section rendering. */
  navigation: readonly DecisionDeckSection[];
}

export function buildDecisionDeckModel(
  project: PublicProjectDetailDTO,
  options: BuildDecisionDeckOptions = {},
): DecisionDeckModel {
  const photos = safePhotos(project);
  const film = projectFilm(project);
  const units = projectUnits(project);
  const amenities = amenitiesPresentation(project);
  const plans = plansPresentation(project);
  const passport = passportPresentation(project, units);
  const overview = overviewPresentation(project, units);
  const intelligence = intelligencePresentation(project);
  const location = locationPresentation(project);
  const developer = developerPresentation(project);
  const updates = updatesPresentation(project);
  const documents = documentsPresentation(project, plans);
  const related = relatedPresentation(project, options.relatedProjects ?? []);
  const decisionRail = decisionRailPresentation(project, units, passport);
  const decisionRailDisplayable = Object.values(decisionRail).some(
    (field) => field.state === "supported",
  );
  const compactPassportDisplayable = [
    passport.compact.foreverId,
    passport.compact.overallScore,
    passport.compact.verdict,
    passport.compact.coreDimensions,
    passport.compact.buyerProfile,
    passport.compact.listedAvailability,
    passport.compact.lastInspection,
    passport.compact.lastPriceUpdate,
  ].some((field) => field.state === "supported");
  const fullPassportDisplayable = [
    passport.full.overallScore,
    passport.full.coreDimensions,
    passport.full.buyerProfile,
    passport.full.advisorySummary,
    passport.full.riskSummary,
  ].some((field) => field.state === "supported");

  const sectionStates: Record<DecisionDeckSectionId, boolean> = {
    overview: overview.state === "supported",
    "featured-amenities": amenities.featured.state === "supported",
    units: units.summary.state === "supported",
    film: film.state === "supported",
    plans: plans.all.state === "supported",
    passport: fullPassportDisplayable,
    intelligence: intelligence.state === "supported",
    amenities: amenities.all.state === "supported",
    location: location.state === "supported",
    developer: developer.state === "supported",
    updates: updates.state === "supported",
    documents: documents.state === "supported",
    related: related.state === "supported",
  };

  const sections = DECISION_DECK_SECTION_ORDER.filter((id) => sectionStates[id]).map((id) => ({
    id,
    label: SECTION_LABELS[id],
  }));

  return {
    compositionOrder: DECISION_DECK_COMPOSITION_ORDER,
    media: {
      photos: photos.length > 0 ? supported(photos) : empty("no-safe-project-photographs"),
      film,
    },
    decisionRail,
    passport,
    overview,
    amenities,
    units,
    plans,
    intelligence,
    location,
    developer,
    updates,
    documents,
    related,
    displayable: {
      decisionRail: decisionRailDisplayable,
      compactPassport: compactPassportDisplayable,
      fullPassport: fullPassportDisplayable,
    },
    sectionStates,
    sections,
    navigation: sections,
  };
}
