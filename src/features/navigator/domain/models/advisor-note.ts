import type { NavigatorAuditFields, NavigatorId } from "./common";

export interface AdvisorNoteModel extends NavigatorAuditFields {
  id: NavigatorId;
  sessionId: NavigatorId;
  clientId: NavigatorId;
  advisorId: NavigatorId;
  title?: string;
  body: string;
  visibility: "internal" | "client_visible";
  tags: string[];
}
