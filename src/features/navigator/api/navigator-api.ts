import type {
  AdvisorNoteModel,
  DecisionProfileModel,
  ForeverStoryModel,
  NavigatorAnswerModel,
  NavigatorId,
  NavigatorSessionModel,
  RecommendationModel,
} from "../domain/models";

export interface CreateNavigatorSessionRequest {
  clientId: NavigatorId;
  version?: string;
  metadata?: Record<string, unknown>;
}

export interface SaveNavigatorAnswersRequest {
  sessionId: NavigatorId;
  clientId: NavigatorId;
  answers: Omit<NavigatorAnswerModel, "id" | "createdAt" | "updatedAt">[];
}

export interface NavigatorApi {
  createSession(request: CreateNavigatorSessionRequest): Promise<NavigatorSessionModel>;
  getSession(sessionId: NavigatorId): Promise<NavigatorSessionModel | null>;
  saveAnswers(request: SaveNavigatorAnswersRequest): Promise<NavigatorAnswerModel[]>;
  getDecisionProfile(sessionId: NavigatorId): Promise<DecisionProfileModel | null>;
  generateForeverStory(sessionId: NavigatorId): Promise<ForeverStoryModel>;
  listAdvisorNotes(sessionId: NavigatorId): Promise<AdvisorNoteModel[]>;
  saveAdvisorNote(
    note: Omit<AdvisorNoteModel, "id" | "createdAt" | "updatedAt">,
  ): Promise<AdvisorNoteModel>;
  runRecommendationPipeline(sessionId: NavigatorId): Promise<RecommendationModel[]>;
  listRecommendations(sessionId: NavigatorId): Promise<RecommendationModel[]>;
}

export class NavigatorApiNotImplemented implements NavigatorApi {
  createSession(): Promise<NavigatorSessionModel> {
    return Promise.reject(new Error("Navigator API is not implemented yet."));
  }
  getSession(): Promise<NavigatorSessionModel | null> {
    return Promise.reject(new Error("Navigator API is not implemented yet."));
  }
  saveAnswers(): Promise<NavigatorAnswerModel[]> {
    return Promise.reject(new Error("Navigator API is not implemented yet."));
  }
  getDecisionProfile(): Promise<DecisionProfileModel | null> {
    return Promise.reject(new Error("Navigator API is not implemented yet."));
  }
  generateForeverStory(): Promise<ForeverStoryModel> {
    return Promise.reject(new Error("Navigator API is not implemented yet."));
  }
  listAdvisorNotes(): Promise<AdvisorNoteModel[]> {
    return Promise.reject(new Error("Navigator API is not implemented yet."));
  }
  saveAdvisorNote(): Promise<AdvisorNoteModel> {
    return Promise.reject(new Error("Navigator API is not implemented yet."));
  }
  runRecommendationPipeline(): Promise<RecommendationModel[]> {
    return Promise.reject(new Error("Navigator API is not implemented yet."));
  }
  listRecommendations(): Promise<RecommendationModel[]> {
    return Promise.reject(new Error("Navigator API is not implemented yet."));
  }
}
