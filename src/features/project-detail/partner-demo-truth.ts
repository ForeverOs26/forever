import type { ProjectDetail } from "./project-detail-types";

/**
 * Public-truth fields for the Modeva partner/demo constructor.
 *
 * Kept free of asset imports so the adapter contract remains testable in a
 * clean checkout where the gitignored demo package is intentionally absent.
 */
export function buildModevaPartnerDemoCore(): ProjectDetail["core"] {
  return {
    id: "partner-demo-modeva",
    slug: "modeva",
    name: "Modeva",
    type: "Condominium",
    status: "Available",
    constructionStatus: "Planning",
    ownershipType: "",
    location: "Bang Tao",
    address: "Bang Tao, Phuket, Thailand",
    tagline: "Published project record for guided review",
    description:
      "Modeva is a published project record in the Forever Core Database. This presentation shows only fields supported by committed project sources.",
    highlights: ["Bang Tao, Phuket", "Planning status recorded"],
    beds: "1–3 bedrooms represented in the reviewed inventory",
    area: "29–148 sq.m. represented in the reviewed inventory",
    isFeatured: true,
    isActive: true,
    developerNameRaw: "Rhom Bho Property",
  };
}
