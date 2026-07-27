import { ContactForm } from "@/components/ContactForm";
import { Section } from "@/components/layout/Section";
import type { ProjectDetail } from "../project-detail-types";
import { projectContactActionsEnabled } from "../contact-actions";

type ProjectContactCTAProps = {
  project: ProjectDetail;
};

export function ProjectContactCTA({ project }: ProjectContactCTAProps) {
  // Nothing renders this component today. The gate is here so that if anything
  // ever does, it fails closed: this is a contextual project contact action —
  // an inline form on the project page, promising that an advisor "will confirm
  // a time" — and gate G0 is open (F5). Defence in depth, not live behaviour.
  if (!projectContactActionsEnabled()) return null;

  return (
    <Section
      eyebrow="Next step"
      title="Request Private Advisory"
      description="Share a few details and your Forever advisor will confirm a time to walk you through this project."
      className="pt-0"
    >
      <div className="mx-auto max-w-3xl">
        <ContactForm
          defaultInterest={project.core.name}
          projectSlug={project.core.slug}
          source="project_detail"
        />
      </div>
    </Section>
  );
}
