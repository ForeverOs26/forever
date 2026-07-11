import { describe, expect, it } from "vitest";

import {
  foreverDatabaseEntities,
  validateForeverDatabaseRecord,
  type ForeverDatabaseRecord,
} from "@/features/forever-database";

import { normalizeDocument, normalizeMedia, validateImport, type ImportBatch } from "..";
import { makeDeveloper, makeProject } from "./fixtures";

/**
 * RC3.1 is additive: it consumes the RC3.0 canonical models and entity
 * descriptors read-only and produces records the existing database foundation
 * accepts unchanged. These tests pin that contract so the import foundation can
 * never drift away from the database it feeds.
 */

describe("backward compatibility with the Forever Database (RC3.0)", () => {
  it("reuses the RC3.0 entity descriptors rather than redefining identity", () => {
    expect(foreverDatabaseEntities.media.tableName).toBe("forever_media");
    expect(foreverDatabaseEntities.project.primaryKey).toBe("id");
  });

  it("produces media and documents that validate as a canonical database record", () => {
    const media = normalizeMedia({ url: "https://cdn.example.com/a.jpg", mediaType: "gallery" });
    const document = normalizeDocument({ url: "https://cdn.example.com/b.pdf" });
    expect(media).toBeDefined();
    expect(document).toBeDefined();

    const record: ForeverDatabaseRecord = {
      project: makeProject({ id: "p-1", developerId: "dev-1", locationId: undefined }),
      developer: makeDeveloper({ id: "dev-1" }),
      location: null,
      units: [],
      media: [{ id: "m-1", projectId: "p-1", ...media! }],
      documents: [{ id: "d-1", projectId: "p-1", ...document! }],
      paymentPlans: [],
      constructionProgress: [],
      rentalInformation: [],
      investmentInformation: [],
    };

    const result = validateForeverDatabaseRecord(record);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("agrees with the RC3.0 validator on a self-consistent batch", () => {
    const batch: ImportBatch = {
      developers: [makeDeveloper({ id: "dev-1" })],
      projects: [makeProject({ id: "p-1", developerId: "dev-1", locationId: undefined })],
    };
    expect(validateImport(batch).valid).toBe(true);
  });
});
