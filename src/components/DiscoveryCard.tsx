import type { Property } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { PremiumProjectCard } from "@/components/PremiumProjectCard";
import { Plus, Check, GitCompare } from "lucide-react";
import { cn } from "@/lib/utils";

interface DiscoveryCardProps {
  project: Property;
  inCompare: boolean;
  inShortlist: boolean;
  recommended?: boolean;
  onToggleCompare: (slug: string) => void;
  onToggleShortlist: (slug: string) => void;
}

export function DiscoveryCard({
  project,
  inCompare,
  inShortlist,
  recommended,
  onToggleCompare,
  onToggleShortlist,
}: DiscoveryCardProps) {
  return (
    <div className="flex h-full flex-col gap-3">
      {recommended ? (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
          Forever Recommended
        </div>
      ) : null}

      <PremiumProjectCard project={project} />

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background p-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onToggleCompare(project.slug)}
            className={cn(inCompare && "border-accent/60 text-accent")}
            aria-pressed={inCompare}
          >
            <GitCompare className="h-3.5 w-3.5" />
            {inCompare ? "Added" : "Compare"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onToggleShortlist(project.slug)}
            className={cn(inShortlist && "text-accent")}
            aria-pressed={inShortlist}
          >
            {inShortlist ? (
              <>
                <Check className="h-3.5 w-3.5" /> Shortlisted
              </>
            ) : (
              <>
                <Plus className="h-3.5 w-3.5" /> Shortlist
              </>
            )}
          </Button>
      </div>
    </div>
  );
}
