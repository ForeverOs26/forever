import { describe, expect, it } from "vitest";

import {
  CORALINA_LOCATION_ID,
  CORALINA_PROJECT_ID,
  CORALINA_SLUG,
  coralinaAssetId,
  coralinaUnitId,
} from "../identity";

describe("Coralina identity", () => {
  it("derives stable ids from verified natural keys", () => {
    expect(CORALINA_SLUG).toBe("coralina");
    expect(CORALINA_PROJECT_ID).toBe("proj_coralina");
    expect(CORALINA_LOCATION_ID).toBe("proj_coralina::location");
  });

  it("is deterministic — the same natural key always yields the same id", () => {
    expect(coralinaUnitId("CKA201")).toBe(coralinaUnitId("CKA201"));
    expect(coralinaUnitId("CKA201")).toBe("proj_coralina::unit::CKA201");
    expect(coralinaAssetId("media", "a/b/c.jpg")).toBe(coralinaAssetId("media", "a/b/c.jpg"));
  });

  it("produces distinct ids for distinct natural keys", () => {
    expect(coralinaUnitId("CKA201")).not.toBe(coralinaUnitId("CKA202"));
    expect(coralinaAssetId("media", "x.jpg")).not.toBe(coralinaAssetId("document", "x.jpg"));
  });

  it("uses no randomness or clock (repeated calls are equal)", () => {
    const first = [coralinaUnitId("CKA201"), coralinaAssetId("document", "d.pdf")];
    const second = [coralinaUnitId("CKA201"), coralinaAssetId("document", "d.pdf")];
    expect(first).toEqual(second);
  });
});
