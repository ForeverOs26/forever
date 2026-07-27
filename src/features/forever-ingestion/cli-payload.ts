import type { ProgressiveBatch } from "./batch-types";
import { assertProgressiveBatchStructure } from "./batch-types";
import type { BuildBatchInput } from "./build-batch";

export type CliPayload =
  | { kind: "ready"; batch: ProgressiveBatch }
  | { kind: "build"; input: BuildBatchInput };

/** Ready batches are inspection artifacts only; live writes must rebuild. */
export function classifyCliPayload(payload: unknown, dryRun: boolean): CliPayload {
  const ready = Boolean(
    payload &&
      typeof payload === "object" &&
      typeof (payload as Record<string, unknown>).batch_fingerprint === "string",
  );
  if (ready) {
    assertProgressiveBatchStructure(payload);
    if (!dryRun) {
      throw new Error("progressive_ingestion: ready_batch_live_execution_forbidden");
    }
    return { kind: "ready", batch: payload };
  }
  return { kind: "build", input: payload as BuildBatchInput };
}
