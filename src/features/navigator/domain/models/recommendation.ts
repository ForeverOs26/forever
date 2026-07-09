import type { NavigatorAuditFields, NavigatorId, NavigatorSourceReference } from "./common";

export type RecommendationStatus =
  | "candidate"
  | "advisor_review"
  | "approved"
  | "rejected"
  | "presented";
export type RecommendationType = "project" | "area" | "strategy" | "next_step";

export interface RecommendationModel extends NavigatorAuditFields {
  id: NavigatorId;
  sessionId: NavigatorId;
  clientId: NavigatorId;
  decisionProfileId: NavigatorId;
  type: RecommendationType;
  status: RecommendationStatus;
  title: string;
  rationale: string;
  confidence?: number;
  rank?: number;
  targetId?: NavigatorId;
  sourceReferences: NavigatorSourceReference[];
  pipelineRunId?: NavigatorId;
  metadata?: Record<string, unknown>;
}
