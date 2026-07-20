import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowRight, X } from "lucide-react";
import { SiteShell } from "@/components/SiteShell";
import { Container } from "@/components/layout/Container";
import { Section } from "@/components/layout/Section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DiscoveryCard } from "@/components/DiscoveryCard";
import {
  discoveryAreaOptions,
  discoveryBeachOptions,
  discoveryCompletionOptions,
  discoverySortOptions,
  discoveryTypeOptions,
  filterDiscoveryProjects,
  type DiscoveryAreaFilter,
  type DiscoveryBeachFilter,
  type DiscoveryCompletionFilter,
  type DiscoverySortOption,
  type DiscoveryTypeFilter,
} from "@/features/discovery/discovery-filters";
import { projectListQuery } from "@/lib/project-service";

export const Route = createFileRoute("/discovery")({
  head: () => ({
    meta: [
      { title: "Forever Discovery — Guided Property Advisory" },
      {
        name: "description",
        content:
          "Filter Forever's Phuket project records by area, budget, type, and completion. Missing facts stay visibly missing.",
      },
      { property: "og:title", content: "Forever Discovery — Guided Property Advisory" },
      {
        property: "og:description",
        content: "Filter Forever's Phuket project records. Missing facts stay visibly missing.",
      },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(projectListQuery()),
  component: DiscoveryPage,
});

function DiscoveryPage() {
  const { data: projects } = useSuspenseQuery(projectListQuery());
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<DiscoverySortOption>(discoverySortOptions[0]);
  const [budget, setBudget] = useState("");
  const [area, setArea] = useState<DiscoveryAreaFilter>(discoveryAreaOptions[0]);
  const [type, setType] = useState<DiscoveryTypeFilter>(discoveryTypeOptions[0]);
  const [completion, setCompletion] = useState<DiscoveryCompletionFilter>(
    discoveryCompletionOptions[0],
  );
  const [beach, setBeach] = useState<DiscoveryBeachFilter>(discoveryBeachOptions[0]);
  const [compare, setCompare] = useState<string[]>([]);
  const [shortlist, setShortlist] = useState<string[]>([]);

  const toggleCompare = (slug: string) => {
    setCompare((prev) => {
      if (prev.includes(slug)) return prev.filter((s) => s !== slug);
      if (prev.length >= 3) return prev;
      return [...prev, slug];
    });
  };
  const toggleShortlist = (slug: string) => {
    setShortlist((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
    );
  };

  const filtered = useMemo(() => {
    return filterDiscoveryProjects(projects, {
      search,
      sortBy,
      budget,
      area,
      propertyType: type,
      completionStatus: completion,
      beachDistance: beach,
    });
  }, [area, beach, budget, completion, projects, search, sortBy, type]);

  return (
    <SiteShell>
      {/* 1. Hero */}
      <section className="border-b border-border bg-muted/20">
        <Container className="py-20 sm:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-5 text-xs font-medium uppercase tracking-[0.2em] text-accent">
              Forever Discovery
            </div>
            <h1 className="font-serif text-4xl leading-[1.05] tracking-tight text-foreground sm:text-5xl md:text-6xl">
              Find the right property, not just another listing.
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Explore Forever&apos;s Phuket project records. Missing facts stay visibly missing
              rather than assumed.
            </p>
            <div className="mt-8">
              <Button asChild size="lg">
                <a href="#refine">
                  Start Discovery <ArrowRight className="h-4 w-4" />
                </a>
              </Button>
            </div>
          </div>
        </Container>
      </section>

      {/* 2. Smart Filters */}
      <Section id="refine" eyebrow="Refine" title="Refine your discovery">
        <div className="rounded-lg border border-border bg-background p-5 shadow-sm sm:p-6">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Search">
              <Input
                placeholder="Project, area, developer or type"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </Field>
            <Field label="Sort">
              <Select value={sortBy} onChange={setSortBy} options={discoverySortOptions} />
            </Field>
            <Field label="Budget">
              <Input
                placeholder="e.g. ฿30M"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
            </Field>
            <Field label="Area">
              <Select value={area} onChange={setArea} options={discoveryAreaOptions} />
            </Field>
            <Field label="Property Type">
              <Select value={type} onChange={setType} options={discoveryTypeOptions} />
            </Field>
            <Field label="Completion">
              <Select
                value={completion}
                onChange={setCompletion}
                options={discoveryCompletionOptions}
              />
            </Field>
            <Field label="Beach Distance">
              <Select value={beach} onChange={setBeach} options={discoveryBeachOptions} />
            </Field>
          </div>
        </div>
      </Section>

      {/* 3. Property Cards */}
      <Section
        eyebrow="Available projects"
        title="Current project records"
        description="Every published project record that matches your filters. Missing facts stay visibly missing rather than assumed."
        className="pt-0"
      >
        {filtered.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div className="mb-5 text-sm text-muted-foreground">
              Showing {filtered.length} projects
            </div>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((p) => (
                <DiscoveryCard
                  key={p.slug}
                  project={p}
                  inCompare={compare.includes(p.slug)}
                  inShortlist={shortlist.includes(p.slug)}
                  onToggleCompare={toggleCompare}
                  onToggleShortlist={toggleShortlist}
                />
              ))}
            </div>
          </>
        )}

        {shortlist.length > 0 && (
          <div className="mt-16 rounded-lg border border-border bg-muted/20 p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-accent">
                  My Shortlist
                </div>
                <h3 className="mt-2 font-serif text-2xl tracking-tight text-foreground">
                  {shortlist.length} {shortlist.length === 1 ? "project" : "projects"} under
                  consideration
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Your Forever advisor can prepare a personal review of your shortlist.
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setShortlist([])}>
                  Clear
                </Button>
                <Button asChild size="sm">
                  <Link to="/contact">Request Private Advisory</Link>
                </Button>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              {shortlist.map((slug) => {
                const p = projects.find((x) => x.slug === slug);
                if (!p) return null;
                return (
                  <span
                    key={slug}
                    className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground"
                  >
                    {p.name}
                    <button
                      type="button"
                      onClick={() => toggleShortlist(slug)}
                      aria-label={`Remove ${p.name}`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </Section>

      {/* 8. Final CTA */}
      <section className="border-t border-border bg-muted/20">
        <Container className="py-20 sm:py-28">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mb-5 text-xs font-medium uppercase tracking-[0.2em] text-accent">
              Private Advisory
            </div>
            <h2 className="font-serif text-3xl leading-tight tracking-tight text-foreground sm:text-4xl md:text-5xl">
              Still not sure which project fits you?
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Forever can prepare a private shortlist based on your goals, budget and risk profile.
            </p>
            <div className="mt-8">
              <Button asChild size="lg">
                <Link to="/contact">
                  Request Private Advisory <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </Container>
      </section>

      {/* 5. Sticky Compare Bar */}
      {compare.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <div className="pointer-events-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-background/95 px-5 py-4 shadow-[0_20px_50px_-20px_rgba(30,30,30,0.25)] backdrop-blur">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-accent">
                Evaluate up to 3 projects side by side
              </div>
              <div className="mt-1 text-sm text-foreground">
                {compare.length} selected
                <span className="ml-2 text-muted-foreground">
                  {compare
                    .map((s) => projects.find((p) => p.slug === s)?.name)
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setCompare([])}>
                Clear
              </Button>
              <Button size="sm" disabled>
                Compare Preview
              </Button>
            </div>
          </div>
        </div>
      )}
    </SiteShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly T[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-background px-8 py-20 text-center">
      <h3 className="font-serif text-2xl tracking-tight text-foreground">
        No projects match these filters yet.
      </h3>
      <p className="mx-auto mt-4 max-w-md text-sm text-muted-foreground">
        Adjust your preferences or ask a Forever advisor to prepare a tailored review.
      </p>
      <div className="mt-8">
        <Button asChild>
          <Link to="/contact">Request Personal Shortlist</Link>
        </Button>
      </div>
    </div>
  );
}
