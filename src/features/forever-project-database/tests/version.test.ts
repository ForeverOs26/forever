import { describe, expect, it } from "vitest";

import {
  compareProjectRecordVersion,
  formatProjectRecordVersion,
  projectRecordVersion,
  validateProjectRecordVersion,
} from "..";

describe("version handling", () => {
  it("builds, formats, and compares through the one reused implementation", () => {
    const version = projectRecordVersion(1, 2, 3);
    expect(version).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(formatProjectRecordVersion(version)).toBe("1.2.3");
    expect(formatProjectRecordVersion(projectRecordVersion(1, 0, 0, "beta"))).toBe("1.0.0-beta");
  });

  it("compares numerically, blind to the optional label", () => {
    expect(
      compareProjectRecordVersion(projectRecordVersion(1, 0, 0), projectRecordVersion(1, 0, 1)),
    ).toBeLessThan(0);
    expect(
      compareProjectRecordVersion(projectRecordVersion(2, 0, 0), projectRecordVersion(1, 9, 9)),
    ).toBeGreaterThan(0);
    expect(
      compareProjectRecordVersion(
        projectRecordVersion(1, 0, 0, "a"),
        projectRecordVersion(1, 0, 0, "b"),
      ),
    ).toBe(0);
  });

  it("validates through the reused guard without throwing", () => {
    expect(validateProjectRecordVersion(projectRecordVersion(1, 0, 0))).toEqual([]);
    const issues = validateProjectRecordVersion({ major: -1, minor: 0.5, patch: NaN } as never);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => issue.severity === "error")).toBe(true);
  });
});
