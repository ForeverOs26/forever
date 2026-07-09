import type { ISODateTime, NavigatorAuditFields, NavigatorId } from "./common";

export type ClientLifecycleStage = "lead" | "qualified" | "active" | "closed" | "inactive";

export interface ClientContactDetails {
  email?: string;
  phone?: string;
  preferredContactMethod?: "email" | "phone" | "whatsapp" | "line" | "in_person";
}

export interface ClientModel extends NavigatorAuditFields {
  id: NavigatorId;
  externalId?: string;
  fullName: string;
  contact: ClientContactDetails;
  lifecycleStage: ClientLifecycleStage;
  consentAcceptedAt?: ISODateTime;
  metadata?: Record<string, unknown>;
}
