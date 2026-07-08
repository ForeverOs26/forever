import { ContactForm } from "@/components/ContactForm";
import { Section } from "@/components/layout/Section";
import type { ProjectDetail } from "../project-detail-types";

type ProjectContactCTAProps = {
  project: ProjectDetail;
};

export function ProjectContactCTA({ project }: ProjectContactCTAProps) {
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
