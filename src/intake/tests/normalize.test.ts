import { describe, expect, it } from "vitest";

import type { ExtractedPriceList } from "@/import/types";

import { normalizeToBatch } from "../normalize";
import type { IntakeProjectFacts } from "../types";

const FULL_FACTS: IntakeProjectFacts = {
  name: {
    value: "Marina Bay",
    source_ref: "facts.json",
    confidence: "high",
    status: "official_source",
  },
  developer: {
    value: "Dev Co",
    source_ref: "facts.json",
    confidence: "high",
    status: "official_source",
  },
  location: {
    value: "Kamala, Phuket, Thailand",
    source_ref: "facts.json",
    confidence: "high",
    status: "official_source",
  },
  country: {
    value: "Thailand",
    source_ref: "facts.json",
    confidence: "high",
    status: "official_source",
  },
};

function priceList(withCurrency = false): ExtractedPriceList {
  return {
    price_list_date: { value: "2026-07-01", source_file: "pl.json", confidence: "high" },
    unit_inventory: [
      {
        unit_number: { value: "A-1", source_file: "pl.json", confidence: "high" },
        building: { value: "A", source_file: "pl.json", confidence: "high" },
        price: { value: "4,000,000", source_file: "pl.json", confidence: "high" },
        ...(withCurrency
          ? { currency: { value: "USD", source_file: "pl.json", confidence: "high" } }
          : {}),
      },
    ],
  } as unknown as ExtractedPriceList;
}

const NO_MEDIA = { hasMedia: false, hasDocuments: false, priceListLogicalPath: null };

async function run(facts: IntakeProjectFacts, pl: ExtractedPriceList | null, flags = NO_MEDIA) {
  return normalizeToBatch({
    projectSlug: "marina-bay",
    projectName: "Marina Bay",
    facts,
    priceList: pl,
    categoryFlags: flags,
  });
}

function codes(batch: Awaited<ReturnType<typeof normalizeToBatch>>["batch"]): string[] {
  return (batch.warnings ?? []).map((warning) => warning.code);
}

describe("Fast Intake normalization and anti-fabrication", () => {
  it("always produces an unpublished create batch", async () => {
    const { batch } = await run(FULL_FACTS, priceList());
    expect(batch.mode).toBe("create");
    expect(batch.project.publish).toBe(false);
    expect(batch.project.slug).toBe("marina-bay");
    expect(batch.batch_fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("infers THB currency from a source-verified country", async () => {
    const { batch } = await run(FULL_FACTS, priceList());
    expect(batch.prices?.[0]?.currency).toBe("THB");
    expect(codes(batch)).not.toContain("currency_unresolved");
  });

  it("warns on missing country and applies the Owner-approved THB default", async () => {
    const { batch } = await run({ ...FULL_FACTS, country: undefined }, priceList());
    expect(batch.prices?.[0]?.currency).toBe("THB");
    expect(codes(batch)).toContain("country_missing");
    expect(codes(batch)).not.toContain("currency_unresolved");
  });

  it("preserves a source-stated currency verbatim", async () => {
    const { batch } = await run(FULL_FACTS, priceList(true));
    expect(batch.prices?.[0]?.currency).toBe("USD");
  });

  it("warns on missing developer and never fabricates one", async () => {
    const { batch } = await run({ ...FULL_FACTS, developer: undefined }, priceList());
    expect(batch.project.developer_name_raw).toBeUndefined();
    expect(batch.project.developer_id ?? null).toBeNull();
    expect(codes(batch)).toContain("developer_missing");
  });

  it("warns on missing location and never fabricates one", async () => {
    const { batch } = await run({ ...FULL_FACTS, location: undefined }, priceList());
    expect(batch.project.location_name_raw).toBeUndefined();
    expect(batch.project.location_id ?? null).toBeNull();
    expect(codes(batch)).toContain("location_missing");
  });

  it("ignores a non-source-backed fact (no value, or confidence none)", async () => {
    const { batch } = await run(
      {
        ...FULL_FACTS,
        developer: { value: "Guessed Dev", confidence: "none", source_ref: "x" },
      },
      priceList(),
    );
    // confidence "none" is not evidence: treated as missing.
    expect(batch.project.developer_name_raw).toBeUndefined();
    expect(codes(batch)).toContain("developer_missing");
  });

  it("uses the operator name with owner provenance when no source name exists", async () => {
    const { batch } = await run({ developer: FULL_FACTS.developer }, priceList());
    expect(batch.project.name).toBe("Marina Bay");
    const provenance = batch.project.field_provenance?.name;
    expect(provenance?.status).toBe("owner_verified");
    expect(provenance?.source_type).toBe("operator_intake");
  });

  it("emits media/document deferral warnings only when such files exist", async () => {
    const withMedia = await run(FULL_FACTS, priceList(), {
      hasMedia: true,
      hasDocuments: true,
      priceListLogicalPath: null,
    });
    expect(codes(withMedia.batch)).toEqual(
      expect.arrayContaining(["media_processing_deferred", "document_processing_deferred"]),
    );
    expect(withMedia.batch.media ?? []).toHaveLength(0);

    const withoutMedia = await run(FULL_FACTS, priceList());
    expect(codes(withoutMedia.batch)).not.toContain("media_processing_deferred");
  });

  it("still produces a maximal partial batch when there is no price list", async () => {
    const { batch, extractedFacts } = await run(FULL_FACTS, null);
    expect(batch.buildings ?? []).toHaveLength(0);
    expect(batch.units ?? []).toHaveLength(0);
    expect(batch.prices ?? []).toHaveLength(0);
    expect(batch.project.publish).toBe(false);
    expect(extractedFacts.counts).toEqual({ buildings: 0, units: 0, prices: 0 });
  });

  it("is deterministic: identical inputs yield an identical fingerprint", async () => {
    const a = await run(FULL_FACTS, priceList());
    const b = await run(FULL_FACTS, priceList());
    expect(a.batch.batch_fingerprint).toBe(b.batch.batch_fingerprint);
  });
});
