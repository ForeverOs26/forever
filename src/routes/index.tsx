import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowRight, Play, BadgeCheck, LineChart, LifeBuoy, Search } from "lucide-react";
import { SiteShell } from "@/components/SiteShell";
import { Container } from "@/components/layout/Container";
import { Section } from "@/components/layout/Section";
import { PremiumProjectCard } from "@/components/PremiumProjectCard";
import { OfferCard } from "@/components/OfferCard";
import { ReviewCard } from "@/components/ReviewCard";
import { AreaCard } from "@/components/AreaCard";
import { ContactForm } from "@/components/ContactForm";
import { Button } from "@/components/ui/button";
import { offers, reviews, areas } from "@/lib/data";
import { projectListQuery } from "@/lib/project-service";
import { isPartnerDemoModeEnabled } from "@/lib/partner-demo-mode";
import heroImage from "@/assets/phuket-hero.jpg";

export const Route = createFileRoute("/")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(projectListQuery({ featuredOnly: true, limit: 3 })),
  component: HomePage,
});

function HomePage() {
  const { data: featured } = useSuspenseQuery(projectListQuery({ featuredOnly: true, limit: 3 }));
  const partnerDemo = import.meta.env.DEV && isPartnerDemoModeEnabled();
  const whyForeverItems = partnerDemo
    ? [
        {
          icon: Search,
          title: "Structured Project Records",
          body: "Available evidence is organized clearly, while missing fields remain visibly unfilled.",
        },
        {
          icon: BadgeCheck,
          title: "Forever Passport",
          body: "The Passport keeps project identity, available evidence, and unresolved information together for review.",
        },
        {
          icon: LineChart,
          title: "Guided Decisions",
          body: "The Navigator turns a buyer conversation into a consistent Decision Profile and Forever Story.",
        },
        {
          icon: LifeBuoy,
          title: "Private Advisory",
          body: "The walkthrough completes through the existing advisory experience without saving a real request.",
        },
      ]
    : [
        {
          icon: Search,
          title: "Verified Project Records",
          body: "Each selected project is organized around inspection signals, pricing context, documents, and the evidence buyers need to review.",
        },
        {
          icon: BadgeCheck,
          title: "Forever Passport",
          body: "The Forever Passport gives each project a clear official record with score, verdict, verification dates, buyer fit, and risks.",
        },
        {
          icon: LineChart,
          title: "Forever Intelligence",
          body: "Forever Intelligence turns structured project data into explainable scores, strengths, risks, and buyer-fit guidance.",
        },
        {
          icon: LifeBuoy,
          title: "Private Advisory",
          body: "A Forever advisor can help interpret the evidence, compare options, and decide what deserves your attention next.",
        },
      ];
  const decisionGuideItems = partnerDemo
    ? [
        ["01", "Ownership", "Identify what is recorded and what still needs legal review."],
        ["02", "Due Diligence", "Keep source evidence and unresolved questions visible."],
        ["03", "Pricing", "Show available price evidence without inventing a project-level claim."],
        [
          "04",
          "Buyer Fit",
          "Connect the guest's priorities to only the evidence the record supports.",
        ],
      ]
    : [
        ["01", "Ownership", "Freehold, leasehold, and Thai company structures."],
        ["02", "Due Diligence", "Title checks, developer track record, EIA approvals."],
        ["03", "Taxes & Fees", "Transfer fees, stamp duty, and annual holding costs."],
        ["04", "Rental Yields", "Realistic occupancy and net yield benchmarks by area."],
      ];
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
              Forever Decision Platform
            </div>
            <h1 className="font-serif text-5xl leading-[1.02] tracking-tight sm:text-6xl md:text-7xl">
              Make Confident Real Estate Decisions in Phuket
            </h1>
            <p className="mt-8 max-w-xl text-base leading-relaxed text-primary-foreground/85 sm:text-lg">
              {partnerDemo
                ? "Forever brings a guided decision flow, source-backed project records, and advisory context into one buyer experience."
                : "Forever combines verified project data, Forever Passport records, and Forever Intelligence so buyers can understand a property before they act."}
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/navigator">
                  Start the Forever Navigator <ArrowRight className="h-4 w-4" />
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
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground hover:text-foreground"
              >
                <Link to="/contact">Request Private Advisory</Link>
              </Button>
            </div>
          </div>
        </Container>
      </section>

      {/* 2. Featured Projects */}
      <Section
        eyebrow={partnerDemo ? "Project records" : "Verified Projects"}
        title={
          partnerDemo
            ? "Review what the available evidence supports"
            : "Start with projects that have been reviewed"
        }
        description={
          partnerDemo
            ? "The presentation uses committed local records and leaves unsupported scores, yields, dates, and verification claims blank."
            : "A focused shortlist of Phuket projects with inspection signals, Forever Score context, and decision-ready project records."
        }
      >
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {featured.slice(0, 3).map((p) => (
            <PremiumProjectCard key={p.slug} project={p} />
          ))}
        </div>
        <div className="mt-10">
          <Button asChild variant="ghost">
            <Link to="/projects">
              {partnerDemo ? "View project records" : "View Verified Projects"}{" "}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </Section>

      {!partnerDemo ? (
        <>
          {/* 3. Verified Offers */}
          <Section
            className="bg-secondary/60"
            eyebrow="Verified Offers"
            title="Offers with clearer context"
            description="Each Verified Offer is presented as decision support, not pressure. Forever checks the terms so buyers can evaluate them calmly."
          >
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {offers.map((o) => (
                <OfferCard key={o.id} offer={o} />
              ))}
            </div>
          </Section>

          {/* 4. Latest Project Reviews */}
          <Section
            eyebrow="Buyer Confidence"
            title="What clients value about clearer decisions"
            description="Real feedback from buyers who wanted inspection support, negotiation clarity, handover guidance, and rental setup without sales pressure."
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
            eyebrow="Phuket Expertise"
            title="Understand the location before the listing"
            description="Each Phuket area has different lifestyle, access, rental, and resale dynamics. Forever helps buyers understand the context first."
          >
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {areas.slice(0, 6).map((a) => (
                <AreaCard key={a.slug} area={a} />
              ))}
            </div>
          </Section>
        </>
      ) : null}

      {/* 6. Investment Guide */}
      <Section eyebrow="Decision Guide" title="Real estate decisions, clearly explained">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <p className="text-base text-muted-foreground sm:text-lg">
              {partnerDemo
                ? "A clear way to discuss ownership, due diligence, available pricing evidence, and the questions to ask before choosing a project."
                : "A concise, jargon-free guide to ownership structures, freehold and leasehold, taxes, rental yields, due diligence, and the questions to ask before choosing a project."}
            </p>
            <div className="mt-8">
              <Button asChild>
                <Link to="/about">
                  Read the Decision Guide <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
          <ol className="lg:col-span-7 grid gap-px overflow-hidden rounded-2xl border border-border/60 bg-border/60 sm:grid-cols-2">
            {decisionGuideItems.map(([n, t, d]) => (
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
        eyebrow="Why Forever"
        title="Trust is built from evidence"
        description="Forever is designed to reduce uncertainty with structured project records, independent analysis, and buyer-side guidance."
      >
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {whyForeverItems.map(({ icon: Icon, title, body }) => (
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
      <Section eyebrow="Contact" title="Request Private Advisory">
        <div className="grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <p className="text-base text-muted-foreground sm:text-lg">
              Tell us what you are trying to decide. We will prepare a focused advisory response
              based on your goals, budget, and risk profile.
            </p>
            {!partnerDemo ? (
              <dl className="mt-10 space-y-6 text-sm">
                <div>
                  <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Office
                  </dt>
                  <dd className="mt-1 text-foreground">Cherng Talay, Phuket 83110, Thailand</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Email
                  </dt>
                  <dd className="mt-1 text-foreground">advisors@forever.property</dd>
                </div>
              </dl>
            ) : null}
          </div>
          <div className="lg:col-span-7">
            <ContactForm source="home_page" />
          </div>
        </div>
      </Section>
    </SiteShell>
  );
}
