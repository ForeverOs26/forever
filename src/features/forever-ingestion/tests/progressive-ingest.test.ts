/**
 * Progressive ingestion — in-memory behavioral tests.
 *
 * These tests exercise the batch contract against the in-memory executor
 * that mirrors the migration draft's RPC semantics (see
 * fake-ingest-executor.ts). They are NOT database integration tests; the
 * SQL text itself is covered by migration-contract.test.ts.
 */

import { describe, expect, it } from "vitest";

import type { ProgressiveBatch } from "../batch-types";
import { buildProgressiveBatch, fingerprintBatch } from "../build-batch";
import type { DependencyReader } from "../dependency-resolution";
import { FakeIngestExecutor } from "./fake-ingest-executor";

const emptyReader: DependencyReader = {
  findDevelopers: async () => [],
  findLocations: async () => [],
};

function readerWith(config: {
  developers?: Array<{ id: string; slug: string | null; name: string }>;
  locations?: Array<{ id: string; slug: string | null; name: string }>;
}): DependencyReader {
  return {
    findDevelopers: async () => config.developers ?? [],
    findLocations: async () => config.locations ?? [],
  };
}

function batchOf(body: Omit<ProgressiveBatch, "batch_fingerprint">): ProgressiveBatch {
  return { ...body, batch_fingerprint: fingerprintBatch(body) };
}

function coralinaSizedBatch(): ProgressiveBatch {
  const buildings = Array.from({ length: 8 }, (_, index) => ({
    building_code: `${index + 1}`,
  }));
  const units = Array.from({ length: 198 }, (_, index) => ({
    unit_code: `A${index + 1}`,
    building_code: `${(index % 8) + 1}`,
    bedrooms: (index % 3) + 1,
  }));
  const prices = units.map((unit, index) => ({
    unit_code: unit.unit_code,
    price: 4_000_000 + index * 10_000,
    currency: "THB",
    price_source: "developer_price_list",
    source_file: "price-list.pdf",
    price_list_date: "2026-06-01",
  }));
  return batchOf({
    schema_version: "1",
    mode: "create",
    project: {
      slug: "coralina",
      name: "Coralina",
      developer_name_raw: "Rhom Bho Property Public Company Limited",
      location_name_raw: "Kamala, Phuket",
    },
    buildings,
    units,
    prices,
    media: [
      { media_type: "cover", url: "https://example.test/cover.jpg" },
      { media_type: "brochure", url: "https://example.test/brochure.pdf", title: "Brochure" },
      { media_type: "document", url: "https://example.test/payment-plan.pdf", title: "Payment plan" },
    ],
  });
}

describe("progressive ingestion — minimal draft (in-memory behavioral)", () => {
  it("creates a name-only draft with null developer_id and location_id", async () => {
    const executor = new FakeIngestExecutor();
    const summary = await executor.ingest(
      batchOf({
        schema_version: "1",
        mode: "create",
        project: { slug: "sunrise-hill", name: "Sunrise Hill" },
      }),
    );
    expect(summary.mode).toBe("create");
    const project = executor.store.projects[0];
    expect(project).toMatchObject({
      slug: "sunrise-hill",
      name: "Sunrise Hill",
      developer_id: null,
      location_id: null,
      public_status: "draft",
      forever_verified: false,
    });
  });

  it("preserves raw developer and location names verbatim", async () => {
    const executor = new FakeIngestExecutor();
    const built = await buildProgressiveBatch(emptyReader, {
      mode: "create",
      project: {
        slug: "coralina",
        name: "Coralina",
        developer_name_raw: "Rhom Bho Property Public Company Limited",
        location_name_raw: "Kamala, Phuket",
      },
    });
    await executor.ingest(built);
    expect(executor.store.projects[0]).toMatchObject({
      developer_name_raw: "Rhom Bho Property Public Company Limited",
      location_name_raw: "Kamala, Phuket",
      developer_id: null,
      location_id: null,
    });
  });

  it("turns unresolved dependencies into persisted warnings, never blockers", async () => {
    const executor = new FakeIngestExecutor();
    const built = await buildProgressiveBatch(emptyReader, {
      mode: "create",
      project: {
        slug: "coralina",
        name: "Coralina",
        developer_name_raw: "Rhom Bho Property Public Company Limited",
        location_name_raw: "Kamala, Phuket",
      },
    });
    const summary = await executor.ingest(built);
    expect(summary.counts.warnings).toBe(2);
    expect(executor.store.warnings.map((warning) => warning.code).sort()).toEqual([
      "developer_unresolved",
      "location_unresolved",
    ]);
  });

  it("auto-links exactly one safe exact-slug dependency match", async () => {
    const built = await buildProgressiveBatch(
      readerWith({
        developers: [
          {
            id: "dev-1",
            slug: "rhom-bho-property-public-company-limited",
            name: "Rhom Bho Property Public Company Limited",
          },
        ],
      }),
      {
        mode: "create",
        project: {
          slug: "coralina",
          name: "Coralina",
          developer_name_raw: "Rhom Bho Property Public Company Limited",
        },
      },
    );
    expect(built.project.developer_id).toBe("dev-1");
    expect(built.warnings ?? []).toEqual([]);
  });

  it("does not auto-link ambiguous or slug-mismatched matches", async () => {
    const ambiguous = await buildProgressiveBatch(
      readerWith({
        developers: [
          { id: "dev-1", slug: "rhom-bho-property-public-company-limited", name: "Rhom Bho" },
          { id: "dev-2", slug: "rhom-bho-property-public-company-limited", name: "Rhom Bho 2" },
        ],
      }),
      {
        mode: "create",
        project: {
          slug: "coralina",
          name: "Coralina",
          developer_name_raw: "Rhom Bho Property Public Company Limited",
        },
      },
    );
    expect(ambiguous.project.developer_id).toBeUndefined();
    expect(ambiguous.warnings?.[0]?.code).toBe("developer_ambiguous");

    const nullSlug = await buildProgressiveBatch(
      readerWith({
        developers: [
          { id: "dev-3", slug: null, name: "Rhom Bho Property Public Company Limited" },
        ],
      }),
      {
        mode: "create",
        project: {
          slug: "coralina",
          name: "Coralina",
          developer_name_raw: "Rhom Bho Property Public Company Limited",
        },
      },
    );
    expect(nullSlug.project.developer_id).toBeUndefined();
    expect(nullSlug.warnings?.[0]?.code).toBe("developer_match_requires_confirmation");
    expect(nullSlug.warnings?.[0]?.payload).toMatchObject({ candidate_id: "dev-3" });
  });
});

describe("progressive ingestion — rich ordinary import (in-memory behavioral)", () => {
  it("imports 1 project + 8 buildings + 198 units + 198 prices + media in ONE call", async () => {
    const executor = new FakeIngestExecutor();
    const summary = await executor.ingest(coralinaSizedBatch());
    expect(summary.counts).toMatchObject({ buildings: 8, units: 198, prices: 198, media: 3 });
    expect(executor.store.projects).toHaveLength(1);
    expect(executor.store.buildings).toHaveLength(8);
    expect(executor.store.units).toHaveLength(198);
    expect(executor.store.prices).toHaveLength(198);
    expect(executor.store.media).toHaveLength(3);
  });

  it("uses no approval, lock, receipt, or prerequisite artifacts", async () => {
    const executor = new FakeIngestExecutor();
    await executor.ingest(coralinaSizedBatch());
    // The whole progressive state model contains only ordinary rows plus the
    // idempotency record — nothing approval- or receipt-shaped.
    expect(Object.keys(executor.store).sort()).toEqual([
      "batches",
      "buildings",
      "media",
      "prices",
      "projects",
      "units",
      "warnings",
    ]);
    expect(executor.store.batches[0]).not.toHaveProperty("approval_digest");
    expect(executor.store.batches[0]).not.toHaveProperty("consumed_at");
  });

  it("rolls back the whole batch on an injected technical failure", async () => {
    const executor = new FakeIngestExecutor();
    executor.failOnUnitCode = "A150";
    await expect(executor.ingest(coralinaSizedBatch())).rejects.toThrow("injected_failure");
    expect(executor.store.projects).toHaveLength(0);
    expect(executor.store.buildings).toHaveLength(0);
    expect(executor.store.units).toHaveLength(0);
    expect(executor.store.prices).toHaveLength(0);
    expect(executor.store.batches).toHaveLength(0);
  });
});

describe("progressive ingestion — idempotency (in-memory behavioral)", () => {
  it("replays an exact create batch instead of failing on the existing slug", async () => {
    const executor = new FakeIngestExecutor();
    const batch = coralinaSizedBatch();
    const first = await executor.ingest(batch);
    expect(first.replayed).toBe(false);
    const replay = await executor.ingest(structuredClone(batch));
    expect(replay.replayed).toBe(true);
    expect(replay.project_id).toBe(first.project_id);
    expect(executor.store.projects).toHaveLength(1);
    expect(executor.store.units).toHaveLength(198);
    expect(executor.store.batches).toHaveLength(1);
  });

  it("hard-fails when the same fingerprint carries changed content", async () => {
    const executor = new FakeIngestExecutor();
    const batch = coralinaSizedBatch();
    await executor.ingest(batch);
    const tampered = structuredClone(batch);
    tampered.project.name = "Coralina Deluxe";
    // fingerprint intentionally NOT recomputed
    await expect(executor.ingest(tampered)).rejects.toThrow("fingerprint_payload_mismatch");
  });

  it("hard-fails an unrelated create batch against an existing slug", async () => {
    const executor = new FakeIngestExecutor();
    await executor.ingest(coralinaSizedBatch());
    const unrelated = batchOf({
      schema_version: "1",
      mode: "create",
      project: { slug: "coralina", name: "A different Coralina" },
    });
    await expect(executor.ingest(unrelated)).rejects.toThrow("project_slug_exists");
  });

  it("applies an edited new batch to only the changed rows", async () => {
    const executor = new FakeIngestExecutor();
    await executor.ingest(coralinaSizedBatch());
    const before = structuredClone(executor.store.units);

    const edited = batchOf({
      schema_version: "1",
      mode: "enrich",
      project: { slug: "coralina" },
      units: [{ unit_code: "A5", bedrooms: 4 }],
    });
    await executor.ingest(edited);

    const changed = executor.store.units.find((unit) => unit.unit_code === "A5");
    expect(changed?.bedrooms).toBe(4);
    const others = executor.store.units.filter((unit) => unit.unit_code !== "A5");
    const beforeOthers = before.filter((unit) => unit.unit_code !== "A5");
    expect(others).toEqual(beforeOthers);
    expect(executor.store.units).toHaveLength(198);
  });
});

describe("progressive ingestion — incremental enrichment (in-memory behavioral)", () => {
  it("price-only enrichment touches no buildings, units, or media", async () => {
    const executor = new FakeIngestExecutor();
    await executor.ingest(coralinaSizedBatch());
    const buildingsBefore = structuredClone(executor.store.buildings);
    const unitsBefore = structuredClone(executor.store.units);
    const mediaBefore = structuredClone(executor.store.media);

    const priceOnly = batchOf({
      schema_version: "1",
      mode: "enrich",
      project: { slug: "coralina" },
      prices: [
        {
          unit_code: "A1",
          price: 4_444_000,
          currency: "THB",
          price_source: "developer_price_list",
          source_file: "price-list-july.pdf",
          price_list_date: "2026-07-01",
        },
      ],
    });
    const summary = await executor.ingest(priceOnly);
    expect(summary.counts).toMatchObject({ buildings: 0, units: 0, prices: 1, media: 0 });
    expect(executor.store.buildings).toEqual(buildingsBefore);
    expect(executor.store.units).toEqual(unitsBefore);
    expect(executor.store.media).toEqual(mediaBefore);
    expect(executor.store.prices).toHaveLength(199);
  });

  it("unit-only enrichment resolves an existing building of the same project", async () => {
    const executor = new FakeIngestExecutor();
    await executor.ingest(coralinaSizedBatch());
    const buildingId = executor.store.buildings.find(
      (building) => building.building_code === "3",
    )?.id;

    const unitOnly = batchOf({
      schema_version: "1",
      mode: "enrich",
      project: { slug: "coralina" },
      units: [{ unit_code: "NEW-1", building_code: "3", bedrooms: 2 }],
    });
    await executor.ingest(unitOnly);

    const unit = executor.store.units.find((row) => row.unit_code === "NEW-1");
    expect(unit?.building_id).toBe(buildingId);
    expect(executor.store.buildings).toHaveLength(8);
    expect(
      executor.store.warnings.filter((warning) => warning.code === "building_unresolved"),
    ).toHaveLength(0);
  });

  it("warns instead of failing when a unit's building is unknown", async () => {
    const executor = new FakeIngestExecutor();
    await executor.ingest(coralinaSizedBatch());
    const unitOnly = batchOf({
      schema_version: "1",
      mode: "enrich",
      project: { slug: "coralina" },
      units: [{ unit_code: "NEW-2", building_code: "99" }],
    });
    await executor.ingest(unitOnly);
    const unit = executor.store.units.find((row) => row.unit_code === "NEW-2");
    expect(unit?.building_id).toBeNull();
    expect(
      executor.store.warnings.filter((warning) => warning.code === "building_unresolved"),
    ).toHaveLength(1);
  });

  it("has no cross-project write path: a foreign unit code fails the whole batch", async () => {
    const executor = new FakeIngestExecutor();
    await executor.ingest(coralinaSizedBatch());
    await executor.ingest(
      batchOf({
        schema_version: "1",
        mode: "create",
        project: { slug: "other-project", name: "Other Project" },
        units: [{ unit_code: "OTHER-1" }],
      }),
    );
    const pricesBefore = executor.store.prices.length;
    const crossProject = batchOf({
      schema_version: "1",
      mode: "enrich",
      project: { slug: "coralina" },
      prices: [{ unit_code: "OTHER-1", price: 1_000_000 }],
    });
    await expect(executor.ingest(crossProject)).rejects.toThrow("price_unit_unknown");
    expect(executor.store.prices).toHaveLength(pricesBefore);
  });

  it("presence-aware updates: omitted values never overwrite curated data", async () => {
    const executor = new FakeIngestExecutor();
    await executor.ingest(
      batchOf({
        schema_version: "1",
        mode: "create",
        project: { slug: "coralina", name: "Coralina" },
        buildings: [{ building_code: "1", name: "Ocean Wing", floors_count: 7 }],
        media: [
          {
            media_type: "gallery",
            url: "https://example.test/1.jpg",
            title: "Sunset facade",
            sort_order: 5,
          },
        ],
      }),
    );
    // Re-send the building and media WITHOUT name/title/sort_order.
    await executor.ingest(
      batchOf({
        schema_version: "1",
        mode: "enrich",
        project: { slug: "coralina" },
        buildings: [{ building_code: "1", units_count: 24 }],
        media: [{ media_type: "gallery", url: "https://example.test/1.jpg" }],
      }),
    );
    const building = executor.store.buildings[0];
    expect(building.name).toBe("Ocean Wing"); // NOT "Building 1"
    expect(building.floors_count).toBe(7);
    expect(building.units_count).toBe(24);
    const media = executor.store.media[0];
    expect(media.title).toBe("Sunset facade");
    expect(media.sort_order).toBe(5); // NOT reset to 0
    expect(executor.store.media).toHaveLength(1); // natural key, no duplicate
  });
});

describe("progressive ingestion — publication lifecycle (in-memory behavioral)", () => {
  it("saves as draft: the project is not publicly readable", async () => {
    const executor = new FakeIngestExecutor();
    await executor.ingest(coralinaSizedBatch());
    expect(executor.store.projects[0].public_status).toBe("draft");
    expect(executor.publicProjects()).toHaveLength(0);
  });

  it("an explicit publish makes the project public; unpublish reverts it", async () => {
    const executor = new FakeIngestExecutor();
    await executor.ingest(coralinaSizedBatch());

    const publish = batchOf({
      schema_version: "1",
      mode: "enrich",
      project: { slug: "coralina", publish: true },
    });
    const summary = await executor.ingest(publish);
    expect(summary.public_status).toBe("published");
    expect(executor.publicProjects()).toHaveLength(1);

    const unpublish = batchOf({
      schema_version: "1",
      mode: "enrich",
      project: { slug: "coralina", publish: false },
    });
    await executor.ingest(unpublish);
    expect(executor.publicProjects()).toHaveLength(0);
  });
});
