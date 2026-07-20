import type { ProjectDetail } from "./project-detail-types";

/**
 * JSON-LD structured data for the public Project Detail route
 * (FOREVER-TRUTH-001A).
 *
 * Rules:
 * - Only recorded facts are emitted; empty values and the "Not available"
 *   sentinel are omitted entirely, never serialized.
 * - Sales availability uses a closed whitelist: only an explicitly recorded
 *   available/selling state maps to `InStock`, only an explicitly recorded
 *   sold-out state maps to `SoldOut`; every other value omits availability.
 * - No geography is inferred: there is no source-backed region/country field
 *   in the project record, so no `addressRegion`/`addressCountry` is emitted.
 *   The recorded free-text location may appear only as `addressLocality`.
 * - The evidence-unproven legacy advisory scalars (score, verdict, market
 *   position, yield, capital growth, verification) are never emitted here,
 *   even if a future object carries values — structured data must not become
 *   a side channel for suppressed claims.
 */

/** A fact counts as recorded only when non-empty and not the absence sentinel. */
function recorded(value: string | null | undefined): value is string {
  return Boolean(value && value.trim().length > 0 && value.trim() !== "Not available");
}

const AVAILABILITY_BY_RECORDED_STATUS: Record<string, string> = {
  Available: "https://schema.org/InStock",
  Selling: "https://schema.org/InStock",
  "Sold Out": "https://schema.org/SoldOut",
};

export function mapRecordedStatusToAvailability(status: string): string | undefined {
  return AVAILABILITY_BY_RECORDED_STATUS[status];
}

export function buildProjectStructuredData(project: ProjectDetail, url: string, image?: string) {
  const images = image ? [image] : [];

  const additionalProperty = [
    recorded(project.core.constructionStatus)
      ? {
          "@type": "PropertyValue",
          name: "Construction Status",
          value: project.core.constructionStatus,
        }
      : null,
  ].filter(Boolean);

  const availability = recorded(project.core.status)
    ? mapRecordedStatusToAvailability(project.core.status)
    : undefined;

  return [
    {
      type: "application/ld+json",
      children: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Product",
        name: project.core.name,
        ...(recorded(project.core.description) ? { description: project.core.description } : {}),
        image: images,
        url,
        ...(recorded(project.core.type) ? { category: project.core.type } : {}),
        ...(project.developer && recorded(project.developer.name)
          ? { brand: { "@type": "Organization", name: project.developer.name } }
          : {}),
        ...(project.pricing.startingPriceTHB > 0
          ? {
              offers: {
                "@type": "Offer",
                price: project.pricing.startingPriceTHB,
                priceCurrency: "THB",
                ...(availability ? { availability } : {}),
                url,
              },
            }
          : {}),
        ...(additionalProperty.length > 0 ? { additionalProperty } : {}),
      }),
    },
    {
      type: "application/ld+json",
      children: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Place",
        name: project.core.name,
        ...(recorded(project.core.tagline) ? { description: project.core.tagline } : {}),
        ...(image ? { image } : {}),
        url,
        ...(recorded(project.core.location)
          ? {
              address: {
                "@type": "PostalAddress",
                addressLocality: project.core.location,
              },
            }
          : {}),
      }),
    },
    {
      type: "application/ld+json",
      children: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Projects",
            item: "https://forever-home-core.lovable.app/projects",
          },
          { "@type": "ListItem", position: 2, name: project.core.name, item: url },
        ],
      }),
    },
  ];
}
