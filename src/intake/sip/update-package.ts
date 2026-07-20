/** SIP-001B portable, post-freeze version-package helpers. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import type { ExtractedPriceList, ExtractedPriceListRow, Fact } from "@/import/types";

import { atomicWriteJson, toCanonicalJson } from "../fs-utils";
import { assertPathBoundaries, assertSafeSlug, removeManagedDir } from "../paths";
import { preflightPdftotext, runPdftotextLayout } from "./pdf-tool";
import {
  fingerprintSourceFile,
  processWithSourceIntegrity,
  type SourceFileFingerprint,
} from "./source-integrity";
import type { PdfTextExtraction, PdfToolPreflight, PreparationSummary, SourceProof } from "./types";

export const BOUND_PRICE_ARTIFACT_KEYS = [
  "source_proof",
  "qualification",
  "candidate_price_list",
  "review_summary",
  "preparation_summary",
  "reviewed_price_list",
] as const;

const PREPARATION_HASH_KEYS = BOUND_PRICE_ARTIFACT_KEYS.filter(
  (key) => key !== "preparation_summary",
);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const TELEGRAM_PUBLIC_CHANNEL_PATTERN = /^@[A-Za-z][A-Za-z0-9_]{4,31}$/;

export type BoundPriceArtifactKey = (typeof BOUND_PRICE_ARTIFACT_KEYS)[number];
export type BoundPriceArtifactPaths = Record<BoundPriceArtifactKey, string>;

export interface SIP001BPackageInput {
  projectSlug: string;
  updateDate: string;
  /** Optional public Telegram channel reference only; never a message identifier or timestamp. */
  originChannel?: string;
  pricePdfPath: string;
  masterPdfPath: string;
  priceArtifacts: BoundPriceArtifactPaths;
  previousPriceList: ExtractedPriceList;
  outDir: string;
  workspaceRoot: string;
  /** Test-only deterministic local tool injection; the CLI never exposes this. */
  toolOverride?: PdfToolPreflight;
  /** Test-only read-only extraction injection; production always invokes local pdftotext. */
  masterExtractionOverride?: (input: {
    tool: PdfToolPreflight;
    pdfPath: string;
    workspaceDir: string;
  }) => PdfTextExtraction;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(path: string, artifactName: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`sip_package_artifact_unreadable: ${artifactName}`);
  }
}

function assertIsoDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("sip_package_update_date_invalid");
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error("sip_package_update_date_invalid");
  }
}

function normalizeOriginChannel(originChannel: string | undefined): string | null {
  if (originChannel === undefined) return null;
  if (!TELEGRAM_PUBLIC_CHANNEL_PATTERN.test(originChannel)) {
    throw new Error("sip_package_origin_channel_invalid");
  }
  return originChannel;
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  code: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(code);
  }
}

function readBoundPriceArtifacts(input: BoundPriceArtifactPaths): {
  hashes: Record<BoundPriceArtifactKey, string>;
  reviewedPriceList: ExtractedPriceList;
  sourceProof: SourceProof;
} {
  if (!isRecord(input)) throw new Error("sip_package_artifact_paths_invalid");
  assertExactKeys(input, BOUND_PRICE_ARTIFACT_KEYS, "sip_package_artifact_keys_invalid");

  const resolvedPaths = new Map<BoundPriceArtifactKey, string>();
  const seenPaths = new Set<string>();
  const parsed = new Map<BoundPriceArtifactKey, unknown>();
  const hashes = {} as Record<BoundPriceArtifactKey, string>;
  for (const key of BOUND_PRICE_ARTIFACT_KEYS) {
    const candidate = input[key];
    if (typeof candidate !== "string" || candidate.trim() === "") {
      throw new Error(`sip_package_artifact_path_invalid: ${key}`);
    }
    const path = resolve(candidate);
    if (seenPaths.has(path)) throw new Error("sip_package_duplicate_artifact_path");
    seenPaths.add(path);
    resolvedPaths.set(key, path);
    hashes[key] = sha256File(path);
    parsed.set(key, readJson(path, key));
  }

  const summary = parsed.get("preparation_summary");
  if (!isRecord(summary) || !isRecord(summary.artifact_hashes)) {
    throw new Error("sip_package_preparation_summary_invalid");
  }
  assertExactKeys(
    summary.artifact_hashes,
    PREPARATION_HASH_KEYS,
    "sip_package_preparation_hash_keys_invalid",
  );
  for (const key of PREPARATION_HASH_KEYS) {
    const expected = summary.artifact_hashes[key];
    if (
      typeof expected !== "string" ||
      !SHA256_PATTERN.test(expected) ||
      expected !== hashes[key]
    ) {
      throw new Error(`sip_package_artifact_hash_mismatch: ${key}`);
    }
  }

  const reviewed = parsed.get("reviewed_price_list");
  if (!isRecord(reviewed) || !Array.isArray(reviewed.unit_inventory)) {
    throw new Error("sip_package_reviewed_price_list_invalid");
  }
  const sourceProof = parsed.get("source_proof");
  if (!isRecord(sourceProof)) throw new Error("sip_package_source_proof_invalid");
  return {
    hashes,
    reviewedPriceList: reviewed as ExtractedPriceList,
    sourceProof: sourceProof as unknown as SourceProof,
  };
}

function assertPriceSourceProof(sourceProof: SourceProof, actual: SourceFileFingerprint): void {
  const validFingerprint = (value: unknown): value is SourceFileFingerprint =>
    isRecord(value) &&
    typeof value.sha256 === "string" &&
    SHA256_PATTERN.test(value.sha256) &&
    typeof value.byte_size === "number" &&
    Number.isSafeInteger(value.byte_size) &&
    value.byte_size >= 0;
  if (
    !sourceProof.hash_verified_unchanged_after_extraction ||
    !validFingerprint(sourceProof.pre_processing) ||
    !validFingerprint(sourceProof.post_processing) ||
    sourceProof.sha256 !== actual.sha256 ||
    sourceProof.byte_size !== actual.byte_size ||
    sourceProof.pre_processing.sha256 !== actual.sha256 ||
    sourceProof.pre_processing.byte_size !== actual.byte_size ||
    sourceProof.post_processing.sha256 !== actual.sha256 ||
    sourceProof.post_processing.byte_size !== actual.byte_size
  ) {
    throw new Error("sip_package_price_source_proof_mismatch");
  }
}

function assertUpdateDateMatchesPriceList(priceList: ExtractedPriceList, updateDate: string): void {
  const fact = priceList.price_list_date as Fact<unknown> | undefined;
  if (typeof fact?.value !== "string" || fact.value !== updateDate) {
    throw new Error("sip_package_update_date_price_list_mismatch");
  }
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

export function writeSIP001BPackage(input: SIP001BPackageInput) {
  assertSafeSlug(input.projectSlug);
  assertIsoDate(input.updateDate);
  const originChannel = normalizeOriginChannel(input.originChannel);
  const pricePdfPath = resolve(input.pricePdfPath);
  const masterPdfPath = resolve(input.masterPdfPath);
  const outDir = resolve(input.outDir);
  const workspaceRoot = resolve(input.workspaceRoot);
  const workspaceDir = join(workspaceRoot, `sip-master-${process.pid}-${Date.now()}`);
  assertPathBoundaries({
    outRoot: dirname(outDir),
    projectDir: outDir,
    workspaceDir,
    sources: [dirname(pricePdfPath), dirname(masterPdfPath)],
  });

  const price = { basename: basename(pricePdfPath), ...fingerprintSourceFile(pricePdfPath) };
  const bound = readBoundPriceArtifacts(input.priceArtifacts);
  assertPriceSourceProof(bound.sourceProof, price);
  assertUpdateDateMatchesPriceList(bound.reviewedPriceList, input.updateDate);

  const tool = input.toolOverride ?? preflightPdftotext();
  if (!tool.found) throw new Error("sip_visual_registration_pdftotext_required");
  let masterIntegrity: {
    value: PdfTextExtraction;
    before: SourceFileFingerprint;
    after: SourceFileFingerprint;
  };
  try {
    masterIntegrity = processWithSourceIntegrity(masterPdfPath, () =>
      input.masterExtractionOverride
        ? input.masterExtractionOverride({ tool, pdfPath: masterPdfPath, workspaceDir })
        : runPdftotextLayout({ tool, pdfPath: masterPdfPath, workspaceDir, mode: "layout" }),
    );
  } finally {
    removeManagedDir(workspaceDir, [workspaceRoot]);
  }
  const master = { basename: basename(masterPdfPath), ...masterIntegrity.before };
  const diff = buildVersionDiff(input.previousPriceList, bound.reviewedPriceList);
  const bundleCore = {
    sip_schema_version: "1",
    project_slug: input.projectSlug,
    update_date: input.updateDate,
    origin_channel: originChannel,
    price_artifact_hashes: bound.hashes,
    sources: [
      { ...price, role: "canonical_price_table" },
      { ...master, role: "visual_master_plan_companion" },
    ],
  };
  const sourceBundle = {
    ...bundleCore,
    bundle_id: createHash("sha256").update(toCanonicalJson(bundleCore)).digest("hex"),
  };
  const masterSourceProof = {
    sip_schema_version: "1",
    project_slug: input.projectSlug,
    source_filename: master.basename,
    sha256: master.sha256,
    byte_size: master.byte_size,
    pre_processing: masterIntegrity.before,
    post_processing: masterIntegrity.after,
    hash_verified_unchanged_after_extraction: true,
  };
  const masterRegistration = {
    sip_schema_version: "1",
    source_filename: master.basename,
    sha256: master.sha256,
    byte_size: master.byte_size,
    page_count: masterIntegrity.value.pageCount,
    floor_sequence_status: "not_machine_interpreted_in_sip_001b",
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
  atomicWriteJson(join(outDir, "source-bundle.json"), sourceBundle);
  atomicWriteJson(join(outDir, "master-plan", "source-proof.json"), masterSourceProof);
  atomicWriteJson(join(outDir, "master-plan", "registration.json"), masterRegistration);
  atomicWriteJson(join(outDir, "version-diff.json"), diff);
  atomicWriteJson(join(outDir, "cross-source-summary.json"), crossSource);
  return { sourceBundle, masterSourceProof, masterRegistration, diff, crossSource, price, master };
}
