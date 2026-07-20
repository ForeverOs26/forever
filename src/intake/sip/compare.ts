/**
 * SIP-001A — post-extraction ground-truth comparison (READ-ONLY, separate).
 *
 * This is the ONLY module in SIP-001A authorized to read the manually
 * reviewed ground-truth comparison JSON. It runs strictly AFTER the
 * reviewed final `ExtractedPriceList` is already fixed — it never feeds
 * anything back into extraction, qualification, normalization, or review,
 * and it never modifies the reviewed output to match the ground truth. It
 * is a read-only oracle check, not an extraction input.
 *
 * Every metric is reported as an explicit numerator/denominator pair; there
 * is no vague single "accuracy" percentage.
 */

import { readFileSync } from "node:fs";

import type { ExtractedPriceList, ExtractedPriceListRow, Fact } from "@/import/types";

export interface Ratio {
  numerator: number;
  denominator: number;
}

export interface ComparisonReport {
  extracted_unit_row_recall: Ratio;
  exact_unit_identity_agreement: Ratio;
  exact_unit_type_agreement: Ratio;
  bedrooms_agreement: Ratio;
  bathrooms_agreement: Ratio;
  size_agreement: Ratio;
  availability_agreement: Ratio;
  positive_price_agreement: Ratio;
  null_price_preservation: Ratio;
  currency_agreement: Ratio;
  source_reference_completeness: Ratio;
  fabricated_row_count: number;
  fabricated_price_count: number;
  lost_null_price_count: number;
  missing_expected_row_count: number;
  unexpected_row_count: number;
  review_item_count: number;
  manual_review_time_seconds: number | null;
}

function normalizeIdentity(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/\s+/g, " ").toUpperCase();
  return text.length > 0 ? text : null;
}

function factValue<T>(fact: Fact<T> | undefined): T | null {
  return fact && fact.value !== undefined ? fact.value : null;
}

function rowsByIdentity(rows: ExtractedPriceListRow[]): Map<string, ExtractedPriceListRow> {
  const map = new Map<string, ExtractedPriceListRow>();
  for (const row of rows) {
    const key = normalizeIdentity(factValue(row.unit_number));
    if (key && !map.has(key)) map.set(key, row);
  }
  return map;
}

function fieldEquals(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/**
 * Compare a reviewed final `ExtractedPriceList` against a ground-truth
 * `ExtractedPriceList`-shaped file, read-only. Never mutates either input.
 */
export function compareAgainstGroundTruth(
  reviewed: ExtractedPriceList,
  groundTruth: ExtractedPriceList,
  options: { reviewItemCount: number; manualReviewTimeSeconds?: number | null } = {
    reviewItemCount: 0,
  },
): ComparisonReport {
  const reviewedRows = reviewed.unit_inventory ?? [];
  const groundTruthRows = groundTruth.unit_inventory ?? [];
  const extractedByIdentity = rowsByIdentity(reviewedRows);
  const groundTruthByIdentity = rowsByIdentity(groundTruthRows);

  let recallHits = 0;
  let exactIdentityHits = 0;
  let unitTypeComparable = 0;
  let unitTypeHits = 0;
  let bedroomsComparable = 0;
  let bedroomsHits = 0;
  let bathroomsComparable = 0;
  let bathroomsHits = 0;
  let sizeComparable = 0;
  let sizeHits = 0;
  let availabilityComparable = 0;
  let availabilityHits = 0;
  let positivePriceComparable = 0;
  let positivePriceHits = 0;
  let nullPriceComparable = 0;
  let nullPriceHits = 0;
  let currencyComparable = 0;
  let currencyHits = 0;
  let fabricatedPriceCount = 0;
  let lostNullPriceCount = 0;

  for (const [key, gtRow] of groundTruthByIdentity) {
    const extractedRow = extractedByIdentity.get(key);
    if (!extractedRow) {
      const gtPrice = factValue(gtRow.price);
      if (gtPrice === null) lostNullPriceCount += 1;
      continue;
    }
    recallHits += 1;
    const gtRawIdentity = String(factValue(gtRow.unit_number) ?? "").trim();
    const extractedRawIdentity = String(factValue(extractedRow.unit_number) ?? "").trim();
    if (gtRawIdentity === extractedRawIdentity) exactIdentityHits += 1;

    const gtType = factValue(gtRow.unit_type);
    if (gtType !== null) {
      unitTypeComparable += 1;
      if (fieldEquals(gtType, factValue(extractedRow.unit_type))) unitTypeHits += 1;
    }
    const gtBed = factValue(gtRow.bedrooms);
    if (gtBed !== null) {
      bedroomsComparable += 1;
      if (fieldEquals(gtBed, factValue(extractedRow.bedrooms))) bedroomsHits += 1;
    }
    const gtBath = factValue(gtRow.bathrooms);
    if (gtBath !== null) {
      bathroomsComparable += 1;
      if (fieldEquals(gtBath, factValue(extractedRow.bathrooms))) bathroomsHits += 1;
    }
    const gtSize = factValue(gtRow.size_sqm);
    if (gtSize !== null) {
      sizeComparable += 1;
      if (fieldEquals(gtSize, factValue(extractedRow.size_sqm))) sizeHits += 1;
    }
    const gtAvailability = factValue(gtRow.availability_status);
    if (gtAvailability !== null) {
      availabilityComparable += 1;
      if (fieldEquals(gtAvailability, factValue(extractedRow.availability_status))) {
        availabilityHits += 1;
      }
    }
    const gtCurrency = factValue(gtRow.currency);
    if (gtCurrency !== null) {
      currencyComparable += 1;
      if (fieldEquals(gtCurrency, factValue(extractedRow.currency))) currencyHits += 1;
    }

    const gtPrice = factValue(gtRow.price);
    const extractedPrice = factValue(extractedRow.price);
    if (gtPrice !== null && Number(gtPrice) > 0) {
      positivePriceComparable += 1;
      if (fieldEquals(gtPrice, extractedPrice)) positivePriceHits += 1;
    }
    if (gtPrice === null) {
      nullPriceComparable += 1;
      if (extractedPrice === null) nullPriceHits += 1;
      else fabricatedPriceCount += 1;
    }
  }

  const unexpectedRowCount = [...extractedByIdentity.keys()].filter(
    (key) => !groundTruthByIdentity.has(key),
  ).length;

  const sourceRefTotal = reviewedRows.length;
  const sourceRefComplete = reviewedRows.filter((row) => {
    const price = row.price;
    return (
      Boolean(price && price.source_file && price.page_number != null) ||
      factValue(row.price) === null
    );
  }).length;

  return {
    extracted_unit_row_recall: { numerator: recallHits, denominator: groundTruthByIdentity.size },
    exact_unit_identity_agreement: {
      numerator: exactIdentityHits,
      denominator: groundTruthByIdentity.size,
    },
    exact_unit_type_agreement: { numerator: unitTypeHits, denominator: unitTypeComparable },
    bedrooms_agreement: { numerator: bedroomsHits, denominator: bedroomsComparable },
    bathrooms_agreement: { numerator: bathroomsHits, denominator: bathroomsComparable },
    size_agreement: { numerator: sizeHits, denominator: sizeComparable },
    availability_agreement: { numerator: availabilityHits, denominator: availabilityComparable },
    positive_price_agreement: {
      numerator: positivePriceHits,
      denominator: positivePriceComparable,
    },
    null_price_preservation: { numerator: nullPriceHits, denominator: nullPriceComparable },
    currency_agreement: { numerator: currencyHits, denominator: currencyComparable },
    source_reference_completeness: {
      numerator: sourceRefComplete,
      denominator: sourceRefTotal,
    },
    fabricated_row_count: unexpectedRowCount,
    fabricated_price_count: fabricatedPriceCount,
    lost_null_price_count: lostNullPriceCount,
    missing_expected_row_count: groundTruthByIdentity.size - recallHits,
    unexpected_row_count: unexpectedRowCount,
    review_item_count: options.reviewItemCount,
    manual_review_time_seconds: options.manualReviewTimeSeconds ?? null,
  };
}

/** Read a reviewed or ground-truth `ExtractedPriceList` JSON file from disk. */
export function readExtractedPriceListFile(path: string): ExtractedPriceList {
  const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const parsed: unknown = JSON.parse(text);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { unit_inventory?: unknown }).unit_inventory)
  ) {
    throw new Error(
      `sip_compare_input_unreadable: ${path} is not an ExtractedPriceList JSON file.`,
    );
  }
  return parsed as ExtractedPriceList;
}
