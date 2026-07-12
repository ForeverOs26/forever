import { describe, expect, it } from "vitest";

import {
  compareSourceTrust,
  meetsTrustLevel,
  sourceTrustRank,
} from "@/features/forever-source-registry";
import {
  compareProjectSourceAuthority,
  projectSourceRelationships,
} from "@/features/forever-project-sources";

import {
  areIndependentCrossSources,
  compareCrossSourceAuthority,
  compareCrossSourceTrust,
  crossSourceTrustRank,
  meetsCrossSourceTrust,
  resolveCrossSourceAuthority,
  resolveCrossValidationSource,
} from "..";
import {
  BROCHURE_ID,
  PRICE_LIST_ID,
  PRICE_LIST_V2_ID,
  TRANSLATION_ID,
  makeBrochureSource,
  makePriceListSource,
  makePriceListV2Source,
  makeSources,
  makeTranslationSource,
} from "./fixtures";

describe("reused trust machinery", () => {
  it("re-exports the RC3.3 trust ladder — the very same functions", () => {
    expect(crossSourceTrustRank).toBe(sourceTrustRank);
    expect(meetsCrossSourceTrust).toBe(meetsTrustLevel);
    expect(compareCrossSourceTrust).toBe(compareSourceTrust);
    expect(compareCrossSourceAuthority).toBe(compareProjectSourceAuthority);
  });
});

describe("resolveCrossValidationSource", () => {
  it("resolves by identity id, first registration winning, and never invents", () => {
    const sources = makeSources();
    expect(resolveCrossValidationSource(sources, PRICE_LIST_ID)?.identity.id).toBe(PRICE_LIST_ID);
    expect(resolveCrossValidationSource(sources, "psrc_unknown")).toBeUndefined();
    expect(resolveCrossValidationSource(undefined, PRICE_LIST_ID)).toBeUndefined();
    expect(resolveCrossValidationSource([null, ...sources] as never, BROCHURE_ID)).toBeDefined();
    const shadowed = [
      makePriceListSource(),
      makePriceListSource({ authority: undefined, status: "rejected" }),
    ];
    expect(resolveCrossValidationSource(shadowed, PRICE_LIST_ID)?.status).toBe("verified");
  });

  it("resolves authority only when the source declares one", () => {
    expect(resolveCrossSourceAuthority(makeSources(), PRICE_LIST_ID)?.kind).toBe(
      "developer_official",
    );
    expect(resolveCrossSourceAuthority(makeSources(), "psrc_unknown")).toBeUndefined();
  });
});

describe("areIndependentCrossSources", () => {
  it("never judges a source independent of itself", () => {
    expect(areIndependentCrossSources(PRICE_LIST_ID, PRICE_LIST_ID)).toBe(false);
  });

  it("judges declared relationship chains dependent, in either direction", () => {
    const sources = [makeBrochureSource(), makeTranslationSource()];
    expect(areIndependentCrossSources(BROCHURE_ID, TRANSLATION_ID, sources)).toBe(false);
    expect(areIndependentCrossSources(TRANSLATION_ID, BROCHURE_ID, sources)).toBe(false);
    expect(
      areIndependentCrossSources(PRICE_LIST_ID, PRICE_LIST_V2_ID, [
        makePriceListSource(),
        makePriceListV2Source(),
      ]),
    ).toBe(false);
  });

  it("treats undeclared pairs as independent — the declaration-or-nothing rule", () => {
    expect(areIndependentCrossSources(PRICE_LIST_ID, BROCHURE_ID, makeSources())).toBe(true);
    expect(areIndependentCrossSources("psrc_a", "psrc_b")).toBe(true);
  });

  it("stays total over malformed relationship values", () => {
    const broken = makeBrochureSource({
      relationships: projectSourceRelationships({ related: "nope" as never }),
    });
    expect(areIndependentCrossSources(BROCHURE_ID, PRICE_LIST_ID, [broken])).toBe(true);
  });
});
