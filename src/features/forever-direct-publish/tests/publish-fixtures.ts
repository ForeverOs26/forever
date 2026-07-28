/**
 * One realistic source package, shared by the tests that run a real publish.
 *
 * Extracted from `publish.test.ts` when a second file needed to execute
 * `publishProject` rather than grep its source
 * (FOREVER-MEDIA-SEMANTIC-PUBLIC-CONTRACT-001). Copying it would have been the
 * cheaper edit and the wrong one: two fixtures drift, and the whole point of the
 * new test is that a claim proved against a lookalike is not proved.
 */

import type { ProgressiveBatch } from "@/features/forever-ingestion/batch-types";
import { fingerprintBatch } from "@/features/forever-ingestion/build-batch";
import { syntheticJpeg, syntheticPng } from "@/features/forever-studio/tests/media-truth-fixtures";

import type { SourcePackage } from "../source-package";

export function batch(overrides: Partial<ProgressiveBatch> = {}): ProgressiveBatch {
  const body = {
    schema_version: "1" as const,
    mode: "create" as const,
    project: {
      slug: "the-title-legendary",
      name: "The Title Legendary Bang-Tao",
      developer_id: null,
      location_id: null,
      developer_name_raw: "Rhom Bho Property",
      location_name_raw: "Bang Tao, Phuket, Thailand",
      construction_status: "Completed",
      ownership_type: undefined,
      publish: false,
      field_provenance: {
        name: {
          status: "official_source" as const,
          source_type: "developer_official_source",
          source_ref: "https://drive.google.com/file/d/abc/view",
        },
      },
    },
    buildings: [{ building_code: "A", floors_count: 7 }],
    units: [{ unit_code: "A308", building_code: "A", availability_status: "available" }],
    prices: [{ unit_code: "A308", price: 9244800, currency: "THB", source_file: "price-list.pdf" }],
    warnings: [
      {
        entity: "project" as const,
        code: "source_marked_internal_use_only",
        severity: "warning" as const,
        message: "The official price list is marked Internal Use Only.",
      },
      {
        entity: "project" as const,
        code: "developer_unresolved",
        severity: "warning" as const,
        message: "No canonical developer row matched.",
      },
    ],
    ...overrides,
  };
  return { ...body, batch_fingerprint: fingerprintBatch(body) } as ProgressiveBatch;
}

export function pkg(overrides: Partial<SourcePackage> = {}): SourcePackage {
  return {
    ref: "the-title-legendary",
    directory: "/owner-local/the-title-legendary",
    batch: batch(),
    media: [
      { path: "photos/pool.jpg", bytes: syntheticJpeg(false, 1, 1) },
      { path: "photos/lobby.jpg", bytes: syntheticJpeg(false, 1, 2) },
      { path: "master-plan/site.png", bytes: syntheticPng(false, 1, 3) },
    ],
    manifest: null,
    skipped: [],
    ...overrides,
  };
}
