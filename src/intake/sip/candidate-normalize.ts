/**
 * SIP-001A — candidate normalization (no fabrication).
 *
 * Turns qualified `TableRegion` rows into unchanged `ExtractedPriceList` /
 * `ExtractedPriceListRow` (`@/import/types`). Every candidate fact preserves
 * its raw value, portable source filename, source page/row, confidence, and
 * an exact current `Fact.status` value. No price or price-per-sqm
 * arithmetic ever occurs. Currency is accepted only from evidence on the
 * mapped price column itself (never a fee column). Availability is
 * normalized only via a small fixed, versioned mapping; an unmapped label
 * is retained verbatim and flagged for review. The date is read only from
 * document content, never a filename or file timestamp.
 */

import { currencyEvidenceFromFact, decideCurrency } from "@/import/currency-policy";
import type { CurrencyEvidence } from "@/import/currency-policy";
import type { ExtractedPriceList, ExtractedPriceListRow, Fact } from "@/import/types";

import type { PdfTextPage, PriceTableField, RawTableRow, ReviewItem, TableRegion } from "./types";

export const AVAILABILITY_MAPPING_VERSION = "1.0.0";

/** Small fixed, versioned availability-label mapping. Unknown labels are never guessed. */
const AVAILABILITY_MAP: Readonly<Record<string, string>> = {
  available: "Available",
  avail: "Available",
  "for sale": "Available",
  sold: "Sold",
  "sold out": "Sold",
  reserved: "Reserved",
  reserve: "Reserved",
  booked: "Reserved",
  "on hold": "On Hold",
  hold: "On Hold",
};

const PRICE_SENTINELS = new Set([
  "",
  "-",
  "--",
  "–",
  "—",
  "sold",
  "n/a",
  "na",
  "tbd",
  "tba",
  "x",
  "xx",
  "?",
]);

type PriceParse =
  | { kind: "sentinel" }
  | { kind: "value"; value: number; rawValue: string }
  | { kind: "invalid" }
  | { kind: "ambiguous_separator" };

function parsePriceCell(raw: string | undefined): PriceParse {
  const trimmed = (raw ?? "").trim();
  const normalized = trimmed.toLowerCase();
  if (PRICE_SENTINELS.has(normalized)) return { kind: "sentinel" };

  const hasComma = trimmed.includes(",");
  const periodCount = (trimmed.match(/\./g) ?? []).length;
  const looksLikeDecimal = periodCount === 1 && /\.\d{1,2}$/.test(trimmed);
  // Comma is the only accepted thousands separator. More than one period, or
  // a period that is not a two-decimal-place suffix, is document-ambiguous
  // (e.g. a European "12.500.000" thousands notation) — reviewed, not guessed.
  if (periodCount > 1 || (hasComma && periodCount === 1 && !looksLikeDecimal)) {
    return { kind: "ambiguous_separator" };
  }

  const cleaned = trimmed.replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return { kind: "invalid" };
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return { kind: "invalid" };
  return { kind: "value", value, rawValue: trimmed };
}

let reviewCounter = 0;
function nextReviewId(): string {
  reviewCounter += 1;
  return `REVIEW-${String(reviewCounter).padStart(4, "0")}`;
}
export function resetReviewIdCounter(): void {
  reviewCounter = 0;
}

function makeReviewItem(input: Omit<ReviewItem, "id">): ReviewItem {
  return { id: nextReviewId(), ...input };
}

function normalizeIdentity(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export interface CandidateBuildResult {
  priceList: ExtractedPriceList;
  reviewItems: ReviewItem[];
  duplicateUnitIdentities: string[];
}

function numericCell(raw: string | undefined): { parsed: number | null; isNumeric: boolean } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { parsed: null, isNumeric: false };
  const cleaned = trimmed.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return { parsed: null, isNumeric: false };
  return { parsed: Number(cleaned), isNumeric: true };
}

/** Build candidate rows + exception-only review items from qualified table regions. */
export function buildPriceListCandidates(
  regions: TableRegion[],
  sourceFilename: string,
): CandidateBuildResult {
  const reviewItems: ReviewItem[] = [];
  const rows: ExtractedPriceListRow[] = [];
  const priceEvidence: CurrencyEvidence[] = [];
  const identityOccurrences = new Map<string, number>();

  for (const region of regions) {
    if (region.unsupported) {
      reviewItems.push(
        makeReviewItem({
          reasonCode: "unsupported_table_region",
          candidateValue: null,
          rawText: region.header.rawHeaderLine,
          sourceRef: { source_file: sourceFilename, page_number: region.page },
          page: region.page,
          table: region.tableIndex,
          row: null,
          column: null,
          recommendedAction: "unresolved",
          allowedActions: ["unresolved", "reject"],
          blocking: false,
        }),
      );
      continue;
    }

    for (const raw of region.rows) {
      const row = buildRow(raw, region, sourceFilename, reviewItems, priceEvidence);
      const identityFact = row.unit_number;
      if (identityFact?.value) {
        const key = normalizeIdentity(String(identityFact.value));
        identityOccurrences.set(key, (identityOccurrences.get(key) ?? 0) + 1);
      }
      rows.push(row);
    }

    // Missing selling-price currency is resolved only by the existing
    // Owner-approved Thailand/THB product-scope default in decideCurrency().
    // It is never mislabeled as source evidence from this PDF.
  }

  const duplicateUnitIdentities = [...identityOccurrences.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key)
    .sort();

  if (duplicateUnitIdentities.length > 0) {
    for (const row of rows) {
      const value = row.unit_number?.value;
      if (value && duplicateUnitIdentities.includes(normalizeIdentity(String(value)))) {
        reviewItems.push(
          makeReviewItem({
            reasonCode: "duplicate_identity",
            candidateValue: value,
            rawText: String(value),
            sourceRef: {
              source_file: sourceFilename,
              page_number: row.unit_number?.page_number ?? null,
            },
            page: row.unit_number?.page_number ?? null,
            table: null,
            row: row.source_row ?? null,
            column: "unit_number",
            recommendedAction: "unresolved",
            allowedActions: ["unresolved", "reject", "edit"],
            blocking: true,
          }),
        );
      }
    }
  }

  const currencyDecision = decideCurrency({ priceEvidence });

  if (currencyDecision.status === "inferred_default" && currencyDecision.value) {
    for (const row of rows) {
      if (row.currency) continue;
      row.currency = {
        value: currencyDecision.value,
        raw_value: null,
        source_file: sourceFilename,
        page_number: row.unit_number?.page_number ?? null,
        confidence: "medium",
        status: "inferred_default",
      };
    }
  }

  const priceList: ExtractedPriceList = {
    currency_decision: currencyDecision,
    unit_inventory: rows,
  };

  return { priceList, reviewItems, duplicateUnitIdentities };
}

function buildRow(
  raw: RawTableRow,
  region: TableRegion,
  sourceFilename: string,
  reviewItems: ReviewItem[],
  priceEvidence: CurrencyEvidence[],
): ExtractedPriceListRow {
  const pageNumber = raw.page;
  const baseRef = { source_file: sourceFilename, page_number: pageNumber };

  const unitNumber: Fact<string> = {
    value: raw.cells.unit_number ?? null,
    raw_value: raw.cells.unit_number ?? null,
    source_file: sourceFilename,
    page_number: pageNumber,
    confidence: raw.cells.unit_number ? "high" : "none",
    status: raw.cells.unit_number ? "source_verified" : "unresolved",
  };
  if (!raw.cells.unit_number) {
    reviewItems.push(
      makeReviewItem({
        reasonCode: "unclear_unit_identity",
        candidateValue: null,
        rawText: raw.rawLine,
        sourceRef: baseRef,
        page: pageNumber,
        table: region.tableIndex,
        row: raw.sourceRow,
        column: "unit_number",
        recommendedAction: "reject",
        allowedActions: ["reject", "unresolved", "edit"],
        blocking: false,
      }),
    );
  }

  const unitType = simpleTextFact(raw.cells.unit_type, sourceFilename, pageNumber);
  const building = simpleTextFact(raw.cells.building, sourceFilename, pageNumber);
  const bedrooms = numericOrTextFact(
    raw.cells.bedrooms,
    sourceFilename,
    pageNumber,
    "bedrooms",
    raw,
    region,
    reviewItems,
  );
  const bathrooms = numericOrTextFact(
    raw.cells.bathrooms,
    sourceFilename,
    pageNumber,
    "bathrooms",
    raw,
    region,
    reviewItems,
  );
  const sizeSqm = numericOrTextFact(
    raw.cells.size_sqm,
    sourceFilename,
    pageNumber,
    "size_sqm",
    raw,
    region,
    reviewItems,
  );

  const priceParse = parsePriceCell(raw.cells.price);
  let price: Fact<string | number>;
  if (priceParse.kind === "value") {
    price = {
      value: priceParse.value,
      raw_value: priceParse.rawValue,
      source_file: sourceFilename,
      page_number: pageNumber,
      confidence: "high",
      status: "source_verified",
    };
  } else if (priceParse.kind === "sentinel") {
    price = {
      value: null,
      raw_value: raw.cells.price ?? null,
      source_file: sourceFilename,
      page_number: pageNumber,
      confidence: "none",
      status: "unresolved",
    };
  } else {
    price = {
      value: null,
      raw_value: raw.cells.price ?? null,
      source_file: sourceFilename,
      page_number: pageNumber,
      confidence: "none",
      status: "unresolved",
    };
    reviewItems.push(
      makeReviewItem({
        reasonCode:
          priceParse.kind === "ambiguous_separator"
            ? "unsupported_numeric_separator"
            : "price_unsupported_value",
        candidateValue: raw.cells.price ?? null,
        rawText: raw.rawLine,
        sourceRef: baseRef,
        page: pageNumber,
        table: region.tableIndex,
        row: raw.sourceRow,
        column: "price",
        recommendedAction: "unresolved",
        allowedActions: ["unresolved", "reject", "edit"],
        blocking: false,
      }),
    );
  }

  let currency: Fact<string> | undefined;
  if (region.header.currencyFromHeader) {
    currency = {
      value: region.header.currencyFromHeader,
      raw_value: region.header.columns.price ?? null,
      source_file: sourceFilename,
      page_number: pageNumber,
      confidence: "high",
      status: "source_verified",
    };
  }
  priceEvidence.push(currencyEvidenceFromFact(currency));

  const availabilityRaw = raw.cells.availability_status?.trim();
  let availability: Fact<string> | undefined;
  if (availabilityRaw) {
    const mapped = AVAILABILITY_MAP[availabilityRaw.toLowerCase()];
    availability = {
      value: mapped ?? availabilityRaw,
      raw_value: availabilityRaw,
      source_file: sourceFilename,
      page_number: pageNumber,
      confidence: mapped ? "high" : "medium",
      status: "source_verified",
    };
    if (!mapped) {
      reviewItems.push(
        makeReviewItem({
          reasonCode: "medium_confidence_cell",
          candidateValue: availabilityRaw,
          rawText: raw.rawLine,
          sourceRef: baseRef,
          page: pageNumber,
          table: region.tableIndex,
          row: raw.sourceRow,
          column: "availability_status",
          recommendedAction: "unresolved",
          allowedActions: ["accept", "edit", "unresolved"],
          blocking: false,
        }),
      );
    }
  }

  return {
    source_row: raw.sourceRow,
    unit_number: unitNumber,
    ...(unitType ? { unit_type: unitType } : {}),
    ...(building ? { building } : {}),
    ...(bedrooms ? { bedrooms } : {}),
    ...(bathrooms ? { bathrooms } : {}),
    ...(sizeSqm ? { size_sqm: sizeSqm } : {}),
    price,
    ...(currency ? { currency } : {}),
    ...(availability ? { availability_status: availability } : {}),
  };
}

function simpleTextFact(
  raw: string | undefined,
  sourceFile: string,
  pageNumber: number,
): Fact<string> | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  return {
    value: trimmed,
    raw_value: trimmed,
    source_file: sourceFile,
    page_number: pageNumber,
    confidence: "high",
    status: "source_verified",
  };
}

function numericOrTextFact(
  raw: string | undefined,
  sourceFile: string,
  pageNumber: number,
  column: PriceTableField,
  rawRow: RawTableRow,
  region: TableRegion,
  reviewItems: ReviewItem[],
): Fact<string | number> | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const { parsed, isNumeric } = numericCell(trimmed);
  if (isNumeric && parsed !== null) {
    return {
      value: parsed,
      raw_value: trimmed,
      source_file: sourceFile,
      page_number: pageNumber,
      confidence: "high",
      status: "source_verified",
    };
  }
  reviewItems.push(
    makeReviewItem({
      reasonCode: "medium_confidence_cell",
      candidateValue: trimmed,
      rawText: rawRow.rawLine,
      sourceRef: { source_file: sourceFile, page_number: pageNumber },
      page: pageNumber,
      table: region.tableIndex,
      row: rawRow.sourceRow,
      column,
      recommendedAction: "unresolved",
      allowedActions: ["accept", "edit", "unresolved"],
      blocking: false,
    }),
  );
  return {
    value: trimmed,
    raw_value: trimmed,
    source_file: sourceFile,
    page_number: pageNumber,
    confidence: "medium",
    status: "source_verified",
  };
}

/**
 * Build the finalized deterministic price list: only high-confidence (or already
 * null/none) cells are kept as-is. Any medium/low-confidence candidate cell
 * — logged as a review item above — is nulled out (never guessed into an
 * accepted value) pending separate Owner review or edit.
 * Rows are never dropped: a source-null sold villa stays a row with a null
 * price, exactly as the candidate had it.
 */
export function buildReviewedPriceList(candidate: ExtractedPriceList): ExtractedPriceList {
  const rows = (candidate.unit_inventory ?? []).map((row) => {
    const nextRow: ExtractedPriceListRow = { source_row: row.source_row };
    for (const key of Object.keys(row) as Array<keyof ExtractedPriceListRow>) {
      if (key === "source_row") continue;
      const fact = row[key] as Fact | undefined;
      if (!fact || typeof fact !== "object" || !("value" in fact)) continue;
      if (
        (fact.confidence === "medium" || fact.confidence === "low") &&
        fact.status !== "inferred_default"
      ) {
        (nextRow as Record<string, unknown>)[key] = {
          value: null,
          source_file: fact.source_file ?? null,
          page_number: fact.page_number ?? null,
          confidence: "none",
          status: "unresolved",
        };
      } else {
        (nextRow as Record<string, unknown>)[key] = fact;
      }
    }
    return nextRow;
  });

  return {
    ...(candidate.price_list_date ? { price_list_date: candidate.price_list_date } : {}),
    ...(candidate.currency_decision ? { currency_decision: candidate.currency_decision } : {}),
    unit_inventory: rows,
  };
}

const DATE_LINE_PATTERN =
  /(?:date|updated|effective|as of)\s*[:-]?\s*(\d{1,2})[./](\d{1,2})[./](\d{2,4})/gi;

export interface DateExtractionResult {
  fact: Fact<string> | null;
  reviewItem: ReviewItem | null;
}

/** Extract the price-list date ONLY from document content — never a filename or timestamp. */
export function extractPriceListDate(
  pages: PdfTextPage[],
  sourceFilename: string,
): DateExtractionResult {
  const matches: Array<{ page: number; raw: string; iso: string | null }> = [];
  for (const page of pages) {
    for (const match of page.text.matchAll(DATE_LINE_PATTERN)) {
      const [raw, dd, mm, yy] = match;
      const year = yy.length === 2 ? Number(`20${yy}`) : Number(yy);
      const month = Number(mm);
      const day = Number(dd);
      const date = new Date(Date.UTC(year, month - 1, day));
      const valid =
        month >= 1 &&
        month <= 12 &&
        day >= 1 &&
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day;
      const iso = valid
        ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
        : null;
      matches.push({ page: page.pageNumber, raw, iso });
    }
  }

  if (matches.length === 0) return { fact: null, reviewItem: null };

  const distinctIso = new Set(matches.map((m) => m.iso).filter(Boolean));
  if (matches.length > 1 && distinctIso.size > 1) {
    return {
      fact: null,
      reviewItem: makeReviewItem({
        reasonCode: "unclear_date",
        candidateValue: matches.map((m) => m.raw),
        rawText: matches.map((m) => m.raw).join(" | "),
        sourceRef: { source_file: sourceFilename, page_number: matches[0].page },
        page: matches[0].page,
        table: null,
        row: null,
        column: null,
        recommendedAction: "unresolved",
        allowedActions: ["unresolved", "edit"],
        blocking: false,
      }),
    };
  }

  const first = matches[0];
  if (!first.iso) {
    return {
      fact: null,
      reviewItem: makeReviewItem({
        reasonCode: "unclear_date",
        candidateValue: first.raw,
        rawText: first.raw,
        sourceRef: { source_file: sourceFilename, page_number: first.page },
        page: first.page,
        table: null,
        row: null,
        column: null,
        recommendedAction: "unresolved",
        allowedActions: ["unresolved", "edit"],
        blocking: false,
      }),
    };
  }

  return {
    fact: {
      value: first.iso,
      raw_value: first.raw,
      source_file: sourceFilename,
      page_number: first.page,
      confidence: "high",
      status: "source_verified",
    },
    reviewItem: null,
  };
}
