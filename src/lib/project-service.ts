/**
 * ProjectService — single data layer for the unified Property model.
 *
 * All UI code reads projects through this module. It:
 *   • fetches from Supabase (projects + developers + project_media)
 *   • maps raw rows into the app-wide `Property` type
 *   • filters by `is_active` and supports `is_featured`
 *   • exposes TanStack Query `queryOptions` objects for loaders / components
 *
 * Future filters, search, AI recommendations and the admin panel should
 * extend this service rather than re-querying Supabase directly.
 */

import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type {
  ForeverVerdict,
  MarketPosition,
  Property,
  PropertyType,
  RentalDemand,
  SalesStatus,
} from "@/lib/data";
import { isKnownFictitiousProjectSlug } from "@/lib/public-truth";
import {
  isPublicPhotograph,
  isPubliclyPresentable,
  neverPublicUrls,
  presentableCoverUrl,
  prohibitedPhotographUrls,
} from "@/lib/public-media-policy";

type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];
type DeveloperRow = Database["public"]["Tables"]["developers"]["Row"];
type MediaRow = Database["public"]["Tables"]["project_media"]["Row"];

/**
 * A project image is only ever the project's own recorded media URL.
 * FOREVER-TRUTH-001A removed the earlier bundled stock-photo fallback
 * (`image_key` → villa-*.jpg, final fallback villa-surin.jpg): a missing
 * photo must stay missing rather than silently become another project's
 * photograph. Cards render an explicit "Media preview pending" state instead.
 */
function resolveMediaUrl(url: string | null | undefined): string {
  if (url && /^(https?:|\/)/.test(url)) return url;
  return "";
}

type ProjectWithRelations = ProjectRow & {
  developer: Pick<DeveloperRow, "name"> | null;
  // `semantic_role` is now present in the generated types, so this is no longer
  // an accommodation for a lagging generator — it is kept because it states
  // something the generated shape does not, on the line below.
  //
  // REQUIRED, not optional, and that is deliberate. Optional would let a future
  // edit drop `semantic_role` from `SELECT` and still compile, after which every
  // row arrives with the field `undefined`, the readers answer "show it" for all
  // of them — correctly, that is the pre-backfill rollout guarantee — and the
  // contract fails open in silence. `public-query-contract.test.ts` pins the
  // select string itself; this pins the shape the code is written against.
  media: (Pick<MediaRow, "media_type" | "url" | "sort_order"> & {
    semantic_role: string | null;
  })[];
};

/**
 * Deliberate public projection. Do not replace this with `*`: projects carry
 * internal provenance and progressive-ingestion metadata which must not cross
 * the anonymous client boundary. The matching database column grants live in
 * migration 20260723130000_public_projection_privacy.sql.
 *
 * DEPLOY ORDER IS PART OF THIS CONTRACT — the same hard gate the Project Detail
 * projection carries. This select requests `project_media.semantic_role`
 * (FOREVER-MEDIA-SEMANTIC-PUBLIC-CONTRACT-001), and PostgREST fails an ENTIRE
 * embedded select with 42703 when a requested column does not exist. Deploying
 * this client before
 * `supabase/migrations/20260728120000_project_media_semantic_role.sql` has been
 * applied would empty the catalogue, not merely one card. For that direction it
 * is not a new gate: the migration already had to precede any build carrying
 * `PROJECT_DETAIL_SELECT`.
 *
 * THERE IS A SECOND, DIFFERENT ORDERING HAZARD, and an earlier version of this
 * comment denied it. `20260723130000_public_projection_privacy.sql` is
 * documented in its own header as intentionally UNAPPLIED, so on this database
 * it necessarily arrives AFTER `20260728120000`. It does
 * `REVOKE SELECT ON TABLE public.project_media FROM anon` and re-grants a column
 * list written before `semantic_role` existed — and a column-less REVOKE removes
 * column-level grants too. Applying it in that order takes `semantic_role` away
 * again and blanks the catalogue and every project page together.
 *
 * Apply `20260723130000` BEFORE `20260728120000`, or add `semantic_role` to its
 * grant list first. The release gate measures the outcome rather than trusting
 * the order: `npm run media:role-census -- --stage before_backfill` blocks when
 * `anon` cannot read `semantic_role`.
 *
 * The role is requested because it is the only way this reader can tell a pool
 * render from a launch-party photograph. Reading `media_type` alone — which is
 * what this did — let a prohibited image be a catalogue card's picture.
 * `metadata` remains unreadable by the anonymous role.
 */
const SELECT = `
  id, slug, name, project_type, location_area, short_description,
  full_description, construction_status, distance_to_beach, distance_to_airport,
  main_image_url, is_featured, is_active, created_at, sales_status,
  starting_price_thb, price_range, price_per_sqm_display, last_price_update,
  tagline, highlights, beds_display, area_range, nearby_schools,
  nearby_hospitals, lifestyle, start_date_display, completion_date_display,
  developer:developers(name),
  media:project_media(media_type, url, sort_order, semantic_role)
` as const;

/**
 * Fail-closed row mapping (FOREVER-TRUTH-001A). Two rules apply:
 *
 * 1. A missing database fact never becomes a positive public claim — it maps
 *    to its absence sentinel ("Not available", "", 0, false).
 * 2. The legacy advisory scalars (`EVIDENCE_UNPROVEN_ADVISORY_COLUMNS` in
 *    `@/lib/public-truth`) are suppressed even when present: the canonical
 *    Modeva seed proves they are placeholders (verified=true next to
 *    "Awaiting full Forever inspection data"), and no code binds them to an
 *    evidence contract. Their raw values stay in the database; the public
 *    claim is withheld until a real evidence contract exists.
 *
 * Descriptive record data (name, location, type, statuses, sizes, recorded
 * prices, distances, media) continues to map through normally.
 */
function mapToProperty(row: ProjectWithRelations): Property {
  const all = [...(row.media ?? [])].sort((a, b) => a.sort_order - b.sort_order);

  // The floor for every bucket below, applied once — the same floor
  // `groupProjectMedia` applies on the detail side. Retired covers and anything
  // whose recorded subject is people are not this project's plans, brochures or
  // videos either, and leaving these six buckets on a bare `media_type` match
  // while the detail reader had a floor would recreate, one field at a time,
  // exactly the asymmetry blocker 117-4 was.
  // Per URL, not per row: a re-published project holds the same URL as both a
  // `cover` row and a `gallery` row, so a per-row filter lets a prohibited image
  // back in through its sibling.
  const asPolicyRows = all.map((m) => ({
    mediaType: m.media_type,
    url: m.url,
    semanticRole: m.semantic_role,
  }));
  const barredEverywhere = neverPublicUrls(asPolicyRows);
  const barredPhotographs = prohibitedPhotographUrls(asPolicyRows);
  const media = all.filter(
    (m) =>
      isPubliclyPresentable({ mediaType: m.media_type, semanticRole: m.semantic_role }) &&
      !barredEverywhere.has((m.url ?? "").trim()),
  );

  // Every card image on the site passes through here. It used to select on
  // `media_type` alone, which admits a retired cover's replacement-era row and
  // every prohibited role, so a catalogue card could show the launch party while
  // the project page it linked to had already learned not to. One policy, asked
  // by both. See `@/lib/public-media-policy`.
  const gallery = media
    .filter(
      (m) =>
        !barredPhotographs.has((m.url ?? "").trim()) &&
        isPublicPhotograph({ mediaType: m.media_type, semanticRole: m.semantic_role }),
    )
    .map((m) => resolveMediaUrl(m.url))
    .filter((url) => url !== "");
  const floorPlans = media.filter((m) => m.media_type === "floor_plan").map((m) => m.url);
  const brochures = media.filter((m) => m.media_type === "brochure").map((m) => m.url);
  const videos = media.filter((m) => m.media_type === "video").map((m) => m.url);
  const masterPlan = media.find((m) => m.media_type === "master_plan")?.url;
  const unitPlanPdf = media.find(
    (m) => m.media_type === "unit_plan" && /\.pdf($|\?)/i.test(m.url),
  )?.url;
  const priceList = media.find((m) => m.media_type === "price_list")?.url;

  // `main_image_url` is a bare column with no role of its own, which is exactly
  // how Sierra's seasonal graphic stayed on its card. It is resolved against the
  // project's own recorded rows for the same URL first; when that URL is a
  // prohibited role or a retired cover the column yields nothing and the fallback
  // is the already-filtered gallery. The fallback never leaves this project, and
  // when nothing is left the card renders its "Media preview pending" state
  // rather than a picture of something else.
  // Resolved against ALL recorded rows, retired ones included: a retired row is
  // the evidence that its URL is no longer the cover, and filtering it out first
  // would leave the column pointing at a retired image with nothing left to
  // contradict it.
  const coverUrl = presentableCoverUrl(row.main_image_url, asPolicyRows);
  const image = resolveMediaUrl(coverUrl) || gallery[0] || "";
  const startingPriceTHB = row.starting_price_thb ?? 0;

  return {
    slug: row.slug,
    name: row.name,
    developer: row.developer?.name ?? "",
    location: row.location_area ?? "",
    propertyType: (row.project_type ?? "Not available") as PropertyType,
    // Recorded verbatim. `ConstructionStatus` is an open union precisely so
    // this no longer needs a cast that misdescribes what the column holds.
    constructionStatus: row.construction_status ?? "Not available",
    status: (row.sales_status ?? "Not available") as SalesStatus,
    tagline: row.tagline ?? "",
    description: row.full_description ?? row.short_description ?? "",
    highlights: row.highlights ?? [],
    beds: row.beds_display ?? "",
    area: row.area_range ?? "",

    price: startingPriceTHB
      ? `From ฿${(startingPriceTHB / 1_000_000).toFixed(startingPriceTHB % 1_000_000 === 0 ? 0 : 1)}M`
      : "",
    startingPriceTHB,
    priceRange: row.price_range ?? "",
    pricePerSqm: row.price_per_sqm_display ?? "",
    lastPriceUpdate: row.last_price_update ?? "",
    // Suppressed evidence-unproven legacy scalars (see module comment).
    verifiedPrice: "",
    promotion: "",
    foreverVerified: false,
    trustScore: 0,
    trustNote: "",
    investmentValue: 0,
    marketPosition: "Not available" as MarketPosition,
    verdict: "Not available" as ForeverVerdict,

    distanceToBeach: row.distance_to_beach ?? "",
    distanceToAirport: row.distance_to_airport ?? "",
    nearbySchools: row.nearby_schools ?? [],
    nearbyHospitals: row.nearby_hospitals ?? [],
    lifestyle: row.lifestyle ?? [],

    // Suppressed evidence-unproven legacy scalars (see module comment).
    rentalYield: "",
    rentalDemand: "Not available" as RentalDemand,
    capitalGrowthEstimate: "",

    startDate: row.start_date_display ?? "",
    completionDate: row.completion_date_display ?? "",
    // Suppressed evidence-unproven legacy scalar (see module comment).
    lastInspection: "",

    image,
    gallery,
    floorPlans,
    brochures,
    videos,
    masterPlan,
    unitPlanPdf,
    priceList,
  };
}

export type ListProjectsFilters = {
  featuredOnly?: boolean;
  limit?: number;
};

/**
 * Loads the local-development-only Coralina preview, guarded by a direct
 * `import.meta.env.DEV` check on the dynamic import call. Vite statically
 * replaces `import.meta.env.DEV` with `false` in a production build, so
 * Rollup's dead-code elimination removes this whole branch — including the
 * `import()` call — meaning the demo-preview module (and its Coralina adapter)
 * is never reachable from, and never bundled into, the production client.
 * See `demo-preview.test.ts` / the production-bundle contract test for proof.
 */
async function loadDemoPreviewProperties(): Promise<Property[]> {
  if (!import.meta.env.DEV) return [];
  const { listDemoPreviewProperties } = await import("@/features/project-detail/demo-preview");
  return listDemoPreviewProperties();
}

/**
 * Returns `null` outside the launcher-controlled Partner Demo. A non-null
 * result is authoritative and prevents any Supabase query for that request.
 */
async function loadPartnerDemoProperties(): Promise<Property[] | null> {
  if (!import.meta.env.DEV) return null;
  const { listPartnerDemoProperties } = await import("@/features/project-detail/partner-demo-data");
  return listPartnerDemoProperties();
}

export const ProjectService = {
  /** Every active project, ordered: featured first, newest first. */
  async listActive(filters: ListProjectsFilters = {}): Promise<Property[]> {
    const partnerDemoProjects = await loadPartnerDemoProperties();
    if (partnerDemoProjects) {
      const selected = filters.featuredOnly
        ? partnerDemoProjects.filter((project) => project.slug === "modeva")
        : partnerDemoProjects;
      return filters.limit === undefined ? selected : selected.slice(0, filters.limit);
    }

    let query = supabase
      .from("projects")
      .select(SELECT)
      .eq("is_active", true)
      .order("is_featured", { ascending: false })
      .order("created_at", { ascending: true });

    if (filters.featuredOnly) query = query.eq("is_featured", true);
    const { data, error } = await query;
    if (error) throw error;
    const projects = (data ?? [])
      .filter((row) => !isKnownFictitiousProjectSlug((row as { slug: string }).slug))
      .map((row) => mapToProperty(row as unknown as ProjectWithRelations));
    const previews = await loadDemoPreviewProperties();
    const combined = [...projects, ...previews];
    return filters.limit === undefined ? combined : combined.slice(0, filters.limit);
  },

  /**
   * Single active project by slug, or `null` if not found / inactive.
   * Known-fictitious slugs resolve to `null` without querying: quarantined
   * seed rows must not be reachable even by direct URL.
   */
  async getBySlug(slug: string): Promise<Property | null> {
    if (isKnownFictitiousProjectSlug(slug)) return null;

    const partnerDemoProjects = await loadPartnerDemoProperties();
    if (partnerDemoProjects) {
      return partnerDemoProjects.find((project) => project.slug === slug) ?? null;
    }

    const { data, error } = await supabase
      .from("projects")
      .select(SELECT)
      .eq("is_active", true)
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return mapToProperty(data as unknown as ProjectWithRelations);
  },

  /** Slugs only — cheap query for sitemap / static enumeration. */
  async listActiveSlugs(): Promise<string[]> {
    const partnerDemoProjects = await loadPartnerDemoProperties();
    if (partnerDemoProjects) return partnerDemoProjects.map((project) => project.slug);

    const { data, error } = await supabase.from("projects").select("slug").eq("is_active", true);
    if (error) throw error;
    return (data ?? []).map((r) => r.slug).filter((slug) => !isKnownFictitiousProjectSlug(slug));
  },
};

/* ---------- TanStack Query options ---------- */

export const projectKeys = {
  all: ["projects"] as const,
  list: (filters: ListProjectsFilters = {}) => ["projects", "list", filters] as const,
  detail: (slug: string) => ["projects", "detail", slug] as const,
};

export const projectListQuery = (filters: ListProjectsFilters = {}) =>
  queryOptions({
    queryKey: projectKeys.list(filters),
    queryFn: () => ProjectService.listActive(filters),
  });

export const projectDetailQuery = (slug: string) =>
  queryOptions({
    queryKey: projectKeys.detail(slug),
    queryFn: () => ProjectService.getBySlug(slug),
  });
