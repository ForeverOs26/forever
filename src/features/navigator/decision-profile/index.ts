import type { DecisionProfileModel, NavigatorAnswerModel, NavigatorId } from "../domain/models";

export interface DecisionProfileBuilderInput {
  sessionId: NavigatorId;
  clientId: NavigatorId;
  answers: NavigatorAnswerModel[];
}

export interface DecisionProfileBuilder {
  build(input: DecisionProfileBuilderInput): Promise<DecisionProfileModel>;
}
