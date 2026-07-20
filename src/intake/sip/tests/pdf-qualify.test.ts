import { describe, expect, it } from "vitest";

import { qualifyPdfText } from "../pdf-qualify";
import { fixtureExtraction } from "./test-support";

describe("SIP-001A text-layer qualification", () => {
  it("qualifies the supported Rainpalm-like layout", () => {
    const result = qualifyPdfText(fixtureExtraction("rainpalm-price-list.pdftotext-layout.txt"));
    expect(result.status).toBe("QUALIFIED_SUPPORTED_LAYOUT");
    expect(result.pageCount).toBe(2);
    expect(result.headerMappings.length).toBeGreaterThan(0);
  });

  it("returns UNSUPPORTED_NO_TEXT_LAYER for near-blank text", () => {
    const result = qualifyPdfText(fixtureExtraction("empty-text-layer.pdftotext-layout.txt"));
    expect(result.status).toBe("UNSUPPORTED_NO_TEXT_LAYER");
  });

  it("returns UNSUPPORTED_NO_TEXT_LAYER when there are zero pages", () => {
    const result = qualifyPdfText(
      fixtureExtraction("empty-text-layer.pdftotext-layout.txt", { pages: [], pageCount: 0 }),
    );
    expect(result.status).toBe("UNSUPPORTED_NO_TEXT_LAYER");
  });

  it("returns UNSUPPORTED_LAYOUT when no header carries a usable unit-identity column", () => {
    const result = qualifyPdfText(
      fixtureExtraction("unsupported-no-unit-column.pdftotext-layout.txt"),
    );
    expect(result.status).toBe("UNSUPPORTED_LAYOUT");
  });

  it("returns REVIEW_REQUIRED when a qualified table coexists with an ambiguous header elsewhere", () => {
    // Two pages: page 1 is the fully supported fixture, page 2 has an
    // ambiguous duplicate-Price header — a realistic mixed document.
    const supported = fixtureExtraction("rainpalm-price-list.pdftotext-layout.txt");
    const ambiguous = fixtureExtraction("ambiguous-header.pdftotext-layout.txt");
    const combined = {
      ...supported,
      pages: [supported.pages[0], { ...ambiguous.pages[0], pageNumber: 2 }],
      pageCount: 2,
    };
    const result = qualifyPdfText(combined);
    expect(result.status).toBe("REVIEW_REQUIRED");
  });

  it("returns TOOL_FAILURE when pdftotext itself did not exit successfully", () => {
    const result = qualifyPdfText(
      fixtureExtraction("rainpalm-price-list.pdftotext-layout.txt", { exitCode: 1 }),
    );
    expect(result.status).toBe("TOOL_FAILURE");
  });

  it("returns TOOL_FAILURE when pdftotext timed out", () => {
    const result = qualifyPdfText(
      fixtureExtraction("rainpalm-price-list.pdftotext-layout.txt", { timedOut: true }),
    );
    expect(result.status).toBe("TOOL_FAILURE");
  });
});
