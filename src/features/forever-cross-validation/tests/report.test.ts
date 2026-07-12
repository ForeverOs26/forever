import { describe, expect, it } from "vitest";

import { projectSourceVersion } from "@/features/forever-project-sources";

import {
  describeCrossSourceValidation,
  findCrossValidationAssessment,
  listCrossValidationFindingsByKind,
  listCrossValidationFindingsRequiringReview,
} from "..";
import {
  BROCHURE_ID,
  PRICE_LIST_ID,
  PRICE_LIST_V2_ID,
  TRANSLATION_ID,
  findingsOfKind,
  makeAgreeingFact,
  makeBrochureSource,
  makeConflictingFact,
  makeContext,
  makeFact,
  makePriceListSource,
  makePriceListV2Source,
  makeRequest,
  makeTranslationSource,
  runValidation,
} from "./fixtures";

const SUBJECT_KEY = "proj_coralina:price:pricing.basePrice";

describe("describeCrossSourceValidation", () => {
  it("describes agreement between independent sources as corroboration", () => {
    const result = runValidation();
    expect(result.ok).toBe(true);
    const report = result.data[0];
    expect(report.id).toBe("xrep_coralina");
    expect(report.projectId).toBe("proj_coralina");

    const assessment = findCrossValidationAssessment(report, SUBJECT_KEY);
    expect(assessment?.consensus).toBe("corroborated");
    expect(assessment?.readings).toHaveLength(2);

    const agreements = listCrossValidationFindingsByKind(report, "agreement");
    expect(agreements).toHaveLength(1);
    expect(agreements[0].disposition).toBe("informational");
    expect(agreements[0].independentSources).toBe(true);
    expect(agreements[0].references.map((reference) => reference.sourceId)).toEqual([
      BROCHURE_ID,
      PRICE_LIST_ID,
    ]);

    expect(report.standings.map((standing) => standing.admissibility)).toEqual([
      "admissible",
      "admissible",
    ]);
    expect(result.stats.completed).toBe(2);
    expect(result.outcome).toBe("success");
  });

  it("describes conflicting readings without electing a winner", () => {
    const result = runValidation({}, { facts: [makeFact(), makeConflictingFact()] });
    const report = result.data[0];

    expect(findCrossValidationAssessment(report, SUBJECT_KEY)?.consensus).toBe("contested");
    const conflicts = findingsOfKind(result, "conflict");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].disposition).toBe("requires_review");
    expect(conflicts[0].dimension).toBe("price");
    expect(conflicts[0].independentSources).toBe(true);
    // Every side is referenced and every side is marked for review — no
    // winner, no loser.
    expect(conflicts[0].references).toHaveLength(2);
    expect(report.standings.map((standing) => standing.admissibility)).toEqual([
      "requires_review",
      "requires_review",
    ]);
    expect(result.stats.skipped).toBe(2);
    // The report itself stays coherent: unresolved findings are a warning,
    // never an error.
    expect(result.ok).toBe(true);
    expect(result.warnings.some((issue) => issue.code === "unresolved_findings")).toBe(true);
  });

  it("keeps a single-source subject uncorroborated and informational by default", () => {
    const result = runValidation({}, { facts: [makeFact()] });
    const report = result.data[0];
    expect(findCrossValidationAssessment(report, SUBJECT_KEY)?.consensus).toBe("uncorroborated");
    const single = findingsOfKind(result, "single_source");
    expect(single).toHaveLength(1);
    expect(single[0].disposition).toBe("informational");
    expect(report.standings[0].admissibility).toBe("admissible");
  });

  it("escalates single-source subjects when corroboration is required", () => {
    const result = runValidation(
      { requirements: { requireIndependentCorroboration: true } },
      { facts: [makeFact()] },
    );
    expect(findingsOfKind(result, "single_source")[0].disposition).toBe("requires_review");
    expect(result.data[0].standings[0].admissibility).toBe("requires_review");
  });

  it("does not let dependent sources corroborate each other", () => {
    const result = runValidation(
      { sources: [makeBrochureSource(), makeTranslationSource()] },
      {
        facts: [
          makeAgreeingFact(),
          makeAgreeingFact({ factSlug: "price-1br-th", sourceId: TRANSLATION_ID }),
        ],
      },
    );
    const report = result.data[0];
    expect(findCrossValidationAssessment(report, SUBJECT_KEY)?.consensus).toBe("uncorroborated");
    const single = findingsOfKind(result, "single_source");
    expect(single).toHaveLength(1);
    expect(single[0].independentSources).toBe(false);
    expect(single[0].message).toContain("mutually dependent");
  });

  it("describes an outdated revision of one document as stale, not conflicting", () => {
    // Both revisions of the price list are catalogued, chained by
    // supersession; the newer revision disagrees with the older.
    const result = describeCrossSourceValidation(
      makeContext({ sources: [makePriceListSource(), makePriceListV2Source()] }),
      makeRequest({
        facts: [
          makeFact(),
          makeFact({
            factSlug: "price-1br-v2",
            sourceId: PRICE_LIST_V2_ID,
            sourceVersion: projectSourceVersion(2, 0, 0),
            rawValue: "THB 4,890,000",
            structuredValue: { amount: 4890000, currency: "THB" },
          }),
        ],
      }),
    );
    const report = result.data[0];
    // No cross-source conflict is manufactured between a document and its
    // own newer revision…
    expect(findingsOfKind(result, "conflict")).toHaveLength(0);
    // …the outdated reading is described as stale and needs review because
    // it disagrees with its successor.
    const stale = findingsOfKind(result, "stale_revision");
    expect(stale.length).toBeGreaterThanOrEqual(1);
    const disagreeing = stale.find((finding) => finding.disposition === "requires_review");
    expect(disagreeing?.message).toContain("disagrees");
    // The successor reading remains the subject's only consensus reading.
    expect(findCrossValidationAssessment(report, SUBJECT_KEY)?.consensus).toBe("uncorroborated");
  });

  it("describes same-source same-revision staleness through in-batch version comparison", () => {
    const result = runValidation(
      { sources: undefined },
      {
        facts: [
          makeFact(),
          makeFact({
            factSlug: "price-1br-newer",
            sourceVersion: projectSourceVersion(1, 1, 0),
            rawValue: "THB 4,650,000",
            structuredValue: { amount: 4650000, currency: "THB" },
          }),
        ],
      },
    );
    const stale = findingsOfKind(result, "stale_revision");
    expect(stale).toHaveLength(1);
    expect(stale[0].disposition).toBe("requires_review");
    expect(stale[0].references).toHaveLength(2);
    expect(findingsOfKind(result, "conflict")).toHaveLength(0);
  });

  it("flags a fact read from an older revision than the registered source describes", () => {
    const result = describeCrossSourceValidation(
      makeContext({ sources: [makePriceListSource({ version: projectSourceVersion(3, 0, 0) })] }),
      makeRequest({
        facts: [makeFact({ sourceId: "psrc_coralina-price-list-v3-0-0" })],
      }),
    );
    const stale = findingsOfKind(result, "stale_revision");
    expect(stale).toHaveLength(1);
    expect(stale[0].disposition).toBe("advisory");
    expect(stale[0].message).toContain("3.0.0");
  });

  it("describes redundant duplicates as advisory, never as corroboration", () => {
    const result = runValidation(
      {},
      { facts: [makeFact(), makeFact({ factSlug: "price-1br-again" })] },
    );
    const duplicates = findingsOfKind(result, "duplicate_fact");
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].disposition).toBe("advisory");
    expect(duplicates[0].references).toHaveLength(2);
    expect(findCrossValidationAssessment(result.data[0], SUBJECT_KEY)?.consensus).toBe(
      "uncorroborated",
    );
  });

  it("describes incomparable units instead of judging agreement across them", () => {
    const result = runValidation(
      {},
      {
        facts: [
          makeFact({
            factSlug: "area-1br",
            factType: "internal_area",
            fieldPath: "units.area1br",
            rawValue: "45",
            structuredValue: 45,
            unit: "sqm",
          }),
          makeFact({
            factSlug: "area-1br-brochure",
            sourceId: BROCHURE_ID,
            factType: "internal_area",
            fieldPath: "units.area1br",
            rawValue: "484",
            structuredValue: 484,
            unit: "sqft",
          }),
        ],
      },
    );
    const report = result.data[0];
    const key = "proj_coralina:internal_area:units.area1br";
    expect(findCrossValidationAssessment(report, key)?.consensus).toBe("incomparable");
    const inconsistencies = findingsOfKind(result, "inconsistency");
    expect(inconsistencies).toHaveLength(1);
    expect(inconsistencies[0].dimension).toBe("unit");
    expect(inconsistencies[0].disposition).toBe("requires_review");
    expect(findingsOfKind(result, "conflict")).toHaveLength(0);
  });

  it("describes incomparable currencies across monetary readings", () => {
    const result = runValidation(
      {},
      {
        facts: [
          makeFact(),
          makeConflictingFact({
            rawValue: "USD 139,000",
            structuredValue: { amount: 139000, currency: "USD" },
          }),
        ],
      },
    );
    const inconsistencies = findingsOfKind(result, "inconsistency");
    expect(inconsistencies).toHaveLength(1);
    expect(inconsistencies[0].dimension).toBe("currency");
    expect(findCrossValidationAssessment(result.data[0], SUBJECT_KEY)?.consensus).toBe(
      "incomparable",
    );
  });

  it("treats differing declared languages over differing raw text as incomparable", () => {
    const facts = [
      makeFact({ structuredValue: undefined, rawValue: "four million" }),
      makeConflictingFact({
        structuredValue: undefined,
        rawValue: "สี่ล้าน",
        language: "th",
      }),
    ];
    const result = runValidation({}, { facts });
    const inconsistencies = findingsOfKind(result, "inconsistency");
    expect(inconsistencies).toHaveLength(1);
    expect(inconsistencies[0].dimension).toBe("language");
  });

  it("flags claims tracing to unregistered sources", () => {
    const result = runValidation(
      { sources: [makePriceListSource()] },
      { facts: [makeFact(), makeAgreeingFact()] },
    );
    const unregistered = findingsOfKind(result, "unregistered_source");
    expect(unregistered).toHaveLength(1);
    expect(unregistered[0].disposition).toBe("requires_review");
    expect(unregistered[0].references[0].sourceId).toBe(BROCHURE_ID);
    // Without a registry in hand nothing can be judged unregistered.
    const noRegistry = runValidation({ sources: undefined });
    expect(findingsOfKind(noRegistry, "unregistered_source")).toHaveLength(0);
  });

  it("flags facts from sources whose registered standing is terminal", () => {
    const result = runValidation(
      { sources: [makePriceListSource({ status: "archived" }), makeBrochureSource()] },
      {},
    );
    const inactive = findingsOfKind(result, "inactive_source");
    expect(inactive).toHaveLength(1);
    expect(inactive[0].message).toContain("archived");
    expect(inactive[0].disposition).toBe("requires_review");
  });

  it("describes evidence and provenance gaps without repairing them", () => {
    const bare = makeFact({
      factSlug: "price-bare",
      locator: undefined,
      excerpt: undefined,
      rawValue: "THB 4,590,000",
    });
    const result = runValidation({}, { facts: [bare] });
    const gaps = findingsOfKind(result, "evidence_gap");
    expect(gaps).toHaveLength(1);
    expect(gaps[0].disposition).toBe("advisory");

    const demanded = runValidation(
      { requirements: { requireLocatedEvidence: true } },
      { facts: [bare] },
    );
    expect(findingsOfKind(demanded, "evidence_gap")[0].disposition).toBe("requires_review");
  });

  it("describes provenance reference inconsistencies as reference inconsistency findings", () => {
    const fact = makeFact();
    const twisted = {
      ...fact,
      provenance: { ...fact.provenance, sourceId: BROCHURE_ID },
    };
    const result = runValidation({}, { facts: [twisted] });
    const inconsistencies = findingsOfKind(result, "inconsistency");
    expect(inconsistencies).toHaveLength(1);
    expect(inconsistencies[0].dimension).toBe("reference");
    expect(inconsistencies[0].disposition).toBe("requires_review");
    expect(result.data[0].standings[0].admissibility).toBe("requires_review");
  });

  it("describes unsupported claims: typed values with nothing observed behind them", () => {
    const unsupported = makeFact({
      factSlug: "price-unsupported",
      rawValue: undefined,
      excerpt: undefined,
    });
    const result = runValidation({}, { facts: [unsupported] });
    const claims = findingsOfKind(result, "unsupported_claim");
    expect(claims).toHaveLength(1);
    expect(claims[0].disposition).toBe("requires_review");
  });

  it("describes derived facts with no derivation chain as unsupported claims", () => {
    const derived = makeFact({ factSlug: "price-derived", valueKind: "derived" });
    const result = runValidation({}, { facts: [derived] });
    const claims = findingsOfKind(result, "unsupported_claim");
    expect(claims).toHaveLength(1);
    expect(claims[0].message).toContain("derived");
  });

  it("applies caller-stated trust and confidence bars without rejecting anything", () => {
    const result = runValidation(
      {
        requirements: { minimumTrust: "high", minimumConfidence: "high" },
      },
      {
        facts: [makeFact(), makeAgreeingFact({ confidence: { level: "low", score: 0.2 } })],
      },
    );
    // The brochure is agency-attributed (standard trust) and low confidence.
    const authority = findingsOfKind(result, "authority_below_bar");
    const confidence = findingsOfKind(result, "confidence_below_bar");
    expect(authority).toHaveLength(1);
    expect(confidence).toHaveLength(1);
    expect(result.data[0].standings[1].admissibility).toBe("requires_review");
    // The price list clears both bars.
    expect(result.data[0].standings[0].admissibility).toBe("admissible");
    // Without stated bars nothing is demanded.
    const bare = runValidation({}, { facts: [makeAgreeingFact({ confidence: undefined })] });
    expect(findingsOfKind(bare, "confidence_below_bar")).toHaveLength(0);
    expect(findingsOfKind(bare, "authority_below_bar")).toHaveLength(0);
  });

  it("judges an unregistered source's trust by the stated unverified posture", () => {
    const result = runValidation(
      { sources: [], requirements: { minimumTrust: "low" } },
      { facts: [makeFact()] },
    );
    const authority = findingsOfKind(result, "authority_below_bar");
    expect(authority).toHaveLength(1);
    expect(authority[0].message).toContain("unverified");
  });

  it("describes missing information for expected paths nothing covers", () => {
    const result = runValidation(
      { requirements: { expectedPaths: ["pricing.basePrice", "units.area1br"] } },
      {},
    );
    const report = result.data[0];
    const missing = findingsOfKind(result, "missing_information");
    expect(missing).toHaveLength(1);
    expect(missing[0].path).toBe("units.area1br");
    expect(missing[0].disposition).toBe("requires_review");
    const expected = findCrossValidationAssessment(report, "proj_coralina:unknown:units.area1br");
    expect(expected?.consensus).toBe("unaddressed");
    expect(expected?.readings).toEqual([]);
    expect(expected?.findingIds).toEqual([missing[0].id]);
  });

  it("preserves declared disputes and superseded facts for review", () => {
    const disputed = makeFact({ factSlug: "price-disputed", conflictsWith: ["xfact_other"] });
    const superseded = makeFact({ factSlug: "price-old", status: "superseded" });
    const result = runValidation({}, { facts: [disputed, superseded] });
    const conflicts = findingsOfKind(result, "conflict");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].references.map((reference) => reference.factId)).toContain("xfact_other");
    const stale = findingsOfKind(result, "stale_revision");
    expect(stale).toHaveLength(1);
    expect(result.data[0].standings.map((standing) => standing.admissibility)).toEqual([
      "requires_review",
      "requires_review",
    ]);
  });

  it("accounts for every input slot and traces every finding", () => {
    const result = runValidation({}, { facts: [makeFact(), makeConflictingFact()] });
    const report = result.data[0];
    expect(report.standings).toHaveLength(2);
    const findingIds = new Set(report.findings.map((finding) => finding.id));
    for (const standing of report.standings) {
      for (const id of standing.findingIds) expect(findingIds.has(id)).toBe(true);
    }
    for (const assessment of report.subjects) {
      for (const id of assessment.findingIds) expect(findingIds.has(id)).toBe(true);
    }
    for (const finding of report.findings) {
      expect(finding.references.length).toBeGreaterThan(0);
      expect(finding.detectedAt).toBe("2026-07-12T00:00:00.000Z");
    }
    expect(listCrossValidationFindingsRequiringReview(report).length).toBe(
      result.metadata.reviewCount,
    );
  });

  it("derives report ids from the project and the caller-stated batch only", () => {
    expect(runValidation({}, { batch: "2026-07" }).data[0].id).toBe("xrep_coralina-2026-07");
    expect(runValidation().data[0].id).toBe("xrep_coralina");
    expect(runValidation().metadata.reportId).toBe("xrep_coralina");
  });

  it("reports counters, metadata, and the RC4.0 lifecycle coherently", () => {
    const result = runValidation({}, { facts: [makeFact(), makeConflictingFact(), null as never] });
    expect(result.stats.steps).toBe(3);
    expect(result.stats.completed).toBe(0);
    expect(result.stats.skipped).toBe(2);
    expect(result.stats.failed).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.state).toBe("failed");
    expect(result.metadata.factCount).toBe(3);
    expect(result.metadata.sourceCount).toBe(2);
    expect(result.metadata.subjectCount).toBe(1);
    expect(result.metadata.findingCount).toBeGreaterThan(0);
    expect(result.metadata.describedAt).toBe("2026-07-12T00:00:00.000Z");
  });
});
