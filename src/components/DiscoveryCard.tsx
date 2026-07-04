import type { Property } from "@/lib/data";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ForeverVerified } from "@/components/ForeverVerified";
import { MapPin, Plus, Check, GitCompare } from "lucide-react";
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
  const { verdict, trustNote, marketPosition } = project;
  const investmentValue = project.investmentValue.toFixed(1);

  return (
    <article className="group flex flex-col overflow-hidden rounded-3xl border border-border/60 bg-card transition-all hover:-translate-y-0.5 hover:shadow-[0_20px_40px_-24px_rgba(30,30,30,0.15)]">
      <Link
        to="/projects/$slug"
        params={{ slug: project.slug }}
        className="relative block aspect-[4/3] overflow-hidden bg-secondary"
      >
        <img
          src={project.image}
          alt={`${project.name} in ${project.location}`}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
        />
        <div className="absolute left-4 top-4">
          <ForeverVerified align="start" side="bottom" />
        </div>
      </Link>

      <div className="flex flex-1 flex-col gap-5 p-6">
        {recommended && (
          <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-accent">
            Forever Recommended
          </div>
        )}
        <div>
          <h3 className="font-serif text-xl leading-tight tracking-tight text-foreground">
            {project.name}
          </h3>
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" />
            {project.location}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-border/60 py-4 text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Starting
            </div>
            <div className="mt-1 font-serif text-base text-foreground">{project.price}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Forever Trust
            </div>
            <div className="mt-1 font-serif text-base text-foreground">
              {project.trustScore.toFixed(1)}
              <span className="text-xs text-muted-foreground"> / 10</span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{trustNote}</p>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Investment Value
            </div>
            <div className="mt-1 font-serif text-base text-foreground">
              {investmentValue}
              <span className="text-xs text-muted-foreground"> / 10</span>
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Market Position
            </div>
            <div className="mt-1 text-sm text-foreground">{marketPosition}</div>
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-accent">Forever Verdict</div>
          <p className="mt-1.5 font-serif text-[15px] leading-snug text-foreground">{verdict}</p>
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
          <Button asChild size="sm" className="flex-1 min-w-[110px]">
            <Link to="/projects/$slug" params={{ slug: project.slug }}>
              View Advisory Report
            </Link>
          </Button>
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
    </article>
  );
}