import { describe, expect, it } from "vitest";

import {
  PROJECT_SOURCE_DOCUMENT_TYPES,
  PROJECT_SOURCE_FILE_FORMATS,
  isKnownProjectSourceDocumentType,
  isKnownProjectSourceFileFormat,
  projectSourceDescriptor,
  projectSourceDocumentTypeToForeverDocumentType,
  projectSourceFileFormatToImportFormat,
  projectSourceFileFormatToMediaType,
} from "..";

describe("document-type vocabulary", () => {
  it("covers every required intake kind plus the explicit unknown", () => {
    expect(PROJECT_SOURCE_DOCUMENT_TYPES).toEqual([
      "price_list",
      "brochure",
      "floor_plan",
      "master_plan",
      "unit_plan",
      "payment_plan",
      "contract",
      "legal_document",
      "marketing_material",
      "specification",
      "developer_update",
      "unknown",
    ]);
    expect(isKnownProjectSourceDocumentType("floor_plan")).toBe(true);
    expect(isKnownProjectSourceDocumentType("novel")).toBe(false);
    expect(isKnownProjectSourceDocumentType(42)).toBe(false);
  });

  it("maps every document type onto the canonical RC3.0 vocabulary, totally", () => {
    for (const type of PROJECT_SOURCE_DOCUMENT_TYPES) {
      expect(projectSourceDocumentTypeToForeverDocumentType(type)).toBeDefined();
    }
    expect(projectSourceDocumentTypeToForeverDocumentType("price_list")).toBe("price_list");
    expect(projectSourceDocumentTypeToForeverDocumentType("contract")).toBe("legal");
    expect(projectSourceDocumentTypeToForeverDocumentType("legal_document")).toBe("legal");
    expect(projectSourceDocumentTypeToForeverDocumentType("developer_update")).toBe("other");
    expect(projectSourceDocumentTypeToForeverDocumentType("unknown")).toBe("other");
  });
});

describe("file-format vocabulary", () => {
  it("covers documents, media, and data formats plus the explicit unknown", () => {
    expect(PROJECT_SOURCE_FILE_FORMATS).toContain("pdf");
    expect(PROJECT_SOURCE_FILE_FORMATS).toContain("image");
    expect(PROJECT_SOURCE_FILE_FORMATS).toContain("video");
    expect(PROJECT_SOURCE_FILE_FORMATS).toContain("unknown");
    expect(isKnownProjectSourceFileFormat("pdf")).toBe(true);
    expect(isKnownProjectSourceFileFormat("papyrus")).toBe(false);
  });

  it("bridges to the RC3.1 import formats partially and deterministically", () => {
    expect(projectSourceFileFormatToImportFormat("pdf")).toBe("pdf");
    expect(projectSourceFileFormatToImportFormat("excel")).toBe("excel");
    expect(projectSourceFileFormatToImportFormat("csv")).toBe("csv");
    expect(projectSourceFileFormatToImportFormat("json")).toBe("json");
    expect(projectSourceFileFormatToImportFormat("image")).toBeUndefined();
    expect(projectSourceFileFormatToImportFormat("video")).toBeUndefined();
  });

  it("bridges only the media formats to the RC3.0 media vocabulary", () => {
    expect(projectSourceFileFormatToMediaType("image")).toBe("image");
    expect(projectSourceFileFormatToMediaType("video")).toBe("video");
    expect(projectSourceFileFormatToMediaType("pdf")).toBeUndefined();
    expect(projectSourceFileFormatToMediaType("excel")).toBeUndefined();
  });
});

describe("descriptor builder", () => {
  it("attaches optional facts only when supplied (anti-fabrication)", () => {
    expect(projectSourceDescriptor("brochure", "pdf")).toEqual({
      documentType: "brochure",
      fileFormat: "pdf",
    });
    expect(
      projectSourceDescriptor("brochure", "pdf", {
        language: "th",
        uploadedAt: "2026-01-01T00:00:00.000Z",
        documentDate: "2025-12-15",
      }),
    ).toEqual({
      documentType: "brochure",
      fileFormat: "pdf",
      language: "th",
      uploadedAt: "2026-01-01T00:00:00.000Z",
      documentDate: "2025-12-15",
    });
  });
});
