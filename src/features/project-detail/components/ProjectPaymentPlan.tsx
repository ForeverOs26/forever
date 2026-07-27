import { FileText } from "lucide-react";

import { Section } from "@/components/layout/Section";
import { Button } from "@/components/ui/button";

import type { ProjectDetail } from "../project-detail-types";
import { paymentPlanDocument } from "../project-sections";

/**
 * Payment plan (FOREVER-PROJECT-DETAIL-FAZWAZ-INSPIRED-UX-001).
 *
 * Forever holds no structured instalment rows for these projects — only, for
 * some of them, the developer's own payment-plan document. So this section
 * offers that document and states nothing else. A table of stages and
 * percentages read off promotional copy would look authoritative and be
 * unverified, which is exactly the kind of confident invention a buyer would
 * reasonably rely on.
 *
 * The section is absent entirely when no official document exists.
 */

export interface ProjectPaymentPlanProps {
  project: ProjectDetail;
}

export function ProjectPaymentPlan({ project }: ProjectPaymentPlanProps) {
  const document = paymentPlanDocument(project);
  if (!document) return null;

  return (
    <Section
      id="payment-plan"
      eyebrow="Payment Plan"
      title="Developer payment plan"
      className="pt-0"
      data-testid="project-payment-plan"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/70 bg-card p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <FileText className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
          <div>
            <p className="font-medium text-foreground">{document.label}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The developer&rsquo;s official payment schedule for this project.
            </p>
          </div>
        </div>
        <Button asChild variant="outline">
          <a href={document.url} target="_blank" rel="noopener noreferrer">
            View payment plan
          </a>
        </Button>
      </div>
    </Section>
  );
}
