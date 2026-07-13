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
    expect(record.project.name).toBe("The Title Coralina Kamala");
    expect(record.project.province).toBe("Phuket");
    expect(record.project.area).toBe("Kamala");
    expect(record.location?.areaName).toBe("Kamala");
    expect(record.units).toHaveLength(198);
    expect(record.documents.length).toBeGreaterThan(0);
    expect(record.media.length).toBeGreaterThan(0);
  });

  it("maps verified developer/country and leaves coordinates absent", () => {
    const record = buildCoralinaRecord();
    expect(record.developer?.name).toBe("Rhom Bho Property Public Company Limited");
    expect(record.project.developerId).toBe(record.developer?.id);
    expect(record.project.country).toBe("Thailand");
    expect(record.location?.geo).toBeUndefined();
    expect(record.location?.country).toBe("Thailand");
    // No verified construction / rental / investment / payment collections.
    expect(record.constructionProgress).toEqual([]);
    expect(record.rentalInformation).toEqual([]);
    expect(record.investmentInformation).toEqual([]);
    expect(record.paymentPlans).toEqual([]);
  });

  it("promotes prices with transparent inferred-default THB provenance", () => {
    const record = buildCoralinaRecord();
    for (const unit of record.units) {
      expect(unit.basePrice?.currency).toBe("THB");
      expect(unit.basePrice?.amount).toBeGreaterThan(0);
      expect(unit.discountedPrice).toBeUndefined();
      expect(unit.pricePerSqm).toBeGreaterThan(0);
      expect(unit.source?.raw?.price).toBeDefined();
      expect(unit.source?.raw?.sourceCurrency).toBeNull();
      expect(unit.source?.raw?.currencyDecision).toMatchObject({
        value: "THB",
        status: "inferred_default",
        confidence: "medium",
        inferenceRule: "project_country_default_currency",
        inferredFromCountry: "Thailand",
      });
    }
    expect(record.project.pricing.startingPrice?.currency).toBe("THB");
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
