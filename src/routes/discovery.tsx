import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Home, TrendingUp, Palmtree, KeyRound, ArrowRight, X } from "lucide-react";
import { SiteShell } from "@/components/SiteShell";
import { Container } from "@/components/layout/Container";
import { Section } from "@/components/layout/Section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { DiscoveryCard } from "@/components/DiscoveryCard";
import { projectListQuery } from "@/lib/project-service";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/discovery")({
  head: () => ({
    meta: [
      { title: "Forever Discovery — Guided Property Advisory" },
      {
        name: "description",
        content:
          "A guided advisory experience to help you find the right Phuket property with Forever Verified, Forever Analysis and Forever Verdict.",
      },
      { property: "og:title", content: "Forever Discovery — Guided Property Advisory" },
      {
        property: "og:description",
        content:
          "Explore independently reviewed Phuket properties. Forever Verified, Forever Analysis, Forever Trust.",
      },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(projectListQuery()),
  component: DiscoveryPage,
});

const intents = [
  {
    id: "family",
    icon: Home,
    title: "Family Living",
    description: "Long-term residences near international schools and calm neighborhoods.",
  },
  {
    id: "investment",
    icon: TrendingUp,
    title: "Investment",
    description: "Yield-focused projects with independent rental and capital analysis.",
  },
  {
    id: "holiday",
    icon: Palmtree,
    title: "Holiday Home",
    description: "Coastal residences designed for seasonal use with managed rentals.",
  },
  {
    id: "residence",
    icon: KeyRound,
    title: "Permanent Residence",
    description: "Freehold-friendly homes suited to full-time living in Phuket.",
  },
] as const;

function getIntentReason(intent: IntentId | null): string {
  switch (intent) {
    case "family":
      return "Selected for calm neighborhoods, international schools, and long-term family living.";
    case "investment":
      return "Selected for rental yield, capital appreciation, and independent financial analysis.";
    case "holiday":
      return "Selected for coastal access, managed rental programs, and seasonal lifestyle use.";
    case "residence":
      return "Selected for freehold eligibility, full-time comfort, and permanent living suitability.";
    default:
      return "Independently reviewed and selected based on verified inspection, pricing, and construction progress.";
  }
}

type IntentId = (typeof intents)[number]["id"];

const areasList = ["All areas", "Surin Beach", "Kamala", "Layan", "Bang Tao", "Kata Noi", "Rawai"];
const typesList = ["All types", "Villa", "Residence", "Condominium"];
const completionList = ["Any", "Ready", "2026", "2027+"];
const beachList = ["Any distance", "Beachfront", "Under 500 m", "Under 1 km", "Under 2 km"];

function DiscoveryPage() {
  const { data: projects } = useSuspenseQuery(projectListQuery());
  const [intent, setIntent] = useState<IntentId | null>(null);
  const [budget, setBudget] = useState("");
  const [area, setArea] = useState(areasList[0]);
  const [type, setType] = useState(typesList[0]);
  const [completion, setCompletion] = useState(completionList[0]);
  const [beach, setBeach] = useState(beachList[0]);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
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
    return projects.filter((p) => {
      if (area !== areasList[0] && p.location !== area) return false;
      // verifiedOnly: all projects are verified in mock; keep as pass-through
      if (verifiedOnly && p.trustScore < 8.8) return false;
      return true;
    });
  }, [area, verifiedOnly]);

  return (
    <SiteShell>
      {/* 1. Hero */}
      <section className="border-b border-border/60 bg-secondary/40">
        <Container className="py-24 sm:py-32">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 text-[11px] font-medium uppercase tracking-[0.35em] text-accent">
              Forever Discovery
            </div>
            <h1 className="font-serif text-4xl leading-[1.05] tracking-tight text-foreground sm:text-5xl md:text-6xl">
              Find the right property, not just another listing.
            </h1>
            <p className="mx-auto mt-8 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Explore independently reviewed Phuket properties with Forever Verified,
              Forever Analysis and Forever Trust.
            </p>
            <div className="mt-10">
              <Button asChild size="lg">
                <a href="#intent">
                  Start Discovery <ArrowRight className="h-4 w-4" />
                </a>
              </Button>
            </div>
          </div>
        </Container>
      </section>

      {/* 2. Buyer Intent */}
      <Section
        id="intent"
        eyebrow="Step 1"
        title="What are you looking for?"
        description="Tell us how you plan to use the property. We will tune the discovery accordingly."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {intents.map((it) => {
            const Icon = it.icon;
            const active = intent === it.id;
            return (
              <button
                key={it.id}
                type="button"
                onClick={() => setIntent(it.id)}
                className={cn(
                  "group flex h-full flex-col items-start gap-5 rounded-3xl border p-8 text-left transition-all",
                  active
                    ? "border-accent/60 bg-accent/[0.04] shadow-[0_20px_50px_-30px_rgba(199,154,69,0.4)]"
                    : "border-border/60 bg-card hover:-translate-y-0.5 hover:border-accent/30",
                )}
                aria-pressed={active}
              >
                <div
                  className={cn(
                    "flex h-12 w-12 items-center justify-center rounded-2xl border transition-colors",
                    active
                      ? "border-accent/40 bg-accent/10 text-accent"
                      : "border-border/60 bg-secondary text-foreground/70 group-hover:text-accent",
                  )}
                >
                  <Icon className="h-5 w-5" strokeWidth={1.6} />
                </div>
                <div>
                  <div className="font-serif text-xl tracking-tight text-foreground">
                    {it.title}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {it.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </Section>

      {/* 3. Smart Filters */}
      <Section eyebrow="Step 2" title="Refine your discovery" className="pt-0">
        <div className="rounded-3xl border border-border/60 bg-card p-6 sm:p-8">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Budget">
              <Input
                placeholder="e.g. ฿30M"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
            </Field>
            <Field label="Area">
              <Select value={area} onChange={setArea} options={areasList} />
            </Field>
            <Field label="Property Type">
              <Select value={type} onChange={setType} options={typesList} />
            </Field>
            <Field label="Completion">
              <Select value={completion} onChange={setCompletion} options={completionList} />
            </Field>
            <Field label="Beach Distance">
              <Select value={beach} onChange={setBeach} options={beachList} />
            </Field>
            <label className="flex cursor-pointer items-center gap-3 self-end rounded-md border border-border/60 bg-secondary/40 px-4 py-2.5">
              <Checkbox
                checked={verifiedOnly}
                onCheckedChange={(v) => setVerifiedOnly(v === true)}
                id="verified-only"
              />
              <span className="text-sm text-foreground">Forever Verified only</span>
            </label>
          </div>
        </div>
      </Section>

      {/* 4. Property Cards */}
      <Section
        eyebrow="Step 3"
        title="Projects Selected For Your Goals"
        description={getIntentReason(intent)}
        className="pt-0"
      >
        {filtered.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((p, i) => (
              <DiscoveryCard
                key={p.slug}
                project={p}
                inCompare={compare.includes(p.slug)}
                inShortlist={shortlist.includes(p.slug)}
                recommended={i < 3}
                onToggleCompare={toggleCompare}
                onToggleShortlist={toggleShortlist}
              />
            ))}
          </div>
        )}

        {shortlist.length > 0 && (
          <div className="mt-16 rounded-3xl border border-border/60 bg-secondary/30 p-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-[10px] font-medium uppercase tracking-[0.25em] text-accent">
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
                  <Link to="/contact">Request Advisor Review</Link>
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
                    className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background px-3 py-1.5 text-xs text-foreground"
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
      <section className="border-t border-border/60 bg-secondary/40">
        <Container className="py-24 sm:py-32">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mb-6 text-[11px] font-medium uppercase tracking-[0.3em] text-accent">
              Private Advisory
            </div>
            <h2 className="font-serif text-3xl leading-tight tracking-tight text-foreground sm:text-4xl md:text-5xl">
              Still not sure which project fits you?
            </h2>
            <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Forever can prepare a private shortlist based on your goals, budget and risk
              profile.
            </p>
            <div className="mt-10">
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
          <div className="pointer-events-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/60 bg-background/95 px-5 py-4 shadow-[0_20px_50px_-20px_rgba(30,30,30,0.25)] backdrop-blur">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-[0.25em] text-accent">
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
              <Button size="sm" disabled={compare.length < 2}>
                Compare Selected
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

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
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
    <div className="rounded-3xl border border-dashed border-border bg-card px-8 py-20 text-center">
      <h3 className="font-serif text-2xl tracking-tight text-foreground">
        No verified selections match your criteria.
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