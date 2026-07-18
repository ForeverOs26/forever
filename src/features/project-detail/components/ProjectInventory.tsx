import { Building2 } from "lucide-react";
import { Section } from "@/components/layout/Section";
import type { ProjectDetail } from "../project-detail-types";

type ProjectInventoryProps = {
  project: ProjectDetail;
};

function buildingCodeFor(unit: ProjectDetail["units"][number]): string | null {
  const match = /^CK([A-Z])\d+/i.exec(unit.code);
  return match?.[1]?.toUpperCase() ?? null;
}

export function ProjectInventory({ project }: ProjectInventoryProps) {
  const buildings = new Map<string, number>();
  for (const unit of project.units) {
    const code = buildingCodeFor(unit);
    if (code) buildings.set(code, (buildings.get(code) ?? 0) + 1);
  }

  if (buildings.size === 0) return null;

  return (
    <Section eyebrow="Inventory" title={`${buildings.size} buildings · ${project.units.length} residences`} className="pt-0">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[...buildings.entries()].map(([building, units]) => (
          <div key={building} className="rounded-2xl border border-border/60 bg-card p-5">
            <Building2 className="h-5 w-5 text-primary" />
            <div className="mt-3 font-serif text-2xl text-foreground">Building {building}</div>
            <div className="mt-1 text-sm text-muted-foreground">{units} listed residences</div>
          </div>
        ))}
      </div>
    </Section>
  );
}
