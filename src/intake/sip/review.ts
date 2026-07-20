/**
 * SIP-001A — exception-only review summary.
 *
 * High-confidence, source-complete deterministic cells that pass every
 * validator never generate a review item. Only medium/low-confidence
 * candidates, ambiguous/unknown headers, parser recovery, conflicts,
 * duplicate identities, unclear identity/date/currency, unsupported
 * separators, and unsupported rows/regions appear here.
 */

import type { ReviewItem, ReviewSummary } from "./types";
import { SIP_SCHEMA_VERSION } from "./types";

export function buildReviewSummary(projectSlug: string, items: ReviewItem[]): ReviewSummary {
  const blocking_issue_count = items.filter((item) => item.blocking).length;
  return {
    sip_schema_version: SIP_SCHEMA_VERSION,
    project_slug: projectSlug,
    items,
    blocking_issue_count,
    review_required_count: items.length,
  };
}

/** True only when no blocking item remains (duplicate identity / hard conflict). */
export function canFinalize(summary: ReviewSummary): boolean {
  return summary.blocking_issue_count === 0;
}
