import { Map as MapIcon } from "lucide-react";
import { Section } from "@/components/layout/Section";
import { Button } from "@/components/ui/button";
import type { ProjectDetail } from "../project-detail-types";

type ProjectMasterPlanProps = {
  project: ProjectDetail;
};

export function ProjectMasterPlan({ project }: ProjectMasterPlanProps) {
  const masterPlan = project.media.masterPlan;

  if (!masterPlan) return null;

  return (
    <Section eyebrow="Master Plan" title="Site plan" className="pt-0">
      <div className="rounded-3xl border border-border/60 bg-card p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <MapIcon className="h-5 w-5 text-accent" />
            <div>
              <div className="text-sm text-foreground">{masterPlan.title || "Master Plan"}</div>
              <div className="text-xs text-muted-foreground">PDF available</div>
            </div>
          </div>
          <Button asChild size="sm" variant="outline">
            <a href={masterPlan.url} target="_blank" rel="noopener noreferrer">
              Open PDF
            </a>
          </Button>
        </div>
      </div>
    </Section>
  );
}
