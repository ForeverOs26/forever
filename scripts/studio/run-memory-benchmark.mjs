#!/usr/bin/env node
/**
 * FOREVER-STUDIO-LARGE-ARCHIVE-001 — processing-only memory benchmark runner.
 *
 * Launches the disk-backed large-archive benchmark in a CHILD process (the
 * vitest forks pool) with --expose-gc so baselines are taken after forced
 * garbage collection, then extracts and prints the structured measurement the
 * benchmark emits. This is the measurement of record for the implementation
 * report; the in-suite memory test remains a fast regression guard.
 *
 * Usage: node scripts/studio/run-memory-benchmark.mjs
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";

const TEST_FILE = "src/features/forever-studio/tests/large-archive-memory-benchmark.test.ts";

const result = spawnSync(
  process.execPath,
  [join(process.cwd(), "node_modules", "vitest", "vitest.mjs"), "run", TEST_FILE, "--pool=forks"],
  {
    env: {
      ...process.env,
      FOREVER_MEMORY_BENCHMARK: "1",
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --expose-gc`.trim(),
    },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  },
);

const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
process.stdout.write(output);

const line = output
  .split("\n")
  .find((candidate) => candidate.includes("[large-archive-benchmark]"));
if (result.status !== 0) {
  console.error("\nBenchmark run FAILED (see vitest output above).");
  process.exit(result.status ?? 1);
}
if (!line) {
  console.error("\nBenchmark completed but no measurement line was emitted.");
  process.exit(1);
}

const payload = JSON.parse(line.slice(line.indexOf("{")));
console.log("\n=== large-archive processing-only memory benchmark ===");
console.log(JSON.stringify(payload, null, 2));
if (!payload.gcForced) {
  console.warn(
    "WARNING: gc was not exposed in the child process; figures include GC timing noise.",
  );
}
