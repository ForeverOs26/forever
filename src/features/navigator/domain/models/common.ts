export type NavigatorId = string;
export type ISODateTime = string;

export type NavigatorActor = "client" | "advisor" | "system" | "ai";
export type NavigatorLifecycleStatus = "draft" | "active" | "completed" | "archived";

export interface NavigatorAuditFields {
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  createdBy?: NavigatorActor | string;
  updatedBy?: NavigatorActor | string;
}

export interface NavigatorMoneyRange {
  currency: string;
  min?: number;
  max?: number;
}

export interface NavigatorSourceReference {
  sourceType: "client_answer" | "advisor_note" | "project_data" | "system" | "ai_model";
  sourceId?: NavigatorId;
  fieldPath?: string;
  confidence?: number;
}
