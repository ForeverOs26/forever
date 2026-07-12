import { describe, expect, it } from "vitest";

import {
  describeCrossSourceValidation,
  describeCrossSourceReading,
  judgeCrossValidationConsensus,
  sortCrossSourceReadings,
  sortCrossValidationFindings,
  validateCrossValidationReport,
} from "..";
import {
  makeConflictingFact,
  makeContext,
  makeFact,
  makeReport,
  makeRequest,
  makeSources,
  runValidation,
} from "./fixtures";

describe("deterministic foundation", () => {
  it("describeCrossSourceValidation is byte-identical for identical input", () => {
    const run = () => describeCrossSourceValidation(makeContext(), makeRequest());
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it("stamps no clock of its own: an unstamped context yields no timestamp anywhere", () => {
    const result = describeCrossSourceValidation(makeContext({ now: undefined }), makeRequest());
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("describedAt");
    expect(serialized).not.toContain("detectedAt");
  });

  it("mutates neither the context nor the request, and never aliases them", () => {
    const context = makeContext();
    const request = makeRequest({ facts: [makeFact(), makeConflictingFact()] });
    const contextSnapshot = structuredClone(context);
    const requestSnapshot = structuredClone(request);
    const result = describeCrossSourceValidation(context, request);
    expect(context).toEqual(contextSnapshot);
    expect(request).toEqual(requestSnapshot);

    // Mutating the described report must never reach back into the caller's
    // sources or facts.
    const report = result.data[0];
    report.subjects.forEach((assessment) => assessment.readings.pop());
    report.findings.forEach((finding) => finding.references.pop());
    report.standings.pop();
    report.sourceIds.pop();
    expect(context).toEqual(contextSnapshot);
    expect(request).toEqual(requestSnapshot);
  });

  it("readings never alias the fact or the registered source", () => {
    const fact = makeFact();
    const sources = makeSources();
    const reading = describeCrossSourceReading(fact, { sources });
    expect(reading.sourceVersion).not.toBe(fact.sourceVersion);
    expect(reading.authority).not.toBe(sources[0].authority);
    reading.sourceVersion.major = 99;
    expect(fact.sourceVersion.major).toBe(1);
  });

  it("does not mutate what it sorts, judges, or validates", () => {
    const report = makeReport();
    const reportSnapshot = structuredClone(report);
    validateCrossValidationReport(report);
    sortCrossValidationFindings(report.findings);
    expect(report).toEqual(reportSnapshot);

    const readings = report.subjects[0].readings;
    const readingsSnapshot = structuredClone(readings);
    sortCrossSourceReadings(readings);
    judgeCrossValidationConsensus(readings, makeSources());
    expect(readings).toEqual(readingsSnapshot);
  });

  it("validation is deterministic: identical input yields identical issues", () => {
    const report = makeReport();
    expect(validateCrossValidationReport(report)).toEqual(validateCrossValidationReport(report));
  });

  it("finding ids are stable across runs and unique within a report", () => {
    const first = runValidation({}, { facts: [makeFact(), makeConflictingFact()] }).data[0];
    const second = runValidation({}, { facts: [makeFact(), makeConflictingFact()] }).data[0];
    expect(first.findings.map((finding) => finding.id)).toEqual(
      second.findings.map((finding) => finding.id),
    );
    const ids = first.findings.map((finding) => finding.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("orders subjects, readings, and findings deterministically regardless of input order", () => {
    const facts = [makeFact(), makeConflictingFact()];
    const forward = runValidation({}, { facts }).data[0];
    const backward = runValidation({}, { facts: [...facts].reverse() }).data[0];
    expect(forward.subjects.map((assessment) => assessment.subject.key)).toEqual(
      backward.subjects.map((assessment) => assessment.subject.key),
    );
    expect(forward.subjects[0].readings.map((reading) => reading.factId)).toEqual(
      backward.subjects[0].readings.map((reading) => reading.factId),
    );
    expect(forward.findings.map((finding) => `${finding.kind}:${finding.id}`)).toEqual(
      backward.findings.map((finding) => `${finding.kind}:${finding.id}`),
    );
  });
});
