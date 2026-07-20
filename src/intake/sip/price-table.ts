/**
 * SIP-001A — deterministic price-table extraction for one supported layout.
 *
 * The supported layout is a narrow fixed-width table produced by
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
      "room no",
      "room number",
    ],
  },
  { field: "unit_code", labels: ["code", "code type", "unit code"] },
  { field: "unit_type", labels: ["type", "unit type", "villa type", "pool villa", "room type"] },
  { field: "building", labels: ["building", "block", "zone", "phase", "tower"] },
  { field: "floor", labels: ["floor", "level", "storey", "story"] },
  { field: "bedrooms", labels: ["bed", "beds", "bedroom", "bedrooms", "bd", "bdr"] },
  { field: "bathrooms", labels: ["bath", "baths", "bathroom", "bathrooms", "ba"] },
  {
    field: "land_area_sqm",
    labels: ["land area", "land area sqm", "plot area", "plot size"],
  },
  { field: "price_per_sqm", labels: ["price/sqm", "price per sqm", "price sqm"] },
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
  if (/(?:price\s*\/\s*sqm|price\s+per\s+sqm|price\s+sqm)/.test(norm)) {
    return "price_per_sqm";
  }
  if (
    /(?:selling\s+price|total\s+price|^price(?:\s*\([a-z]{3}\))?$)/.test(norm) &&
    !/\bfee\b/.test(norm)
  ) {
    return "price";
  }
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

const UNIT_IDENTITY_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9\-/.]{0,18}[A-Za-z0-9])?$/;

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
      let merged = false;
      for (const [field, value] of Object.entries(cells) as Array<[PriceTableField, string]>) {
        if (!value || !value.trim()) continue;
        const existing = previous.cells[field]?.trim();
        if (existing) {
          // Xpdf table mode can emit detached duplicates/numeric cells on the
          // following line. Never append those to the prior row. A genuine
          // wrapped continuation is limited to descriptive text columns.
          if (existing.toLowerCase() === value.trim().toLowerCase()) continue;
          if (!new Set<PriceTableField>(["availability_status", "unit_type"]).has(field)) {
            continue;
          }
          // A real wrapped status continuation is explicitly punctuated
          // (for example "Reserved - pending contract"). Do not append
          // detached header/footer fragments such as unit labels to a status.
          if (
            field === "availability_status" &&
            !value.trim().startsWith("-") &&
            !existing.endsWith("-")
          ) {
            continue;
          }
          previous.cells[field] = `${existing} ${value.trim()}`;
          merged = true;
        } else if (new Set<PriceTableField>(["availability_status", "unit_type"]).has(field)) {
          previous.cells[field] = value.trim();
          merged = true;
        }
      }
      if (merged) previous.isContinuation = true;
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

const LAYOUT_CORE_ROW =
  /^\s*\d{1,3}\s+([A-Za-z0-9][A-Za-z0-9\-/.]{0,19})\s+(\S+)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)(?:\s|$)/;

/**
 * Xpdf `-table` is reliable for Rainpalm's price/status geometry but can
 * detach an occasional bedroom/bathroom cell. Its required `-layout` output
 * preserves the stable left-hand row prefix. Merge only those six explicit
 * prefix fields by exact unique unit identity; never use layout-mode price or
 * status cells. Any disagreement fails closed through the returned conflicts.
 */
export function mergeLayoutCoreCells(
  regions: TableRegion[],
  layoutPages: PdfTextPage[],
): { regions: TableRegion[]; conflicts: string[] } {
  const coreByIdentity = new Map<
    string,
    Partial<Record<PriceTableField, string>> & { unit_number: string }
  >();
  const conflicts: string[] = [];
  for (const page of layoutPages) {
    for (const line of page.text.split(/\r?\n/)) {
      const match = line.match(LAYOUT_CORE_ROW);
      if (!match) continue;
      const [, unit, type, land, living, bedrooms, bathrooms] = match;
      const key = unit.toUpperCase();
      const cells = {
        unit_number: unit,
        unit_type: type,
        land_area_sqm: land,
        size_sqm: living,
        bedrooms,
        bathrooms,
      } satisfies Partial<Record<PriceTableField, string>> & { unit_number: string };
      const previous = coreByIdentity.get(key);
      if (previous && JSON.stringify(previous) !== JSON.stringify(cells)) {
        conflicts.push(`layout_core_duplicate_conflict:${unit}`);
      } else {
        coreByIdentity.set(key, cells);
      }
    }
  }

  const fields: PriceTableField[] = [
    "unit_type",
    "land_area_sqm",
    "size_sqm",
    "bedrooms",
    "bathrooms",
  ];
  for (const region of regions) {
    for (const row of region.rows) {
      const unit = row.cells.unit_number;
      if (!unit) continue;
      const core = coreByIdentity.get(unit.toUpperCase());
      if (!core) continue;
      for (const field of fields) {
        const value = core[field];
        if (!value) continue;
        const current = row.cells[field];
        if (current && current.trim() !== value.trim()) {
          conflicts.push(`layout_table_core_conflict:${unit}:${field}`);
        } else if (!current) {
          row.cells[field] = value;
        }
      }
    }
  }
  return { regions, conflicts: [...new Set(conflicts)].sort() };
}
