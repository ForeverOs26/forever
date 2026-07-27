import { FileText, Map as MapIcon } from "lucide-react";
import { Section } from "@/components/layout/Section";
import { Button } from "@/components/ui/button";
import { renderablePlan, renderablePlans } from "../plan-media";
import type { ProjectDetail } from "../project-detail-types";
import { hasFloorPlansSection } from "../project-sections";

type ProjectFloorPlansProps = {
  project: ProjectDetail;
};

export function ProjectFloorPlans({ project }: ProjectFloorPlansProps) {
  // Records without a usable URL are not items: counting them would render the
  // heading over an empty grid of broken tiles (F-008).
  const floorPlans = renderablePlans(project.media.floorPlans);
  const unitPlans = renderablePlans(project.media.unitPlans);
  const masterPlan = renderablePlan(project.media.masterPlan);

  if (!hasFloorPlansSection(project)) return null;

  return (
    <Section eyebrow="Floor Plans" title="Layouts by building" className="pt-0">
      <div id="floor-plans" className="scroll-mt-24">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {floorPlans.slice(0, 6).map((plan, index) => (
            <a
              key={plan.id}
              href={plan.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group block overflow-hidden rounded-2xl border border-border/60 bg-card"
            >
              <div className="aspect-[4/3] w-full overflow-hidden bg-secondary">
                <img
                  src={plan.url}
                  alt={plan.title || `${project.core.name} floor plan ${index + 1}`}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
                />
              </div>
              <div className="flex items-center justify-between px-4 py-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-accent" />
                  {plan.title || `Floor plan ${index + 1}`}
                </span>
                <span className="uppercase tracking-[0.2em]">Open</span>
              </div>
            </a>
          ))}
        </div>
        {(floorPlans.length > 6 || unitPlans.length > 0 || masterPlan) && (
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {floorPlans.length > 6 && (
              <span className="inline-flex items-center rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">
                +{floorPlans.length - 6} more floor plans
              </span>
            )}
            {unitPlans[0] && (
              <Button asChild size="sm" variant="outline">
                <a href={unitPlans[0].url} target="_blank" rel="noopener noreferrer">
                  <FileText className="mr-1.5 h-4 w-4" /> Unit Plans PDF
                </a>
              </Button>
            )}
            {masterPlan && (
              <Button asChild size="sm" variant="outline">
                <a href={masterPlan.url} target="_blank" rel="noopener noreferrer">
                  <MapIcon className="mr-1.5 h-4 w-4" /> Master Plan
                </a>
              </Button>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}
