import { describe, expect, it } from "vitest";

import {
  projectFieldValueFromFact,
  projectFieldValueSignature,
} from "@/features/forever-project-database";

import {
  CROSS_READING_UNDESCRIBABLE_SIGNATURE,
  crossSourceReadingCurrency,
  crossSourceReadingSignature,
  describeCrossSourceReading,
  sortCrossSourceReadings,
} from "..";
import type { CrossSourceReading } from "..";
import { BROCHURE_ID, makeFact, makeSources } from "./fixtures";

describe("crossSourceReadingSignature", () => {
  it("is exactly the RC4.6 signature of the canonical value the fact would settle into", () => {
    const fact = makeFact();
    expect(crossSourceReadingSignature(fact)).toBe(
      projectFieldValueSignature(projectFieldValueFromFact(fact)),
    );
  });

  it("judges stated absence the way the canonical merge does", () => {
    const unavailable = makeFact({ status: "unavailable" });
    expect(crossSourceReadingSignature(unavailable)).toBe(
      projectFieldValueSignature(projectFieldValueFromFact(unavailable)),
    );
    expect(crossSourceReadingSignature(unavailable)).not.toBe(
      crossSourceReadingSignature(makeFact()),
    );
  });

  it("collapses an undescribable fact to the one stable marker instead of throwing", () => {
    const exotic = makeFact() as never as Record<string, unknown>;
    exotic.confidence = { level: "high", toJSON: () => "x" };
    expect(crossSourceReadingSignature(exotic as never)).toBe(
      CROSS_READING_UNDESCRIBABLE_SIGNATURE,
    );
  });
});

describe("describeCrossSourceReading", () => {
  it("resolves authority and status only for registered sources", () => {
    const registered = describeCrossSourceReading(makeFact(), { sources: makeSources() });
    expect(registered.registered).toBe(true);
    expect(registered.authority?.kind).toBe("developer_official");
    expect(registered.sourceStatus).toBe("verified");

    const unregistered = describeCrossSourceReading(makeFact(), { sources: [] });
    expect(unregistered.registered).toBe(false);
    expect(unregistered.authority).toBeUndefined();
    expect(unregistered.sourceStatus).toBeUndefined();
  });

  it("reads the currency only off an RC3.0 Money structured value", () => {
    expect(crossSourceReadingCurrency(makeFact())).toBe("THB");
    expect(crossSourceReadingCurrency(makeFact({ structuredValue: 42 }))).toBeUndefined();
    expect(crossSourceReadingCurrency(makeFact({ structuredValue: undefined }))).toBeUndefined();
    expect(describeCrossSourceReading(makeFact()).currency).toBe("THB");
  });

  it("judges currentness through the reused RC4.5 status predicate", () => {
    expect(describeCrossSourceReading(makeFact()).current).toBe(true);
    expect(describeCrossSourceReading(makeFact({ status: "verified" })).current).toBe(true);
    expect(describeCrossSourceReading(makeFact({ status: "superseded" })).current).toBe(false);
    // A stated absence is a current statement — "the value is not there" is
    // data that participates in consensus, never silence.
    expect(describeCrossSourceReading(makeFact({ status: "unavailable" })).current).toBe(true);
  });

  it("views declared-but-empty units, currencies, and languages as undeclared", () => {
    const reading = describeCrossSourceReading(
      makeFact({ unit: "", language: " ", structuredValue: { amount: 1, currency: "" } }),
    );
    expect(reading.unit).toBeUndefined();
    expect(reading.currency).toBeUndefined();
    expect(reading.language).toBeUndefined();
  });

  it("never propagates an attribution the reused RC4.4 guards reject", () => {
    const bogus = makeSources().map((source) => ({
      ...source,
      status: "bogus" as never,
      authority: { kind: "weird", trust: "nope" } as never,
    }));
    const reading = describeCrossSourceReading(makeFact(), { sources: bogus });
    expect(reading.registered).toBe(true);
    expect(reading.authority).toBeUndefined();
    expect(reading.sourceStatus).toBeUndefined();
  });
});

describe("sortCrossSourceReadings", () => {
  it("orders by source, revision, then fact — stably and immutably", () => {
    const make = (
      sourceId: string,
      version: { major: number; minor: number; patch: number },
      factId: string,
    ): CrossSourceReading => ({
      factId,
      sourceId,
      sourceVersion: version,
      signature: "s",
      confidence: { level: "unknown" },
      current: true,
      statesAbsence: false,
      registered: false,
    });
    const readings = [
      make("psrc_z", { major: 1, minor: 0, patch: 0 }, "f1"),
      make(BROCHURE_ID, { major: 2, minor: 0, patch: 0 }, "f2"),
      make(BROCHURE_ID, { major: 1, minor: 0, patch: 0 }, "f4"),
      make(BROCHURE_ID, { major: 1, minor: 0, patch: 0 }, "f3"),
    ];
    const snapshot = structuredClone(readings);
    expect(sortCrossSourceReadings(readings).map((reading) => reading.factId)).toEqual([
      "f3",
      "f4",
      "f2",
      "f1",
    ]);
    expect(readings).toEqual(snapshot);
    // A malformed revision orders through the total comparison instead of
    // throwing.
    const malformed = [
      make("a", null as never, "f1"),
      make("a", { major: 1, minor: 0, patch: 0 }, "f0"),
    ];
    expect(sortCrossSourceReadings(malformed).map((reading) => reading.factId)).toEqual([
      "f0",
      "f1",
    ]);
  });
});
