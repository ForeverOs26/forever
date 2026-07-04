import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowRight, Play, BadgeCheck, LineChart, LifeBuoy, Search } from "lucide-react";
import { SiteShell } from "@/components/SiteShell";
import { Container } from "@/components/layout/Container";
import { Section } from "@/components/layout/Section";
import { ProjectCard } from "@/components/ProjectCard";
import { OfferCard } from "@/components/OfferCard";
import { ReviewCard } from "@/components/ReviewCard";
import { AreaCard } from "@/components/AreaCard";
import { ContactForm } from "@/components/ContactForm";
import { Button } from "@/components/ui/button";
import { offers, reviews, areas } from "@/lib/data";
import { projectListQuery } from "@/lib/project-service";
import heroImage from "@/assets/phuket-hero.jpg";

export const Route = createFileRoute("/")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(projectListQuery({ featuredOnly: true, limit: 3 })),
  component: HomePage,
});

function HomePage() {
  const { data: featured } = useSuspenseQuery(
    projectListQuery({ featuredOnly: true, limit: 3 }),
  );
  return (
    <SiteShell>
      {/* 1. Hero */}
      <section className="relative isolate overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <img
            src={heroImage}
            alt="Aerial view of Phuket coastline at golden hour"
            width={1920}
            height={1280}
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/30 to-black/70" />
        </div>
        <Container className="flex min-h-[92vh] flex-col justify-end pb-20 pt-40 sm:pb-28 sm:pt-48">
          <div className="max-w-3xl text-primary-foreground">
            <div className="mb-6 text-[11px] font-medium uppercase tracking-[0.35em] text-primary-foreground/80">
              Independent Phuket Property Advisory
            </div>
            <h1 className="font-serif text-5xl leading-[1.02] tracking-tight sm:text-6xl md:text-7xl">
              Find Your Perfect Property in Phuket
            </h1>
            <p className="mt-8 max-w-xl text-base leading-relaxed text-primary-foreground/85 sm:text-lg">
              Personally inspected projects. Verified developer promotions.
              Independent investment analysis. We represent you — never the developer.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/contact">
                  Book Property Tour <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground hover:text-foreground"
              >
                <Link to="/projects">
                  <Play className="h-4 w-4" /> Explore Projects
                </Link>
              </Button>
            </div>
          </div>
        </Container>
      </section>

      {/* 2. Featured Projects */}
      <Section
        eyebrow="Featured Projects"
        title="Personally inspected residences"
        description="A shortlist of Phuket projects our advisors have walked, measured, and independently priced — with verified promotions where available."
      >
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {featured.slice(0, 3).map((p) => (
            <ProjectCard key={p.slug} project={p} />
          ))}
        </div>
        <div className="mt-10">
          <Button asChild variant="ghost">
            <Link to="/projects">
              View all projects <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </Section>

      {/* 3. Special Offers */}
      <Section
        className="bg-secondary/60"
        eyebrow="Verified Promotions"
        title="Current developer promotions"
        description="Every promotion below has been verified against the signed reservation contract by a Forever advisor. No brochure-only claims."
      >
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {offers.map((o) => (
            <OfferCard key={o.id} offer={o} />
          ))}
        </div>
      </Section>

      {/* 4. Latest Project Reviews */}
      <Section
        eyebrow="Owner Reviews"
        title="From buyers we've advised"
        description="Unedited reviews from owners we walked through inspection, negotiation, handover, and rental setup."
      >
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {reviews.slice(0, 3).map((r) => (
            <ReviewCard key={r.id} review={r} />
          ))}
        </div>
        <div className="mt-10">
          <Button asChild variant="ghost">
            <Link to="/reviews">
              Read all reviews <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </Section>

      {/* 5. Explore Areas */}
      <Section
        className="bg-secondary/60"
        eyebrow="Explore Areas"
        title="Where to buy in Phuket"
        description="Each coast has its own rhythm. Start with a neighborhood, then find the residence."
      >
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {areas.slice(0, 6).map((a) => (
            <AreaCard key={a.slug} area={a} />
          ))}
        </div>
      </Section>

      {/* 6. Investment Guide */}
      <Section eyebrow="Investment Guide" title="Buying property in Phuket, clearly explained">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <p className="text-base text-muted-foreground sm:text-lg">
              A concise, jargon-free guide to ownership structures, freehold and
              leasehold, taxes, rental yields, and the steps from reservation to
              handover.
            </p>
            <div className="mt-8">
              <Button asChild>
                <Link to="/about">
                  Read the guide <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
          <ol className="lg:col-span-7 grid gap-px overflow-hidden rounded-2xl border border-border/60 bg-border/60 sm:grid-cols-2">
            {[
              ["01", "Ownership", "Freehold, leasehold, and Thai company structures."],
              ["02", "Due Diligence", "Title checks, developer track record, EIA approvals."],
              ["03", "Taxes & Fees", "Transfer fees, stamp duty, and annual holding costs."],
              ["04", "Rental Yields", "Realistic occupancy and net yield benchmarks by area."],
            ].map(([n, t, d]) => (
              <li key={n} className="bg-card p-8">
                <div className="font-serif text-sm text-accent">{n}</div>
                <div className="mt-3 font-serif text-xl text-foreground">{t}</div>
                <p className="mt-2 text-sm text-muted-foreground">{d}</p>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      {/* 7. Why Forever */}
      <Section
        className="bg-secondary/60"
        eyebrow="Why Trust Forever"
        title="An advisor, not an agent"
        description="We represent buyers only. No developer commissions steer our shortlist, our promotions, or our advice."
      >
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: Search,
              title: "Personally Inspected Projects",
              body: "Every project on our shortlist has been walked, measured, and photographed by a Forever advisor — no desk-only listings.",
            },
            {
              icon: BadgeCheck,
              title: "Verified Developer Promotions",
              body: "We check each promotion against the signed reservation contract before publishing. Brochure claims never make it through.",
            },
            {
              icon: LineChart,
              title: "Independent Investment Analysis",
              body: "Honest yield modeling, resale benchmarks, and area comparisons — commissioned for you, not the developer.",
            },
            {
              icon: LifeBuoy,
              title: "End-to-End Buyer Support",
              body: "Legal, tax, handover snagging, rental management, and resale — one advisor, from first viewing onward.",
            },
          ].map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-3xl border border-border/60 bg-card p-7 shadow-[0_1px_2px_rgba(30,30,30,0.04)] transition-shadow hover:shadow-[0_20px_40px_-20px_rgba(30,30,30,0.15)]"
            >
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-accent/15 text-accent">
                <Icon className="h-5 w-5" />
              </div>
              <div className="mt-6 font-serif text-xl text-foreground">{title}</div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* 8. Contact */}
      <Section eyebrow="Contact" title="Book a private property tour">
        <div className="grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <p className="text-base text-muted-foreground sm:text-lg">
              Tell us what you're looking for. We'll send back a shortlist within
              two business days — no mailing lists, no follow-up chains.
            </p>
            <dl className="mt-10 space-y-6 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Office</dt>
                <dd className="mt-1 text-foreground">Cherngtalay, Phuket 83110, Thailand</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Email</dt>
                <dd className="mt-1 text-foreground">advisors@forever.property</dd>
              </div>
            </dl>
          </div>
          <div className="lg:col-span-7">
            <ContactForm source="home_page" />
          </div>
        </div>
      </Section>
    </SiteShell>
  );
}
