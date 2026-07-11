import { describe, expect, it } from "vitest";

import { NOT_AVAILABLE } from "../investment-intelligence";
import { LOCATION_SCORE_UNAVAILABLE, deriveLocationIntelligence } from "../location-intelligence";
import { makeProject } from "./fixtures";

describe("deriveLocationIntelligence — sparse (Modeva-like) record", () => {
  // Only the location name/area and address are present (matching the verified
  // Modeva seed); every richer location field is empty.
  const result = deriveLocationIntelligence(
    makeProject({
      core: { location: "Bang Tao", address: "Bang Tao, Phuket, Thailand" },
      location: {
        area: "Bang Tao",
        latitude: null,
        longitude: null,
        distanceToBeach: "",
        distanceToAirport: "",
        nearbySchools: [],
        nearbyHospitals: [],
        lifestyle: [],
      },
    }),
  );

  it("surfaces the recorded location identity and description", () => {
    expect(result.locationIdentity).toBe("Bang Tao");
    expect(result.locationDescription).toBe("Bang Tao, Phuket, Thailand");
  });

  it("renders unsupported location fields as 'Not available'", () => {
    expect(result.beachProximity).toBe(NOT_AVAILABLE);
    expect(result.airportProximity).toBe(NOT_AVAILABLE);
    expect(result.lifestyleEvidence).toBe(NOT_AVAILABLE);
    expect(result.infrastructureEvidence).toBe(NOT_AVAILABLE);
    expect(result.rentalLocationEvidence).toBe(NOT_AVAILABLE);
    expect(result.resaleLocationEvidence).toBe(NOT_AVAILABLE);
  });

  it("never fabricates a distance or travel-time value when the field is empty", () => {
    const serialized = JSON.stringify(result);
    // No digit-bearing distance/travel string may appear for beach or airport.
    expect(result.beachProximity).not.toMatch(/\d/);
    expect(result.airportProximity).not.toMatch(/\d/);
    // The layer never introduces the concept of travel time at all.
    expect(serialized.toLowerCase()).not.toContain("minute");
    expect(serialized.toLowerCase()).not.toContain("travel time");
  });

  it("lists the key location data gaps deterministically", () => {
    expect(result.keyDataGaps).toEqual([
      "Beach proximity",
      "Airport proximity",
      "Lifestyle & amenities",
      "Nearby schools/hospitals",
    ]);
  });

  it("never produces a numeric location score", () => {
    expect(result.locationScore).toBe(LOCATION_SCORE_UNAVAILABLE);
    expect(result.locationScore).toBe("Location score not available");
  });

  it("returns a conservative verdict when only name + address exist", () => {
    expect(result.readinessVerdict).toBe("More evidence required");
    expect(result.verdictRationale).toContain("0 of 4");
  });
});

describe("deriveLocationIntelligence — only the location name exists", () => {
  const result = deriveLocationIntelligence(
    makeProject({
      core: { location: "Bang Tao", address: "" },
      location: {
        area: "Bang Tao",
        latitude: null,
        longitude: null,
        distanceToBeach: "",
        distanceToAirport: "",
        nearbySchools: [],
        nearbyHospitals: [],
        lifestyle: [],
      },
    }),
  );

  it("shows the name and marks every other field 'Not available'", () => {
    expect(result.locationIdentity).toBe("Bang Tao");
    expect(result.locationDescription).toBe(NOT_AVAILABLE);
    expect(result.beachProximity).toBe(NOT_AVAILABLE);
    expect(result.airportProximity).toBe(NOT_AVAILABLE);
    expect(result.lifestyleEvidence).toBe(NOT_AVAILABLE);
    expect(result.infrastructureEvidence).toBe(NOT_AVAILABLE);
  });

  it("is 'Insufficient verified data' because address is missing", () => {
    expect(result.signals.hasAreaIdentity).toBe(true);
    expect(result.signals.hasAddress).toBe(false);
    expect(result.readinessVerdict).toBe("Insufficient verified data");
    expect(result.verdictRationale).toContain("address");
  });
});

describe("deriveLocationIntelligence — no fabrication", () => {
  it("surfaces beach/airport proximity ONLY as the verbatim recorded value", () => {
    const result = deriveLocationIntelligence(
      makeProject({
        core: { location: "Bang Tao", address: "1 Beach Road" },
        location: {
          area: "Bang Tao",
          latitude: 7.99,
          longitude: 98.29,
          distanceToBeach: "Bang Tao area",
          distanceToAirport: "Near the airport",
          nearbySchools: [],
          nearbyHospitals: [],
          lifestyle: [],
        },
      }),
    );

    // Verbatim recorded strings — never computed from coordinates.
    expect(result.beachProximity).toBe("Recorded: Bang Tao area");
    expect(result.airportProximity).toBe("Recorded: Near the airport");
    // Latitude/longitude are never leaked as a fabricated distance.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("7.99");
    expect(serialized).not.toContain("98.29");
  });

  it("never reuses trustScore, matchScore, or any unrelated score as a location score", () => {
    const trustScore = 91;
    const result = deriveLocationIntelligence(
      makeProject({ trust: { trustScore }, investment: { investmentValue: 42 } }),
    );

    expect(result.locationScore).toBe(LOCATION_SCORE_UNAVAILABLE);
    expect(JSON.stringify(result)).not.toContain(String(trustScore));
    expect(result).not.toHaveProperty("matchScore");
    expect(result).not.toHaveProperty("trustScore");
  });

  it("makes no demand, growth, or market claim in rental/resale location evidence", () => {
    const result = deriveLocationIntelligence(
      makeProject({
        core: { location: "Bang Tao", address: "1 Beach Road" },
        location: {
          area: "Bang Tao",
          latitude: null,
          longitude: null,
          distanceToBeach: "500 m",
          distanceToAirport: "",
          nearbySchools: ["Intl School"],
          nearbyHospitals: [],
          lifestyle: ["Beach club"],
        },
      }),
    );

    for (const field of [result.rentalLocationEvidence, result.resaleLocationEvidence]) {
      const lower = field.toLowerCase();
      expect(lower).not.toContain("demand");
      expect(lower).not.toContain("growth");
      expect(lower).not.toContain("appreciation");
      expect(lower).not.toContain("high");
      expect(lower).not.toContain("premium");
    }
    // They only enumerate which recorded factors exist.
    expect(result.rentalLocationEvidence).toBe(
      "Location factors on record: beach proximity, lifestyle & amenities",
    );
    expect(result.resaleLocationEvidence).toBe(
      "Location factors on record: beach proximity, nearby infrastructure",
    );
  });
});

describe("deriveLocationIntelligence — traceability", () => {
  it("records a ProjectDetail source reference for every surfaced value", () => {
    const result = deriveLocationIntelligence(makeProject());
    expect(result.sources.beachProximity).toBe("location.distanceToBeach");
    expect(result.sources.airportProximity).toBe("location.distanceToAirport");
    expect(result.sources.locationIdentity).toContain("location.area");
    expect(result.sources.locationDescription).toBe("core.address");
    // Every source path points into the canonical ProjectDetail model.
    for (const path of Object.values(result.sources)) {
      expect(path).toMatch(/^(location|core)\./);
    }
  });
});

describe("deriveLocationIntelligence — determinism", () => {
  it("produces identical output for identical input", () => {
    const project = makeProject({
      core: { location: "Bang Tao", address: "1 Beach Road" },
      location: {
        area: "Bang Tao",
        latitude: null,
        longitude: null,
        distanceToBeach: "500 m",
        distanceToAirport: "20 km",
        nearbySchools: ["Intl School", "Intl School"],
        nearbyHospitals: ["Clinic"],
        lifestyle: ["Beach club", "Restaurants"],
      },
    });

    const first = deriveLocationIntelligence(project);
    const second = deriveLocationIntelligence(project);

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toEqual(JSON.stringify(second));
  });
});

describe("deriveLocationIntelligence — verdict tiers", () => {
  it("is 'Ready for preliminary review' with both foundational + ≥2 depth signals", () => {
    const result = deriveLocationIntelligence(
      makeProject({
        core: { location: "Bang Tao", address: "1 Beach Road" },
        location: {
          area: "Bang Tao",
          latitude: null,
          longitude: null,
          distanceToBeach: "500 m",
          distanceToAirport: "20 km",
          nearbySchools: [],
          nearbyHospitals: [],
          lifestyle: ["Beach club"],
        },
      }),
    );

    expect(result.signals).toEqual({
      hasAreaIdentity: true,
      hasAddress: true,
      hasBeachProximity: true,
      hasAirportProximity: true,
      hasLifestyle: true,
      hasInfrastructure: false,
    });
    expect(result.beachProximity).toBe("Recorded: 500 m");
    expect(result.lifestyleEvidence).toBe("1 recorded lifestyle/amenity feature(s): Beach club");
    expect(result.readinessVerdict).toBe("Ready for preliminary review");
    expect(result.keyDataGaps).toEqual(["Nearby schools/hospitals"]);
  });

  it("deduplicates nearby infrastructure and lifestyle entries", () => {
    const result = deriveLocationIntelligence(
      makeProject({
        location: {
          area: "Bang Tao",
          latitude: null,
          longitude: null,
          distanceToBeach: "",
          distanceToAirport: "",
          nearbySchools: ["Intl School", "Intl School", "Village School"],
          nearbyHospitals: ["Clinic"],
          lifestyle: ["Beach club", "Beach club"],
        },
      }),
    );

    expect(result.infrastructureEvidence).toBe(
      "2 recorded nearby school(s); 1 recorded nearby hospital(s)",
    );
    expect(result.lifestyleEvidence).toBe("1 recorded lifestyle/amenity feature(s): Beach club");
  });
});
