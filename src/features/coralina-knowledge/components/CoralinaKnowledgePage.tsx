/**
 * Coralina Knowledge inspection page (RC5.0).
 *
 * As of RC5.1 the presentation lives in the project-agnostic
 * {@link ProjectKnowledgePage}; this wrapper keeps the RC5.0 component name
 * and props for the existing `/internal/coralina` route. Coralina's stated
 * page copy (kicker, intro, notes, footer) travels on the inspection
 * view-model; the generic page's shared section notes are project-agnostic,
 * so two RC5.0 sentences now read generically ("this project's definition"
 * instead of "this slice", and the RC4.4 chain summary).
 */

import { ProjectKnowledgePage } from "@/features/forever-project-knowledge/components/ProjectKnowledgePage";

import type { CoralinaKnowledgeInspection } from "../inspection";

export function CoralinaKnowledgePage({ inspection }: { inspection: CoralinaKnowledgeInspection }) {
  return <ProjectKnowledgePage inspection={inspection} />;
}
