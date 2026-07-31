import { ExternalLink, FileText } from "lucide-react";

import { Section } from "@/components/layout/Section";

import type { DecisionDeckDocument, DecisionDeckValue } from "../decision-deck-model";
import { publicBrowserUrl } from "../public-url";

const DOCUMENT_LABELS: Readonly<Record<DecisionDeckDocument["type"], string>> = {
  brochure: "Brochure",
  price_list: "Price list",
  payment_plan: "Payment plan",
  document: "Document",
};

interface RenderableDocument {
  id: string;
  url: string;
  label: string;
}

export interface ProjectDecisionDocumentsProps {
  documents: DecisionDeckValue<readonly DecisionDeckDocument[]>;
}

function browserSafeUrl(value: string): string {
  return publicBrowserUrl(value);
}

function renderableDocuments(
  documents: readonly DecisionDeckDocument[],
): readonly RenderableDocument[] {
  const counts = new Map<DecisionDeckDocument["type"], number>();
  const result: RenderableDocument[] = [];

  for (const document of documents) {
    const url = browserSafeUrl(document.url);
    if (!url) continue;
    const count = (counts.get(document.type) ?? 0) + 1;
    counts.set(document.type, count);
    const baseLabel = DOCUMENT_LABELS[document.type];
    result.push({
      id: document.id,
      url,
      label: count === 1 ? baseLabel : `${baseLabel} ${count}`,
    });
  }

  return result;
}

/**
 * General public documents from the Decision Deck model. The visible labels
 * are regenerated from the closed document-type vocabulary, so legacy source
 * titles and notes never enter this section.
 */
export function ProjectDecisionDocuments({ documents }: ProjectDecisionDocumentsProps) {
  if (documents.state !== "supported") return null;
  const items = renderableDocuments(documents.value);
  if (items.length === 0) return null;

  return (
    <Section
      id="documents"
      eyebrow="Documents"
      title="Project documents"
      className="py-11 sm:py-16"
      data-decision-deck-section=""
      data-testid="project-documents"
    >
      <ul className="overflow-hidden rounded-xl border border-border/60 bg-card">
        {items.map((document) => (
          <li
            key={`${document.id}-${document.url}`}
            className="border-b border-border/60 last:border-b-0"
          >
            <a
              href={document.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-4 px-4 py-4 transition hover:bg-accent/[0.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
              aria-label={`Open ${document.label}`}
            >
              <span className="inline-flex min-w-0 items-center gap-3">
                <FileText className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                <span className="truncate text-sm font-medium text-foreground">
                  {document.label}
                </span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Open
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </span>
            </a>
          </li>
        ))}
      </ul>
    </Section>
  );
}
