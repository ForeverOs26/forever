import { Link } from "@tanstack/react-router";
import { ArrowLeft, Building2, FlaskConical, MapPin, ShieldCheck } from "lucide-react";

import { Container } from "@/components/layout/Container";

import type { DecisionDeckModel, DecisionDeckValue } from "../decision-deck-model";
import type { PublicProjectDetailDTO } from "../public-project-detail";
import { ProjectDecisionRail } from "./ProjectDecisionRail";
import { ProjectLightbox, useLightbox } from "./ProjectLightbox";
import { ProjectMediaMosaic } from "./ProjectMediaMosaic";
import { ProjectPassportStrip } from "./ProjectPassportStrip";

export interface ProjectTopSectionProps {
  project: PublicProjectDetailDTO;
  model: DecisionDeckModel;
}

function supported<T>(
  value: DecisionDeckValue<T>,
): value is Extract<DecisionDeckValue<T>, { state: "supported" }> {
  return value.state === "supported";
}

/**
 * Opening Decision Deck: verified identity, semantic media, Decision Rail and
 * the compact Passport. The rail is not a contact surface.
 */
export function ProjectTopSection({ project, model }: ProjectTopSectionProps) {
  // The model intentionally discarded free-text media titles. Reconstitute
  // only the structural shape the shared viewer needs, using generic labels.
  const photographs = supported(model.media.photos)
    ? model.media.photos.value.map((asset) => ({
        id: asset.id,
        type: asset.type,
        title: asset.label,
        url: asset.url,
        sortOrder: asset.sortOrder,
        semanticRole: null,
      }))
    : [];
  const lightbox = useLightbox();
  const location =
    supported(model.location) && model.location.value.area ? model.location.value.area : "";
  const overview = supported(model.overview) ? model.overview.value : null;
  const projectType = overview && supported(overview.projectType) ? overview.projectType.value : "";
  const constructionContext =
    overview && supported(overview.constructionContext) ? overview.constructionContext.value : "";

  return (
    <section
      className="border-b border-border/60 bg-background pb-8 pt-5 sm:pb-10 sm:pt-7"
      data-testid="decision-deck-opening"
    >
      <Container>
        <Link
          to="/projects"
          className="inline-flex min-h-11 w-fit items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden="true" /> All projects
        </Link>

        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          {project.isDemoPreview ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/60 bg-amber-50 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.16em] text-amber-900">
              <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
              Unpublished project preview
            </span>
          ) : null}
          {projectType ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1.5 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
              {projectType}
            </span>
          ) : null}
          {constructionContext ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1.5 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {constructionContext}
            </span>
          ) : null}
        </div>

        <div className="mt-3 min-w-0">
          <h1 className="font-serif text-[clamp(2rem,1.4rem+2.1vw,3rem)] leading-[1.05] tracking-tight text-foreground">
            {project.name}
          </h1>
          {location ? (
            <p className="mt-3 inline-flex items-center gap-2 text-base text-muted-foreground">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              {location}
            </p>
          ) : null}
        </div>

        {/*
          DOM order is the narrow-screen reading order: media, rail, Passport.
          From 960px the rail occupies column two and spans the Passport row,
          which gives the sticky card usable travel without an inner scrollbar.
        */}
        <div
          className={`mt-7 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 ${
            model.displayable.decisionRail
              ? "min-[960px]:grid-cols-[minmax(0,1fr)_minmax(21.25rem,23.25rem)] min-[960px]:gap-8"
              : ""
          }`}
        >
          <div data-composition-id="media" className="min-w-0">
            <ProjectMediaMosaic
              items={photographs}
              projectName={project.name}
              onOpen={lightbox.open}
              film={supported(model.media.film) ? model.media.film.value : null}
            />
          </div>
          {model.displayable.decisionRail ? (
            <ProjectDecisionRail rail={model.decisionRail} />
          ) : null}
          {model.displayable.compactPassport ? (
            <ProjectPassportStrip passport={model.passport.compact} />
          ) : null}
        </div>
      </Container>

      <ProjectLightbox
        items={photographs}
        index={lightbox.index}
        onIndexChange={lightbox.onIndexChange}
        onClose={lightbox.close}
        label={`${project.name} photographs`}
      />
    </section>
  );
}
