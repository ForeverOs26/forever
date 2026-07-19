import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { validateDraftPayloadFile } from "../validate-draft";

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

function tsVerdict(name: string): "accept" | "reject" {
  try {
    validateDraftPayloadFile(join(CORPUS, `${name}.json`));
    return "accept";
  } catch {
    return "reject";
  }
}

describe("Draft validation importer-compatibility (TypeScript vs PowerShell -ValidateOnly)", () => {
  it("has an expected verdict for every corpus payload and vice versa", () => {
    const files = readdirSync(CORPUS)
      .filter((f) => f.endsWith(".json") && f !== "expected.json")
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

  it(
    "runs the LIVE PowerShell boundary via the child-process harness when PowerShell is available",
    { timeout: 180_000 },
    () => {
      const pwsh = ["pwsh", "powershell"].find((bin) => {
        try {
          return (
            spawnSync(bin, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
              encoding: "utf8",
            }).status === 0
          );
        } catch {
          return false;
        }
      });
      if (!pwsh) {
        console.warn(
          "[validation-parity] PowerShell not available in this environment; the LIVE half did not run. " +
            "Run scripts/import/tests/Compare-DraftValidationParity.ps1 on Windows for the live PowerShell proof.",
        );
        expect(pwsh).toBeUndefined();
        return;
      }
      const harness = resolve("scripts/import/tests/Compare-DraftValidationParity.ps1");
      const result = spawnSync(pwsh, ["-NoProfile", "-File", harness], {
        encoding: "utf8",
        timeout: 150_000,
      });
      console.log(result.stdout);
      if (result.status !== 0) console.error(result.stderr);
      expect(result.stdout).toContain("PowerShell validation parity OK");
      expect(result.status).toBe(0);
    },
  );
});
