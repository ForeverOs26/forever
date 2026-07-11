import { describe, expect, it } from "vitest";

import type { ForeverMedia } from "@/features/forever-database";

import {
  MediaImportSource,
  createImportResult,
  defineImportAdapter,
  emptyStats,
  normalizeMedia,
  type ImportContext,
  type ImportSource,
  type RawImportInput,
  type ReferenceScope,
} from "..";
import { makeContext, makeSource } from "./fixtures";

const mediaAdapter = defineImportAdapter<ForeverMedia>({
  format: "manual",
  kind: "media",
  adapt(input: RawImportInput, context: ImportContext) {
    const rows = Array.isArray(input) ? (input as Record<string, unknown>[]) : [];
    const data: ForeverMedia[] = [];
    rows.forEach((row, index) => {
      const normalized = normalizeMedia(row);
      if (normalized) {
        data.push({ id: `media-${index}`, projectId: "project-1", ...normalized });
      }
    });
    return createImportResult({
      data,
      stats: { ...emptyStats(), total: rows.length, imported: data.length },
      metadata: {
        source: context.source,
        importedAt: context.now,
        adapter: "manual",
        recordCount: data.length,
      },
    });
  },
});

/** A concrete source whose `read()` returns in-memory rows — no IO. */
class TestMediaSource extends MediaImportSource {
  readonly descriptor: ImportSource = makeSource({ kind: "media", format: "manual" });

  constructor(
    private readonly rows: unknown[],
    private readonly scope: ReferenceScope = {},
  ) {
    super(mediaAdapter);
  }

  protected read(): RawImportInput {
    return this.rows;
  }

  protected referenceScope(): ReferenceScope {
    return this.scope;
  }
}

describe("AbstractImportSource wiring", () => {
  it("adapts then validates, succeeding when references resolve via scope", () => {
    const source = new TestMediaSource([{ url: "https://cdn.example.com/a.jpg" }], {
      projectIds: new Set(["project-1"]),
    });
    const result = source.load(makeContext());
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.stats.imported).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it("surfaces validation errors when a reference cannot be resolved", () => {
    const source = new TestMediaSource([{ url: "https://cdn.example.com/a.jpg" }]);
    const result = source.load(makeContext());
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "unresolved_reference")).toBe(true);
    expect(result.stats.imported).toBe(0);
    expect(result.stats.failed).toBe(1);
  });

  it("carries adapter metadata through the source unchanged", () => {
    const source = new TestMediaSource([], { projectIds: new Set(["project-1"]) });
    const context = makeContext();
    const result = source.load(context);
    expect(result.metadata.source).toBe(context.source);
    expect(result.metadata.adapter).toBe("manual");
    expect(result.ok).toBe(true);
  });
});
