import { FileText } from "lucide-react";
import { Section } from "@/components/layout/Section";
import type { ProjectDetail } from "../project-detail-types";

type ProjectDocumentsProps = {
  project: ProjectDetail;
};

export function ProjectDocuments({ project }: ProjectDocumentsProps) {
  const documents = project.media.documents;

  if (documents.length === 0) return null;

  return (
    <Section eyebrow="Documents" title="Available documents" className="pt-0">
      <div className="overflow-hidden rounded-3xl border border-border/60 bg-card">
        {documents.map((document) => (
          <a
            key={document.id}
            href={document.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between border-b border-border/60 px-6 py-5 transition-colors last:border-0 hover:bg-accent/[0.03]"
          >
            <div className="flex items-center gap-3">
              <FileText className="h-4 w-4 text-accent" />
              <div>
                <div className="text-sm text-foreground">{document.label}</div>
                <div className="text-xs text-muted-foreground">{document.note}</div>
              </div>
            </div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Open PDF
            </div>
          </a>
        ))}
      </div>
    </Section>
  );
}
