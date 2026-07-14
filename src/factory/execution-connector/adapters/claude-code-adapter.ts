import type {
  AdapterCapability,
  AdapterResult,
  ExecutionRequest,
  ExpectedResultFormat,
  ProviderAdapter,
} from "../contracts";
import type { EffortLevel } from "../../routing-table";
import { redactEvidence, redactSecrets } from "../redaction";

/**
 * Real adapter for the officially supported Claude Code non-interactive
 * interface (`claude --print`), confirmed available in the environment
 * (Claude Code CLI 2.x). It selects the exact provider model and effort, never
 * enables a fallback model, and captures a redacted, provider-neutral result.
 *
 * The command construction is a pure, unit-tested function; the actual process
 * launch is an injected {@link ProcessRunner}, so the tested code path performs
 * no I/O and no network access. A concrete node runner lives in
 * `node-process-runner.ts` and is used only for gated live proving.
 */

export interface ProcessRunResult {
  /** Process exit code, or null if the process was killed (e.g. timeout). */
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export type ProcessRunner = (
  argv: readonly string[],
  opts: { readonly cwd: string; readonly timeoutMs: number },
) => Promise<ProcessRunResult>;

export const CLAUDE_CLI_BINARY = "claude";

const READ_ONLY_TOOLS = "Read,Grep,Glob";
const PATCH_TOOLS = "Read,Grep,Glob,Edit,Write";

/** Read-only "report" work runs in plan mode; change-producing work accepts edits. */
function permissionModeFor(format: ExpectedResultFormat): string {
  return format === "report" ? "plan" : "acceptEdits";
}

function toolsFor(format: ExpectedResultFormat): string {
  return format === "report" ? READ_ONLY_TOOLS : PATCH_TOOLS;
}

/**
 * Deterministic guardrail system prompt embedding the packet's scope, forbidden
 * actions, and stop condition. It never contains credentials.
 */
export function buildGuardrailPrompt(request: ExecutionRequest): string {
  const lines = [
    `You are executing Forever Factory Task Packet ${request.taskPacketId} (run ${request.runId}).`,
    `Model tier: ${request.tier}. Selected model: ${request.model}. Selected effort: ${request.effort}.`,
    `Allowed scope (do not modify anything outside these paths): ${request.allowedScope.join(", ") || "(none)"}.`,
    `Forbidden actions: ${request.forbiddenActions.join("; ") || "(none)"}.`,
    "Do not merge, push, open a pull request, or start any other Task Packet.",
    `Stop condition: ${request.stopCondition}`,
    `Expected result format: ${request.expectedResultFormat}.`,
  ];
  return lines.join("\n");
}

/**
 * Pure builder of the `claude` argument vector. Asserts the exact selected
 * model and effort are passed through unchanged, structured JSON output is
 * requested, and no fallback model is ever configured.
 */
export function buildClaudeArgs(request: ExecutionRequest): string[] {
  return [
    "--print",
    "--model",
    request.providerModel,
    "--effort",
    request.effort,
    "--output-format",
    "json",
    "--permission-mode",
    permissionModeFor(request.expectedResultFormat),
    "--tools",
    toolsFor(request.expectedResultFormat),
    "--no-session-persistence",
    "--append-system-prompt",
    buildGuardrailPrompt(request),
    request.prompt,
  ];
}

/** Subset of the `claude --output-format json` envelope the adapter consumes. */
interface ClaudeResultEnvelope {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
}

function parseEnvelope(stdout: string): ClaudeResultEnvelope | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as ClaudeResultEnvelope;
  } catch {
    // Fall back to the last JSON object line if extra output was interleaved.
    const lines = trimmed.split(/\r?\n/).reverse();
    for (const line of lines) {
      if (line.startsWith("{") && line.endsWith("}")) {
        try {
          return JSON.parse(line) as ClaudeResultEnvelope;
        } catch {
          // keep scanning
        }
      }
    }
    return null;
  }
}

export interface ClaudeCodeAdapterOptions {
  readonly run: ProcessRunner;
  readonly capability?: AdapterCapability;
}

const DEFAULT_CAPABILITY: AdapterCapability = {
  name: "claude-code-cli",
  supportedModels: ["claude-sonnet-5", "claude-opus-4-8", "claude-fable-5"],
  // The CLI accepts every router effort level, so each maps 1:1.
  supportedEfforts: ["low", "medium", "high", "xhigh", "max"] satisfies EffortLevel[],
};

export class ClaudeCodeAdapter implements ProviderAdapter {
  readonly capability: AdapterCapability;
  private readonly run: ProcessRunner;

  constructor(options: ClaudeCodeAdapterOptions) {
    this.run = options.run;
    this.capability = options.capability ?? DEFAULT_CAPABILITY;
  }

  async execute(request: ExecutionRequest): Promise<AdapterResult> {
    // Provider-neutral id derived from the run; never the provider session id.
    const providerExecutionId = `claude-code-${request.runId}`;
    const argv = buildClaudeArgs(request);

    let outcome: ProcessRunResult;
    try {
      outcome = await this.run(argv, {
        cwd: request.workingDirectory,
        timeoutMs: request.timeoutMs,
      });
    } catch (error) {
      return {
        status: "failed",
        providerExecutionId,
        exitStatus: 1,
        failureClass: "environment",
        message: redactSecrets(
          `Claude Code process could not be launched: ${error instanceof Error ? error.message : String(error)}`,
        ),
      };
    }

    if (outcome.timedOut) {
      return {
        status: "failed",
        providerExecutionId,
        exitStatus: "timeout",
        failureClass: "timeout",
        message: `Claude Code execution exceeded ${request.timeoutMs}ms and was terminated.`,
      };
    }

    const envelope = parseEnvelope(outcome.stdout);
    const succeeded =
      outcome.exitCode === 0 &&
      envelope !== null &&
      envelope.type === "result" &&
      envelope.subtype === "success" &&
      envelope.is_error !== true;

    if (!succeeded) {
      return {
        status: "failed",
        providerExecutionId,
        exitStatus: outcome.exitCode ?? 1,
        failureClass: "provider",
        message: redactSecrets(
          envelope?.result
            ? `Claude Code reported a non-success result: ${envelope.result}`
            : `Claude Code exited with status ${outcome.exitCode ?? "unknown"}.`,
        ),
        rawEvidence: redactEvidence(outcome.stderr),
      };
    }

    const patchPath =
      request.expectedResultFormat === "report" ? undefined : `inbox/${request.runId}.patch`;
    return {
      status: "succeeded",
      providerExecutionId,
      exitStatus: 0,
      resultSummary: redactEvidence(envelope.result ?? "Execution completed.", 1000),
      patchPath,
    };
  }
}
