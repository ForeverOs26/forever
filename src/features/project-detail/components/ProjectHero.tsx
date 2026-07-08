import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  BookOpen,
  Building2,
  CalendarCheck,
  LayoutGrid,
  Map as MapIcon,
  MapPin,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { ForeverVerified } from "@/components/ForeverVerified";
import { Container } from "@/components/layout/Container";
import { Button } from "@/components/ui/button";
import type { ProjectDetail } from "../project-detail-types";

type ProjectHeroProps = {
  project: ProjectDetail;
};

export function ProjectHero({ project }: ProjectHeroProps) {
  const hero = project.media.hero ?? project.media.gallery[0] ?? null;
  const brochure = project.media.brochures[0] ?? null;
  const masterPlan = project.media.masterPlan;
  const hasFloorPlans = project.media.floorPlans.length > 0;
  const location = project.location.area || project.core.location;

  function scrollToFloorPlans() {
    if (typeof document === "undefined") return;
    document
      .getElementById("floor-plans")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section className="relative">
      <div className="relative min-h-[720px] w-full overflow-hidden bg-secondary sm:min-h-[760px] lg:min-h-[820px]">
        {hero && (
          <img
            src={hero.url}
            alt={`${project.core.name} in ${location}`}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/45 to-black/10" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/20" />

        <Container className="relative flex min-h-[720px] flex-col justify-between py-6 sm:min-h-[760px] lg:min-h-[820px] lg:py-8">
          <Link
            to="/projects"
            className="inline-flex w-fit items-center gap-2 rounded-full border border-white/20 bg-black/20 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-primary-foreground/85 backdrop-blur-sm transition-colors hover:text-primary-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> All projects
          </Link>

          <div className="grid gap-8 pb-8 text-primary-foreground lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end lg:pb-12">
            <div className="max-w-4xl">
              <div className="mb-5 flex flex-wrap items-center gap-3">
                {project.trust.foreverVerified ? <ForeverVerified /> : null}
                {project.core.status ? (
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.16em] backdrop-blur-sm">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {project.core.status}
                  </span>
                ) : null}
                {project.core.type ? (
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.16em] backdrop-blur-sm">
                    <Building2 className="h-3.5 w-3.5" />
                    {project.core.type}
                  </span>
                ) : null}
              </div>

              <h1 className="font-serif text-5xl leading-[0.98] tracking-tight sm:text-6xl lg:text-7xl">
                {project.core.name}
              </h1>

              {location ? (
                <div className="mt-5 inline-flex items-center gap-2 text-base font-medium text-primary-foreground/90">
                  <MapPin className="h-4 w-4" />
                  {location}
                </div>
              ) : null}

              {project.core.tagline || project.core.description ? (
                <p className="mt-6 max-w-2xl text-lg leading-8 text-primary-foreground/82 sm:text-xl">
                  {project.core.tagline || project.core.description}
                </p>
              ) : null}

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Button asChild size="lg" className="w-full sm:w-auto">
                  <Link to="/contact">Request Private Advisory</Link>
                </Button>
                {brochure && (
                  <Button asChild size="lg" variant="secondary" className="w-full sm:w-auto">
                    <a href={brochure.url} target="_blank" rel="noopener noreferrer">
                      <BookOpen className="mr-2 h-4 w-4" /> View Brochure
                    </a>
                  </Button>
                )}
                {masterPlan && (
                  <Button asChild size="lg" variant="secondary" className="w-full sm:w-auto">
                    <a href={masterPlan.url} target="_blank" rel="noopener noreferrer">
                      <MapIcon className="mr-2 h-4 w-4" /> Master Plan
                    </a>
                  </Button>
                )}
                {hasFloorPlans && (
                  <Button
                    type="button"
                    size="lg"
                    variant="secondary"
                    onClick={scrollToFloorPlans}
                    className="w-full sm:w-auto"
                  >
                    <LayoutGrid className="mr-2 h-4 w-4" /> Floor Plans
                  </Button>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-white/20 bg-black/30 p-5 shadow-2xl backdrop-blur-md sm:p-6">
              <div className="grid gap-5">
                {project.pricing.displayPrice ? (
                  <div>
                    <div className="text-xs font-medium uppercase tracking-[0.22em] text-primary-foreground/60">
                      Starting price
                    </div>
                    <div className="mt-2 font-serif text-4xl leading-none sm:text-5xl">
                      {project.pricing.displayPrice}
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-3 border-t border-white/15 pt-5">
                  {project.trust.trustScore > 0 ? (
                    <div className="flex items-center justify-between gap-4">
                      <span className="inline-flex items-center gap-2 text-sm text-primary-foreground/70">
                        <ShieldCheck className="h-4 w-4" />
                        Forever Score
                      </span>
                      <span className="text-sm font-semibold">{project.trust.trustScore}/100</span>
                    </div>
                  ) : null}

                  {project.investment.rentalYield ? (
                    <div className="flex items-center justify-between gap-4">
                      <span className="inline-flex items-center gap-2 text-sm text-primary-foreground/70">
                        <TrendingUp className="h-4 w-4" />
                        Rental yield
                      </span>
                      <span className="text-sm font-semibold">{project.investment.rentalYield}</span>
                    </div>
                  ) : null}

                  {project.trust.lastInspection ? (
                    <div className="flex items-center justify-between gap-4">
                      <span className="inline-flex items-center gap-2 text-sm text-primary-foreground/70">
                        <CalendarCheck className="h-4 w-4" />
                        Forever Inspection
                      </span>
                      <span className="text-right text-sm font-semibold">
                        {project.trust.lastInspection}
                      </span>
                    </div>
                  ) : null}

                  {project.core.constructionStatus ? (
                    <div className="flex items-center justify-between gap-4">
                      <span className="inline-flex items-center gap-2 text-sm text-primary-foreground/70">
                        <Building2 className="h-4 w-4" />
                        Construction
                      </span>
                      <span className="text-right text-sm font-semibold">
                        {project.core.constructionStatus}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </Container>
      </div>
    </section>
  );
}
