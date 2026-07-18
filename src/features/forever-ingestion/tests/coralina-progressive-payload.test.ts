import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { ProgressiveBatch } from "../batch-types";
import { assertProgressiveBatchStructure } from "../batch-types";
import { fingerprintBatch } from "../build-batch";
import { FakeIngestExecutor } from "./fake-ingest-executor";

const payloadPath = "forever-data/projects/coralina/progressive/payload.json";
const payloadBytes = readFileSync(payloadPath);
const payload = JSON.parse(payloadBytes.toString("utf8")) as ProgressiveBatch;

describe("Coralina permanent Progressive payload", () => {
  it("matches the RPC contract and its deterministic fingerprint", () => {
    expect(() => assertProgressiveBatchStructure(payload)).not.toThrow();
    const { batch_fingerprint, ...body } = payload;
    expect(fingerprintBatch(body)).toBe(batch_fingerprint);
    expect(createHash("sha256").update(payloadBytes).digest("hex")).toBe(
      "2d5613a35705b251f20208aa4273038c2d8001bebe5d2c5bab5e55cb653e6605",
    );
  });

  it("has the exact source-proven graph with no orphan or duplicate rows", () => {
    expect(payload.buildings).toHaveLength(8);
    expect(payload.units).toHaveLength(198);
    expect(payload.prices).toHaveLength(198);
    const buildings = new Set(payload.buildings?.map((row) => row.building_code));
    const units = new Set(payload.units?.map((row) => row.unit_code));
    expect(buildings.size).toBe(8);
    expect(units.size).toBe(198);
    expect(payload.units?.every((row) => row.building_code && buildings.has(row.building_code))).toBe(true);
    expect(payload.prices?.every((row) => units.has(row.unit_code))).toBe(true);
    expect(new Set(payload.prices?.map((row) => `${row.unit_code}|${row.price_source}|${row.source_file}|${row.source_page}|${row.price_list_date}`)).size).toBe(198);
  });

  it("preserves identity, null canonical links, inference provenance, and draft intent", () => {
    expect(payload.project).toMatchObject({
      slug: "coralina",
      name: "The Title Coralina Kamala",
      developer_id: null,
      location_id: null,
      developer_name_raw: "Rhom Bho Property Public Company Limited",
      location_name_raw: "Kamala, Phuket, Thailand",
      publish: false,
    });
    expect(payload.prices?.every((row) => row.currency === "THB")).toBe(true);
    expect(payload.prices?.every((row) => {
      const decision = row.metadata?.currency_decision as Record<string, unknown>;
      const field = (row.metadata?.field_provenance as Record<string, Record<string, unknown>>).currency;
      return decision.status === "inferred_default" &&
        decision.inferenceRule === "project_country_default_currency" &&
        decision.inferenceRuleVersion === "1.0.0" &&
        decision.confidence === "medium" &&
        field.status === "inferred";
    })).toBe(true);
    expect(JSON.stringify(payload)).not.toMatch(/approval|receipt|lock_digest|service_role|password|postgresql:\/\//i);
  });

  it("imports once, replays identically, and rejects a conflicting identity", async () => {
    const executor = new FakeIngestExecutor();
    const first = await executor.ingest(structuredClone(payload));
    expect(first).toMatchObject({ public_status: "draft", replayed: false });
    expect(first.counts).toMatchObject({ buildings: 8, units: 198, prices: 198, media: 0, warnings: 6 });
    expect(executor.publicProjects()).toHaveLength(0);
    await expect(executor.ingest(structuredClone(payload))).resolves.toMatchObject({ replayed: true });
    const conflicting = structuredClone(payload);
    conflicting.batch_fingerprint = "0".repeat(64);
    conflicting.project.name = "Conflicting Coralina";
    await expect(executor.ingest(conflicting)).rejects.toThrow("project_slug_exists");
  });
});
