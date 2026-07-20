import type { Property } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { PremiumProjectCard } from "@/components/PremiumProjectCard";
import { Plus, Check, GitCompare } from "lucide-react";
import { cn } from "@/lib/utils";

interface DiscoveryCardProps {
  project: Property;
  inCompare: boolean;
  inShortlist: boolean;
  onToggleCompare: (slug: string) => void;
  onToggleShortlist: (slug: string) => void;
}

/**
 * FOREVER-TRUTH-001A: the earlier "Forever Recommended" banner was applied
 * to the first three results by list position, not by any recorded evidence.
 * A recommendation is an evidence-dependent claim and may not be fabricated
 * from ordering.
 */
export function DiscoveryCard({
  project,
  inCompare,
  inShortlist,
  onToggleCompare,
  onToggleShortlist,
}: DiscoveryCardProps) {
  return (
    <div className="flex h-full flex-col gap-3">
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
