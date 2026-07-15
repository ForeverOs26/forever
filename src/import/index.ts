export { createDatabaseLayer } from "./database";
export { loadExtractedDatasets } from "./datasets";
export type {
  BuildingInput,
  DatabaseLayer,
  DeveloperRecord,
  LocationRecord,
  PriceHistoryInput,
  ProjectRecord,
  UnitInput,
} from "./database";
export { importProject } from "./importer";
export type { ImportProjectOptions } from "./importer";
export {
  assertReadOnlyReader,
  createCollisionInspectionReader,
  createSupabaseCollisionInspectionReader,
  resolvePublishableReadCredentials,
  COLLISION_READER_METHODS,
  COLLISION_READ_BATCH_SIZE,
} from "./collision-reader";
export type {
  CollisionInspectionReader,
  SupabaseReadClient,
  TargetProjectRow,
  TargetDeveloperRow,
  TargetLocationRow,
  TargetBuildingRow,
  TargetUnitRow,
  TargetPriceHistoryRow,
} from "./collision-reader";
export {
  inspectPlanCollisions,
  fingerprintCollisionReport,
  validateImportOperationSet,
  comparePersistedEntityFields,
  COLLISION_CLASSIFICATIONS,
  COLLISION_REPORT_SCHEMA_VERSION,
  IMPORT_ENTITY_EXECUTION_ORDER,
  SUPPORTED_COLLISION_ENTITIES,
} from "./collision-inspector";
export {
  createLiveTransactionRunner,
  sanitizeExecutionReason,
  isExecutionReasonCode,
  EXECUTION_REASON_CODES,
  ExecutionFailure,
} from "./execution-adapter";
export type { ExecutionReasonCode } from "./execution-adapter";
export type {
  ImportExecutionTransaction,
  ImportTransactionRunner,
  TransactionOutcome,
  WrittenRowRef,
  DependencyRow,
  ProjectWriteRow,
  BuildingWriteRow,
  UnitWriteRow,
  PriceHistoryWriteRow,
} from "./execution-adapter";
export {
  validateExecutionApproval,
  safeApprovalId,
  computeApprovalDigest,
  InMemoryApprovalRegistry,
  APPROVAL_ID_PATTERN,
  APPROVAL_DIGEST_DOMAIN,
  EXECUTION_APPROVAL_SCHEMA_VERSION,
  EXECUTION_APPROVAL_MAX_LIFETIME_MS,
} from "./execution-approval";
export type {
  ImportExecutionApproval,
  ExecutionApprovalScope,
  ApprovalRegistry,
  ApprovalFailureCode,
  ApprovalValidationResult,
} from "./execution-approval";
export {
  executeApprovedImportPlan,
  validateExecutionOrdering,
  EXECUTION_RECEIPT_SCHEMA_VERSION,
  LIVE_EXECUTION_ENABLED,
} from "./transaction-executor";
export type {
  ExecuteApprovedImportInput,
  ExecutionOutcome,
  ImportExecutionReceipt,
} from "./transaction-executor";
export type {
  CollisionClassification,
  CollisionFinding,
  CollisionInspectionReport,
  CollisionInspectionStatus,
  InspectPlanCollisionsInput,
} from "./collision-inspector";
export {
  buildingPersistenceProjection,
  canonicalJson,
  canonicalJsonString,
  developerNaturalKey,
  locationNaturalKey,
  priceHistoryPersistenceProjection,
  projectPersistenceProjection,
  slugify,
  unitPersistenceProjection,
} from "./persistence-projection";
export type { ProjectManifestFields, ProjectForeignKeys } from "./persistence-projection";
export { validateImportPlanRelationships } from "./plan-validator";
export { createImportPlan } from "./planner";
export { createRollbackPlan, rollbackImport } from "./rollback";
export { getImportStateMachine, transitionImportState } from "./state-machine";
export type {
  ExtractedDatasets,
  ExtractedPriceList,
  ExtractedPriceListRow,
  ExtractedUnitPlanRow,
  ExtractedUnitPlans,
  Fact,
  ImportEntityType,
  ImportExecutionContext,
  ImportExecutionResult,
  ImportMode,
  ImportOperation,
  ImportOperationAction,
  ImportPlan,
  ImportState,
  RollbackPlan,
  RollbackStep,
} from "./types";
export {
  FOREVER_PROJECTS_ROOT,
  getManifestPath,
  getProjectRoot,
  loadManifest,
  SUPPORTED_MANIFEST_VERSIONS,
  validateManifestShape,
} from "./manifest";
export type { ForeverManifest, ForeverManifestAsset } from "./manifest";
export { validateProjectImport } from "./validator";
export type { ProjectValidationReport, ValidationIssue } from "./validator";
