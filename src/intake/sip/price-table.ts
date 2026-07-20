/**
 * SIP-001A — deterministic price-table extraction for one supported layout.
 *
 * The supported Rainpalm-like layout is a fixed-width table produced by
 * `pdftotext -layout`: one header line naming columns from a fixed
 * dictionary (never guessed), followed by data lines whose cells are sliced
 * at the header's column start offsets. Headers may repeat on later pages;
 * repeats are recognized and skipped, not re-parsed as data. A data line
 * with a blank unit-identity cell but content elsewhere is treated as a
 * wrapped continuation of the previous row.
 *
 * Unknown/duplicate/shifted headers and rows without a syntactically valid
 * unit identity never enter a table region. This module implements ONLY
 * this one layout — it is not a general PDF table parser.
 */

import type {
  HeaderMapping,
  PdfTextPage,
  PriceTableField,
  RawTableRow,
  TableRegion,
} from "./types";

const HEADER_DICTIONARY: ReadonlyArray<{ field: PriceTableField; labels: string[] }> = [
  {
    field: "unit_number",
    labels: [
      "unit",
      "unit no",
      "unit number",
      "unit #",
      "villa",
      "villa no",
      "villa number",
      "unit/villa",
    ],
  },
  { field: "unit_type", labels: ["type", "unit type", "villa type"] },
  { field: "building", labels: ["building", "block", "zone", "phase"] },
  { field: "bedrooms", labels: ["bed", "beds", "bedroom", "bedrooms", "bd", "bdr"] },
  { field: "bathrooms", labels: ["bath", "baths", "bathroom", "bathrooms", "ba"] },
  {
    field: "size_sqm",
    labels: ["size", "area", "living area", "usable area", "sqm", "size sqm", "living/usable size"],
  },
  { field: "availability_status", labels: ["status", "availability", "avail", "sales status"] },
];

function normalizeToken(token: string): string {
  return token.trim().toLowerCase().replace(/[.:]/g, "").trim();
}

function stripParenthetical(token: string): string {
  return token.replace(/\([^)]*\)/g, "").trim();
}

function matchField(token: string): PriceTableField | null {
  const norm = normalizeToken(token);
  if (!norm) return null;
  if (/\bprice\b/.test(norm) && !/\bfee\b/.test(norm)) return "price";
  const stripped = stripParenthetical(norm);
  for (const { field, labels } of HEADER_DICTIONARY) {
    if (labels.includes(norm) || labels.includes(stripped)) return field;
  }
  return null;
}

/** Split a line into column tokens at runs of 2+ spaces (or a tab). */
export function splitColumns(line: string): Array<{ text: string; start: number }> {
  const columns: Array<{ text: string; start: number }> = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    while (i < n && (line[i] === " " || line[i] === "\t")) i++;
    if (i >= n) break;
    const start = i;
    while (i < n) {
      if (line[i] === "\t") break;
      if (line[i] === " " && line[i + 1] === " ") break;
      i++;
    }
    columns.push({ text: line.slice(start, i).trim(), start });
  }
  return columns;
}

const UNIT_IDENTITY_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9\-/. ]{0,18}[A-Za-z0-9])?$/;

export function isSyntacticUnitIdentity(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 20) return false;
  if (!/\d/.test(v)) return false;
  return UNIT_IDENTITY_PATTERN.test(v);
}

type HeaderParseResult =
  | { kind: "header"; mapping: Omit<HeaderMapping, "tableIndex"> }
  | { kind: "ambiguous"; rawHeaderLine: string }
  | { kind: "unsupported"; rawHeaderLine: string; reason: string }
  | { kind: "not-header" };

function parseHeaderLine(line: string, page: number): HeaderParseResult {
  const cols = splitColumns(line);
  if (cols.length < 2) return { kind: "not-header" };

  const columns: Partial<Record<PriceTableField, string>> = {};
  const columnFields: Array<PriceTableField | null> = [];
  let currencyFromHeader: string | null = null;
  let recognizedCount = 0;
  let duplicate = false;

  for (const col of cols) {
    const field = matchField(col.text);
    columnFields.push(field);
    if (!field) continue;
    recognizedCount += 1;
    if (columns[field]) duplicate = true;
    columns[field] = col.text;
    if (field === "price") {
      const m = col.text.match(/\(([A-Za-z]{3})\)/);
      if (m) currencyFromHeader = m[1].toUpperCase();
    }
  }

  if (recognizedCount < 2) return { kind: "not-header" };
  if (duplicate) return { kind: "ambiguous", rawHeaderLine: line };
  if (!columns.unit_number) {
    return {
      kind: "unsupported",
      rawHeaderLine: line,
      reason: "unsupported_layout_missing_unit_identity_column",
    };
  }
  if (!columns.price) {
    return {
      kind: "unsupported",
      rawHeaderLine: line,
      reason: "unsupported_layout_missing_price_column",
    };
  }

  return {
    kind: "header",
    mapping: {
      page,
      rawHeaderLine: line,
      columns,
      columnStarts: cols.map((c) => c.start),
      columnFields,
      currencyFromHeader,
    },
  };
}

function normalizeHeaderText(line: string): string {
  return line.trim().toLowerCase().replace(/\s+/g, " ");
}

function sliceByHeader(
  line: string,
  header: HeaderMapping,
): Partial<Record<PriceTableField, string>> {
  const cells: Partial<Record<PriceTableField, string>> = {};
  for (let i = 0; i < header.columnStarts.length; i += 1) {
    const field = header.columnFields[i];
    if (!field) continue;
    const start = header.columnStarts[i];
    const end = i + 1 < header.columnStarts.length ? header.columnStarts[i + 1] : line.length;
    const value = line.slice(start, end).trim();
    if (value) cells[field] = value;
  }
  return cells;
}

export interface PageTableExtraction {
  regions: TableRegion[];
  ambiguousHeaderLines: string[];
}

/** Extract every table region on one page of `pdftotext -layout` text. */
export function extractPageTables(page: PdfTextPage): PageTableExtraction {
  const lines = page.text.split(/\r?\n/);
  const regions: TableRegion[] = [];
  const ambiguousHeaderLines: string[] = [];
  let tableIndex = -1;
  let current: TableRegion | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;

    const attempt = parseHeaderLine(line, page.pageNumber);

    if (attempt.kind === "ambiguous") {
      ambiguousHeaderLines.push(attempt.rawHeaderLine);
      continue;
    }

    if (attempt.kind === "unsupported") {
      tableIndex += 1;
      const header: HeaderMapping = {
        page: page.pageNumber,
        tableIndex,
        rawHeaderLine: attempt.rawHeaderLine,
        columns: {},
        columnStarts: [],
        columnFields: [],
        currencyFromHeader: null,
      };
      const region: TableRegion = {
        page: page.pageNumber,
        tableIndex,
        header,
        rows: [],
        unsupported: true,
        unsupportedReason: attempt.reason,
      };
      regions.push(region);
      current = null;
      continue;
    }

    if (attempt.kind === "header") {
      if (
        current &&
        !current.unsupported &&
        normalizeHeaderText(current.header.rawHeaderLine) === normalizeHeaderText(line)
      ) {
        // A repeated header for the SAME logical table on this page: skip,
        // do not start a second region or misparse it as a data row.
        continue;
      }
      tableIndex += 1;
      const header: HeaderMapping = { ...attempt.mapping, tableIndex };
      current = { page: page.pageNumber, tableIndex, header, rows: [], unsupported: false };
      regions.push(current);
      continue;
    }

    // Data line.
    if (!current || current.unsupported) continue;
    const cells = sliceByHeader(line, current.header);
    const unitCell = (cells.unit_number ?? "").trim();

    if (isSyntacticUnitIdentity(unitCell)) {
      const row: RawTableRow = {
        page: page.pageNumber,
        tableIndex: current.tableIndex,
        sourceRow: current.rows.length + 1,
        rawLine: line,
        cells,
        isContinuation: false,
      };
      current.rows.push(row);
      continue;
    }

    // A wrapped continuation line: no unit identity here, but other cells
    // carry text, and a previous row in this region exists to attach it to.
    const hasOtherContent = Object.values(cells).some((value) => value && value.trim());
    if (unitCell === "" && hasOtherContent && current.rows.length > 0) {
      const previous = current.rows[current.rows.length - 1];
      for (const [field, value] of Object.entries(cells) as Array<[PriceTableField, string]>) {
        if (!value || !value.trim()) continue;
        previous.cells[field] = previous.cells[field]
          ? `${previous.cells[field]} ${value.trim()}`
          : value.trim();
      }
      previous.isContinuation = true;
    }
    // Otherwise: footer/legend/notes text under a qualified table — ignored.
  }

  return { regions, ambiguousHeaderLines };
}

export interface DocumentTableExtraction {
  regions: TableRegion[];
  ambiguousHeaderLines: string[];
  pagesWithoutHeader: number[];
}

/** Extract table regions across every page. Each page must carry its own header. */
export function extractDocumentTables(pages: PdfTextPage[]): DocumentTableExtraction {
  const regions: TableRegion[] = [];
  const ambiguousHeaderLines: string[] = [];
  const pagesWithoutHeader: number[] = [];

  for (const page of pages) {
    const result = extractPageTables(page);
    ambiguousHeaderLines.push(...result.ambiguousHeaderLines);
    if (result.regions.length === 0) {
      pagesWithoutHeader.push(page.pageNumber);
    }
    regions.push(...result.regions);
  }

  return { regions, ambiguousHeaderLines, pagesWithoutHeader };
}
