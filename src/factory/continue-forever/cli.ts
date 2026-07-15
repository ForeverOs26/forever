import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { ProviderAdapter } from "../execution-connector";
import { AtomicFileLockStore } from "./atomic-lock";
import { continueForever } from "./continue-forever";
import type { ContinueResult, CurrentTaskEnvelope, ExecutionMode } from "./contracts";
import {
  evaluateOperatorTaskObject,
  SourceReadError,
  type OperatorTaskState,
} from "./current-task-resolver";
import { renderFinalReport } from "./report";

/**
 * Continue Forever command entry point (`npm run factory:continue`).
 *
 * The thin, filesystem-bound wrapper around the {@link continueForever}
 * orchestrator. It reads one canonical current-task source, runs the single
 * approved packet through the unchanged router and Execution Connector,
 * persists an auditable durable/atomic lock, and prints one owner-visible final
 * report.
 *
 * Production default is the REAL Claude Code adapter. `--fake` selects the
 * hermetic, TEST_ONLY adapter; the fake is never a silent production default.
 * There is no automatic fallback from live to fake: if the real adapter is
 * unavailable the command fails closed with LIVE_EXECUTION_UNAVAILABLE.
 */

/**
 * Canonical Continue source. This is NOT the Operator canonical task
 * (`.forever-factory/CURRENT_TASK.json`, the Operator v0.1 task schema). Continue
 * needs the richer routing+execution+handoff envelope, so it uses a distinct
 * file; the two are reconciled by Task Packet id and can never silently disagree.
 */
const DEFAULT_SOURCE = ".forever-factory/CONTINUE_TASK.json";
const OPERATOR_TASK_FILE = ".forever-factory/CURRENT_TASK.json";
const DEFAULT_LOCK_FILE = ".forever-factory/state/continue-forever-locks.json";

function printUsage(fake: boolean): void {
  console.log("Continue Forever — execute exactly one approved current Task Packet.");
  console.log("");
  console.log(
    `Active mode for this invocation: ${fake ? "FAKE (hermetic, TEST_ONLY)" : "LIVE (real Claude Code adapter)"}`,
  );
  console.log("");
  console.log("Usage:");
  console.log(
    "  npm run factory:continue                      (LIVE — real Claude Code execution)",
  );
  console.log("  npm run factory:continue -- --fake            (hermetic TEST_ONLY execution)");
  console.log("  npm run factory:continue -- --source=<path>   (default: " + DEFAULT_SOURCE + ")");
  console.log("  npm run factory:continue -- --retry           (explicit retry of a failed run)");
  console.log("  npm run factory:continue -- --recover         (explicit recovery of a stale run)");
  console.log(
    "  npm run factory:continue -- --json            (print the structured report as JSON)",
  );
  console.log("");
  console.log("Fake mode is for tests only and is NOT proof that a real Forever task ran.");
  console.log("It resolves one approved current packet, routes it (FACTORY-A1-001),");
  console.log("executes it (FACTORY-A1-002), prepares the Operator handoff, prints one");
  console.log("final report, and stops. It starts no next task and enables no auto-merge.");
}

/**
 * Read the Continue source strictly. A missing file resolves to no envelopes;
 * an unreadable or malformed file throws {@link SourceReadError}, which the
 * orchestrator maps to a structured CURRENT_TASK_INVALID stop.
 */
function readEnvelopes(sourcePath: string): readonly CurrentTaskEnvelope[] {
  if (!existsSync(sourcePath)) return [];
  let raw: string;
  try {
    raw = readFileSync(sourcePath, "utf8");
  } catch {
    throw new SourceReadError(`Continue source ${sourcePath} is unreadable.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SourceReadError(`Continue source ${sourcePath} is not valid JSON.`);
  }
  if (Array.isArray(parsed)) return parsed as CurrentTaskEnvelope[];
  if (parsed !== null && typeof parsed === "object") return [parsed as CurrentTaskEnvelope];
  throw new SourceReadError(
    `Continue source ${sourcePath} must be an envelope object or an array of envelopes.`,
  );
}

/**
 * Read the Operator canonical task state strictly. Missing → absent; a present
 * file that is unreadable or malformed → invalid (never a silent skip).
 */
function readOperatorTaskState(): OperatorTaskState {
  const path = resolve(OPERATOR_TASK_FILE);
  if (!existsSync(path)) return { status: "absent" };
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { status: "invalid", reason: `${OPERATOR_TASK_FILE} is unreadable.` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid", reason: `${OPERATOR_TASK_FILE} is not valid JSON.` };
  }
  return evaluateOperatorTaskObject(parsed);
}

async function selectAdapter(fake: boolean): Promise<ProviderAdapter> {
  if (fake) {
    const { FakeClaudeAdapter } = await import("../execution-connector");
    return new FakeClaudeAdapter();
  }
  // Real adapter is the production default; it imports node:child_process.
  const [{ ClaudeCodeAdapter }, { createNodeProcessRunner }] = await Promise.all([
    import("../execution-connector/adapters/claude-code-adapter"),
    import("../execution-connector/adapters/node-process-runner"),
  ]);
  return new ClaudeCodeAdapter({ run: createNodeProcessRunner() });
}

/**
 * Live preflight: confirm the real Claude Code binary is resolvable. This checks
 * binary availability only — it does NOT verify authentication. Authentication
 * is confirmed solely by a real execution; a recognized auth/login failure at
 * runtime is mapped to LIVE_EXECUTION_UNAVAILABLE by the orchestrator.
 */
async function probeLiveAvailability(): Promise<{ available: boolean; reason?: string }> {
  const { CLAUDE_CLI_BINARY } = await import("../execution-connector/adapters/claude-code-adapter");
  try {
    const probe = spawnSync(CLAUDE_CLI_BINARY, ["--version"], { timeout: 15_000 });
    if (probe.error) {
      return {
        available: false,
        reason: `${CLAUDE_CLI_BINARY} could not be launched (${probe.error.message}); binary availability only, authentication not verified.`,
      };
    }
    if (typeof probe.status === "number" && probe.status !== 0) {
      return {
        available: false,
        reason: `${CLAUDE_CLI_BINARY} --version exited with status ${probe.status}; binary availability only, authentication not verified.`,
      };
    }
    return { available: true };
  } catch (error) {
    return {
      available: false,
      reason: `Availability probe failed: ${error instanceof Error ? error.message : String(error)}.`,
    };
  }
}

function exitCodeFor(result: ContinueResult): number {
  switch (result.report.finalState) {
    case "handed_off":
    case "succeeded_report_only":
    case "completed_replay":
      return 0;
    default:
      return 1;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fake = args.includes("--fake");
  if (args.includes("--help") || args.includes("-h")) {
    printUsage(fake);
    process.exit(0);
  }

  const option = (name: string): string | undefined =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

  const sourcePath = resolve(option("source") ?? DEFAULT_SOURCE);
  const lockPath = resolve(option("lock-file") ?? DEFAULT_LOCK_FILE);
  const retry = args.includes("--retry");
  const recover = args.includes("--recover");
  const asJson = args.includes("--json");
  const executionMode: ExecutionMode = fake ? "fake" : "live";

  const adapter = await selectAdapter(fake);
  const result = await continueForever({
    source: () => readEnvelopes(sourcePath),
    adapter,
    executionMode,
    operatorTaskState: readOperatorTaskState(),
    probeAvailability: fake ? undefined : probeLiveAvailability,
    lockStore: new AtomicFileLockStore(lockPath),
    retry,
    recover,
  });

  if (asJson) {
    console.log(JSON.stringify(result.report, null, 2));
  } else {
    console.log(renderFinalReport(result.report));
  }
  process.exit(exitCodeFor(result));
}

main().catch((error) => {
  console.error(
    `Continue Forever failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
