import { createFileRoute, notFound } from "@tanstack/react-router";

import { SiteShell } from "@/components/SiteShell";
import { listingDetailQuery, type PublicListing } from "@/lib/listing-service";

/**
 * Public resale listing page (FOREVER-STUDIO-001).
 *
 * The anonymous client + RLS serve only published listings, and rendering is
 * fail-closed per the public truth boundary: a missing price shows
 * "Price on request", missing sections are omitted, nothing is invented.
 */
export const Route = createFileRoute("/resale/$slug")({
  loader: async ({ params, context }) => {
    const listing = await context.queryClient.ensureQueryData(listingDetailQuery(params.slug));
    if (!listing) throw notFound();
    return { listing };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData ? `${loaderData.listing.title} — Forever` : "Resale — Forever" },
      ...(loaderData?.listing.description
        ? [{ name: "description", content: loaderData.listing.description.slice(0, 160) }]
        : []),
    ],
  }),
  component: ResaleListingPage,
});

function formatPrice(listing: PublicListing): string {
  if (listing.price == null) return "Price on request";
  const amount = listing.price.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return listing.currency ? `${amount} ${listing.currency}` : amount;
}

function ResaleListingPage() {
  const { listing } = Route.useLoaderData();
  const facts: Array<[string, string]> = [];
  if (listing.bedrooms != null) facts.push(["Bedrooms", String(listing.bedrooms)]);
  if (listing.bathrooms != null) facts.push(["Bathrooms", String(listing.bathrooms)]);
  if (listing.area_sqm != null) facts.push(["Area", `${listing.area_sqm} m²`]);
  if (listing.property_type) facts.push(["Type", listing.property_type]);
  if (listing.project_name_raw) facts.push(["Project", listing.project_name_raw]);
  if (listing.location_name_raw) facts.push(["Location", listing.location_name_raw]);

  return (
    <SiteShell>
      <article className="mx-auto w-full max-w-4xl px-4 py-10">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Resale listing
        </p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{listing.title}</h1>
        <p className="mt-2 text-xl font-medium">{formatPrice(listing)}</p>

        {listing.photos.length ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {listing.photos.map((photo, index) => (
              <img
                key={index}
                src={photo}
                alt={`${listing.title} — photo ${index + 1}`}
                loading={index === 0 ? "eager" : "lazy"}
                className="aspect-[4/3] w-full rounded-2xl object-cover"
              />
            ))}
          </div>
        ) : null}

        {facts.length ? (
          <dl className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {facts.map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border/60 bg-card p-3">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {listing.description ? (
          <div className="mt-8 max-w-2xl whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
            {listing.description}
          </div>
        ) : null}

        <div className="mt-10 rounded-2xl border border-border/60 bg-card p-6">
          <h2 className="font-medium">Interested in this property?</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every enquiry goes through a Forever advisor, who arranges details and a viewing. Seller
            contact details are never published.
          </p>
          <a
            href="/contact"
            className="mt-4 inline-flex h-11 items-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground"
          >
            Contact Forever
          </a>
        </div>
      </article>
    </SiteShell>
  );
}
