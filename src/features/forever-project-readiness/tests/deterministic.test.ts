import { describe, expect, it } from "vitest";

import { describeProjectReadiness, validateReadinessReport } from "..";
import {
  makeConflictingFact,
  makeContext,
  makeFact,
  makeReadinessReport,
  makeProfile,
  makeReport,
  makeRequest,
  runReadiness,
} from "./fixtures";

describe("deterministic foundation", () => {
  it("describeProjectReadiness is byte-identical for identical input", () => {
    const run = () => describeProjectReadiness(makeContext(), makeRequest());
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it("stamps no clock of its own: an unstamped context yields no timestamp anywhere", () => {
    const result = runReadiness({ now: undefined });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("describedAt");
    expect(serialized).not.toContain("evaluatedAt");
  });

  it("mutates neither the context nor the request, and never aliases them", () => {
    const context = makeContext();
    const request = makeRequest({ profile: makeProfile() });
    const contextSnapshot = structuredClone(context);
    const requestSnapshot = structuredClone(request);
    const result = describeProjectReadiness(context, request);
    expect(context).toEqual(contextSnapshot);
    expect(request).toEqual(requestSnapshot);

    // Mutating the described report must never reach back into the caller's
    // sources, record, report, profile, or requirements.
    const report = result.data[0];
    report.evaluations.forEach((evaluation) => {
      evaluation.references.pop();
      evaluation.requirement.path = "mutated";
    });
    report.evaluations.pop();
    report.slots.pop();
    report.sourceIds.pop();
    expect(context).toEqual(contextSnapshot);
    expect(request).toEqual(requestSnapshot);
  });

  it("does not mutate what it validates, and validation is deterministic", () => {
    const report = makeReadinessReport();
    const snapshot = structuredClone(report);
    validateReadinessReport(report);
    expect(report).toEqual(snapshot);
    expect(validateReadinessReport(report)).toEqual(validateReadinessReport(report));
  });

  it("evaluation ids are stable across runs and unique within a report", () => {
    const first = makeReadinessReport();
    const second = makeReadinessReport();
    expect(first.evaluations.map((evaluation) => evaluation.id)).toEqual(
      second.evaluations.map((evaluation) => evaluation.id),
    );
    const ids = first.evaluations.map((evaluation) => evaluation.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("orders evaluations deterministically regardless of statement order", () => {
    const requirements = makeRequest().requirements!;
    const forward = runReadiness({}, { requirements }).data[0];
    const backward = runReadiness({}, { requirements: [...requirements].reverse() }).data[0];
    expect(
      forward.evaluations.map(
        (evaluation) => `${evaluation.requirement.kind}:${evaluation.requirement.path ?? ""}`,
      ),
    ).toEqual(
      backward.evaluations.map(
        (evaluation) => `${evaluation.requirement.kind}:${evaluation.requirement.path ?? ""}`,
      ),
    );
    expect(forward.evaluations.map((evaluation) => evaluation.id)).toEqual(
      backward.evaluations.map((evaluation) => evaluation.id),
    );
  });

  it("the engine's own output always passes the module's own validator", () => {
    const contested = [makeFact(), makeConflictingFact()];
    const results = [
      runReadiness(),
      runReadiness({ report: makeReport(contested) }),
      runReadiness({ sources: undefined, record: undefined, report: undefined }),
      runReadiness({}, { requirements: undefined, profile: makeProfile() }),
      runReadiness(
        {},
        {
          requirements: [
            { kind: "field_present", path: "pricing.basePrice" },
            { kind: "field_present", path: "pricing.basePrice" },
            null as never,
          ],
        },
      ),
    ];
    for (const result of results) {
      expect(result.data).toHaveLength(1);
      expect(validateReadinessReport(result.data[0])).toEqual([]);
    }
  });
});
