/**
 * Batch builder — currency doctrine and owner_verified precedence.
 * Pure in-memory tests over deterministic builder output.
 */

import { describe, expect, it } from "vitest";

import type { ExtractedPriceList } from "@/import/types";

import { buildProgressiveBatch } from "../build-batch";
import type { DependencyReader } from "../dependency-resolution";
import { canReplaceField } from "../provenance";
import { FakeIngestExecutor } from "./fake-ingest-executor";

const emptyReader: DependencyReader = {
  findDevelopers: async () => [],
  findLocations: async () => [],
};

function priceListRow(overrides: Record<string, unknown> = {}) {
  return {
    unit_number: { value: "A1", source_file: "price-list.pdf", confidence: "high" },
    building: { value: "1", source_file: "price-list.pdf", confidence: "high" },
    price: { value: "4,500,000", source_file: "price-list.pdf", confidence: "high" },
    ...overrides,
  };
}

describe("currency doctrine (builder)", () => {
  it("keeps unknown currency NULL and emits one currency_unresolved warning", async () => {
    const priceList = { unit_inventory: [priceListRow()] } as unknown as ExtractedPriceList;
    const batch = await buildProgressiveBatch(emptyReader, {
      mode: "create",
      project: { slug: "coralina", name: "Coralina" },
      priceList,
    });
    expect(batch.prices?.[0]?.currency).toBeNull();
    const warning = batch.warnings?.find((item) => item.code === "currency_unresolved");
    expect(warning).toBeDefined();
    expect(warning?.payload).toMatchObject({ rows: 1 });
  });

  it("stores extracted currency when the source states it", async () => {
    const priceList = {
      unit_inventory: [
        priceListRow({
          currency: { value: "THB", source_file: "price-list.pdf", confidence: "high" },
        }),
      ],
    } as unknown as ExtractedPriceList;
    const batch = await buildProgressiveBatch(emptyReader, {
      mode: "create",
      project: { slug: "coralina", name: "Coralina" },
      priceList,
    });
    expect(batch.prices?.[0]?.currency).toBe("THB");
    const provenance = batch.prices?.[0]?.metadata?.field_provenance as
      | Record<string, { status: string }>
      | undefined;
    expect(provenance?.currency?.status).toBe("extracted");
    expect(batch.warnings?.some((item) => item.code === "currency_unresolved")).toBeFalsy();
  });

  it("records rule and country reasoning when THB is deliberately inferred", async () => {
    const priceList = { unit_inventory: [priceListRow()] } as unknown as ExtractedPriceList;
    const batch = await buildProgressiveBatch(emptyReader, {
      mode: "create",
      project: { slug: "coralina", name: "Coralina" },
      priceList,
      countryEvidence: {
        value: "Thailand",
        status: "source_verified",
        confidence: "high",
        context: "source-verified project country",
      },
    });
    expect(batch.prices?.[0]?.currency).toBe("THB");
    const metadata = batch.prices?.[0]?.metadata as Record<string, unknown>;
    const provenance = metadata.field_provenance as Record<
      string,
      { status: string; reasoning?: Record<string, unknown> }
    >;
    expect(provenance.currency.status).toBe("inferred");
    expect(provenance.currency.reasoning).toMatchObject({
      rule: "project_country_default_currency",
      inferred_from_country: "Thailand",
    });
    expect((metadata.currency_decision as { status: string }).status).toBe("inferred_default");
  });
});

describe("owner_verified precedence (builder + canReplaceField)", () => {
  it("protects an owner_verified project field: value stripped, field_conflict emitted", async () => {
    const batch = await buildProgressiveBatch(emptyReader, {
      mode: "enrich",
      project: {
        slug: "coralina",
        set: { starting_price_thb: 7_500_000 },
        field_provenance: { starting_price_thb: { status: "extracted", confidence: 0.6 } },
      },
      existing: {
        project: {
          values: { starting_price_thb: 8_900_000 },
          fieldProvenance: { starting_price_thb: { status: "owner_verified" } },
        },
      },
    });
    expect(batch.project.set).toEqual({});
    expect(batch.project.field_provenance).toEqual({});
    const conflict = batch.warnings?.find((item) => item.code === "field_conflict");
    expect(conflict).toMatchObject({
      entity: "project",
      field: "starting_price_thb",
      payload: { current: 8_900_000, proposed: 7_500_000 },
    });
  });

  it("preserves stored owner provenance while accepting a different project field", async () => {
    const executor = new FakeIngestExecutor();
    const created = await buildProgressiveBatch(emptyReader, {
      mode: "create",
      project: {
        slug: "protected",
        name: "Protected",
        starting_price_thb: 8_900_000,
        field_provenance: { starting_price_thb: { status: "owner_verified" } },
      },
    });
    await executor.ingest(created);
    const enriched = await buildProgressiveBatch(emptyReader, {
      mode: "enrich",
      project: {
        slug: "protected",
        set: { starting_price_thb: 7_500_000, price_range: "7.5m+" },
        field_provenance: {
          starting_price_thb: { status: "extracted" },
          price_range: { status: "extracted" },
        },
      },
      existing: {
        project: {
          values: { starting_price_thb: 8_900_000, price_range: null },
          fieldProvenance: { starting_price_thb: { status: "owner_verified" } },
        },
      },
    });
    expect(enriched.project.field_provenance).toEqual({ price_range: { status: "extracted" } });
    await executor.ingest(enriched);
    expect(executor.store.projects[0].starting_price_thb).toBe(8_900_000);
    expect(executor.store.projects[0].price_range).toBe("7.5m+");
    expect(executor.store.projects[0].field_provenance).toMatchObject({
      starting_price_thb: { status: "owner_verified" },
      price_range: { status: "extracted" },
    });
  });

  it("protects owner_verified unit and building fields from extracted replacements", async () => {
    const priceList = {
      unit_inventory: [
        priceListRow({
          bedrooms: { value: "3", source_file: "price-list.pdf", confidence: "high" },
        }),
      ],
    } as unknown as ExtractedPriceList;
    const batch = await buildProgressiveBatch(emptyReader, {
      mode: "enrich",
      project: { slug: "coralina" },
      priceList,
      existing: {
        units: {
          A1: {
            values: { bedrooms: 2 },
            fieldProvenance: { bedrooms: { status: "owner_verified" } },
          },
        },
        buildings: {
          "1": {
            values: { name: "Ocean Wing" },
            fieldProvenance: { name: { status: "owner_verified" } },
          },
        },
      },
    });
    const unit = batch.units?.find((item) => item.unit_code === "A1");
    expect(unit?.bedrooms).toBeUndefined();
    expect(
      batch.warnings?.filter(
        (item) => item.code === "field_conflict" && item.entity === "unit",
      ),
    ).toHaveLength(1);
  });

  it("lets equal-or-higher precedence with a newer source date replace a value", () => {
    expect(
      canReplaceField(
        { status: "extracted", source_date: "2026-05-01" },
        { status: "extracted", source_date: "2026-07-01" },
        false,
      ),
    ).toBe("apply");
    expect(
      canReplaceField(
        { status: "extracted", source_date: "2026-07-01" },
        { status: "extracted", source_date: "2026-05-01" },
        false,
      ),
    ).toBe("conflict");
    expect(canReplaceField({ status: "owner_verified" }, { status: "owner_verified" }, false)).toBe(
      "apply",
    );
  });

  it("rejects weaker matching price and media metadata but appends a new dated price", async () => {
    const priceList = {
      price_list_date: { value: "2026-07-01" },
      unit_inventory: [priceListRow()],
    } as unknown as ExtractedPriceList;
    const existing = {
      prices: {
        '["A1","developer_price_list","price-list.pdf",null,"2026-07-01"]': {
          values: { price: 5_000_000, currency: "USD" },
          fieldProvenance: { price: { status: "owner_verified" as const }, currency: { status: "owner_verified" as const } },
        },
      },
      media: {
        '["gallery","https://example.test/a.jpg"]': {
          values: { title: "Owner title", sort_order: 9 },
          fieldProvenance: { title: { status: "owner_verified" as const }, sort_order: { status: "owner_verified" as const } },
        },
      },
    };
    const batch = await buildProgressiveBatch(emptyReader, {
      mode: "enrich",
      project: { slug: "protected" },
      priceList,
      media: [{
        media_type: "gallery",
        url: "https://example.test/a.jpg",
        title: "Extracted title",
        sort_order: 1,
        metadata: { field_provenance: { title: { status: "extracted" }, sort_order: { status: "extracted" } } },
      }],
      existing,
    });
    expect(batch.prices).toBeUndefined();
    expect(batch.media?.[0]).toMatchObject({
      media_type: "gallery",
      url: "https://example.test/a.jpg",
      metadata: { field_provenance: {} },
    });
    expect(batch.media?.[0].title).toBeUndefined();
    expect(batch.media?.[0].sort_order).toBeUndefined();
    expect(batch.warnings?.filter((warning) => warning.code === "field_conflict")).toHaveLength(4);

    const newer = await buildProgressiveBatch(emptyReader, {
      mode: "enrich",
      project: { slug: "protected" },
      priceList: {
        price_list_date: { value: "2026-08-01" },
        unit_inventory: [priceListRow()],
      } as unknown as ExtractedPriceList,
      existing,
    });
    expect(newer.prices).toHaveLength(1);
    expect(newer.prices?.[0].currency).toBeNull();
  });
});
