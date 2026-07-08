import { FileText } from "lucide-react";
import { Section } from "@/components/layout/Section";
import { Button } from "@/components/ui/button";
import type { ProjectDetail } from "../project-detail-types";

type ProjectUnitPlansProps = {
  project: ProjectDetail;
};

export function ProjectUnitPlans({ project }: ProjectUnitPlansProps) {
  const unitPlans = project.media.unitPlans;

  if (unitPlans.length === 0 && project.units.length === 0) return null;

  return (
    <Section eyebrow="Unit Plans" title="Available layouts" className="pt-0">
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
        {project.units.length > 0 && (
          <div className="grid gap-px bg-border/60 sm:grid-cols-2 lg:grid-cols-3">
            {project.units.map((unit) => (
              <div key={unit.id} className="bg-card p-5">
                <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  {unit.availabilityStatus}
                </div>
                <div className="mt-2 font-serif text-xl text-foreground">
                  {unit.code || unit.type || "Unit"}
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  {[unit.bedrooms ? `${unit.bedrooms} beds` : "", unit.sizeSqm ? `${unit.sizeSqm} sqm` : ""]
                    .filter(Boolean)
                    .join(" - ")}
                </div>
                {unit.basePriceTHB && (
                  <div className="mt-3 text-sm text-foreground">
                    THB {unit.basePriceTHB.toLocaleString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {unitPlans[0] && (
        <div className="mt-6 flex justify-center">
          <Button asChild size="sm" variant="outline">
            <a href={unitPlans[0].url} target="_blank" rel="noopener noreferrer">
              <FileText className="mr-1.5 h-4 w-4" /> Unit Plans PDF
            </a>
          </Button>
        </div>
      )}
    </Section>
  );
}
