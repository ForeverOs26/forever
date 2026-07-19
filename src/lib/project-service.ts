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
  ConstructionStatus,
  ForeverVerdict,
  MarketPosition,
  Property,
  PropertyType,
  RentalDemand,
  SalesStatus,
} from "@/lib/data";
import villaSurin from "@/assets/villa-surin.jpg";
import villaKamala from "@/assets/villa-kamala.jpg";
import villaLayan from "@/assets/villa-layan.jpg";
import villaBangtao from "@/assets/villa-bangtao.jpg";
import villaKata from "@/assets/villa-kata.jpg";
import villaRawai from "@/assets/villa-rawai.jpg";

type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];
type DeveloperRow = Database["public"]["Tables"]["developers"]["Row"];
type MediaRow = Database["public"]["Tables"]["project_media"]["Row"];

/** Bundled fallback assets keyed by `projects.image_key` (used until a CMS
 *  publishes real URLs into `main_image_url` / `project_media.url`). */
const IMAGE_ASSETS: Record<string, string> = {
  villaSurin,
  villaKamala,
  villaLayan,
  villaBangtao,
  villaKata,
  villaRawai,
};

function resolveImage(url: string | null | undefined, key: string | null | undefined): string {
  if (url && /^(https?:|\/)/.test(url)) return url;
  if (url && IMAGE_ASSETS[url]) return IMAGE_ASSETS[url];
  if (key && IMAGE_ASSETS[key]) return IMAGE_ASSETS[key];
  return villaSurin; // final fallback
}

type ProjectWithRelations = ProjectRow & {
  developer: Pick<DeveloperRow, "name"> | null;
  media: Pick<MediaRow, "media_type" | "url" | "sort_order">[];
};

const SELECT = `
  *,
  developer:developers(name),
  media:project_media(media_type, url, sort_order)
` as const;

function mapToProperty(row: ProjectWithRelations): Property {
  const media = [...(row.media ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const gallery = media
    .filter((m) => m.media_type === "gallery" || m.media_type === "cover")
    .map((m) => resolveImage(m.url, row.image_key));
  const floorPlans = media.filter((m) => m.media_type === "floor_plan").map((m) => m.url);
  const brochures = media.filter((m) => m.media_type === "brochure").map((m) => m.url);
  const videos = media.filter((m) => m.media_type === "video").map((m) => m.url);
  const masterPlan = media.find((m) => m.media_type === "master_plan")?.url;
  const unitPlanPdf = media.find((m) => m.media_type === "unit_plan" && /\.pdf($|\?)/i.test(m.url))?.url;
  const priceList = media.find((m) => m.media_type === "price_list")?.url;

  const image = resolveImage(row.main_image_url, row.image_key);
  const startingPriceTHB = row.starting_price_thb ?? 0;

  return {
    slug: row.slug,
    name: row.name,
    developer: row.developer?.name ?? "",
    location: row.location_area ?? "",
    propertyType: (row.project_type ?? "Villa") as PropertyType,
    constructionStatus: (row.construction_status ?? "Planning") as ConstructionStatus,
    status: (row.sales_status ?? "Available") as SalesStatus,
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
    verifiedPrice: row.verified_price ?? row.price_range ?? "",
    promotion: row.promotion ?? "",

    foreverVerified: row.forever_verified ?? true,
    trustScore: Number(row.trust_score ?? 0),
    trustNote: row.trust_note ?? "",
    investmentValue: Number(row.investment_value ?? 0),
    marketPosition: (row.market_position ?? "In line with market") as MarketPosition,
    verdict: (row.verdict ?? "Strong Buy") as ForeverVerdict,

    distanceToBeach: row.distance_to_beach ?? "",
    distanceToAirport: row.distance_to_airport ?? "",
    nearbySchools: row.nearby_schools ?? [],
    nearbyHospitals: row.nearby_hospitals ?? [],
    lifestyle: row.lifestyle ?? [],

    rentalYield: row.rental_yield ?? "",
    rentalDemand: (row.rental_demand ?? "Moderate") as RentalDemand,
    capitalGrowthEstimate: row.capital_growth_estimate ?? "",

    startDate: row.start_date_display ?? "",
    completionDate: row.completion_date_display ?? "",
    lastInspection: row.last_inspection ?? "",

    image,
    gallery: gallery.length > 0 ? gallery : [image],
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

export const ProjectService = {
  /** Every active project, ordered: featured first, newest first. */
  async listActive(filters: ListProjectsFilters = {}): Promise<Property[]> {
    let query = supabase
      .from("projects")
      .select(SELECT)
      .eq("is_active", true)
      .order("is_featured", { ascending: false })
      .order("created_at", { ascending: true });

    if (filters.featuredOnly) query = query.eq("is_featured", true);
    const { data, error } = await query;
    if (error) throw error;
    const projects = (data ?? []).map((row) => mapToProperty(row as unknown as ProjectWithRelations));
    const previews = await loadDemoPreviewProperties();
    const combined = [...projects, ...previews];
    return filters.limit === undefined ? combined : combined.slice(0, filters.limit);
  },

  /** Single active project by slug, or `null` if not found / inactive. */
  async getBySlug(slug: string): Promise<Property | null> {
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
    const { data, error } = await supabase
      .from("projects")
      .select("slug")
      .eq("is_active", true);
    if (error) throw error;
    return (data ?? []).map((r) => r.slug);
  },
};

/* ---------- TanStack Query options ---------- */

export const projectKeys = {
  all: ["projects"] as const,
  list: (filters: ListProjectsFilters = {}) =>
    ["projects", "list", filters] as const,
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
