/**
 * Project detail — raw unverified developer/location fallback mapping.
 * Pure mapper test; complements the existing Modeva adapter regression suite.
 */

import { describe, expect, it } from "vitest";

import { mapProjectDetail } from "./project-detail-mappers";
import type { ProjectDetailRecord } from "./project-detail-types";

function minimalRecord(overrides: Partial<ProjectDetailRecord> = {}): ProjectDetailRecord {
  return {
    id: "p-1",
    slug: "coralina",
    name: "Coralina",
    is_featured: false,
    is_active: true,
    forever_verified: false,
    developer: null,
    media: null,
    units: null,
    investment: null,
    ...overrides,
  } as unknown as ProjectDetailRecord;
}

describe("raw developer/location fallback", () => {
  it("maps raw names into the core view model when no canonical link exists", () => {
    const detail = mapProjectDetail(
      minimalRecord({
        developer_name_raw: "Rhom Bho Property Public Company Limited",
        location_name_raw: "Kamala, Phuket",
      }),
    );
    expect(detail.developer).toBeNull();
    expect(detail.core.developerNameRaw).toBe("Rhom Bho Property Public Company Limited");
    expect(detail.core.locationNameRaw).toBe("Kamala, Phuket");
  });

  it("keeps the fallback empty and the view model safe when the columns are absent", () => {
    const detail = mapProjectDetail(minimalRecord());
    expect(detail.core.developerNameRaw).toBe("");
    expect(detail.core.locationNameRaw).toBe("");
    expect(detail.units).toEqual([]);
    expect(detail.media.hero).toBeNull();
  });
});
