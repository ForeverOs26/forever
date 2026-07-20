import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { loadExtractedDatasets } from "./datasets";
import { loadManifest } from "./manifest";
import { createImportPlan } from "./planner";
import { validateImportPlanRelationships } from "./plan-validator";
import { validateProjectImport } from "./validator";
import { currencyEvidenceFromFact, decideCurrency, type CurrencyEvidence } from "./currency-policy";
import { createPriceHistoryPersistencePayload, type PriceHistoryInput } from "./database";

const MODEVA_CURRENCY_FIXTURE_ROOT = resolve(process.cwd(), "src/import/test-fixtures");

const explicit = (value: string): CurrencyEvidence => ({
  value,
  status: "source_verified",
  confidence: "high",
  sourceFile: "price-list.pdf",
  sourcePage: 1,
});

const absent: CurrencyEvidence = {
  value: null,
  status: "unresolved",
  confidence: "none",
  sourceFile: "price-list.pdf",
  sourcePage: 1,
};

const country = (value: string | null, verified = true): CurrencyEvidence => ({
  value,
  status: verified ? "source_verified" : "unresolved",
  confidence: verified ? "high" : "none",
  sourceFile: verified ? "official-country-source" : null,
});

describe("Forever currency policy", () => {
  it("preserves explicit THB as source_verified", () => {
    expect(
      decideCurrency({ priceEvidence: [explicit("THB")], countryEvidence: country("Thailand") }),
    ).toMatchObject({ value: "THB", status: "source_verified", confidence: "high" });
  });

  it("preserves an explicitly stated non-THB source currency", () => {
    const decision = decideCurrency({ priceEvidence: [explicit("USD")] });
    expect(decision).toMatchObject({ value: "USD", status: "source_verified", confidence: "high" });
  });

  it("infers THB only from source-verified Thailand", () => {
    expect(
      decideCurrency({ priceEvidence: [absent], countryEvidence: country("Thailand") }),
    ).toMatchObject({
      value: "THB",
      status: "inferred_default",
      confidence: "medium",
      inferenceRule: "project_country_default_currency",
      inferenceRuleVersion: "1.0.0",
      inferredFromCountry: "Thailand",
    });
  });

  it("defaults to THB when no country evidence is supplied under the current Owner scope", () => {
    expect(decideCurrency({ priceEvidence: [absent] })).toMatchObject({
      value: "THB",
      status: "inferred_default",
      inferredFromCountry: "Thailand",
    });
  });

  it.each([
    [null, false],
    ["Singapore", true],
  ])("leaves absent currency unresolved for country %s", (value, verified) => {
    expect(
      decideCurrency({ priceEvidence: [absent], countryEvidence: country(value, verified) }),
    ).toMatchObject({ value: null, status: "unresolved", confidence: "none" });
  });

  it("does not overwrite explicit USD for a Thailand project", () => {
    expect(
      decideCurrency({ priceEvidence: [explicit("USD")], countryEvidence: country("Thailand") }),
    ).toMatchObject({ value: "USD", status: "source_verified" });
  });

  it("does not relabel an inferred-default Fact as source evidence", () => {
    const evidence = currencyEvidenceFromFact({
      value: "THB",
      source_file: "price-list.pdf",
      page_number: 1,
      confidence: "medium",
      status: "inferred_default",
    });
    expect(evidence).toMatchObject({ value: "THB", status: "unresolved", confidence: "medium" });
    expect(decideCurrency({ priceEvidence: [evidence] })).toMatchObject({
      value: "THB",
      status: "inferred_default",
    });
  });

  it("returns a blocking review finding for conflicting explicit currencies", () => {
    const decision = decideCurrency({
      priceEvidence: [explicit("THB"), explicit("USD")],
      countryEvidence: country("Thailand"),
    });
    expect(decision).toMatchObject({ value: null, status: "conflict" });
    expect(decision.reviewFindings).toEqual([
      expect.objectContaining({ code: "currency_evidence_conflict", currencies: ["THB", "USD"] }),
    ]);
  });
});

describe("Coralina currency planning", () => {
  it("produces 198 deterministic inferred-default THB rows without relationship findings", async () => {
    const manifest = await loadManifest("coralina", "forever-data/projects");
    const datasets = await loadExtractedDatasets("coralina", "forever-data/projects");
    const validation = await validateProjectImport(manifest);
    const first = createImportPlan(manifest, validation, datasets, "dry-run");
    const second = createImportPlan(manifest, validation, datasets, "dry-run");

    expect(first.priceHistoryRows).toHaveLength(198);
    expect(first.priceHistoryRows.every((row) => row.currency === "THB")).toBe(true);
    expect(
      first.priceHistoryRows.every(
        (row) =>
          row.currencyDecision.status === "inferred_default" &&
          row.currencyDecision.confidence === "medium",
      ),
    ).toBe(true);
    expect(validateImportPlanRelationships(first)).toEqual([]);
    const firstSerialized = JSON.stringify(first.operations);
    const secondSerialized = JSON.stringify(second.operations);
    expect(firstSerialized).toBe(secondSerialized);
    expect(createHash("sha256").update(firstSerialized).digest("hex")).toBe(
      createHash("sha256").update(secondSerialized).digest("hex"),
    );
    expect(first.operations).toHaveLength(405);
    expect(first.operations.map((operation) => operation.naturalKey)).toEqual(
      second.operations.map((operation) => operation.naturalKey),
    );
  });

  it("blocks a price row whose authoritative currency evidence conflicts", async () => {
    const manifest = await loadManifest("coralina", "forever-data/projects");
    const datasets = await loadExtractedDatasets("coralina", "forever-data/projects");
    const validation = await validateProjectImport(manifest);
    const plan = createImportPlan(manifest, validation, datasets, "dry-run");
    const conflict = decideCurrency({
      priceEvidence: [explicit("THB"), explicit("USD")],
      countryEvidence: country("Thailand"),
    });
    plan.priceHistoryRows[0] = {
      ...plan.priceHistoryRows[0],
      currency: conflict.value,
      currencyDecision: conflict,
    };
    expect(validateImportPlanRelationships(plan)).toContainEqual(
      expect.objectContaining({ severity: "error", code: "price_history_currency_conflict" }),
    );
  });

  it("leaves Modeva-like price data without authoritative currency unresolved", async () => {
    const manifest = await loadManifest("modeva-currency", MODEVA_CURRENCY_FIXTURE_ROOT);
    const datasets = await loadExtractedDatasets("modeva-currency", MODEVA_CURRENCY_FIXTURE_ROOT);
    const validation = await validateProjectImport(manifest, MODEVA_CURRENCY_FIXTURE_ROOT);
    const plan = createImportPlan(manifest, validation, datasets, "dry-run");

    expect(validation.ready).toBe(true);
    expect(plan.priceHistoryRows).toHaveLength(1);
    expect(plan.priceHistoryRows[0].currency).toBeNull();
    expect(plan.priceHistoryRows[0].currencyDecision.status).toBe("unresolved");
  });
});

describe("currency persistence payload", () => {
  const row = (decision: ReturnType<typeof decideCurrency>): PriceHistoryInput => ({
    unitNumber: "A101",
    price: 1_000_000,
    currency: decision.value,
    currencyDecision: decision,
    priceSource: "developer_price_list",
    recordedDate: "2026-07-03",
    priceListDate: "2026-07-03",
  });

  it("preserves inferred THB and its decision without re-inferring", () => {
    const decision = decideCurrency({
      priceEvidence: [absent],
      countryEvidence: country("Thailand"),
    });
    const payload = createPriceHistoryPersistencePayload("unit-1", row(decision));
    expect(payload.currency).toBe("THB");
    expect(payload.metadata.currency_decision).toEqual(decision);
  });

  it("preserves unresolved null instead of silently replacing it", () => {
    const decision = decideCurrency({
      priceEvidence: [absent],
      countryEvidence: country(null, false),
    });
    const payload = createPriceHistoryPersistencePayload("unit-1", row(decision));
    expect(payload.currency).toBeNull();
    expect(payload.metadata.currency_decision.status).toBe("unresolved");
  });
});
