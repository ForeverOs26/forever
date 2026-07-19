/**
 * Local demo-only project previews.
 *
 * Published projects continue to come from Supabase.  This narrow adapter is
 * intentionally limited to Vite development mode, where it makes the tracked
 * Coralina draft payload available to the existing read models without using
 * privileged credentials or changing production visibility.
 */
import type { Property } from "@/lib/data";
import type { ProjectDetail } from "./project-detail-types";
import { DEMO_PREVIEW_SLUG } from "./demo-preview-constants";

export { DEMO_PREVIEW_SLUG };

const loadDemoPreviewAdapter = import.meta.env.DEV
  ? () => import("@/features/coralina-integration/adapters/coralina-project-detail")
  : undefined;

export function isDemoPreviewEnabled(
  env: Pick<ImportMetaEnv, "DEV"> & { VITE_ENABLE_DEMO_PREVIEW?: string } = import.meta.env,
): boolean {
  return env.DEV && env.VITE_ENABLE_DEMO_PREVIEW !== "false";
}

export async function getDemoPreviewProjectDetail(slug: string): Promise<ProjectDetail | null> {
  if (!isDemoPreviewEnabled() || slug !== DEMO_PREVIEW_SLUG) return null;

  if (!loadDemoPreviewAdapter) return null;

  // The adapter is compiled only in local Vite development builds.
  const { buildCoralinaProjectDetail } = await loadDemoPreviewAdapter();
  const project = buildCoralinaProjectDetail();

  return {
    ...project,
    core: { ...project.core, isDemoPreview: true },
    // The draft payload deliberately has no public storage URLs. Do not turn
    // repository-source paths into guest-facing links; the shared engine's
    // existing empty states handle the absent media and documents cleanly.
    media: {
      hero: null,
      gallery: [],
      floorPlans: [],
      masterPlan: null,
      unitPlans: [],
      brochures: [],
      videos: [],
      documents: [],
    },
  };
}

export function mapProjectDetailToProperty(project: ProjectDetail): Property {
  const hero = project.media.hero ?? project.media.gallery[0];
  const startingPrice = project.pricing.startingPriceTHB;

  return {
    slug: project.core.slug,
    name: project.core.name,
    developer: project.developer?.name ?? "",
    location: project.location.area || project.core.location,
    propertyType: "Residence",
    constructionStatus: "Not available",
    status: "Not available",
    tagline: project.core.tagline,
    description: project.core.description,
    highlights: project.core.highlights,
    beds: project.core.beds,
    area: project.core.area,
    price: startingPrice ? `From THB ${(startingPrice / 1_000_000).toFixed(1)}M` : "",
    startingPriceTHB: startingPrice,
    priceRange: project.pricing.priceRange,
    pricePerSqm: project.pricing.pricePerSqm,
    lastPriceUpdate: project.pricing.lastPriceUpdate,
    verifiedPrice: project.pricing.verifiedPrice,
    promotion: project.pricing.promotion,
    foreverVerified: project.trust.foreverVerified,
    trustScore: project.trust.trustScore,
    trustNote: project.trust.trustNote,
    investmentValue: project.investment.investmentValue,
    marketPosition: "Not available",
    verdict: "Not available",
    distanceToBeach: project.location.distanceToBeach,
    distanceToAirport: project.location.distanceToAirport,
    nearbySchools: project.location.nearbySchools,
    nearbyHospitals: project.location.nearbyHospitals,
    lifestyle: project.location.lifestyle,
    rentalYield: project.investment.rentalYield,
    rentalDemand: "Not available",
    capitalGrowthEstimate: project.investment.capitalGrowthEstimate,
    startDate: "",
    completionDate: "",
    lastInspection: project.trust.lastInspection,
    image: hero?.url ?? "",
    gallery: project.media.gallery.map((item) => item.url),
    floorPlans: project.media.floorPlans.map((item) => item.url),
    brochures: project.media.brochures.map((item) => item.url),
    videos: project.media.videos.map((item) => item.url),
    masterPlan: project.media.masterPlan?.url,
    unitPlanPdf: project.media.unitPlans[0]?.url,
  };
}

export async function listDemoPreviewProperties(): Promise<Property[]> {
  const project = await getDemoPreviewProjectDetail(DEMO_PREVIEW_SLUG);
  return project ? [mapProjectDetailToProperty(project)] : [];
}
