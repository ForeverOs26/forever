import type { ISODateTime, NavigatorAuditFields, NavigatorId } from "./common";

export type NavigatorSessionStatus =
  | "not_started"
  | "in_progress"
  | "submitted"
  | "advisor_review"
  | "completed";
export type NavigatorStepId =
  | "navigator"
  | "decision_profile"
  | "forever_story"
  | "decision_desk"
  | "recommendations";

export interface NavigatorSessionModel extends NavigatorAuditFields {
  id: NavigatorId;
  clientId: NavigatorId;
  status: NavigatorSessionStatus;
  currentStep: NavigatorStepId;
  startedAt?: ISODateTime;
  submittedAt?: ISODateTime;
  completedAt?: ISODateTime;
  version: string;
  metadata?: Record<string, unknown>;
}
