import { PUBLIC_SITE_ORIGIN } from "@/lib/sitemap";
import { presentableDeveloperName } from "./developer-identity";
import { projectSocialImage } from "./project-sections";
import type { ProjectDetail } from "./project-detail-types";
import { publicRecordedText } from "./public-value";

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
  return Boolean(publicRecordedText(value));
}

const AVAILABILITY_BY_RECORDED_STATUS: Record<string, string> = {
  Available: "https://schema.org/InStock",
  Selling: "https://schema.org/InStock",
  "Sold Out": "https://schema.org/SoldOut",
};

export function mapRecordedStatusToAvailability(status: string): string | undefined {
  return AVAILABILITY_BY_RECORDED_STATUS[status];
}

/**
 * One fact-only description shared by visible metadata and structured data.
 * Free-text marketing copy is deliberately excluded because it can carry a
 * stale developer name after the developer truth layer has withheld identity.
 */
export function projectPublicFactDescription(project: ProjectDetail): string {
  const location = publicRecordedText(project.location.area || project.core.location);
  const projectType = publicRecordedText(project.core.type);
  const constructionStatus = publicRecordedText(project.core.constructionStatus);
  const facts = [
    location ? `${project.core.name} in ${location}.` : `${project.core.name}.`,
    projectType ? `Recorded project type: ${projectType}.` : null,
    constructionStatus ? `Recorded construction status: ${constructionStatus}.` : null,
    "Forever project record.",
  ];
  return facts.filter((fact): fact is string => fact !== null).join(" ");
}

export function buildProjectStructuredData(project: ProjectDetail, url: string, image?: string) {
  const publicDescription = projectPublicFactDescription(project);
  const location = publicRecordedText(project.location.area || project.core.location);
  // Do not trust a caller-provided social image as a second media policy. The
  // structured-data image is always re-derived from the same semantic selector
  // used by the visible mosaic and metadata. The optional argument remains for
  // API compatibility and is accepted only when it equals that result.
  const canonicalImage = projectSocialImage(project);
  const publicImage = image && image === canonicalImage ? image : canonicalImage;
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

  // The same developer decision the visible page makes (F2), so the two cannot
  // diverge. `recorded()` still applies: a "Not available" sentinel is not a
  // brand.
  const presentableDeveloper = presentableDeveloperName(project);
  const brandName =
    presentableDeveloper && recorded(presentableDeveloper) ? presentableDeveloper : null;

  return [
    {
      type: "application/ld+json",
      children: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Product",
        name: project.core.name,
        description: publicDescription,
        // Omitted, not emitted empty. The module's own rule is that an absent
        // fact is never serialized, and `image: []` broke it — it stated that
        // the project's pictures had been considered and there were none, in a
        // field consumers read as the project's photograph. A project whose only
        // photographs depict something else has no image to give.
        ...(publicImage ? { image: [publicImage] } : {}),
        url,
        ...(recorded(project.core.type) ? { category: project.core.type } : {}),
        // Suppressed when Forever's two sources name different developers (F2).
        // JSON-LD is the machine-readable copy of the page: publishing a
        // contradicted brand to search engines is the same false claim, made
        // somewhere it outlives the page and cannot be read in context.
        ...(brandName ? { brand: { "@type": "Organization", name: brandName } } : {}),
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
        description: publicDescription,
        ...(publicImage ? { image: publicImage } : {}),
        url,
        ...(recorded(location)
          ? {
              address: {
                "@type": "PostalAddress",
                addressLocality: location,
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
            item: `${PUBLIC_SITE_ORIGIN}/projects`,
          },
          { "@type": "ListItem", position: 2, name: project.core.name, item: url },
        ],
      }),
    },
  ];
}
