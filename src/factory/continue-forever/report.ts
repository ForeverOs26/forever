import type { ConnectorArtifact } from "../execution-connector";
import { redactSecrets } from "../execution-connector";
import {
  HERMETIC_TEST_MARKER,
  type ArtifactLocation,
  type ContinueFinalState,
  type ContinueStopCode,
  type ExecutionMode,
  type FinalReport,
  type PublishingDecision,
} from "./contracts";

/**
 * Owner-visible final report builder for Continue Forever.
 *
 * Exactly one structured report is produced per invocation. Every free-text
 * field is either static command text or already-redacted connector output, so
 * credentials, provider session ids, cookies, tokens, and private URLs never
 * appear. The report always confirms that no next task was started and that
 * automatic merge is disabled.
 */

const NO_MODEL = "not selected";

/** Describe the publishing decision in one owner-facing line. */
function describePublishing(decision: PublishingDecision): string {
  switch (decision.mode) {
    case "prepare-only":
      return `Publishing not requested; handoff prepared only. ${decision.reason}`;
    case "authorized-prepared":
      return (
        `Publishing explicitly authorized (${decision.actions.join(", ")}; record: ` +
        `${redactSecrets(decision.authorizationRecord)}). Handoff prepared for the authorized ` +
        `Operator run; this command performs no Git action itself.`
      );
    case "blocked":
      return (
        `Publishing requested (${decision.requested.join(", ")}) without explicit authorization; ` +
        `blocked with OWNER_APPROVAL_REQUIRED. ${decision.reason}`
      );
  }
}

/** Build the structured final report for a run that reached the connector. */
export function buildFinalReport(params: {
  readonly finalState: ContinueFinalState;
  readonly stopCode: ContinueStopCode | null;
  readonly artifact: ConnectorArtifact;
  readonly missionTitle: string;
  readonly executionMode: ExecutionMode;
  readonly publishing: PublishingDecision;
  readonly auditNotes: readonly string[];
}): FinalReport {
  const { artifact, finalState, stopCode, missionTitle, executionMode, publishing, auditNotes } =
    params;
  const capture = artifact.capture;
  // A fake run is always visibly marked so it can never be mistaken for live.
  const modeMarker = executionMode === "fake" ? `${HERMETIC_TEST_MARKER} ` : "";
  const auditSuffix = auditNotes.length > 0 ? ` [audit: ${auditNotes.join(" ")}]` : "";

  const location: ArtifactLocation | null =
    artifact.handoff || capture.patchPath || capture.worktreePath
      ? {
          branchName: artifact.handoff?.operatorTask.branchName ?? null,
          worktreePath: capture.worktreePath,
          patchPath: capture.patchPath ?? artifact.handoff?.operatorTask.patchPath ?? null,
        }
      : null;

  const blockers: string[] = [];
  if (artifact.blocked) blockers.push(...artifact.blocked.reasons);
  if (capture.failure) blockers.push(`Execution failure: ${capture.failure.message}`);
  if (publishing.mode === "blocked") blockers.push(publishing.reason);

  const operatorHandoffStatus = artifact.handoff
    ? "prepared: Operator-compatible v0.1 handoff ready (automatic merge disabled)."
    : finalState === "succeeded_report_only"
      ? "not applicable: report-only execution produced no patch to hand off."
      : capture.validationInstructions?.startsWith("Operator handoff rejected")
        ? capture.validationInstructions
        : "not produced.";

  const ownerApprovalAction =
    publishing.mode === "blocked"
      ? `OWNER_APPROVAL_REQUIRED before any ${publishing.requested.join(", ")}; ` +
        `re-run only after the Owner records explicit publishing authorization.`
      : stopCode
        ? `Owner review required to resolve ${stopCode}.`
        : artifact.handoff
          ? "Owner review of the prepared Operator handoff before any Operator run."
          : null;

  return {
    taskPacketId: artifact.taskPacketId,
    missionTitle,
    finalState,
    stopCode,
    executionMode,
    selectedModel: capture.selectedModel,
    selectedEffort: capture.selectedEffort,
    selectedTier: capture.selectedTier,
    modelSelectionReasons: artifact.selectionReasons,
    executionResult:
      modeMarker +
      redactSecrets(
        capture.resultSummary || artifact.ownerReport || "No execution result captured.",
      ) +
      auditSuffix,
    operatorHandoffStatus,
    validationGateStatus: artifact.handoff
      ? `handoff validation profile: ${artifact.handoff.operatorTask.validationProfile}; ` +
        `mode: ${artifact.handoff.validationInstructions.mode}; gates run by the Operator, not this command.`
      : "no handoff gates prepared.",
    artifactLocation: location,
    publishingState: describePublishing(publishing),
    blockers,
    ownerApprovalAction,
    nextTaskStarted: false,
    automaticMerge: false,
    connectorArtifact: artifact,
  };
}

/** Build the structured final report for a fail-closed stop before the connector. */
export function buildStopReport(params: {
  readonly stopCode: ContinueStopCode;
  readonly reasons: readonly string[];
  readonly taskPacketId: string;
  readonly missionTitle: string;
  readonly executionMode: ExecutionMode;
  readonly ownerApprovalAction?: string;
}): FinalReport {
  return {
    taskPacketId: params.taskPacketId,
    missionTitle: params.missionTitle,
    finalState: "blocked",
    stopCode: params.stopCode,
    executionMode: params.executionMode,
    selectedModel: null,
    selectedEffort: null,
    selectedTier: null,
    modelSelectionReasons: [],
    executionResult: "No execution occurred; the command stopped before invoking any model.",
    operatorHandoffStatus: "not produced.",
    validationGateStatus: "no handoff gates prepared.",
    artifactLocation: null,
    publishingState: "No publishing performed or prepared.",
    blockers: params.reasons.map((reason) => redactSecrets(reason)),
    ownerApprovalAction:
      params.ownerApprovalAction ?? `Owner action required to resolve ${params.stopCode}.`,
    nextTaskStarted: false,
    automaticMerge: false,
    connectorArtifact: null,
  };
}

/** Render the concise human-readable form of a final report. */
export function renderFinalReport(report: FinalReport): string {
  const lines: string[] = [
    "Continue Forever — final report",
    "===============================",
    `Task Packet:        ${report.taskPacketId}`,
    `Mission:            ${report.missionTitle}`,
    `Final state:        ${report.finalState}${report.stopCode ? ` (${report.stopCode})` : ""}`,
    `Execution mode:     ${
      report.executionMode === "fake"
        ? `fake — ${HERMETIC_TEST_MARKER}`
        : "live (real Claude Code adapter)"
    }`,
    `Selected model:     ${report.selectedModel ?? NO_MODEL}`,
    `Selected effort:    ${report.selectedEffort ?? NO_MODEL}`,
    `Selection reasons:  ${
      report.modelSelectionReasons.length > 0 ? report.modelSelectionReasons.join("; ") : "n/a"
    }`,
    `Execution result:   ${report.executionResult}`,
    `Operator handoff:   ${report.operatorHandoffStatus}`,
    `Validation/gates:   ${report.validationGateStatus}`,
  ];

  if (report.artifactLocation) {
    lines.push(
      `Artifact location:  branch=${report.artifactLocation.branchName ?? "n/a"} ` +
        `worktree=${report.artifactLocation.worktreePath ?? "n/a"} ` +
        `patch=${report.artifactLocation.patchPath ?? "n/a"}`,
    );
  }

  lines.push(
    `Publishing:         ${report.publishingState}`,
    `Commit/PR state:    none produced by this command (Operator is the Owner's subsequent step).`,
    `Blockers:           ${report.blockers.length > 0 ? report.blockers.join("; ") : "none"}`,
    `Owner approval:     ${report.ownerApprovalAction ?? "none"}`,
    `Automatic merge:    disabled (structurally impossible).`,
    `Next task started:  no — Continue Forever executes exactly one current packet and stops.`,
  );

  return lines.join("\n");
}
