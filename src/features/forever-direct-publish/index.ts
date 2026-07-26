/**
 * Owner Direct Publish — public module surface
 * (FOREVER-STUDIO-OWNER-DIRECT-PUBLISH-001).
 *
 * Deliberately excludes ./deps.server and ./cli: both read credentials and must
 * be imported explicitly by server/CLI code only, never reachable through a
 * barrel import from application code.
 */

export {
  DEFAULT_MAX_FLOOR_PLANS,
  DEFAULT_MAX_GALLERY,
  isCrossProjectMaterial,
  planPublicMedia,
  publicMediaTypeForCategory,
  type ExcludedMedia,
  type MediaPlan,
  type MediaPlanOptions,
  type PlannedMediaItem,
  type SourceMediaCandidate,
} from "./media-plan";

export { assessPublishability, SLUG_PATTERN, type PublishabilityVerdict } from "./publishability";

export {
  adaptBatchMode,
  detectSanitizableImageType,
  evidencePath,
  projectPagePath,
  PRIVATE_EVIDENCE_BUCKET,
  PUBLIC_IMAGE_BUCKET,
  publicMediaPath,
  publishProject,
  publishProjects,
  type DirectPublishDeps,
  type DirectPublishResult,
  type DirectPublishSummary,
  type DirectPublishWarning,
} from "./publish";

export {
  MAX_MEDIA_FILE_BYTES,
  MAX_PACKAGE_FILES,
  PAYLOAD_CANDIDATE_PATHS,
  readSourcePackage,
  SOURCE_MANIFEST_FILENAME,
  SourcePackageError,
  type SourcePackage,
} from "./source-package";

export {
  assertProductionTarget,
  DIRECT_PUBLISH_TARGET,
  DirectPublishTargetError,
  PRODUCTION_PROJECT_REF,
  projectRefFromUrl,
  STAGING_PROJECT_REF,
  type DirectPublishTarget,
  type VerifiedTarget,
} from "./target";

export {
  AGENT_FACING_SOURCE_LABELS,
  assertDirectPublishAuthorization,
  BLOCKING_SAFETY_WARNING_CODES,
  DIRECT_PUBLISH_ROLES,
  DirectPublishAuthorizationError,
  hasAgentFacingLabel,
  isOwnerRetiredBlocker,
  isPublicationBlocking,
  OWNER_NON_BLOCKING_WARNING_CODES,
  PUBLICATION_MODE,
  SOURCE_TRUST,
  type DirectPublishAuthorization,
  type DirectPublishRole,
} from "./trust";
