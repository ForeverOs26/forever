import type { NavigatorAuditFields, NavigatorId, NavigatorSourceReference } from "./common";

export interface ForeverStorySection {
  key: string;
  title: string;
  content: string;
  sourceReferences: NavigatorSourceReference[];
}

export interface ForeverStoryModel extends NavigatorAuditFields {
  id: NavigatorId;
  sessionId: NavigatorId;
  clientId: NavigatorId;
  decisionProfileId: NavigatorId;
  sections: ForeverStorySection[];
  status: "draft" | "advisor_review" | "approved" | "archived";
  generatedBy: "system" | "advisor" | "ai_assisted";
  version: string;
}
