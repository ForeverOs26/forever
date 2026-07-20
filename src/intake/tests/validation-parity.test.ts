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
const expected = JSON.parse(readFileSync(join(CORPUS, "expected.json"), "utf8")) as Record<
  string,
  { powershell: "accept" | "reject"; typescript: "accept" | "reject"; note?: string }
>;
const arrayShapes = JSON.parse(readFileSync(join(CORPUS, "array-shapes.json"), "utf8")) as {
  fields: string[];
  shapes: Array<{ name: string; is_array: boolean; value: unknown }>;
};

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
      const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>(
        (complete) => {
          const child = spawn(pwsh, args, {
            windowsHide: true,
          });
          let stdout = "";
          let stderr = "";
          child.stdout.setEncoding("utf8");
          child.stderr.setEncoding("utf8");
          child.stdout.on("data", (chunk: string) => {
            stdout += chunk;
          });
          child.stderr.on("data", (chunk: string) => {
            stderr += chunk;
          });
          const timer = setTimeout(() => child.kill(), 270_000);
          child.once("close", (status) => {
            clearTimeout(timer);
            complete({ status, stdout, stderr });
          });
          child.once("error", (error) => {
            clearTimeout(timer);
            complete({ status: null, stdout, stderr: `${stderr}\n${error.message}` });
          });
        },
      );
      const outputLines = result.stdout.split(/\r?\n/).filter(Boolean);
      console.log(outputLines.at(-1));
      if (result.status !== 0) {
        console.error(result.stdout);
        console.error(result.stderr);
      }
      expect(result.stdout).toContain("PowerShell validation parity OK");
      expect(result.status).toBe(0);
    },
  );
});
