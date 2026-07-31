import { useMemo } from "react";
import { ExternalLink, FileText, Image as ImageIcon } from "lucide-react";

import { Section } from "@/components/layout/Section";
import type {
  DecisionDeckMediaAsset,
  DecisionDeckPlanCategoryId,
  DecisionDeckPlans,
} from "../decision-deck-model";
import type { ProjectDetailMediaItem } from "../project-detail-types";
import { publicBrowserUrl } from "../public-url";
import { ProjectLightbox, useLightbox } from "./ProjectLightbox";

const CATEGORY_LABELS: Readonly<Record<DecisionDeckPlanCategoryId, string>> = {
  "master-plan": "Master plan",
  "floor-plans": "Floor plan",
  "unit-plans": "Unit plan",
};

type PlanFileKind = "image" | "pdf" | "file";

interface RenderablePlan {
  asset: DecisionDeckMediaAsset;
  label: string;
  kind: PlanFileKind;
}

interface RenderableCategory {
  id: DecisionDeckPlanCategoryId;
  label: string;
  items: RenderablePlan[];
}

export interface ProjectPlansProps {
  plans: DecisionDeckPlans;
}

function browserSafeUrl(value: string): string {
  return publicBrowserUrl(value);
}

function filePath(url: string): string {
  try {
    return /^https?:\/\//i.test(url) ? new URL(url).pathname : url.split(/[?#]/, 1)[0];
  } catch {
    return "";
  }
}

function planFileKind(url: string): PlanFileKind {
  const path = filePath(url);
  if (/\.pdf$/i.test(path)) return "pdf";
  if (/\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(path)) return "image";
  return "file";
}

function genericItemLabel(category: DecisionDeckPlanCategoryId, index: number, total: number) {
  const label = CATEGORY_LABELS[category];
  return total === 1 ? label : `${label} ${index + 1}`;
}

function planCardClasses() {
  return "group block w-full overflow-hidden rounded-xl border border-border/60 bg-card text-left transition hover:border-border hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
}

/**
 * Plan categories remain distinct from lifestyle media. Image files open in a
 * focused viewer; PDF files stay ordinary external documents. Labels are
 * generated only from the model's closed category ids, never from source media
 * titles or document notes.
 */
export function ProjectPlans({ plans }: ProjectPlansProps) {
  const lightbox = useLightbox();

  const categories = useMemo<readonly RenderableCategory[]>(() => {
    if (plans.all.state !== "supported") return [];

    const result: RenderableCategory[] = [];
    for (const category of plans.categories) {
      const items = category.items
        .map((asset, index) => {
          const url = browserSafeUrl(asset.url);
          if (!url) return null;
          const label = genericItemLabel(category.id, index, category.items.length);
          return {
            asset: { ...asset, url },
            label,
            kind: planFileKind(url),
          } satisfies RenderablePlan;
        })
        .filter((item): item is RenderablePlan => item !== null);

      if (items.length > 0) {
        result.push({
          id: category.id,
          label: CATEGORY_LABELS[category.id],
          items,
        });
      }
    }
    return result;
  }, [plans]);

  if (categories.length === 0) return null;

  const planImages: ProjectDetailMediaItem[] = categories.flatMap((category) =>
    category.items
      .filter((item) => item.kind === "image")
      .map(({ asset, label }) => ({
        id: `${category.id}-${asset.id}`,
        type: asset.type,
        title: label,
        url: asset.url,
        sortOrder: asset.sortOrder,
        semanticRole: null,
      })),
  );

  return (
    <>
      <Section
        id="plans"
        eyebrow="Plans"
        title="Project plans"
        description="Recorded site, floor and residence plan files."
        className="py-11 sm:py-16"
        data-decision-deck-section=""
        data-testid="project-plans"
      >
        <div className="space-y-8">
          {categories.map((category) => (
            <div key={category.id}>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {category.label}
              </h3>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {category.items.map(({ asset, label, kind }) => (
                  <li key={`${category.id}-${asset.id}-${asset.url}`}>
                    {kind === "image" ? (
                      <button
                        type="button"
                        className={planCardClasses()}
                        onClick={() => {
                          const imageIndex = planImages.findIndex(
                            (item) =>
                              item.id === `${category.id}-${asset.id}` && item.url === asset.url,
                          );
                          if (imageIndex >= 0) lightbox.open(imageIndex);
                        }}
                        aria-label={`View ${label}`}
                      >
                        <span className="flex aspect-[10/7] items-center justify-center overflow-hidden bg-secondary/60">
                          <img
                            src={asset.url}
                            alt={label}
                            loading="lazy"
                            className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.02]"
                          />
                        </span>
                        <span className="flex items-center justify-between gap-3 px-4 py-3">
                          <span className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
                            <ImageIcon
                              className="h-4 w-4 shrink-0 text-accent"
                              aria-hidden="true"
                            />
                            <span className="truncate">{label}</span>
                          </span>
                          <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                            View
                          </span>
                        </span>
                      </button>
                    ) : (
                      <a
                        href={asset.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={planCardClasses()}
                        aria-label={`Open ${label}${kind === "pdf" ? " PDF" : " file"}`}
                      >
                        <span className="flex aspect-[10/7] items-center justify-center bg-secondary/60">
                          <FileText className="h-10 w-10 text-accent" aria-hidden="true" />
                        </span>
                        <span className="flex items-center justify-between gap-3 px-4 py-3">
                          <span className="truncate text-sm font-medium text-foreground">
                            {label}
                          </span>
                          <span className="inline-flex shrink-0 items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                            {kind === "pdf" ? "Open PDF" : "Open file"}
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </span>
                        </span>
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <ProjectLightbox
        items={planImages}
        index={lightbox.index}
        onIndexChange={lightbox.onIndexChange}
        onClose={lightbox.close}
        label="Project plans"
      />
    </>
  );
}
