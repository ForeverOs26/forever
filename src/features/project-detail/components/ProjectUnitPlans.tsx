import { FileText } from "lucide-react";
import { Section } from "@/components/layout/Section";
import { Button } from "@/components/ui/button";
import { renderablePlans } from "../plan-media";
import type { ProjectDetail } from "../project-detail-types";

type ProjectUnitPlansProps = {
  project: ProjectDetail;
};

/**
 * Unit layout plans, and nothing else (F-008).
 *
 * This section used to fall back to a grid of inventory unit cards whenever a
 * project had units but no unit plans, which put an "Available layouts"
 * heading on projects holding no plan at all — Serenity and Modeva both showed
 * it. Those cards were also a strictly poorer copy of `ProjectInventory`,
 * which already renders every unit with its building, floor, area, price and
 * availability. The heading now follows the plans it names.
 */
export function ProjectUnitPlans({ project }: ProjectUnitPlansProps) {
  const unitPlans = renderablePlans(project.media.unitPlans);

  if (unitPlans.length === 0) return null;

  return (
    <Section id="unit-plans" eyebrow="Unit Plans" title="Available layouts" className="pt-0">
      <div className="overflow-hidden rounded-3xl border border-border/60 bg-card">
        {unitPlans.map((plan) => (
          <a
            key={plan.id}
            href={plan.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between border-b border-border/60 px-6 py-5 transition-colors last:border-0 hover:bg-accent/[0.03]"
          >
            <div className="flex items-center gap-3">
              <FileText className="h-4 w-4 text-accent" />
              <div>
                <div className="text-sm text-foreground">{plan.title || "Unit Plans"}</div>
                <div className="text-xs text-muted-foreground">PDF available</div>
              </div>
            </div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Open PDF
            </div>
          </a>
        ))}
      </div>
      <div className="mt-6 flex justify-center">
        <Button asChild size="sm" variant="outline">
          <a href={unitPlans[0].url} target="_blank" rel="noopener noreferrer">
            <FileText className="mr-1.5 h-4 w-4" /> Unit Plans PDF
          </a>
        </Button>
      </div>
    </Section>
  );
}
