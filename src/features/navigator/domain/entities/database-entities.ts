import type {
  AdvisorNoteModel,
  ClientModel,
  DecisionProfileModel,
  ForeverStoryModel,
  NavigatorAnswerModel,
  NavigatorSessionModel,
  RecommendationModel,
} from "../models";

export type JsonRecord = Record<string, unknown>;

export interface DatabaseEntity<TDomain> {
  tableName: string;
  primaryKey: "id";
  toDomain(row: JsonRecord): TDomain;
  fromDomain(model: TDomain): JsonRecord;
}

const identityMapper = <TDomain>(): Pick<DatabaseEntity<TDomain>, "toDomain" | "fromDomain"> => ({
  toDomain: (row) => row as TDomain,
  fromDomain: (model) => model as JsonRecord,
});

export const clientEntity: DatabaseEntity<ClientModel> = {
  tableName: "navigator_clients",
  primaryKey: "id",
  ...identityMapper<ClientModel>(),
};

export const navigatorSessionEntity: DatabaseEntity<NavigatorSessionModel> = {
  tableName: "navigator_sessions",
  primaryKey: "id",
  ...identityMapper<NavigatorSessionModel>(),
};

export const navigatorAnswerEntity: DatabaseEntity<NavigatorAnswerModel> = {
  tableName: "navigator_answers",
  primaryKey: "id",
  ...identityMapper<NavigatorAnswerModel>(),
};

export const decisionProfileEntity: DatabaseEntity<DecisionProfileModel> = {
  tableName: "navigator_decision_profiles",
  primaryKey: "id",
  ...identityMapper<DecisionProfileModel>(),
};

export const foreverStoryEntity: DatabaseEntity<ForeverStoryModel> = {
  tableName: "navigator_forever_stories",
  primaryKey: "id",
  ...identityMapper<ForeverStoryModel>(),
};

export const advisorNoteEntity: DatabaseEntity<AdvisorNoteModel> = {
  tableName: "navigator_advisor_notes",
  primaryKey: "id",
  ...identityMapper<AdvisorNoteModel>(),
};

export const recommendationEntity: DatabaseEntity<RecommendationModel> = {
  tableName: "navigator_recommendations",
  primaryKey: "id",
  ...identityMapper<RecommendationModel>(),
};

export const navigatorDatabaseEntities = {
  client: clientEntity,
  navigatorSession: navigatorSessionEntity,
  navigatorAnswer: navigatorAnswerEntity,
  decisionProfile: decisionProfileEntity,
  foreverStory: foreverStoryEntity,
  advisorNote: advisorNoteEntity,
  recommendation: recommendationEntity,
} as const;
