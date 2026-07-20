import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BadgeCheck,
  CalendarCheck,
  MapPin,
  ShieldCheck,
  TrendingUp,
  Waves,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Property } from "@/lib/data";

type PremiumProjectCardProps = {
  project: Property;
};

/**
 * "Not available" is the fail-closed sentinel for an absent fact
 * (FOREVER-TRUTH-001A): the card hides the element rather than presenting
 * the sentinel as if it were data.
 */
function hasValue(value: string | number | boolean | null | undefined): boolean {
  if (typeof value === "number") {
    return value > 0;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (!value || value.trim().length === 0) {
    return false;
  }

  return value !== "Not available";
}

function DetailItem({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof ShieldCheck;
}) {
  if (!hasValue(value)) {
    return null;
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon className="h-3.5 w-3.5 shrink-0 text-primary/80" />
      <div className="min-w-0">
        <dt className="text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </dt>
        <dd className="truncate text-xs font-medium leading-snug text-foreground">{value}</dd>
      </div>
    </div>
  );
}

export function PremiumProjectCard({ project }: PremiumProjectCardProps) {
  const trustScore = project.trustScore > 0 ? project.trustScore.toFixed(1) : "";
  const quietDetails = [
    { label: "Build", value: project.constructionStatus, icon: CalendarCheck },
    { label: "Beach", value: project.distanceToBeach, icon: Waves },
    { label: "Yield", value: project.rentalYield, icon: TrendingUp },
  ];

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-[0_24px_48px_-28px_rgba(30,30,30,0.24)]">
      <Link
        to="/projects/$slug"
        params={{ slug: project.slug }}
        className="relative block aspect-[16/10] overflow-hidden bg-secondary"
        aria-label={`Open ${project.name} passport`}
      >
        {project.image ? (
          <img
            src={project.image}
            alt={`${project.name} in ${project.location}`}
            width={1024}
            height={768}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.035]"
          />
        ) : (
          <div className="flex h-full items-end bg-gradient-to-br from-secondary via-muted to-background p-4 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Media preview pending
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

        <div className="absolute left-3 right-3 top-3 flex items-start justify-between gap-3">
          {project.foreverVerified ? (
            <Badge className="gap-1.5 border border-white/20 bg-background/95 px-2 text-[10px] text-foreground hover:bg-background">
              <ShieldCheck className="h-3 w-3 text-primary" />
              Forever Verified
            </Badge>
          ) : hasValue(project.status) ? (
            <Badge variant="secondary">{project.status}</Badge>
          ) : null}

          {hasValue(project.verifiedPrice) ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-white/20 bg-background/95 px-2.5 py-1 text-[11px] font-medium text-foreground">
              <BadgeCheck className="h-3 w-3 text-primary" />
              Forever Verified Price
            </span>
          ) : null}
        </div>

        {trustScore ? (
          <div className="absolute bottom-3 right-3 rounded-lg border border-white/20 bg-background/95 px-3 py-2 text-right text-foreground shadow-sm">
            <div className="text-[9px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Forever Score
            </div>
            <div className="font-serif text-2xl leading-none">
              {trustScore}
              <span className="text-xs text-muted-foreground">/10</span>
            </div>
          </div>
        ) : null}

        <div className="absolute bottom-3 left-3 right-24 text-primary-foreground">
          {hasValue(project.propertyType) ? (
            <div className="mb-1.5 text-[9px] font-medium uppercase tracking-[0.18em] text-primary-foreground/75">
              {project.propertyType}
            </div>
          ) : null}
          <h3 className="line-clamp-2 font-serif text-xl leading-tight tracking-tight">
            {project.name}
          </h3>
          {project.location ? (
            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-primary-foreground/90">
              <MapPin className="h-3 w-3" />
              {project.location}
            </div>
          ) : null}
        </div>
      </Link>

      <div className="flex flex-1 flex-col p-4">
        <div className="grid grid-cols-[1fr_auto] items-start gap-4 border-b border-border pb-4">
          <div>
            <div className="text-[9px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Starting price
            </div>
            <div className="mt-1 font-serif text-xl leading-none text-foreground">
              {project.price || project.priceRange || "Price on request"}
            </div>
          </div>

          {hasValue(project.verifiedPrice) ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
              <BadgeCheck className="h-3 w-3 text-primary" />
              Forever Verified Price
            </span>
          ) : null}
        </div>

        {hasValue(project.verdict) ? (
          <div className="border-b border-border py-4">
            <div className="text-[9px] font-medium uppercase tracking-[0.16em] text-primary">
              Forever Verdict
            </div>
            <p className="mt-1.5 line-clamp-1 text-sm font-semibold leading-snug text-foreground">
              {project.verdict}
            </p>
          </div>
        ) : null}

        <dl className="grid gap-3 py-4 text-sm">
          {quietDetails.map((detail) => (
            <DetailItem
              key={detail.label}
              label={detail.label}
              value={detail.value}
              icon={detail.icon}
            />
          ))}
        </dl>

        <div className="mt-auto space-y-3 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            {hasValue(project.status) ? <div>{project.status}</div> : null}
            {hasValue(project.lastInspection) ? (
              <div>Inspected {project.lastInspection}</div>
            ) : null}
          </div>
          <Button asChild size="sm" className="w-full">
            <Link to="/projects/$slug" params={{ slug: project.slug }}>
              View Passport
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    </article>
  );
}
