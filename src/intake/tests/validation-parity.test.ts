import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { validateDraftPayloadFile } from "../validate-draft";

const CORPUS = resolve("src/intake/test-fixtures/validation-corpus");
const expected = JSON.parse(readFileSync(join(CORPUS, "expected.json"), "utf8")) as Record<
  string,
  { powershell: "accept" | "reject"; typescript: "accept" | "reject" }
>;

function tsVerdict(name: string): "accept" | "reject" {
  try {
    validateDraftPayloadFile(join(CORPUS, `${name}.json`));
    return "accept";
  } catch {
    return "reject";
  }
}

describe("Draft validation parity (TypeScript vs PowerShell -ValidateOnly)", () => {
  it("has an expected verdict for every corpus payload and vice versa", () => {
    const files = readdirSync(CORPUS)
      .filter((f) => f.endsWith(".json") && f !== "expected.json")
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
    expect(files).toEqual(Object.keys(expected).sort());
  });

  for (const [name, verdicts] of Object.entries(expected)) {
    it(`TypeScript verdict for "${name}" matches the recorded PowerShell boundary`, () => {
      const ts = tsVerdict(name);
      // TypeScript must match its recorded verdict exactly...
      expect(ts).toBe(verdicts.typescript);
      // ...and it must NEVER be more lenient than PowerShell (the blocking case):
      // if PowerShell rejects, TypeScript must reject too.
      if (verdicts.powershell === "reject") expect(ts).toBe("reject");
    });
  }

  it("runs the live PowerShell boundary when pwsh is available (skips with a note otherwise)", () => {
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
        "[validation-parity] PowerShell not available in this environment; skipping the LIVE parity run. " +
          "Run scripts/import/tests/Compare-DraftValidationParity.ps1 on Windows for the live PowerShell half.",
      );
      expect(pwsh).toBeUndefined();
      return;
    }
    const harness = resolve("scripts/import/tests/Compare-DraftValidationParity.ps1");
    const result = spawnSync(pwsh, ["-NoProfile", "-File", harness], { encoding: "utf8" });
    console.log(result.stdout);
    expect(result.status).toBe(0);
  });
});
