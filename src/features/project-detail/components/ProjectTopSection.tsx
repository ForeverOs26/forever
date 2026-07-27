import { Link } from "@tanstack/react-router";
import { ArrowLeft, Building2, FlaskConical, MapPin, ShieldCheck } from "lucide-react";

import { ForeverVerified } from "@/components/ForeverVerified";
import { Container } from "@/components/layout/Container";

import type { ProjectDetail } from "../project-detail-types";
import { projectPhotographs } from "../project-sections";
import { ProjectLightbox, useLightbox } from "./ProjectLightbox";
import { ProjectMediaMosaic } from "./ProjectMediaMosaic";
import { ProjectQuickFacts } from "./ProjectQuickFacts";
import { ProjectSummaryPanel } from "./ProjectSummaryPanel";

/**
 * The first screen (FOREVER-PROJECT-DETAIL-FAZWAZ-INSPIRED-UX-001).
 *
 * Identity, then photographs beside a summary and the two real contact
 * actions, then the facts the record supports. A visitor learns what the
 * project looks like, where it is, what it costs and what they can do next
 * without scrolling.
 *
 * The photograph sequence is the corrected media order: the semantic cover
 * first, then the gallery. Plans, maps and brochures are never mixed in — they
 * have their own sections, because a floor plan among the photographs is what
 * made the old gallery unreadable.
 */

export interface ProjectTopSectionProps {
  project: ProjectDetail;
}

export function ProjectTopSection({ project }: ProjectTopSectionProps) {
  const photographs = projectPhotographs(project);
  const lightbox = useLightbox();
  const location = project.location.area || project.core.location;

  return (
    <section className="border-b border-border/60 bg-background pb-10 pt-6 sm:pt-8">
      <Container>
        <Link
          to="/projects"
          className="inline-flex w-fit items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> All projects
        </Link>

        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          {project.core.isDemoPreview ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/60 bg-amber-50 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.16em] text-amber-900">
              <FlaskConical className="h-3.5 w-3.5" />
              Unpublished project preview
            </span>
          ) : null}
          {project.trust.foreverVerified ? <ForeverVerified /> : null}
          {project.core.type ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1.5 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" />
              {project.core.type}
            </span>
          ) : null}
          {project.core.constructionStatus ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1.5 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              {project.core.constructionStatus}
            </span>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div className="min-w-0">
            <h1 className="font-serif text-4xl leading-[1.05] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              {project.core.name}
            </h1>
            {location ? (
              <p className="mt-3 inline-flex items-center gap-2 text-base text-muted-foreground">
                <MapPin className="h-4 w-4" />
                {location}
              </p>
            ) : null}
          </div>
          {project.pricing.displayPrice ? (
            <p className="font-serif text-2xl text-foreground lg:hidden">
              {project.pricing.displayPrice}
            </p>
          ) : null}
        </div>

        <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-8">
          <ProjectMediaMosaic
            items={photographs}
            projectName={project.core.name}
            onOpen={lightbox.open}
          />
          {/*
            Sticky only where there is room for it to travel: below `lg` the
            panel is simply the next block, which keeps it from covering the
            photographs on a narrow screen.
          */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <ProjectSummaryPanel project={project} />
          </div>
        </div>

        <ProjectQuickFacts project={project} />
      </Container>

      <ProjectLightbox
        items={photographs}
        index={lightbox.index}
        onIndexChange={lightbox.onIndexChange}
        onClose={lightbox.close}
        label={`${project.core.name} photographs`}
      />
    </section>
  );
}
