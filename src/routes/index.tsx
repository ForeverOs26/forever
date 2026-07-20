import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowRight, Play, BadgeCheck, LineChart, LifeBuoy, Search } from "lucide-react";
import { SiteShell } from "@/components/SiteShell";
import { Container } from "@/components/layout/Container";
import { Section } from "@/components/layout/Section";
import { PremiumProjectCard } from "@/components/PremiumProjectCard";
import { ContactForm } from "@/components/ContactForm";
import { Button } from "@/components/ui/button";
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
          title: "Structured Project Records",
          body: "Each project record is organized around documents, pricing context, and recorded facts — and shows plainly what is still missing.",
        },
        {
          icon: BadgeCheck,
          title: "Forever Passport",
          body: "The Forever Passport keeps each project's identity, available evidence, and unresolved questions together in one record.",
        },
        {
          icon: LineChart,
          title: "Honest Analysis",
          body: "Forever's analysis stays explainable and conservative: conclusions are tied to recorded facts, and nothing is claimed when data is missing.",
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
        [
          "01",
          "Ownership",
          "Freehold, leasehold, and Thai company structures — and what each means for you.",
        ],
        [
          "02",
          "Due Diligence",
          "The checks worth completing before committing, and who should perform them.",
        ],
        ["03", "Taxes & Fees", "The cost categories to account for beyond the purchase price."],
        ["04", "Rental Reality", "The questions to ask before relying on projected rental income."],
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
                ? "Forever brings a guided decision flow, structured project records, and advisory context into one buyer experience."
                : "Forever combines structured project records, Forever Passport records, and honest missing-data handling so buyers can understand a property before they act."}
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
        eyebrow="Project records"
        title={
          partnerDemo
            ? "Review what the available evidence supports"
            : "Start with the current project records"
        }
        description={
          partnerDemo
            ? "The presentation uses committed local records and leaves unsupported scores, yields, dates, and verification claims blank."
            : "Current Phuket project records. Where a fact is not recorded, it stays visibly missing rather than assumed."
        }
      >
        {featured.length > 0 ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featured.slice(0, 3).map((p) => (
              <PremiumProjectCard key={p.slug} project={p} />
            ))}
          </div>
        ) : (
          <div className="max-w-xl rounded-2xl border border-border/60 bg-card p-8 text-sm leading-relaxed text-muted-foreground">
            Project records are being prepared for publication. Each record is published with its
            recorded facts and its open gaps shown honestly.
          </div>
        )}
        <div className="mt-10">
          <Button asChild variant="ghost">
            <Link to="/projects">
              View project records <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </Section>

      {/* 3. Decision Guide */}
      <Section eyebrow="Decision Guide" title="Real estate decisions, clearly explained">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <p className="text-base text-muted-foreground sm:text-lg">
              {partnerDemo
                ? "A clear way to discuss ownership, due diligence, available pricing evidence, and the questions to ask before choosing a project."
                : "These are the topics a Forever advisor works through with you before you choose a project — plainly, and without pressure."}
            </p>
            <div className="mt-8">
              <Button asChild>
                <Link to="/contact">
                  Discuss with an advisor <ArrowRight className="h-4 w-4" />
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
          </div>
          <div className="lg:col-span-7">
            <ContactForm source="home_page" />
          </div>
        </div>
      </Section>
    </SiteShell>
  );
}
