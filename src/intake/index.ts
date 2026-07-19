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
  validateDraftPayload,
  validateDraftPayloadFile,
  DraftValidationError,
} from "./validate-draft";
export { runIntake, importCommand } from "./run";
export {
  readZipEntries,
  readZipEntryData,
  extractZip,
  safeJoinInside,
  ZipError,
  ZipTraversalError,
} from "./zip";
