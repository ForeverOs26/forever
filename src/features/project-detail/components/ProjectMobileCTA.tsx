import { Link } from "@tanstack/react-router";
import { CalendarClock, MessageSquare } from "lucide-react";

import type { ProjectDetail } from "../project-detail-types";
import { projectContactActionsEnabled } from "../contact-actions";

/**
 * Mobile contact bar (FOREVER-PROJECT-DETAIL-FAZWAZ-INSPIRED-UX-001).
 *
 * On a phone the desktop summary panel scrolls away, so the two real actions
 * stay pinned to the bottom. Both go to the Forever contact route carrying the
 * project, so an enquiry arrives knowing what it is about.
 *
 * It is `lg:hidden`, sits above the safe-area inset, and the page reserves
 * matching bottom padding so the bar never covers the last section.
 */

export interface ProjectMobileCTAProps {
  project: ProjectDetail;
}

export function ProjectMobileCTA({ project }: ProjectMobileCTAProps) {
  // Withheld until gate G0 passes (F5). Rendering nothing — not a disabled bar
  // — is the point: the page must not reserve space for, or advertise, an
  // action whose delivery has never been observed. `ProjectDetailEngine` drops
  // its matching bottom padding through the same check.
  if (!projectContactActionsEnabled()) return null;

  return (
    <div
      data-testid="project-mobile-cta"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-center gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted-foreground">{project.core.name}</p>
          <p className="truncate text-sm font-medium text-foreground">
            {project.pricing.displayPrice || "Price on request"}
          </p>
        </div>
        <Link
          to="/contact"
          search={{ project: project.core.name }}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-2 text-sm font-medium text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <CalendarClock className="h-4 w-4" aria-hidden="true" />
          Viewing
        </Link>
        <Link
          to="/contact"
          search={{ project: project.core.name }}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
          Request details
        </Link>
      </div>
    </div>
  );
}
