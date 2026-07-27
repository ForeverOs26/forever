import { Section } from "@/components/layout/Section";

import type { ProjectDetail } from "../project-detail-types";
import { projectPhotographs } from "../project-sections";
import { ProjectLightbox, useLightbox } from "./ProjectLightbox";

/**
 * The full photograph set (FOREVER-PROJECT-DETAIL-FAZWAZ-INSPIRED-UX-001).
 *
 * The same ordered sequence the mosaic shows at the top, so "photo 7" means the
 * same image in both, opened through the same viewer. Plans, maps and
 * brochures are not here: mixing a floor plan into a photo grid is what made
 * the old gallery hard to read.
 *
 * Every tile is lazily loaded; the viewer prepares only the neighbours of
 * whatever is on screen.
 */

export interface ProjectPhotosProps {
  project: ProjectDetail;
}

export function ProjectPhotos({ project }: ProjectPhotosProps) {
  const photographs = projectPhotographs(project);
  const lightbox = useLightbox();

  if (photographs.length <= 5) return null;

  return (
    <Section
      id="photos"
      eyebrow="Photos"
      title={`${photographs.length} project photographs`}
      className="pt-0"
      data-testid="project-photos"
    >
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {photographs.map((item, index) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => lightbox.open(index)}
              className="group relative block aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border/60 bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={`Open photograph ${index + 1} of ${photographs.length}`}
            >
              <img
                src={item.url}
                alt={item.title || `${project.core.name} photograph ${index + 1}`}
                width={800}
                height={600}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
              />
            </button>
          </li>
        ))}
      </ul>

      <ProjectLightbox
        items={photographs}
        index={lightbox.index}
        onIndexChange={lightbox.onIndexChange}
        onClose={lightbox.close}
        label={`${project.core.name} photographs`}
      />
    </Section>
  );
}
