import { describe, expect, it } from "vitest";

import { parseWatchInvocation } from "../cli-args";
import { runStamp } from "../run";
import { safeStorageExtension, storedObjectName, versionHash } from "../store";

describe("parseWatchInvocation", () => {
  it("parses the documented owner invocation", () => {
    const parsed = parseWatchInvocation([
      "--channel",
      "@coralinakamala",
      "--export",
      "C:\\forever-incoming\\tg-export\\coralinakamala",
      "--run-at",
      "2026-07-20T10:00:00.000Z",
      "--verbose",
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.options.channel).toBe("@coralinakamala");
    expect(parsed.options.exportDir).toBe("C:\\forever-incoming\\tg-export\\coralinakamala");
    expect(parsed.options.runAt?.toISOString()).toBe("2026-07-20T10:00:00.000Z");
    expect(parsed.options.verbose).toBe(true);
  });

  it("rejects missing/invalid channel, missing export, bad run-at, unknown flags", () => {
    expect(parseWatchInvocation(["--export", "x"]).ok).toBe(false);
    expect(parseWatchInvocation(["--channel", "coralinakamala", "--export", "x"]).ok).toBe(false);
    expect(parseWatchInvocation(["--channel", "@coralinakamala"]).ok).toBe(false);
    expect(
      parseWatchInvocation(["--channel", "@coralinakamala", "--export", "x", "--run-at", "nope"])
        .ok,
    ).toBe(false);
    expect(parseWatchInvocation(["--nope", "x"]).ok).toBe(false);
    expect(parseWatchInvocation(["positional"]).ok).toBe(false);
  });

  it("parses and validates --max-attachment-mb", () => {
    const good = parseWatchInvocation([
      "--channel",
      "@coralinakamala",
      "--export",
      "x",
      "--max-attachment-mb",
      "2048",
    ]);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.options.maxAttachmentBytes).toBe(2048 * 1024 * 1024);
    for (const bad of ["0", "-5", "1.5", "big", "999999"]) {
      expect(
        parseWatchInvocation([
          "--channel",
          "@coralinakamala",
          "--export",
          "x",
          "--max-attachment-mb",
          bad,
        ]).ok,
      ).toBe(false);
    }
  });
});

describe("storage naming primitives", () => {
  it("derives only allowlisted lowercase extensions from published filenames", () => {
    expect(safeStorageExtension("Price List.PDF")).toBe(".pdf");
    expect(safeStorageExtension("photo.jpeg")).toBe(".jpeg");
    expect(safeStorageExtension("evil.pdf.‮gpj")).toBeNull();
    expect(safeStorageExtension("no-extension")).toBeNull();
    expect(safeStorageExtension(null)).toBeNull();
  });

  it("builds content-addressed object names and rejects invalid hashes", () => {
    const sha = "a".repeat(64);
    expect(storedObjectName(sha, ".pdf")).toBe(`${sha}.pdf`);
    expect(storedObjectName(sha, null)).toBe(sha);
    expect(() => storedObjectName("nothex", ".pdf")).toThrow();
  });

  it("hashes version content independently of storage layout", () => {
    const version = {
      posted_at: "2026-07-01T10:00:00",
      edited_at: null,
      text: "hello",
      attachments: [],
    };
    expect(versionHash(version)).toBe(versionHash({ ...version }));
    expect(versionHash(version)).not.toBe(versionHash({ ...version, text: "changed" }));
  });
});

describe("runStamp", () => {
  it("produces a Windows-safe filename stamp", () => {
    expect(runStamp("2026-07-20T10:30:05.123Z")).toBe("2026-07-20T10-30-05Z");
    expect(runStamp("2026-07-20T10:30:05.123Z")).not.toContain(":");
  });
});
