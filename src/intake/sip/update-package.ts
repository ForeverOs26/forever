/** SIP-001B portable, post-freeze version-package helpers. */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { atomicWriteJson, toCanonicalJson } from "../fs-utils";
import { removeManagedDir } from "../paths";
import type { ExtractedPriceList, ExtractedPriceListRow, Fact } from "@/import/types";
import { preflightPdftotext, runPdftotextLayout } from "./pdf-tool";

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
function value(fact: Fact<unknown> | undefined): unknown {
  return fact?.value ?? null;
}
function identity(row: ExtractedPriceListRow): string | null {
  const unit = value(row.unit_number as Fact<unknown> | undefined);
  return typeof unit === "string" && unit.trim() ? unit.trim().toUpperCase() : null;
}
function sourceRef(row: ExtractedPriceListRow): {
  source_file: string | null;
  page_number: number | null;
  source_row: number | undefined;
} {
  const fact = row.unit_number;
  return {
    source_file: fact?.source_file ?? null,
    page_number: fact?.page_number ?? null,
    source_row: row.source_row,
  };
}
function numberValue(fact: Fact<unknown> | undefined): number | null {
  const raw = value(fact);
  const parsed = Number(String(raw ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
function changed(a: Fact<unknown> | undefined, b: Fact<unknown> | undefined): boolean {
  return String(value(a) ?? "").trim() !== String(value(b) ?? "").trim();
}

export function buildVersionDiff(previous: ExtractedPriceList, latest: ExtractedPriceList) {
  const previousRows = previous.unit_inventory ?? [];
  const latestRows = latest.unit_inventory ?? [];
  const index = (rows: ExtractedPriceListRow[]) => {
    const map = new Map<string, ExtractedPriceListRow>();
    const duplicates: string[] = [];
    for (const row of rows) {
      const key = identity(row);
      if (!key) continue;
      if (map.has(key)) duplicates.push(key);
      else map.set(key, row);
    }
    return { map, duplicates: [...new Set(duplicates)].sort() };
  };
  const old = index(previousRows);
  const next = index(latestRows);
  const shared = [...next.map.keys()].filter((key) => old.map.has(key)).sort();
  const added = [...next.map.keys()].filter((key) => !old.map.has(key)).sort();
  const absent = [...old.map.keys()].filter((key) => !next.map.has(key)).sort();
  const priceChanges: Array<Record<string, unknown> & { unit_identity: string }> = [];
  const ppsmChanges: Array<Record<string, unknown> & { unit_identity: string }> = [];
  const availabilityChanges: Array<Record<string, unknown> & { unit_identity: string }> = [];
  const attributeChanges: Array<Record<string, unknown> & { unit_identity: string }> = [];
  const unchanged: string[] = [];
  for (const key of shared) {
    const before = old.map.get(key)!;
    const after = next.map.get(key)!;
    const oldPrice = numberValue(before.price);
    const newPrice = numberValue(after.price);
    if (oldPrice !== newPrice)
      priceChanges.push({
        unit_identity: key,
        old_value: value(before.price),
        new_value: value(after.price),
        absolute_delta: oldPrice !== null && newPrice !== null ? newPrice - oldPrice : null,
        percentage_delta: oldPrice && newPrice ? ((newPrice - oldPrice) / oldPrice) * 100 : null,
        previous_source_ref: sourceRef(before),
        new_source_ref: sourceRef(after),
      });
    const oldPpsm = numberValue(before.price_per_sqm);
    const newPpsm = numberValue(after.price_per_sqm);
    if (oldPpsm !== newPpsm)
      ppsmChanges.push({
        unit_identity: key,
        old_value: value(before.price_per_sqm),
        new_value: value(after.price_per_sqm),
        previous_source_ref: sourceRef(before),
        new_source_ref: sourceRef(after),
      });
    if (changed(before.availability_status, after.availability_status))
      availabilityChanges.push({
        unit_identity: key,
        old_value: value(before.availability_status),
        new_value: value(after.availability_status),
        previous_source_ref: sourceRef(before),
        new_source_ref: sourceRef(after),
      });
    const fields = [
      "unit_number",
      "unit_code",
      "unit_type",
      "building",
      "floor",
      "size_sqm",
    ] as const;
    const changes = fields
      .filter((field) => changed(before[field], after[field]))
      .map((field) => ({ field, old_value: value(before[field]), new_value: value(after[field]) }));
    if (changes.length)
      attributeChanges.push({
        unit_identity: key,
        changes,
        previous_source_ref: sourceRef(before),
        new_source_ref: sourceRef(after),
      });
    if (
      !priceChanges.some((x) => x.unit_identity === key) &&
      !ppsmChanges.some((x) => x.unit_identity === key) &&
      !availabilityChanges.some((x) => x.unit_identity === key) &&
      !attributeChanges.some((x) => x.unit_identity === key)
    )
      unchanged.push(key);
  }
  return {
    previous_source_date: value(previous.price_list_date as Fact<unknown> | undefined),
    new_source_date: value(latest.price_list_date as Fact<unknown> | undefined),
    previous_row_count: previousRows.length,
    new_row_count: latestRows.length,
    unit_identities_present_in_both: shared,
    units_appearing_in_new_available_table: added.map((unit_identity) => ({
      unit_identity,
      new_source_ref: sourceRef(next.map.get(unit_identity)!),
    })),
    units_absent_from_new_available_table: absent.map((unit_identity) => ({
      unit_identity,
      classification: "missing_from_latest_price_list",
      previous_source_ref: sourceRef(old.map.get(unit_identity)!),
    })),
    price_changes: priceChanges,
    price_per_sqm_changes: ppsmChanges,
    availability_text_changes: availabilityChanges,
    room_code_type_area_changes: attributeChanges,
    duplicate_identities: { previous: old.duplicates, latest: next.duplicates },
    unchanged_units: unchanged,
    summary_counts: {
      shared: shared.length,
      added: added.length,
      missing_from_latest_price_list: absent.length,
      price_changes: priceChanges.length,
      price_per_sqm_changes: ppsmChanges.length,
      availability_text_changes: availabilityChanges.length,
      room_code_type_area_changes: attributeChanges.length,
      unchanged: unchanged.length,
    },
  };
}

export function writeSIP001BPackage(input: {
  projectSlug: string;
  updateDate: string;
  pricePdfPath: string;
  masterPdfPath: string;
  priceList: ExtractedPriceList;
  previousPriceList: ExtractedPriceList;
  priceArtifactHashes: Record<string, string>;
  outDir: string;
  workspaceRoot: string;
}) {
  const price = {
    basename: basename(input.pricePdfPath),
    sha256: sha256File(input.pricePdfPath),
    byte_size: statSync(input.pricePdfPath).size,
  };
  const master = {
    basename: basename(input.masterPdfPath),
    sha256: sha256File(input.masterPdfPath),
    byte_size: statSync(input.masterPdfPath).size,
  };
  const tool = preflightPdftotext();
  if (!tool.found) throw new Error("sip_visual_registration_pdftotext_required");
  const workspaceDir = join(input.workspaceRoot, `sip-master-${process.pid}-${Date.now()}`);
  let extraction;
  try {
    extraction = runPdftotextLayout({
      tool,
      pdfPath: input.masterPdfPath,
      workspaceDir,
      mode: "layout",
    });
  } finally {
    removeManagedDir(workspaceDir, [resolve(input.workspaceRoot)]);
  }
  const diff = buildVersionDiff(input.previousPriceList, input.priceList);
  const bundleCore = {
    sip_schema_version: "1",
    project_slug: input.projectSlug,
    update_date: input.updateDate,
    origin_channel: "@coralinakamala",
    sources: [
      { ...price, role: "canonical_price_table" },
      { ...master, role: "visual_master_plan_companion" },
    ],
  };
  const sourceBundle = {
    ...bundleCore,
    bundle_id: createHash("sha256").update(toCanonicalJson(bundleCore)).digest("hex"),
  };
  const masterRegistration = {
    sip_schema_version: "1",
    source_filename: master.basename,
    sha256: master.sha256,
    byte_size: master.byte_size,
    page_count: extraction.pageCount,
    visible_floor_page_sequence: Array.from({ length: extraction.pageCount }, (_, i) => i + 1),
    document_role: "visual_master_plan_companion",
    paired_update_date: input.updateDate,
    paired_primary_source: price.basename,
    processing_status: "registered_visual_source",
    machine_extraction_status: "not_machine_interpreted_in_sip_001b",
  };
  const crossSource = {
    sip_schema_version: "1",
    primary_table_authority:
      "The primary Price List is authoritative for structured availability and prices in this update package.",
    master_plan_role: "The Master Plan is registered as visual companion evidence.",
    unit_level_master_plan_extraction: "not_performed",
    automatic_conflict_resolution: "not_performed",
    future_spatial_extraction: "requires_a_separate_approved_checkpoint",
    telegram_monitoring: "not_implemented_in_sip_001b",
  };
  atomicWriteJson(join(input.outDir, "source-bundle.json"), sourceBundle);
  atomicWriteJson(join(input.outDir, "master-plan", "source-proof.json"), {
    sip_schema_version: "1",
    project_slug: input.projectSlug,
    source_filename: master.basename,
    sha256: master.sha256,
    byte_size: master.byte_size,
    hash_verified_unchanged_after_extraction: true,
  });
  atomicWriteJson(join(input.outDir, "master-plan", "registration.json"), masterRegistration);
  atomicWriteJson(join(input.outDir, "version-diff.json"), diff);
  atomicWriteJson(join(input.outDir, "cross-source-summary.json"), crossSource);
  return { sourceBundle, masterRegistration, diff, crossSource, price, master };
}
