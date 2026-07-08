import { Link } from "@tanstack/react-router";
import { MapPin, ShieldCheck, CalendarCheck, Waves, Tag, BadgeCheck } from "lucide-react";
import type { Project } from "@/lib/data";
import { Badge } from "@/components/ui/badge";

export function ProjectCard({ project }: { project: Project }) {
  return (
    <Link
      to="/projects/$slug"
      params={{ slug: project.slug }}
      className="group flex flex-col overflow-hidden rounded-3xl border border-border/60 bg-card shadow-[0_1px_2px_rgba(30,30,30,0.04)] transition-all hover:-translate-y-1 hover:shadow-[0_20px_40px_-20px_rgba(30,30,30,0.18)]"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-secondary">
        <img
          src={project.image}
          alt={`${project.name} in ${project.location}, Phuket`}
          width={1024}
          height={768}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
        />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/50 to-transparent" />
        <div className="absolute left-4 right-4 top-4 flex items-start justify-between">
          <Badge className="bg-background/95 text-foreground hover:bg-background">
            {project.status}
          </Badge>
          <div className="inline-flex items-center gap-1 rounded-full bg-background/95 px-2.5 py-1 text-[11px] font-medium text-foreground">
            <ShieldCheck className="h-3 w-3 text-accent" />
            Forever Score {project.trustScore.toFixed(1)}
          </div>
        </div>
        <div className="absolute bottom-4 left-4 right-4 text-primary-foreground">
          <div className="font-serif text-2xl leading-tight">{project.name}</div>
          <div className="mt-1 flex items-center gap-1 text-xs opacity-90">
            <MapPin className="h-3 w-3" /> {project.location}
          </div>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-4 p-6">
        <p className="text-sm text-muted-foreground">{project.tagline}</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
          <div className="flex items-start gap-2">
            <CalendarCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
            <div>
              <dt className="text-muted-foreground">Forever Inspection</dt>
              <dd className="text-foreground">{project.lastInspection}</dd>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
            <div>
              <dt className="text-muted-foreground">Forever Verified Price</dt>
              <dd className="text-foreground">{project.verifiedPrice}</dd>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Tag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
            <div>
              <dt className="text-muted-foreground">Verified Offer</dt>
              <dd className="text-foreground">{project.promotion}</dd>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Waves className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
            <div>
              <dt className="text-muted-foreground">Distance to beach</dt>
              <dd className="text-foreground">{project.distanceToBeach}</dd>
            </div>
          </div>
        </dl>
        <div className="mt-auto flex items-end justify-between border-t border-border/60 pt-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Starting</div>
            <div className="font-serif text-lg text-foreground">{project.price}</div>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <div>{project.beds}</div>
            <div>{project.area}</div>
          </div>
        </div>
      </div>
    </Link>
  );
}
