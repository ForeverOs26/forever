/**
 * SIP-001A — text-layer qualification.
 *
 * A PDF qualifies as `QUALIFIED_SUPPORTED_LAYOUT` only when Poppler ran
 * successfully, page-addressable text exists, meaningful non-whitespace
 * text exists, at least one fixed-dictionary table header maps without
 * ambiguity, and at least one row under it carries a syntactically valid
 * unit identity. Nothing here is decided from the PDF's filename. No OCR
 * fallback exists for a PDF with no usable text layer.
 */

import { extractDocumentTables } from "./price-table";
import type {
  HeaderMapping,
  PdfTextExtraction,
  QualificationResult,
  QualificationStatus,
} from "./types";

/** Below this, output is treated as effectively empty (near-blank text layer). */
const MIN_MEANINGFUL_TEXT_CHARS = 20;

export function qualifyPdfText(extraction: PdfTextExtraction): QualificationResult {
  const reasons: string[] = [];
  const totalNonWhitespace = extraction.pages.reduce(
    (sum, page) => sum + page.nonWhitespaceCharCount,
    0,
  );

  if (extraction.timedOut || extraction.exitCode !== 0) {
    reasons.push(
      extraction.timedOut ? "pdftotext_timed_out" : `pdftotext_exit_code_${extraction.exitCode}`,
    );
    return statusResult("TOOL_FAILURE", reasons, extraction, totalNonWhitespace, []);
  }

  if (extraction.pageCount === 0) {
    reasons.push("no_page_addressable_output");
    return statusResult("UNSUPPORTED_NO_TEXT_LAYER", reasons, extraction, totalNonWhitespace, []);
  }

  if (totalNonWhitespace < MIN_MEANINGFUL_TEXT_CHARS) {
    reasons.push("no_meaningful_text_content");
    return statusResult("UNSUPPORTED_NO_TEXT_LAYER", reasons, extraction, totalNonWhitespace, []);
  }

  const { regions, ambiguousHeaderLines } = extractDocumentTables(extraction.pages);
  const supportedRegions = regions.filter(
    (region) => !region.unsupported && region.rows.length > 0,
  );
  const unsupportedRegions = regions.filter((region) => region.unsupported);
  const headerMappings: HeaderMapping[] = supportedRegions.map((region) => region.header);

  if (supportedRegions.length === 0) {
    if (regions.length === 0 && ambiguousHeaderLines.length === 0) {
      reasons.push("no_recognizable_table_headers");
    } else {
      reasons.push("no_usable_table_after_header_evaluation");
    }
    if (unsupportedRegions.length > 0) {
      reasons.push(
        ...unsupportedRegions.map(
          (region) => `unsupported_table: page=${region.page} reason=${region.unsupportedReason}`,
        ),
      );
    }
    if (ambiguousHeaderLines.length > 0) {
      reasons.push(...ambiguousHeaderLines.map((line) => `ambiguous_header: ${line}`));
    }
    return statusResult(
      "UNSUPPORTED_LAYOUT",
      reasons,
      extraction,
      totalNonWhitespace,
      headerMappings,
    );
  }

  const hasIssues = unsupportedRegions.length > 0 || ambiguousHeaderLines.length > 0;
  if (hasIssues) {
    if (unsupportedRegions.length > 0) {
      reasons.push(
        ...unsupportedRegions.map(
          (region) => `unsupported_table: page=${region.page} reason=${region.unsupportedReason}`,
        ),
      );
    }
    if (ambiguousHeaderLines.length > 0) {
      reasons.push(...ambiguousHeaderLines.map((line) => `ambiguous_header: ${line}`));
    }
    return statusResult("REVIEW_REQUIRED", reasons, extraction, totalNonWhitespace, headerMappings);
  }

  reasons.push(
    `qualified_tables=${supportedRegions.length}`,
    `qualified_rows=${supportedRegions.reduce((sum, region) => sum + region.rows.length, 0)}`,
  );
  return statusResult(
    "QUALIFIED_SUPPORTED_LAYOUT",
    reasons,
    extraction,
    totalNonWhitespace,
    headerMappings,
  );
}

function statusResult(
  status: QualificationStatus,
  reasons: string[],
  extraction: PdfTextExtraction,
  nonWhitespaceCharCount: number,
  headerMappings: HeaderMapping[],
): QualificationResult {
  return {
    status,
    reasons,
    pageCount: extraction.pageCount,
    nonWhitespaceCharCount,
    headerMappings,
  };
}
