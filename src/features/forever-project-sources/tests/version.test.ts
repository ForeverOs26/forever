import { describe, expect, it } from "vitest";

import {
  compareSourceVersion,
  formatSourceVersion,
  sourceVersion,
} from "@/features/forever-source-registry";

import {
  compareProjectSourceVersion,
  formatProjectSourceVersion,
  latestProjectSourceVersion,
  projectSourceVersion,
} from "..";

describe("version reuse", () => {
  it("is the RC3.3 version machinery verbatim — one implementation, no drift", () => {
    expect(projectSourceVersion).toBe(sourceVersion);
    expect(formatProjectSourceVersion).toBe(formatSourceVersion);
    expect(compareProjectSourceVersion).toBe(compareSourceVersion);
    expect(formatProjectSourceVersion(projectSourceVersion(1, 2, 3, "draft"))).toBe("1.2.3-draft");
  });
});

describe("latestProjectSourceVersion", () => {
  it("returns undefined for an empty list and the highest revision otherwise", () => {
    expect(latestProjectSourceVersion([])).toBeUndefined();
    const latest = latestProjectSourceVersion([
      projectSourceVersion(1, 0, 0),
      projectSourceVersion(2, 1, 0),
      projectSourceVersion(2, 0, 5),
    ]);
    expect(latest).toEqual(projectSourceVersion(2, 1, 0));
  });

  it("resolves ties to the earliest occurrence and never mutates the input", () => {
    const first = projectSourceVersion(1, 0, 0, "first");
    const second = projectSourceVersion(1, 0, 0, "second");
    const versions = [first, second];
    expect(latestProjectSourceVersion(versions)).toBe(first);
    expect(versions).toEqual([first, second]);
  });
});
