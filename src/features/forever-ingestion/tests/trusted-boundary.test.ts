import { describe, expect, it } from "vitest";

import { assertProgressiveBatchStructure } from "../batch-types";
import { classifyCliPayload } from "../cli-payload";
import { createDependencyReader } from "../ingest-client";

const ready = {
  schema_version: "1",
  mode: "enrich",
  project: { slug: "protected", set: { name: "weaker" } },
  batch_fingerprint: "a".repeat(64),
};

describe("trusted progressive ingestion boundary", () => {
  it("allows a ready batch only for static dry-run inspection", () => {
    expect(classifyCliPayload(ready, true).kind).toBe("ready");
    expect(() => classifyCliPayload(ready, false)).toThrow(
      "progressive_ingestion: ready_batch_live_execution_forbidden",
    );
  });

  it("rejects unsupported schema versions and malformed collections", () => {
    expect(() => assertProgressiveBatchStructure({ ...ready, schema_version: "2" })).toThrow(
      "forever_progressive_ingest: schema_version_unsupported",
    );
    for (const key of ["buildings", "units", "prices", "media", "warnings"]) {
      expect(() => assertProgressiveBatchStructure({ ...ready, [key]: {} })).toThrow(
        `forever_progressive_ingest: ${key}_malformed`,
      );
    }
  });

  it("uses separate equality queries for punctuation-heavy names", async () => {
    const calls: Array<[string, string]> = [];
    const client = {
      from: () => ({
        select: () => ({
          eq: async (column: string, value: string) => {
            calls.push([column, value]);
            return { data: [], error: null };
          },
        }),
      }),
    };
    const reader = createDependencyReader(client as never);
    const name = "ACME, 100% (Thailand).Co";
    await reader.findDevelopers({ slug: "acme-100-thailand-co", name });
    expect(calls).toEqual([
      ["slug", "acme-100-thailand-co"],
      ["name", name],
    ]);
  });
});
