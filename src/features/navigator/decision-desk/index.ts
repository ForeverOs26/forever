import type {
  AdvisorNoteModel,
  ForeverStoryModel,
  NavigatorId,
  RecommendationModel,
} from "../domain/models";

export interface DecisionDeskSnapshot {
  sessionId: NavigatorId;
  clientId: NavigatorId;
  foreverStory?: ForeverStoryModel;
  advisorNotes: AdvisorNoteModel[];
  recommendations: RecommendationModel[];
}

export interface DecisionDeskRepository {
  getSnapshot(sessionId: NavigatorId): Promise<DecisionDeskSnapshot>;
  addAdvisorNote(
    note: Omit<AdvisorNoteModel, "id" | "createdAt" | "updatedAt">,
  ): Promise<AdvisorNoteModel>;
}
