import { spawn, spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { fingerprintBatch } from "@/features/forever-ingestion/build-batch";

import { validateDraftPayload, validateDraftPayloadFile } from "../validate-draft";

/**
 * TypeScript importer-compatibility guard: the TypeScript validation boundary
 * must NEVER be more permissive than PowerShell -ValidateOnly. It may be
 * stricter (it recomputes the fingerprint from content; PowerShell checks only
 * the format) — a stricter-only asymmetry is recorded in expected.json with a
 * note and is not a parity failure. Complete equality is NOT claimed.
 */

const CORPUS = resolve("src/intake/test-fixtures/validation-corpus");
const PARITY_STARTUP_TIMEOUT_MS = 15_000;
const PARITY_COMPLETION_TIMEOUT_MS = 270_000;
const expected = JSON.parse(readFileSync(join(CORPUS, "expected.json"), "utf8")) as Record<
  string,
  { powershell: "accept" | "reject"; typescript: "accept" | "reject"; note?: string }
>;
const arrayShapes = JSON.parse(readFileSync(join(CORPUS, "array-shapes.json"), "utf8")) as {
  fields: string[];
  shapes: Array<{ name: string; is_array: boolean; value: unknown }>;
};

type LiveHarnessResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  parityStarted: boolean;
};

/**
 * A retry is permitted only for the known Windows process-start contention
 * shape: no exit result, no child output/diagnostics, and no emitted startup
 * marker. A timeout is retryable only before that marker; any result from a
 * child that actually began the parity run is meaningful proof (or meaningful
 * failure) and must be reported directly.
 */
function isRetryableEmptyLiveHarnessResult(
  result: LiveHarnessResult,
  isWindows = process.platform === "win32",
): boolean {
  return (
    isWindows &&
    result.status === null &&
    result.stdout.trim() === "" &&
    result.stderr.trim() === "" &&
    !result.parityStarted
  );
}

function tsVerdict(name: string): "accept" | "reject" {
  try {
    validateDraftPayloadFile(join(CORPUS, `${name}.json`));
    return "accept";
  } catch {
    return "reject";
  }
}

function liveHarnessArguments(executable: string, harness: string): string[] {
  // Windows PowerShell's execution policy is process-scoped here. pwsh on
  // non-Windows receives only arguments it supports; it is not evidence of a
  // Windows execution-policy bypass.
  return process.platform === "win32" && /^powershell(?:\.exe)?$/i.test(executable)
    ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", harness]
    : ["-NoProfile", "-File", harness];
}

describe("Draft validation parity live-harness retry classification", () => {
  const emptyLaunchResult: LiveHarnessResult = {
    status: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    parityStarted: false,
  };

  it("retries only an empty Windows process-start result", () => {
    expect(isRetryableEmptyLiveHarnessResult(emptyLaunchResult, true)).toBe(true);
    expect(isRetryableEmptyLiveHarnessResult({ ...emptyLaunchResult, timedOut: true }, true)).toBe(
      true,
    );
    expect(isRetryableEmptyLiveHarnessResult(emptyLaunchResult, false)).toBe(false);
  });

  it.each([
    ["explicit non-zero exit", { ...emptyLaunchResult, status: 1 }],
    ["marker contradiction", { ...emptyLaunchResult, status: 0, stdout: "DRAFT_PAYLOAD_VALID" }],
    ["PowerShell diagnostic", { ...emptyLaunchResult, stderr: "validation failed" }],
    ["partial case result", { ...emptyLaunchResult, stdout: "case valid-minimal: accept" }],
    [
      "timeout after parity start",
      {
        ...emptyLaunchResult,
        timedOut: true,
        parityStarted: true,
        stdout: "VALIDATION_PARITY_STARTED",
      },
    ],
  ] as const)("does not retry a %s", (_name, result) => {
    expect(isRetryableEmptyLiveHarnessResult(result, true)).toBe(false);
  });
});

describe("Draft validation importer-compatibility (TypeScript vs PowerShell -ValidateOnly)", () => {
  it("has an expected verdict for every corpus payload and vice versa", () => {
    const files = readdirSync(CORPUS)
      .filter((f) => f.endsWith(".json") && !["expected.json", "array-shapes.json"].includes(f))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
    expect(files).toEqual(Object.keys(expected).sort());
  });

  it("documents every stricter-only asymmetry explicitly", () => {
    for (const [name, verdicts] of Object.entries(expected)) {
      if (verdicts.powershell !== verdicts.typescript) {
        // Only the stricter-only direction is permitted, and it must carry a note.
        expect(verdicts.powershell).toBe("accept");
        expect(verdicts.typescript).toBe("reject");
        expect(verdicts.note).toBeTruthy();
      }
    }
  });

  for (const [name, verdicts] of Object.entries(expected)) {
    it(`TypeScript verdict for "${name}" matches the recorded expectation and is never more permissive`, () => {
      const ts = tsVerdict(name);
      expect(ts).toBe(verdicts.typescript);
      // The blocking direction: PowerShell rejects → TypeScript must reject.
      if (verdicts.powershell === "reject") expect(ts).toBe("reject");
    });
  }

  it("uses the shared corpus to preserve every array shape and reject every scalar/null shape", () => {
    const base = JSON.parse(readFileSync(join(CORPUS, "valid-minimal.json"), "utf8")) as Record<
      string,
      unknown
    >;
    for (const field of arrayShapes.fields) {
      for (const shape of arrayShapes.shapes) {
        const payload = structuredClone(base);
        payload[field] = structuredClone(shape.value);
        const { batch_fingerprint: _old, ...body } = payload;
        payload.batch_fingerprint = fingerprintBatch(body as never);
        const shouldAccept = shape.is_array && (field !== "documents" || shape.name === "zero");
        let accepted = true;
        try {
          const result = validateDraftPayload(payload, "array-shape-corpus");
          if (shouldAccept) {
            expect(result.counts[field as keyof typeof result.counts]).toBe(
              (shape.value as unknown[]).length,
            );
          }
        } catch {
          accepted = false;
        }
        expect(accepted, `${field}/${shape.name}`).toBe(shouldAccept);
      }
    }
  });

  it(
    "runs the LIVE PowerShell boundary via the child-process harness when PowerShell is available",
    { timeout: 300_000 },
    async () => {
      const pwsh = (process.platform === "win32" ? ["powershell", "pwsh"] : ["pwsh"]).find(
        (bin) => {
          try {
            return (
              spawnSync(bin, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
                encoding: "utf8",
              }).status === 0
            );
          } catch {
            return false;
          }
        },
      );
      if (!pwsh) {
        console.warn(
          "[validation-parity] PowerShell not available in this environment; the LIVE half did not run. " +
            "Run scripts/import/tests/Compare-DraftValidationParity.ps1 on Windows for the live PowerShell proof.",
        );
        expect(pwsh).toBeUndefined();
        return;
      }
      const harness = resolve("scripts/import/tests/Compare-DraftValidationParity.ps1");
      const args = liveHarnessArguments(pwsh, harness);
      if (process.platform === "win32" && /^powershell(?:\.exe)?$/i.test(pwsh)) {
        expect(args).toEqual(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", harness]);
      } else {
        expect(args).toEqual(["-NoProfile", "-File", harness]);
      }
      const runLiveHarness = () =>
        new Promise<LiveHarnessResult>((complete) => {
          const child = spawn(pwsh, args, {
            windowsHide: true,
          });
          let stdout = "";
          let stderr = "";
          let timedOut = false;
          let parityStarted = false;
          child.stdout.setEncoding("utf8");
          child.stderr.setEncoding("utf8");
          child.stdout.on("data", (chunk: string) => {
            stdout += chunk;
            parityStarted ||= stdout.includes("VALIDATION_PARITY_STARTED");
          });
          child.stderr.on("data", (chunk: string) => {
            stderr += chunk;
          });
          const clearTimers = (): void => {
            clearTimeout(startupTimer);
            clearTimeout(completionTimer);
          };
          // A short, test-only startup bound makes Windows process-start
          // contention observable while preserving the established 270-second
          // complete-parity bound once the child emits its flushed start marker.
          const startupTimer = setTimeout(() => {
            if (parityStarted) return;
            timedOut = true;
            child.kill();
          }, PARITY_STARTUP_TIMEOUT_MS);
          const completionTimer = setTimeout(() => {
            timedOut = true;
            child.kill();
          }, PARITY_COMPLETION_TIMEOUT_MS);
          child.once("close", (status) => {
            clearTimers();
            complete({ status, stdout, stderr, timedOut, parityStarted });
          });
          child.once("error", (error) => {
            clearTimers();
            complete({
              status: null,
              stdout,
              stderr: `${stderr}\n${error.message}`,
              timedOut,
              parityStarted,
            });
          });
        });
      const hasParityProof = (result: LiveHarnessResult) =>
        result.status === 0 && result.stdout.includes("PowerShell validation parity OK");
      const firstResult = await runLiveHarness();
      // Under a saturated Windows full-suite run, a PowerShell child can very
      // occasionally stall before the child script emits its startup marker.
      // Retry only that empty non-proof shape; a validation failure or any
      // timeout after the parity run starts is never retried.
      const attempts = [firstResult];
      if (!hasParityProof(firstResult) && isRetryableEmptyLiveHarnessResult(firstResult)) {
        attempts.push(await runLiveHarness());
      }
      const result = attempts.at(-1)!;
      const outputLines = result.stdout.split(/\r?\n/).filter(Boolean);
      console.log(outputLines.at(-1));
      if (!hasParityProof(result)) {
        console.error(
          `[validation-parity] Live PowerShell proof failed after ${attempts.length} attempt(s).`,
        );
        for (const [attempt, attemptResult] of attempts.entries()) {
          console.error(
            `[validation-parity] attempt ${attempt + 1} status=${attemptResult.status} timedOut=${attemptResult.timedOut} parityStarted=${attemptResult.parityStarted}`,
          );
          console.error(attemptResult.stdout);
          console.error(attemptResult.stderr);
        }
      }
      expect(result.stdout).toContain("PowerShell validation parity OK");
      expect(result.status).toBe(0);
    },
  );
});
