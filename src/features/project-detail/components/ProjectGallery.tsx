import { useState } from "react";
import { X } from "lucide-react";
import { Section } from "@/components/layout/Section";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { ProjectDetail } from "../project-detail-types";

type ProjectGalleryProps = {
  project: ProjectDetail;
};

export function ProjectGallery({ project }: ProjectGalleryProps) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const gallery = project.media.gallery;

  if (gallery.length === 0) return null;

  return (
    <Section eyebrow="Gallery" title="Residence & surroundings" className="pt-0">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        {gallery.slice(0, 9).map((item, index) => (
          <button
            type="button"
            key={item.id}
            onClick={() => setLightbox(index)}
            className="group relative aspect-[4/3] overflow-hidden rounded-2xl border border-border/60 bg-secondary focus:outline-none focus:ring-2 focus:ring-accent/40"
            aria-label={`Open image ${index + 1} of ${gallery.length}`}
          >
            <img
              src={item.url}
              alt={item.title || `${project.core.name} view ${index + 1}`}
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
      <Dialog open={lightbox !== null} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent className="max-w-6xl border-0 bg-black/95 p-0">
          <DialogTitle className="sr-only">
            {project.core.name} image {(lightbox ?? 0) + 1} of {gallery.length}
          </DialogTitle>
          {lightbox !== null && (
            <div className="relative">
              <img
                src={gallery[lightbox].url}
                alt={gallery[lightbox].title || `${project.core.name} view ${lightbox + 1}`}
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
                      setLightbox((index) =>
                        index === null ? 0 : (index - 1 + gallery.length) % gallery.length,
                      )
                    }
                    className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 px-3 py-2 text-white transition hover:bg-black/70"
                    aria-label="Previous image"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setLightbox((index) => (index === null ? 0 : (index + 1) % gallery.length))
                    }
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 px-3 py-2 text-white transition hover:bg-black/70"
                    aria-label="Next image"
                  >
                    Next
                  </button>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Section>
  );
}
