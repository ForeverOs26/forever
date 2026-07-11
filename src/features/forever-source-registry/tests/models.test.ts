import { describe, expect, it } from "vitest";

import {
  compareSourcePriority,
  compareSourceTrust,
  formatSourceVersion,
  hasSourceCapability,
  isHigherPriority,
  isTerminalLifecycle,
  isUsableStatus,
  meetsTrustLevel,
  sourceCapability,
  sourcePriorityRank,
  sourceTrustRank,
  sourceVersion,
  supportedCapabilityKinds,
  compareSourceVersion,
  type SourcePriority,
  type SourceTrustLevel,
} from "..";

describe("capability model", () => {
  it("defaults to supported and detects declared capabilities", () => {
    const caps = [sourceCapability("read"), sourceCapability("write", false)];
    expect(caps[0]).toEqual({ kind: "read", supported: true });
    expect(hasSourceCapability(caps, "read")).toBe(true);
    expect(hasSourceCapability(caps, "write")).toBe(false);
    expect(supportedCapabilityKinds(caps)).toEqual(["read"]);
  });
});

describe("priority model", () => {
  it("ranks primary as the most authoritative", () => {
    expect(sourcePriorityRank("primary")).toBeLessThan(sourcePriorityRank("secondary"));
    expect(isHigherPriority("primary", "reference")).toBe(true);
    const priorities: SourcePriority[] = ["reference", "primary", "fallback"];
    expect([...priorities].sort(compareSourcePriority)).toEqual([
      "primary",
      "fallback",
      "reference",
    ]);
  });
});

describe("trust model", () => {
  it("orders trust levels and checks a required bar", () => {
    expect(sourceTrustRank("authoritative")).toBeGreaterThan(sourceTrustRank("unverified"));
    expect(meetsTrustLevel("high", "standard")).toBe(true);
    expect(meetsTrustLevel("low", "high")).toBe(false);
    const levels: SourceTrustLevel[] = ["low", "authoritative", "standard"];
    expect([...levels].sort(compareSourceTrust)).toEqual(["authoritative", "standard", "low"]);
  });
});

describe("lifecycle and status predicates", () => {
  it("classifies terminal lifecycles and usable statuses", () => {
    expect(isTerminalLifecycle("retired")).toBe(true);
    expect(isTerminalLifecycle("active")).toBe(false);
    expect(isUsableStatus("enabled")).toBe(true);
    expect(isUsableStatus("experimental")).toBe(true);
    expect(isUsableStatus("blocked")).toBe(false);
  });
});

describe("version model", () => {
  it("formats and compares deterministically without a clock", () => {
    expect(formatSourceVersion(sourceVersion(1, 2, 3))).toBe("1.2.3");
    expect(formatSourceVersion(sourceVersion(1, 0, 0, "draft"))).toBe("1.0.0-draft");
    expect(compareSourceVersion(sourceVersion(0, 1, 0), sourceVersion(0, 2, 0))).toBeLessThan(0);
    expect(compareSourceVersion(sourceVersion(1, 0, 0), sourceVersion(1, 0, 0))).toBe(0);
    // The label never participates in ordering.
    expect(compareSourceVersion(sourceVersion(1, 0, 0, "a"), sourceVersion(1, 0, 0, "b"))).toBe(0);
  });
});
