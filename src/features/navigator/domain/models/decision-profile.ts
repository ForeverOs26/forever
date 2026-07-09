import type {
  NavigatorAuditFields,
  NavigatorId,
  NavigatorMoneyRange,
  NavigatorSourceReference,
} from "./common";

export type BuyerIntent =
  | "primary_home"
  | "second_home"
  | "investment"
  | "relocation"
  | "retirement"
  | "mixed";
export type RiskTolerance = "low" | "moderate" | "high";
export type DecisionReadiness = "exploring" | "shortlisting" | "ready_to_act" | "post_purchase";

export interface DecisionProfileModel extends NavigatorAuditFields {
  id: NavigatorId;
  sessionId: NavigatorId;
  clientId: NavigatorId;
  intent: BuyerIntent;
  readiness: DecisionReadiness;
  riskTolerance: RiskTolerance;
  budget?: NavigatorMoneyRange;
  preferredAreas: string[];
  mustHaves: string[];
  dealBreakers: string[];
  sourceReferences: NavigatorSourceReference[];
  version: string;
}
