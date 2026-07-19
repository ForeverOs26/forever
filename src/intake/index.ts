/**
 * Fast Intake v1 — owner-only local tooling surface.
 *
 * These are preparation-and-validation entry points. `cli.ts` is the executable
 * entry and is deliberately NOT re-exported: nothing in the web application
 * graph may import Fast Intake. It never creates a database client, never
 * touches the network, and never publishes.
 */

export * from "./types";
export { parseIntakeInvocation } from "./cli-args";
export { classifyPath, supportFor } from "./classify";
export { buildInventory } from "./inventory";
export { extractStructured } from "./extract";
export { normalizeToBatch } from "./normalize";
export {
  sanitizePriceList,
  usableIntakeFact,
  isUsableFactValue,
  isUsableConfidence,
  isUsableCountry,
  isValidIsoDate,
  isSentinelValue,
  parsePositivePrice,
  SUPPORTED_CURRENCIES,
  IntakeConflictError,
} from "./sanitize";
export {
  assertSafeSlug,
  assertPathBoundaries,
  isStrictlyInside,
  isSamePath,
  isFilesystemRoot,
  removeManagedDir,
  IntakePathError,
} from "./paths";
export {
  validateDraftPayload,
  validateDraftPayloadFile,
  DraftValidationError,
} from "./validate-draft";
export {
  runIntake,
  importCommand,
  classifyReadiness,
  SUBSTANTIVE_WARNING_CODES,
  IntakeLockError,
} from "./run";
export {
  commitArtifacts,
  reconcileProject,
  generationComplete,
  readJournal,
  journalPath,
  acquireProjectLock,
  releaseProjectLock,
  IntakeRecoveryError,
  IntakeCrashSimulation,
  JOURNAL_FILENAME,
  LOCK_DIRNAME,
  STALE_LOCK_MS,
} from "./txn";
export {
  readZipEntries,
  readZipEntryData,
  extractZip,
  safeJoinInside,
  assertSafeEntryName,
  DEFAULT_ZIP_LIMITS,
  ZipError,
  ZipTraversalError,
  ZipLimitError,
  ZipUnsupportedError,
  ZipIntegrityError,
  ZipCollisionError,
} from "./zip";
