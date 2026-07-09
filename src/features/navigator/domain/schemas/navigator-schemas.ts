import { z } from "zod";

export const navigatorIdSchema = z.string().uuid();
export const isoDateTimeSchema = z.string().datetime();
export const navigatorActorSchema = z.union([
  z.enum(["client", "advisor", "system", "ai"]),
  z.string().min(1),
]);

export const auditFieldsSchema = z.object({
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  createdBy: navigatorActorSchema.optional(),
  updatedBy: navigatorActorSchema.optional(),
});

export const moneyRangeSchema = z.object({
  currency: z.string().length(3),
  min: z.number().nonnegative().optional(),
  max: z.number().nonnegative().optional(),
});

export const sourceReferenceSchema = z.object({
  sourceType: z.enum(["client_answer", "advisor_note", "project_data", "system", "ai_model"]),
  sourceId: navigatorIdSchema.optional(),
  fieldPath: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const clientSchema = auditFieldsSchema.extend({
  id: navigatorIdSchema,
  externalId: z.string().optional(),
  fullName: z.string().min(1),
  contact: z.object({
    email: z.string().email().optional(),
    phone: z.string().optional(),
    preferredContactMethod: z.enum(["email", "phone", "whatsapp", "line", "in_person"]).optional(),
  }),
  lifecycleStage: z.enum(["lead", "qualified", "active", "closed", "inactive"]),
  consentAcceptedAt: isoDateTimeSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const navigatorSessionSchema = auditFieldsSchema.extend({
  id: navigatorIdSchema,
  clientId: navigatorIdSchema,
  status: z.enum(["not_started", "in_progress", "submitted", "advisor_review", "completed"]),
  currentStep: z.enum([
    "navigator",
    "decision_profile",
    "forever_story",
    "decision_desk",
    "recommendations",
  ]),
  startedAt: isoDateTimeSchema.optional(),
  submittedAt: isoDateTimeSchema.optional(),
  completedAt: isoDateTimeSchema.optional(),
  version: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

export const answerValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.record(z.unknown()),
  z.null(),
]);

export const navigatorAnswerSchema = auditFieldsSchema.extend({
  id: navigatorIdSchema,
  sessionId: navigatorIdSchema,
  clientId: navigatorIdSchema,
  questionKey: z.string().min(1),
  moduleKey: z.string().min(1),
  value: answerValueSchema,
  sourceReferences: z.array(sourceReferenceSchema).optional(),
});

export const decisionProfileSchema = auditFieldsSchema.extend({
  id: navigatorIdSchema,
  sessionId: navigatorIdSchema,
  clientId: navigatorIdSchema,
  intent: z.enum([
    "primary_home",
    "second_home",
    "investment",
    "relocation",
    "retirement",
    "mixed",
  ]),
  readiness: z.enum(["exploring", "shortlisting", "ready_to_act", "post_purchase"]),
  riskTolerance: z.enum(["low", "moderate", "high"]),
  budget: moneyRangeSchema.optional(),
  preferredAreas: z.array(z.string()),
  mustHaves: z.array(z.string()),
  dealBreakers: z.array(z.string()),
  sourceReferences: z.array(sourceReferenceSchema),
  version: z.string().min(1),
});

export const foreverStorySectionSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  content: z.string(),
  sourceReferences: z.array(sourceReferenceSchema),
});

export const foreverStorySchema = auditFieldsSchema.extend({
  id: navigatorIdSchema,
  sessionId: navigatorIdSchema,
  clientId: navigatorIdSchema,
  decisionProfileId: navigatorIdSchema,
  sections: z.array(foreverStorySectionSchema),
  status: z.enum(["draft", "advisor_review", "approved", "archived"]),
  generatedBy: z.enum(["system", "advisor", "ai_assisted"]),
  version: z.string().min(1),
});

export const advisorNoteSchema = auditFieldsSchema.extend({
  id: navigatorIdSchema,
  sessionId: navigatorIdSchema,
  clientId: navigatorIdSchema,
  advisorId: navigatorIdSchema,
  title: z.string().optional(),
  body: z.string().min(1),
  visibility: z.enum(["internal", "client_visible"]),
  tags: z.array(z.string()),
});

export const recommendationSchema = auditFieldsSchema.extend({
  id: navigatorIdSchema,
  sessionId: navigatorIdSchema,
  clientId: navigatorIdSchema,
  decisionProfileId: navigatorIdSchema,
  type: z.enum(["project", "area", "strategy", "next_step"]),
  status: z.enum(["candidate", "advisor_review", "approved", "rejected", "presented"]),
  title: z.string().min(1),
  rationale: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  rank: z.number().int().positive().optional(),
  targetId: navigatorIdSchema.optional(),
  sourceReferences: z.array(sourceReferenceSchema),
  pipelineRunId: navigatorIdSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
});
