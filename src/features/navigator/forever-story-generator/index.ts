import type {
  DecisionProfileModel,
  ForeverStoryModel,
  NavigatorAnswerModel,
  NavigatorId,
} from "../domain/models";

export interface ForeverStoryGeneratorInput {
  sessionId: NavigatorId;
  clientId: NavigatorId;
  decisionProfile: DecisionProfileModel;
  answers: NavigatorAnswerModel[];
}

export interface ForeverStoryGenerator {
  generate(input: ForeverStoryGeneratorInput): Promise<ForeverStoryModel>;
}
