import { describe, expect, it } from "vitest";

import type { ForeverMedia } from "@/features/forever-database";

import {
  ImportAdapterRegistry,
  createImportResult,
  defineImportAdapter,
  emptyStats,
  importWarning,
  normalizeMedia,
  type ImportContext,
  type ImportWarning,
  type RawImportInput,
} from "..";
import { makeContext, makeSource } from "./fixtures";

/**
 * A minimal reference adapter defined inside the test. RC3.1 ships no concrete
 * adapters; this proves the contract is implementable and deterministic without
 * any IO — exactly what a future CSV/JSON/PDF adapter will do.
 */
const mediaAdapter = defineImportAdapter<ForeverMedia>({
  format: "json",
  kind: "media",
  adapt(input: RawImportInput, context: ImportContext) {
    const rows = Array.isArray(input) ? (input as Record<string, unknown>[]) : [];
    const data: ForeverMedia[] = [];
    const issues: ImportWarning[] = [];
    rows.forEach((row, index) => {
      const normalized = normalizeMedia(row);
      if (!normalized) {
        issues.push(importWarning("skipped_media", "Row has no valid url", `input.${index}`));
        return;
      }
      data.push({ id: `media-${index}`, projectId: "project-1", ...normalized });
    });
    return createImportResult({
      data,
      issues,
      stats: {
        ...emptyStats(),
        total: rows.length,
        imported: data.length,
        skipped: rows.length - data.length,
      },
      metadata: {
        source: context.source,
        importedAt: context.now,
        adapter: "json",
        recordCount: data.length,
      },
    });
  },
});

describe("ImportAdapter contract", () => {
  it("maps extracted rows into canonical records deterministically", () => {
    const context = makeContext({ source: makeSource({ kind: "media", format: "json" }) });
    const input = [
      { url: "https://cdn.example.com/a.jpg", mediaType: "gallery" },
      { url: "not-a-url" },
    ];
    const a = mediaAdapter.adapt(input, context);
    const b = mediaAdapter.adapt(input, context);
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    expect(a.data).toHaveLength(1);
    expect(a.warnings).toHaveLength(1);
    expect(a.stats).toEqual({
      total: 2,
      imported: 1,
      skipped: 1,
      failed: 0,
      warnings: 1,
      errors: 0,
    });
    expect(a.metadata.recordCount).toBe(1);
    expect(a.metadata.importedAt).toBe(context.now);
  });

  it("handles non-array input as an empty run", () => {
    const result = mediaAdapter.adapt(null, makeContext());
    expect(result.data).toEqual([]);
    expect(result.stats.total).toBe(0);
    expect(result.ok).toBe(true);
  });
});

describe("ImportAdapterRegistry", () => {
  it("registers, resolves, and lists adapters by (format, kind)", () => {
    const registry = new ImportAdapterRegistry();
    registry.register(mediaAdapter);
    expect(registry.has("json", "media")).toBe(true);
    expect(registry.resolve("json", "media")).toBe(mediaAdapter);
    expect(registry.resolve("csv", "media")).toBeUndefined();
    expect(registry.list()).toEqual([mediaAdapter]);
  });

  it("rejects a second adapter for the same (format, kind)", () => {
    const registry = new ImportAdapterRegistry();
    registry.register(mediaAdapter);
    expect(() => registry.register(mediaAdapter)).toThrow(/already registered/);
  });

  it("keeps distinct (format, kind) pairs independent", () => {
    const registry = new ImportAdapterRegistry();
    const csvVariant = defineImportAdapter({ ...mediaAdapter, format: "csv" as const });
    registry.register(mediaAdapter).register(csvVariant);
    expect(registry.resolve("json", "media")).toBe(mediaAdapter);
    expect(registry.resolve("csv", "media")).toBe(csvVariant);
    expect(registry.list()).toHaveLength(2);
  });
});
