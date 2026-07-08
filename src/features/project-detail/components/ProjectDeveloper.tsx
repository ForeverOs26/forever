import { Building2, Globe, Mail, Phone } from "lucide-react";
import { Section } from "@/components/layout/Section";
import type { ProjectDetail } from "../project-detail-types";

type ProjectDeveloperProps = {
  project: ProjectDetail;
};

export function ProjectDeveloper({ project }: ProjectDeveloperProps) {
  const developer = project.developer;

  if (!developer) return null;

  return (
    <Section eyebrow="Developer" title={developer.name} className="pt-0">
      <div className="rounded-3xl border border-border/60 bg-card p-6 sm:p-8">
        <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-start">
          <div>
            <div className="flex items-center gap-3">
              {developer.logoUrl ? (
                <img
                  src={developer.logoUrl}
                  alt={`${developer.name} logo`}
                  className="h-11 w-11 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/15 text-accent">
                  <Building2 className="h-5 w-5" />
                </div>
              )}
              <div className="font-serif text-2xl text-foreground">{developer.name}</div>
            </div>
            {developer.description && (
              <p className="mt-5 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                {developer.description}
              </p>
            )}
          </div>
          <div className="grid gap-3 text-sm">
            {developer.website && (
              <a
                href={developer.website}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-foreground hover:text-accent"
              >
                <Globe className="h-4 w-4 text-accent" /> Website
              </a>
            )}
            {developer.contactEmail && (
              <a
                href={`mailto:${developer.contactEmail}`}
                className="inline-flex items-center gap-2 text-foreground hover:text-accent"
              >
                <Mail className="h-4 w-4 text-accent" /> {developer.contactEmail}
              </a>
            )}
            {developer.contactPhone && (
              <a
                href={`tel:${developer.contactPhone}`}
                className="inline-flex items-center gap-2 text-foreground hover:text-accent"
              >
                <Phone className="h-4 w-4 text-accent" /> {developer.contactPhone}
              </a>
            )}
          </div>
        </div>
      </div>
    </Section>
  );
}
