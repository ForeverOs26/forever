import { describe, expect, it } from "vitest";

import { parseIntakeInvocation } from "../cli-args";

describe("Fast Intake CLI argument parsing", () => {
  it("parses slug, name, and one source", () => {
    const result = parseIntakeInvocation([
      "--project",
      "marina-bay",
      "--name",
      "Marina Bay",
      "--source",
      "/incoming/marina",
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.options).toMatchObject({
      projectSlug: "marina-bay",
      projectName: "Marina Bay",
      sources: ["/incoming/marina"],
      verbose: false,
    });
  });

  it("collects multiple --source paths, including paths with spaces", () => {
    const result = parseIntakeInvocation([
      "--project",
      "marina-bay",
      "--name",
      "Marina Bay",
      "--source",
      "C:\\forever incoming\\Marina Bay",
      "--source",
      "C:\\forever incoming\\price list.zip",
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.options.sources).toEqual([
      "C:\\forever incoming\\Marina Bay",
      "C:\\forever incoming\\price list.zip",
    ]);
  });

  it("supports --flag=value form and --verbose", () => {
    const result = parseIntakeInvocation([
      "--project=marina-bay",
      "--name=Marina Bay",
      "--source=/a",
      "--verbose",
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.options.verbose).toBe(true);
    expect(result.options.projectName).toBe("Marina Bay");
  });

  it("requires slug, name, and at least one source", () => {
    expect(parseIntakeInvocation([]).ok).toBe(false);
    expect(parseIntakeInvocation(["--project", "x"]).ok).toBe(false);
    expect(parseIntakeInvocation(["--project", "x", "--name", "X"]).ok).toBe(false);
  });

  it("rejects a non-lowercase slug and unknown flags", () => {
    expect(parseIntakeInvocation(["--project", "Marina", "--name", "M", "--source", "/a"]).ok).toBe(
      false,
    );
    expect(
      parseIntakeInvocation(["--project", "m", "--name", "M", "--source", "/a", "--nope"]).ok,
    ).toBe(false);
  });

  it("validates --target-seconds", () => {
    const bad = parseIntakeInvocation([
      "--project",
      "m",
      "--name",
      "M",
      "--source",
      "/a",
      "--target-seconds",
      "-3",
    ]);
    expect(bad.ok).toBe(false);
    const good = parseIntakeInvocation([
      "--project",
      "m",
      "--name",
      "M",
      "--source",
      "/a",
      "--target-seconds",
      "120",
    ]);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.options.targetSeconds).toBe(120);
  });
});
