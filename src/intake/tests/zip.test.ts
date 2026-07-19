import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { extractZip, readZipEntries, safeJoinInside, ZipTraversalError } from "../zip";
import { makeZip } from "./zip-writer";

describe("Fast Intake ZIP reader", () => {
  let work: string;
  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), "intake-zip-"));
  });
  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  it("round-trips STORED and DEFLATE entries", () => {
    const zip = makeZip([
      { name: "a.txt", data: "stored-content", method: 0 },
      { name: "nested/b.json", data: '{"k":1}', method: 8 },
      { name: "dir/", directory: true },
    ]);
    const entries = readZipEntries(zip);
    expect(entries.map((entry) => entry.name).sort()).toEqual(["a.txt", "dir/", "nested/b.json"]);

    const dest = join(work, "out");
    const written = extractZip(zip, dest);
    expect(readFileSync(join(dest, "a.txt"), "utf8")).toBe("stored-content");
    expect(readFileSync(join(dest, "nested", "b.json"), "utf8")).toBe('{"k":1}');
    expect(written.map((file) => file.relativePath).sort()).toEqual(["a.txt", "nested/b.json"]);
  });

  it("rejects a parent-traversal entry before writing anything", () => {
    const zip = makeZip([
      { name: "safe.txt", data: "ok" },
      { name: "../escape.txt", data: "evil" },
    ]);
    const dest = join(work, "out");
    expect(() => extractZip(zip, dest)).toThrow(ZipTraversalError);
    // Fail closed: nothing escaped and nothing was written.
    expect(existsSync(join(work, "escape.txt"))).toBe(false);
    expect(existsSync(join(dest, "safe.txt"))).toBe(false);
  });

  it("rejects absolute and drive-letter entry names", () => {
    expect(() => safeJoinInside(work, "/etc/passwd")).toThrow(ZipTraversalError);
    expect(() => safeJoinInside(work, "C:\\Windows\\x")).toThrow(ZipTraversalError);
    expect(() => safeJoinInside(work, "a/../../b")).toThrow(ZipTraversalError);
    // A benign nested path is accepted.
    expect(() => safeJoinInside(work, "a/b/c.txt")).not.toThrow();
  });
});
