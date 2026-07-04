import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  MapPin,
  CalendarCheck,
  ShieldCheck,
  TrendingUp,
  LineChart,
  Droplets,
  Users,
  FileText,
  Building2,
  GraduationCap,
  Plane,
  Waves,
  Sparkles,
  BadgeCheck,
  HardHat,
} from "lucide-react";
import * as React from "react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Map as MapIcon, LayoutGrid, BookOpen, X } from "lucide-react";
import { ForeverVerified } from "@/components/ForeverVerified";
import { ProjectCard } from "@/components/ProjectCard";
import { SiteShell } from "@/components/SiteShell";
import { Container } from "@/components/layout/Container";
import { Section } from "@/components/layout/Section";
import { Button } from "@/components/ui/button";
import { ContactForm } from "@/components/ContactForm";
import type { Property } from "@/lib/data";
import { projectDetailQuery, projectListQuery } from "@/lib/project-service";

export const Route = createFileRoute("/projects/$slug")({
  loader: async ({ context, params }) => {
    const property = await context.queryClient.ensureQueryData(
      projectDetailQuery(params.slug),
    );
    if (!property) throw notFound();
    // Warm the "related" list used by the component.
    void context.queryClient.ensureQueryData(projectListQuery());
    return { property };
  },
  head: ({ params, loaderData }) => {
    const p = loaderData?.property;
    const title = p ? `${p.name} — Forever Advisory Report` : "Project Details — Forever";
    const description = p
      ? `${p.name} in ${p.location}. ${p.tagline}. Independently reviewed by Forever.`
      : "Independent Forever advisory report on a Phuket residence.";
    const url = `https://forever-home-core.lovable.app/projects/${params.slug}`;
    const meta = [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "product" },
      { property: "og:url", content: url },
      ...(p
        ? [
            { property: "og:image", content: p.image },
            { name: "twitter:image", content: p.image },
          ]
        : []),
    ];
    const links = [{ rel: "canonical", href: url }];
    const scripts = p
      ? [
          {
            type: "application/ld+json",
            children: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Product",
              name: p.name,
              description: p.description,
              image: [p.image],
              url,
              category: p.propertyType,
              brand: { "@type": "Organization", name: p.developer },
              offers: {
                "@type": "Offer",
                price: p.startingPriceTHB,
                priceCurrency: "THB",
                availability:
                  p.status === "Sold Out"
                    ? "https://schema.org/SoldOut"
                    : "https://schema.org/InStock",
                url,
                priceValidUntil: undefined,
                priceSpecification: {
                  "@type": "PriceSpecification",
                  price: p.startingPriceTHB,
                  priceCurrency: "THB",
                  valueAddedTaxIncluded: false,
                  description: `Starting price. Verified range ${p.verifiedPrice}, ${p.pricePerSqm}.`,
                },
              },
              additionalProperty: [
                { "@type": "PropertyValue", name: "Forever Trust", value: p.trustScore, maxValue: 10 },
                { "@type": "PropertyValue", name: "Investment Value", value: p.investmentValue, maxValue: 10 },
                { "@type": "PropertyValue", name: "Market Position", value: p.marketPosition },
                { "@type": "PropertyValue", name: "Forever Verdict", value: p.verdict },
                { "@type": "PropertyValue", name: "Construction Status", value: p.constructionStatus },
                { "@type": "PropertyValue", name: "Rental Yield", value: p.rentalYield },
                { "@type": "PropertyValue", name: "Capital Growth Estimate", value: p.capitalGrowthEstimate },
              ],
            }),
          },
          {
            type: "application/ld+json",
            children: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Place",
              name: p.name,
              description: p.tagline,
              image: p.image,
              url,
              address: {
                "@type": "PostalAddress",
                addressLocality: p.location,
                addressRegion: "Phuket",
                addressCountry: "TH",
              },
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
                { "@type": "ListItem", position: 2, name: p.name, item: url },
              ],
            }),
          },
        ]
      : undefined;
    return { meta, links, scripts };
  },
  component: ProjectDetailPage,
  notFoundComponent: NotFoundView,
  errorComponent: ErrorView,
});

function NotFoundView() {
  const { slug } = Route.useParams();
  return (
    <SiteShell>
      <Section eyebrow="Not found" title="This project isn't in our advisory list">
        <p className="text-sm text-muted-foreground">
          We couldn't find a Forever-reviewed project matching "{slug}".
        </p>
        <div className="mt-6">
          <Button asChild>
            <Link to="/projects">Back to all projects</Link>
          </Button>
        </div>
      </Section>
    </SiteShell>
  );
}

function ErrorView({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <SiteShell>
      <Section eyebrow="Something went wrong" title="We couldn't load this project">
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <div className="mt-6">
          <Button
            onClick={() => {
              reset();
              router.invalidate();
            }}
          >
            Try again
          </Button>
        </div>
      </Section>
    </SiteShell>
  );
}

function liquidityFor(p: Property): string {
  if (p.rentalDemand === "Very High") return "High";
  if (p.rentalDemand === "High") return "Moderate – High";
  if (p.rentalDemand === "Moderate") return "Moderate";
  return "Limited";
}

function ProjectDetailPage() {
  const { slug } = Route.useParams();
  const { data: detail } = useSuspenseQuery(projectDetailQuery(slug));
  const { data: allProjects } = useSuspenseQuery(projectListQuery());
  if (!detail) throw notFound();
  const p: Property = detail;
  const gallery = p.gallery.length > 0 ? p.gallery : [p.image];
  const hero = p.image || gallery[0];
  const related = allProjects.filter((x) => x.slug !== p.slug).slice(0, 3);
  const brochureUrl = p.brochures[0];
  const masterPlanUrl = p.masterPlan;
  const hasTrust = p.trustScore > 0;
  const hasInvestment = p.investmentValue > 0;
  const priceVerified =
    p.verifiedPrice === "true" ||
    p.verifiedPrice.toLowerCase?.() === "verified" ||
    p.foreverVerified;
  const [lightbox, setLightbox] = useState<number | null>(null);

  const scrollToFloorPlans = () => {
    if (typeof document === "undefined") return;
    document
      .getElementById("floor-plans")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const documents: { label: string; note: string; href?: string }[] = [
    {
      label: "Brochure",
      note: brochureUrl ? "PDF available" : "Available on request",
      href: brochureUrl,
    },
    {
      label: "Price List",
      note: p.lastPriceUpdate ? `Verified ${p.lastPriceUpdate}` : "Available on request",
      href: p.priceList,
    },
    {
      label: "Master Plan",
      note: masterPlanUrl ? "PDF available" : "Available on request",
      href: masterPlanUrl,
    },
    {
      label: "Unit Plans",
      note: p.unitPlanPdf ? "PDF available" : "Available on request",
      href: p.unitPlanPdf,
    },
    {
      label: "Payment Plan",
      note: "Developer schedule — available on request",
    },
  ];

  return (
    <SiteShell>
      {/* 1. HERO */}
      <section className="relative">
        <div className="relative h-[70vh] min-h-[520px] w-full overflow-hidden">
          <img
            src={hero}
            alt={`${p.name} — ${p.location}, Phuket`}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-black/10" />
          <Container className="relative flex h-full flex-col justify-end pb-14">
            <Link
              to="/projects"
              className="mb-6 inline-flex w-fit items-center gap-1 text-xs uppercase tracking-[0.2em] text-primary-foreground/80 hover:text-primary-foreground"
            >
              <ArrowLeft className="h-3 w-3" /> All projects
            </Link>
            <div className="grid gap-6 text-primary-foreground md:grid-cols-[1fr_auto] md:items-end">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <ForeverVerified />
                </div>
                <h1 className="mt-3 font-serif text-4xl leading-[1.05] tracking-tight sm:text-6xl">
                  {p.name}
                </h1>
                <div className="mt-4 inline-flex items-center gap-1.5 text-sm opacity-90">
                  <MapPin className="h-4 w-4" /> {p.location} · Phuket
                </div>
              </div>
              <div className="flex flex-col items-start gap-4 md:items-end">
                <div className="md:text-right">
                  <div className="text-[10px] uppercase tracking-[0.24em] opacity-70">
                    Starting price
                  </div>
                  <div className="font-serif text-3xl sm:text-4xl">{p.price}</div>
                </div>
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    {brochureUrl && (
                      <Button asChild size="sm" variant="secondary">
                        <a href={brochureUrl} target="_blank" rel="noopener noreferrer">
                          <BookOpen className="mr-1.5 h-4 w-4" /> View Brochure
                        </a>
                      </Button>
                    )}
                    {masterPlanUrl && (
                      <Button asChild size="sm" variant="secondary">
                        <a href={masterPlanUrl} target="_blank" rel="noopener noreferrer">
                          <MapIcon className="mr-1.5 h-4 w-4" /> Master Plan
                        </a>
                      </Button>
                    )}
                    {p.floorPlans.length > 0 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={scrollToFloorPlans}
                      >
                        <LayoutGrid className="mr-1.5 h-4 w-4" /> Floor Plans
                      </Button>
                    )}
                    <Button asChild size="sm">
                      <Link to="/contact">Book Private Advisory</Link>
                    </Button>
                  </div>
              </div>
            </div>
          </Container>
        </div>
      </section>

      {/* 2. FOREVER ADVISORY SUMMARY */}
      <Section
        eyebrow="Forever Advisory Summary"
        title="Trust, value, position and verdict"
        className="py-16 sm:py-20"
      >
        {(() => {
          const stats = [
            hasTrust && (
              <SummaryStat
                key="trust"
                label="Forever Trust"
                value={p.trustScore.toFixed(1)}
                suffix="/ 10"
              />
            ),
            hasInvestment && (
              <SummaryStat
                key="investment"
                label="Investment Value"
                value={p.investmentValue.toFixed(1)}
                suffix="/ 10"
              />
            ),
            <SummaryStat key="market" label="Market Position" value={p.marketPosition} />,
            <SummaryStat key="verdict" label="Forever Verdict" value={p.verdict} accent />,
          ].filter(Boolean);
          const cols =
            stats.length === 4
              ? "sm:grid-cols-4"
              : stats.length === 3
                ? "sm:grid-cols-3"
                : "sm:grid-cols-2";
          return (
            <div className="rounded-3xl border border-border/60 bg-card p-6 sm:p-8">
              <div className={`grid grid-cols-1 gap-8 ${cols} sm:gap-6`}>{stats}</div>
            </div>
          );
        })()}
      </Section>

      {/* 3. WHY FOREVER RECOMMENDS IT */}
      <Section
        eyebrow="Why Forever Recommends It"
        title="An advisor's note"
        className="pt-0"
      >
        <div className="mx-auto max-w-3xl rounded-3xl border border-accent/20 bg-accent/[0.04] px-6 py-8 sm:px-10 sm:py-10">
          <p className="font-serif text-xl leading-relaxed text-foreground sm:text-2xl">
            {p.tagline}.
          </p>
          <p className="mt-5 text-sm leading-relaxed text-muted-foreground sm:text-base">
            {p.description} Our verdict — <span className="text-foreground">{p.verdict}</span> —
            reflects an independent review of {p.developer}'s track record, verified pricing at{" "}
            {p.pricePerSqm}, and the neighborhood's long-term trajectory. {p.trustNote}
          </p>
          {p.highlights.length > 0 && (
            <ul className="mt-6 grid gap-2 sm:grid-cols-2">
              {p.highlights.map((h: string) => (
                <li key={h} className="flex items-start gap-2.5 text-sm text-foreground">
                  <span className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-accent/70" />
                  {h}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      {/* 4. INSPECTION REPORT */}
      <Section
        eyebrow="Inspection Report"
        title="What we verified on site"
        className="pt-0"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <InspectionItem
            icon={CalendarCheck}
            label="Last inspection"
            value={p.lastInspection}
          />
          <InspectionItem
            icon={HardHat}
            label="Construction status"
            value={p.constructionStatus}
          />
          <InspectionItem
            icon={Sparkles}
            label="Verified promotion"
            value={p.promotion}
          />
          <InspectionItem
            icon={BadgeCheck}
            label="Price verification"
            valueNode={
              <div className="mt-1 flex flex-col gap-1.5">
                {priceVerified ? (
                  <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-accent/25 bg-accent/[0.08] px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-accent">
                    <BadgeCheck className="h-3.5 w-3.5" strokeWidth={2} />
                    Verified price
                  </span>
                ) : (
                  <span className="text-sm text-foreground">{p.verifiedPrice || "—"}</span>
                )}
                {p.lastPriceUpdate && (
                  <span className="text-xs text-muted-foreground">
                    Updated {p.lastPriceUpdate}
                  </span>
                )}
              </div>
            }
          />
          <InspectionItem
            icon={ShieldCheck}
            label="Legal verification"
            value="Title & permits confirmed"
          />
        </div>
      </Section>

      {/* 5. INVESTMENT SNAPSHOT */}
      <Section eyebrow="Investment Snapshot" title="At a glance" className="pt-0">
        <div className="grid grid-cols-2 gap-4 rounded-3xl border border-border/60 bg-card p-6 sm:p-8 md:grid-cols-4">
          <MetricTile icon={TrendingUp} label="Rental Yield" value={p.rentalYield} />
          <MetricTile
            icon={LineChart}
            label="Capital Appreciation"
            value={p.capitalGrowthEstimate}
          />
          <MetricTile icon={Users} label="Demand" value={p.rentalDemand} />
          <MetricTile icon={Droplets} label="Liquidity" value={liquidityFor(p)} />
        </div>
      </Section>

      {/* 6. LOCATION */}
      <Section eyebrow="Location" title={`Around ${p.location}`} className="pt-0">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div
            className="relative aspect-[4/3] overflow-hidden rounded-3xl border border-border/60 bg-secondary"
            aria-label="Interactive map placeholder"
          >
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
              <MapPin className="h-6 w-6 text-accent" />
              <div className="text-xs uppercase tracking-[0.2em]">Interactive map</div>
              <div className="text-sm text-foreground">{p.location}, Phuket</div>
            </div>
          </div>
          <div className="grid gap-4">
            <LocationRow icon={Waves} label="Beach" value={p.distanceToBeach} />
            <LocationRow
              icon={GraduationCap}
              label="Schools"
              value={p.nearbySchools.join(" · ") || "—"}
            />
            <LocationRow icon={Plane} label="Airport" value={p.distanceToAirport} />
            <LocationRow
              icon={Sparkles}
              label="Lifestyle"
              value={p.lifestyle.join(" · ") || "—"}
            />
            {p.nearbyHospitals.length > 0 && (
              <LocationRow
                icon={Building2}
                label="Hospitals"
                value={p.nearbyHospitals.join(" · ")}
              />
            )}
          </div>
        </div>
      </Section>

      {/* 7. GALLERY */}
      <Section eyebrow="Gallery" title="Residence & surroundings" className="pt-0">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          {gallery.slice(0, 9).map((src, i) => (
            <button
              type="button"
              key={`${src}-${i}`}
              onClick={() => setLightbox(i)}
              className="group relative aspect-[4/3] overflow-hidden rounded-2xl border border-border/60 bg-secondary focus:outline-none focus:ring-2 focus:ring-accent/40"
              aria-label={`Open image ${i + 1} of ${gallery.length}`}
            >
              <img
                src={src}
                alt={`${p.name} — view ${i + 1}`}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
            </button>
          ))}
        </div>
        {gallery.length > 9 && (
          <div className="mt-6 flex justify-center">
            <Button variant="outline" size="sm" onClick={() => setLightbox(0)}>
              View all {gallery.length} photos
            </Button>
          </div>
        )}
        <Dialog
          open={lightbox !== null}
          onOpenChange={(open) => !open && setLightbox(null)}
        >
          <DialogContent className="max-w-6xl border-0 bg-black/95 p-0">
            <DialogTitle className="sr-only">
              {p.name} — image {(lightbox ?? 0) + 1} of {gallery.length}
            </DialogTitle>
            {lightbox !== null && (
              <div className="relative">
                <img
                  src={gallery[lightbox]}
                  alt={`${p.name} — view ${lightbox + 1}`}
                  className="max-h-[85vh] w-full object-contain"
                />
                <button
                  type="button"
                  onClick={() => setLightbox(null)}
                  className="absolute right-3 top-3 rounded-full bg-black/50 p-2 text-white transition hover:bg-black/70"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs text-white">
                  {lightbox + 1} / {gallery.length}
                </div>
                {gallery.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setLightbox((i) =>
                          i === null ? 0 : (i - 1 + gallery.length) % gallery.length,
                        )
                      }
                      className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 px-3 py-2 text-white transition hover:bg-black/70"
                      aria-label="Previous image"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setLightbox((i) => (i === null ? 0 : (i + 1) % gallery.length))
                      }
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 px-3 py-2 text-white transition hover:bg-black/70"
                      aria-label="Next image"
                    >
                      ›
                    </button>
                  </>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </Section>

      {/* 8. FLOOR PLANS */}
      <Section
        eyebrow="Floor Plans"
        title="Layouts by building"
        className="pt-0"
      >
        <div id="floor-plans" className="scroll-mt-24">
          {p.floorPlans.length > 0 ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {p.floorPlans.slice(0, 6).map((plan: string, i: number) => (
                  <a
                    key={i}
                    href={plan}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block overflow-hidden rounded-2xl border border-border/60 bg-card"
                  >
                    <div className="aspect-[4/3] w-full overflow-hidden bg-secondary">
                      <img
                        src={plan}
                        alt={`${p.name} floor plan ${i + 1}`}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
                      />
                    </div>
                    <div className="flex items-center justify-between px-4 py-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5 text-accent" />
                        Floor plan {i + 1}
                      </span>
                      <span className="uppercase tracking-[0.2em]">Open</span>
                    </div>
                  </a>
                ))}
              </div>
              {(p.floorPlans.length > 6 || p.unitPlanPdf || masterPlanUrl) && (
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {p.floorPlans.length > 6 && (
                    <span className="inline-flex items-center rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">
                      +{p.floorPlans.length - 6} more floor plans
                    </span>
                  )}
                  {p.unitPlanPdf && (
                    <Button asChild size="sm" variant="outline">
                      <a href={p.unitPlanPdf} target="_blank" rel="noopener noreferrer">
                        <FileText className="mr-1.5 h-4 w-4" /> Unit Plans PDF
                      </a>
                    </Button>
                  )}
                  {masterPlanUrl && (
                    <Button asChild size="sm" variant="outline">
                      <a href={masterPlanUrl} target="_blank" rel="noopener noreferrer">
                        <MapIcon className="mr-1.5 h-4 w-4" /> Master Plan
                      </a>
                    </Button>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
              Floor plans available on request.
            </div>
          )}
        </div>
      </Section>

      {/* 9. DOCUMENTS */}
      <Section eyebrow="Documents" title="Available on request" className="pt-0">
        <div className="overflow-hidden rounded-3xl border border-border/60 bg-card">
          {documents.map((doc) => {
            const Wrapper: React.ElementType = doc.href ? "a" : "div";
            const wrapperProps = doc.href
              ? {
                  href: doc.href,
                  target: "_blank",
                  rel: "noopener noreferrer",
                }
              : {};
            return (
              <Wrapper
                key={doc.label}
                {...wrapperProps}
                className="flex items-center justify-between border-b border-border/60 px-6 py-5 transition-colors last:border-0 hover:bg-accent/[0.03]"
              >
                <div className="flex items-center gap-3">
                  <FileText className="h-4 w-4 text-accent" />
                  <div>
                    <div className="text-sm text-foreground">{doc.label}</div>
                    <div className="text-xs text-muted-foreground">{doc.note}</div>
                  </div>
                </div>
                <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                  {doc.href ? "Open PDF" : "Request access"}
                </div>
              </Wrapper>
            );
          })}
        </div>
      </Section>

      {/* 10. RELATED FOREVER RECOMMENDATIONS */}
      {related.length > 0 && (
        <Section
          eyebrow="Related Forever Recommendations"
          title="Other projects worth reviewing"
          className="pt-0"
        >
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((r) => (
              <ProjectCard key={r.slug} project={r} />
            ))}
          </div>
        </Section>
      )}

      {/* 11. FINAL CTA */}
      <Section
        eyebrow="Next step"
        title="Book a Private Advisory Session"
        description="Share a few details and your Forever advisor will confirm a time to walk you through this project."
        className="pt-0"
      >
        <div className="mx-auto max-w-3xl">
          <ContactForm
            defaultInterest={p.name}
            projectSlug={p.slug}
            source="project_detail"
          />
        </div>
      </Section>
    </SiteShell>
  );
}

function SummaryStat({
  label,
  value,
  suffix,
  accent,
}: {
  label: string;
  value: string;
  suffix?: string;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </span>
      <span
        className={
          accent
            ? "font-serif text-2xl leading-tight tracking-tight text-foreground"
            : "font-serif text-3xl tracking-tight text-foreground"
        }
      >
        {value}
        {suffix && (
          <span className="ml-1 font-sans text-sm font-normal text-muted-foreground">
            {suffix}
          </span>
        )}
      </span>
      <span className="mt-0.5 h-[2px] w-8 rounded-full bg-accent/30" />
    </div>
  );
}

function InspectionItem({
  icon: Icon,
  label,
  value,
  valueNode,
}: {
  icon: typeof CalendarCheck;
  label: string;
  value?: string;
  valueNode?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-card p-5">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
      <div>
        <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </div>
        {valueNode ?? <div className="mt-1 text-sm text-foreground">{value}</div>}
      </div>
    </div>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof TrendingUp;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Icon className="h-5 w-5 text-accent" />
      <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </div>
      <div className="font-serif text-lg leading-snug text-foreground">{value}</div>
    </div>
  );
}

function LocationRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MapPin;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-card p-5">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
      <div>
        <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </div>
        <div className="mt-1 text-sm text-foreground">{value}</div>
      </div>
    </div>
  );
}
