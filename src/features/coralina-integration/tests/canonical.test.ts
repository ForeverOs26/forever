import {
  foreverDatabaseEntities,
  findDuplicateEntities,
  validateForeverDatabaseRecord,
  validateNoDuplicateEntities,
  validateReferentialIntegrity,
} from "@/features/forever-database";
import { describe, expect, it } from "vitest";

import { buildCoralinaRecord } from "../adapters/coralina-canonical";
import { CORALINA_PROJECT_ID } from "../identity";

describe("Coralina canonical mapping (RC3.0)", () => {
  it("is deterministic — two builds are deeply equal", () => {
    expect(buildCoralinaRecord()).toEqual(buildCoralinaRecord());
  });

  it("maps the verified project, location, and full unit inventory", () => {
    const record = buildCoralinaRecord();
    expect(record.project.id).toBe(CORALINA_PROJECT_ID);
    expect(record.project.slug).toBe("coralina");
    expect(record.project.name).toBe("CORALINA KAMALA");
    expect(record.project.province).toBe("Phuket");
    expect(record.project.area).toBe("Kamala");
    expect(record.location?.areaName).toBe("Kamala");
    expect(record.units).toHaveLength(198);
    expect(record.documents.length).toBeGreaterThan(0);
    expect(record.media.length).toBeGreaterThan(0);
  });

  it("leaves absent facts absent (developer, country, coordinates, currency)", () => {
    const record = buildCoralinaRecord();
    expect(record.developer).toBeNull();
    expect(record.project.developerId).toBeUndefined();
    expect(record.project.country).toBeUndefined();
    expect(record.location?.geo).toBeUndefined();
    expect(record.location?.country).toBeUndefined();
    // No verified construction / rental / investment / payment collections.
    expect(record.constructionProgress).toEqual([]);
    expect(record.rentalInformation).toEqual([]);
    expect(record.investmentInformation).toEqual([]);
    expect(record.paymentPlans).toEqual([]);
  });

  it("never promotes a price to a canonical Money value (no currency in source)", () => {
    const record = buildCoralinaRecord();
    for (const unit of record.units) {
      expect(unit.basePrice).toBeUndefined();
      expect(unit.discountedPrice).toBeUndefined();
      expect(unit.pricePerSqm).toBeUndefined();
      // but the verified figure is preserved verbatim in provenance
      expect(unit.source?.raw?.price).toBeDefined();
      expect(unit.source?.raw?.currency).toBeNull();
    }
    expect(record.project.pricing.startingPrice).toBeUndefined();
  });

  it("passes RC3.0 record validation (schema + duplicates + integrity)", () => {
    const result = validateForeverDatabaseRecord(buildCoralinaRecord());
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("has no duplicate entities and full referential integrity", () => {
    const record = buildCoralinaRecord();
    expect(validateNoDuplicateEntities(record).valid).toBe(true);
    expect(validateReferentialIntegrity(record).valid).toBe(true);
    expect(findDuplicateEntities(record.units, foreverDatabaseEntities.unit)).toEqual([]);
    expect(findDuplicateEntities(record.media, foreverDatabaseEntities.media)).toEqual([]);
    expect(findDuplicateEntities(record.documents, foreverDatabaseEntities.document)).toEqual([]);
  });

  it("detects a deliberately duplicated unit (duplicate detection works)", () => {
    const record = buildCoralinaRecord();
    const withDupe = { ...record, units: [...record.units, record.units[0]] };
    expect(findDuplicateEntities(withDupe.units, foreverDatabaseEntities.unit)).toHaveLength(1);
    expect(validateNoDuplicateEntities(withDupe).valid).toBe(false);
  });
});
