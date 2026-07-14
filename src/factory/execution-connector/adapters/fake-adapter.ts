import type {
  AdapterCapability,
  AdapterResult,
  ExecutionRequest,
  ProviderAdapter,
} from "../contracts";
import type { EffortLevel } from "../../routing-table";

/**
 * Hermetic fake Claude adapter for deterministic tests and the full proving
 * cycle. It performs no I/O, no network access, and no randomness: it records
 * the exact request it received and returns a scripted, deterministic outcome.
 * It never selects a model or effort of its own — the request drives it.
 */

export type FakeOutcome =
  | { kind: "succeed"; resultSummary?: string; patchPath?: string; rawEvidence?: string }
  | {
      kind: "fail";
      failureClass?: "provider" | "environment" | "capability";
      message?: string;
      rawEvidence?: string;
    }
  | { kind: "timeout"; message?: string };

export interface FakeAdapterOptions {
  readonly capability?: AdapterCapability;
  readonly outcome?: FakeOutcome;
}

const DEFAULT_CAPABILITY: AdapterCapability = {
  name: "fake-claude",
  supportedModels: ["claude-sonnet-5", "claude-opus-4-8", "claude-fable-5"],
  supportedEfforts: ["low", "medium", "high", "xhigh", "max"] satisfies EffortLevel[],
};

/**
 * A deterministic in-memory adapter. `requests` exposes every request it was
 * asked to execute, so tests can assert that the exact selected model and
 * effort reached the adapter unchanged, and that a deduplicated run never
 * reaches the adapter a second time.
 */
export class FakeClaudeAdapter implements ProviderAdapter {
  readonly capability: AdapterCapability;
  readonly requests: ExecutionRequest[] = [];
  private readonly outcome: FakeOutcome;

  constructor(options: FakeAdapterOptions = {}) {
    this.capability = options.capability ?? DEFAULT_CAPABILITY;
    this.outcome = options.outcome ?? { kind: "succeed" };
  }

  get executeCount(): number {
    return this.requests.length;
  }

  execute(request: ExecutionRequest): Promise<AdapterResult> {
    this.requests.push(request);
    const providerExecutionId = `fake-exec-${request.runId}`;

    if (this.outcome.kind === "timeout") {
      return Promise.resolve({
        status: "failed",
        providerExecutionId,
        exitStatus: "timeout",
        failureClass: "timeout",
        message:
          this.outcome.message ?? `Execution exceeded ${request.timeoutMs}ms and was terminated.`,
      });
    }

    if (this.outcome.kind === "fail") {
      return Promise.resolve({
        status: "failed",
        providerExecutionId,
        exitStatus: 1,
        failureClass: this.outcome.failureClass ?? "provider",
        message: this.outcome.message ?? "Fake provider execution failed.",
        rawEvidence: this.outcome.rawEvidence,
      });
    }

    const patchPath =
      this.outcome.patchPath ??
      (request.expectedResultFormat === "report" ? undefined : `inbox/${request.runId}.patch`);
    return Promise.resolve({
      status: "succeeded",
      providerExecutionId,
      exitStatus: 0,
      resultSummary:
        this.outcome.resultSummary ??
        `Fake ${request.providerModel} [${request.effort}] produced the requested ${request.expectedResultFormat}.`,
      patchPath,
      rawEvidence: this.outcome.rawEvidence,
    });
  }
}
