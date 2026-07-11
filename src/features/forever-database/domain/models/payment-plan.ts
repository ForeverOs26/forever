import type { AuditFields, ForeverId, Money, SourceMetadata } from "./common";

/** A single milestone within a payment plan. */
export interface ForeverPaymentMilestone {
  label: string;
  percentage?: number;
  amount?: Money;
  /** Stage or date the milestone is due, e.g. "On booking" or "2026-01". */
  dueOn?: string;
  sortOrder: number;
}

/**
 * Payment Plan — the schedule of payments for a project or unit.
 *
 * A canonical structure future import pipelines can populate from extracted
 * price-list terms. A plan may be project-wide (`unitId` omitted) or specific
 * to a unit.
 */
export interface ForeverPaymentPlan extends AuditFields {
  id: ForeverId;
  projectId: ForeverId;
  unitId?: ForeverId;
  name: string;
  description?: string;
  milestones: ForeverPaymentMilestone[];
  source?: SourceMetadata;
}
