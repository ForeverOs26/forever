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

export const DEMO_PREVIEW_SLUG = "coralina";

export function isDemoPreviewEnabled(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEMO_PREVIEW !== "false";
}

export async function getDemoPreviewProjectDetail(slug: string): Promise<ProjectDetail | null> {
  if (!isDemoPreviewEnabled() || slug !== DEMO_PREVIEW_SLUG) return null;

  // The Coralina adapter is generated from the committed canonical import
  // payload/source facts. Dynamic loading keeps that local-only preview data
  // out of the normal published-project read path.
  const { buildCoralinaProjectDetail } = await import(
    "@/features/coralina-integration/adapters/coralina-project-detail"
  );
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
    constructionStatus: "Planning",
    status: "Available",
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
    marketPosition: "In line with market",
    // The preview has no Forever verdict; this field is retained only for the
    // legacy card contract and is never presented as a verified assessment.
    verdict: (project.trust.verdict || "Lifestyle Purchase") as Property["verdict"],
    distanceToBeach: project.location.distanceToBeach,
    distanceToAirport: project.location.distanceToAirport,
    nearbySchools: project.location.nearbySchools,
    nearbyHospitals: project.location.nearbyHospitals,
    lifestyle: project.location.lifestyle,
    rentalYield: project.investment.rentalYield,
    rentalDemand: "Moderate",
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
