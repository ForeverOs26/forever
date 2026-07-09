import type { NavigatorAuditFields, NavigatorId, NavigatorSourceReference } from "./common";

export type NavigatorAnswerValue =
  | string
  | number
  | boolean
  | string[]
  | Record<string, unknown>
  | null;

export interface NavigatorAnswerModel extends NavigatorAuditFields {
  id: NavigatorId;
  sessionId: NavigatorId;
  clientId: NavigatorId;
  questionKey: string;
  moduleKey: string;
  value: NavigatorAnswerValue;
  sourceReferences?: NavigatorSourceReference[];
}
