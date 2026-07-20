import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SourceIntegrityError, processWithSourceIntegrity } from "../source-integrity";

describe("SIP source integrity", () => {
  let dir: string;
  let sourcePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sip-source-integrity-"));
    sourcePath = join(dir, "authorized-source.pdf");
    writeFileSync(sourcePath, "original source bytes", "utf8");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("records identical pre/post fingerprints after an unchanged read-only operation", () => {
    const result = processWithSourceIntegrity(sourcePath, () => "read-only result");
    expect(result.before).toEqual(result.after);
    expect(result.value).toBe("read-only result");
  });

  it("fails closed when bytes change without changing source size", () => {
    expect(() =>
      processWithSourceIntegrity(sourcePath, () => {
        writeFileSync(sourcePath, "altered! source bytes", "utf8");
      }),
    ).toThrow(/sip_source_file_changed_during_processing/);
  });

  it("fails closed when source size changes", () => {
    expect(() =>
      processWithSourceIntegrity(sourcePath, () => {
        writeFileSync(sourcePath, "source bytes changed and lengthened", "utf8");
      }),
    ).toThrow(/sip_source_file_changed_during_processing/);
  });

  it("fails closed when the source disappears after preflight", () => {
    expect(() =>
      processWithSourceIntegrity(sourcePath, () => {
        rmSync(sourcePath);
      }),
    ).toThrow(SourceIntegrityError);
    expect(existsSync(sourcePath)).toBe(false);
  });
});
