import type {
  DecisionProfileModel,
  NavigatorId,
  NavigatorSourceReference,
  RecommendationModel,
} from "../domain/models";

export interface RecommendationPipelineContext {
  sessionId: NavigatorId;
  clientId: NavigatorId;
  decisionProfile: DecisionProfileModel;
  sourceReferences: NavigatorSourceReference[];
  aiContext?: Record<string, unknown>;
}

export interface RecommendationPipelineRun {
  id: NavigatorId;
  startedAt: string;
  completedAt?: string;
  status: "queued" | "running" | "completed" | "failed";
  modelVersion?: string;
}

export interface RecommendationPipeline {
  prepare(context: RecommendationPipelineContext): Promise<RecommendationPipelineRun>;
  execute(
    run: RecommendationPipelineRun,
    context: RecommendationPipelineContext,
  ): Promise<RecommendationModel[]>;
}
