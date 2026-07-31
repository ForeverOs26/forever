import { Section } from "@/components/layout/Section";

import {
  isDirectPlayableProjectFilmUrl,
  type DecisionDeckMediaAsset,
} from "../decision-deck-model";

export interface ProjectFilmProps {
  film: DecisionDeckMediaAsset | null | undefined;
}

/**
 * A supported direct media file, played only through native controls. The
 * fixed frame reserves its space before metadata is requested, and the browser
 * receives no autoplay instruction in any state.
 */
export function ProjectFilm({ film }: ProjectFilmProps) {
  const url = film?.url.trim() ?? "";
  if (!film || !isDirectPlayableProjectFilmUrl(url)) return null;

  return (
    <Section
      id="film"
      eyebrow="Film"
      title="Project film"
      description="Project video from the published record."
      className="py-11 sm:py-16"
      data-decision-deck-section=""
      data-testid="project-film"
    >
      <div className="aspect-video overflow-hidden rounded-2xl border border-border/60 bg-black">
        <video
          src={url}
          controls
          preload="none"
          playsInline
          aria-label="Project film"
          className="h-full w-full object-contain"
        >
          Your browser does not support this project video.
        </video>
      </div>
    </Section>
  );
}
