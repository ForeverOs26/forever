import type { ProjectDetail } from "@/features/project-detail/project-detail-types";

import { NOT_AVAILABLE } from "./investment-intelligence";

/**
 * Location Intelligence — Foundation layer (Sprint RC2.3).
 *
 * A deterministic, evidence-only derivation over the EXISTING `ProjectDetail`
 * view model. It reports what the verified project record can currently support
 * about the project's LOCATION, and — just as importantly — what it cannot. It
 * follows exactly the same architectural principles as the Investment
 * Intelligence (`./investment-intelligence`) and Rental Intelligence
 * (`./rental-intelligence`) foundations.
 *
 * Hard rules honoured here (see the module tests for the guarantees):
 *  - Every field is derived strictly from existing `ProjectDetail` data. Each
 *    surfaced value is traceable to a concrete source field, recorded in the
 *    `sources` map on the returned view model.
 *  - Nothing is fabricated or estimated. The layer NEVER invents a distance to
 *    beach, distance to airport, travel time, walkability, infrastructure
 *    quality, rental/tourism demand, capital growth, area appreciation,
 *    neighbourhood safety, school/hospital access, traffic conditions, future
 *    infrastructure, market averages, or a location score. Missing data renders
 *    as `NOT_AVAILABLE`.
 *  - Beach and airport proximity are surfaced ONLY as the verbatim recorded
 *    string on `location.distanceToBeach` / `location.distanceToAirport`. If the
 *    field is empty, the value is `NOT_AVAILABLE` — never interpolated from
 *    coordinates or the area name.
 *  - No travel time is ever produced: there is no verified `ProjectDetail`
 *    source for it, so it is never surfaced in any form.
 *  - `trust.trustScore` (and `matchScore`, investment/rental scores) are NEVER
 *    reused as a location score.
 *  - No numeric Location Score is produced. No approved, evidence-backed
 *    calculation rule exists in the repository, so the score field is always
 *    `LOCATION_SCORE_UNAVAILABLE`.
 *  - Identical input always produces identical output (pure function).
 *
 * `NOT_AVAILABLE` is intentionally reused from the Investment Intelligence
 * module so all three foundations render the exact same sentinel.
 */

/**
 * Rendered in place of a numeric Location Score. This foundation sprint
 * intentionally ships no scoring engine; there is no approved, evidence-backed
 * calculation rule in the repository to derive one from.
 */
export const LOCATION_SCORE_UNAVAILABLE = "Location score not available" as const;

/** Conservative, deterministic readiness verdicts. Ordered low → high. */
export type LocationReadinessVerdict =
  | "Insufficient verified data"
  | "More evidence required"
  | "Ready for preliminary review";

/**
 * The exact boolean evidence signals that drive the readiness verdict. Exposed
 * so the verdict is fully explainable and directly assertable in tests.
 */
export interface LocationReadinessSignals {
  /** A named area / location identity exists. */
  hasAreaIdentity: boolean;
  /** A concrete recorded address exists. */
  hasAddress: boolean;
  /** A recorded beach-proximity string exists (verbatim, never computed). */
  hasBeachProximity: boolean;
  /** A recorded airport-proximity string exists (verbatim, never computed). */
  hasAirportProximity: boolean;
  /** At least one recorded lifestyle / amenity entry exists. */
  hasLifestyle: boolean;
  /** At least one recorded nearby school or hospital exists. */
  hasInfrastructure: boolean;
}

/**
 * Source field references for each surfaced value. Every entry is a path into
 * the canonical `ProjectDetail` model, proving traceability and making the
 * anti-fabrication contract auditable. Static and deterministic.
 */
export interface LocationIntelligenceSources {
  locationIdentity: string;
  locationDescription: string;
  beachProximity: string;
  airportProximity: string;
  lifestyleEvidence: string;
  infrastructureEvidence: string;
  rentalLocationEvidence: string;
  resaleLocationEvidence: string;
}

/** Fully-derived, presentational-ready Location Intelligence for one project. */
export interface LocationIntelligence {
  /** 1. Area / location identity — the recorded location name. */
  locationIdentity: string;
  /** 2. Location description — the recorded concrete address. */
  locationDescription: string;
  /** 3. Beach proximity evidence — verbatim recorded value, never computed. */
  beachProximity: string;
  /** 4. Airport proximity evidence — verbatim recorded value, never computed. */
  airportProximity: string;
  /** 5. Lifestyle and amenity evidence — recorded amenity labels. */
  lifestyleEvidence: string;
  /** 6. Infrastructure evidence — recorded nearby schools / hospitals (presence only). */
  infrastructureEvidence: string;
  /** 7. Rental-location evidence — which recorded location factors are on file. */
  rentalLocationEvidence: string;
  /** 8. Resale / liquidity location evidence — which recorded location factors are on file. */
  resaleLocationEvidence: string;
  /** 9. Named data gaps, deterministically ordered. Empty when nothing is missing. */
  keyDataGaps: string[];
  /** 10. Location readiness verdict — conservative, rule-based. */
  readinessVerdict: LocationReadinessVerdict;
  /** Plain-language, deterministic explanation of the verdict. */
  verdictRationale: string;
  /** 11. Location score status — always `LOCATION_SCORE_UNAVAILABLE` this sprint. */
  locationScore: typeof LOCATION_SCORE_UNAVAILABLE;
  /** The raw signals behind the verdict, for transparency and testing. */
  signals: LocationReadinessSignals;
  /** Source field references for every surfaced value. */
  sources: LocationIntelligenceSources;
}

/** The immutable source-field map. Kept as a constant so it never varies. */
const SOURCES: LocationIntelligenceSources = {
  locationIdentity: "location.area (core.location)",
  locationDescription: "core.address",
  beachProximity: "location.distanceToBeach",
  airportProximity: "location.distanceToAirport",
  lifestyleEvidence: "location.lifestyle",
  infrastructureEvidence: "location.nearbySchools, location.nearbyHospitals",
  rentalLocationEvidence:
    "location.distanceToBeach, location.distanceToAirport, location.lifestyle",
  resaleLocationEvidence:
    "location.distanceToBeach, location.distanceToAirport, location.nearbySchools, location.nearbyHospitals",
};

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Distinct, cleaned, first-seen-ordered list of strings. */
function distinctText(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    if (hasText(raw)) {
      const value = raw.trim();
      if (!seen.has(value)) {
        seen.add(value);
        out.push(value);
      }
    }
  }
  return out;
}

function deriveLocationIdentity(project: ProjectDetail): string {
  const area = hasText(project.location.area) ? project.location.area : project.core.location;
  return hasText(area) ? area.trim() : NOT_AVAILABLE;
}

function deriveLocationDescription(project: ProjectDetail): string {
  return hasText(project.core.address) ? project.core.address.trim() : NOT_AVAILABLE;
}

/**
 * Beach / airport proximity: surfaced ONLY as the verbatim recorded string.
 * Never derived from coordinates, the area name, or any estimate.
 */
function deriveBeachProximity(project: ProjectDetail): string {
  return hasText(project.location.distanceToBeach)
    ? `Recorded: ${project.location.distanceToBeach.trim()}`
    : NOT_AVAILABLE;
}

function deriveAirportProximity(project: ProjectDetail): string {
  return hasText(project.location.distanceToAirport)
    ? `Recorded: ${project.location.distanceToAirport.trim()}`
    : NOT_AVAILABLE;
}

function deriveLifestyleEvidence(project: ProjectDetail): string {
  const entries = distinctText(project.location.lifestyle);
  return entries.length > 0
    ? `${entries.length} recorded lifestyle/amenity feature(s): ${entries.join(", ")}`
    : NOT_AVAILABLE;
}

function deriveInfrastructureEvidence(project: ProjectDetail): string {
  const schools = distinctText(project.location.nearbySchools).length;
  const hospitals = distinctText(project.location.nearbyHospitals).length;

  const parts: string[] = [];
  if (schools > 0) parts.push(`${schools} recorded nearby school(s)`);
  if (hospitals > 0) parts.push(`${hospitals} recorded nearby hospital(s)`);

  return parts.length > 0 ? parts.join("; ") : NOT_AVAILABLE;
}

/**
 * Rental / resale location evidence: NON-interpretive. It only lists which
 * recorded location factors are on file — it makes NO claim about demand,
 * growth, appreciation, or liquidity. If none of the relevant factors are
 * recorded, the value is `NOT_AVAILABLE`.
 */
function deriveFactorEvidence(factors: Array<[boolean, string]>): string {
  const present = factors.filter(([ok]) => ok).map(([, label]) => label);
  return present.length > 0 ? `Location factors on record: ${present.join(", ")}` : NOT_AVAILABLE;
}

function deriveKeyDataGaps(signals: LocationReadinessSignals): string[] {
  const gaps: string[] = [];
  if (!signals.hasAreaIdentity) gaps.push("Area identity");
  if (!signals.hasAddress) gaps.push("Address");
  if (!signals.hasBeachProximity) gaps.push("Beach proximity");
  if (!signals.hasAirportProximity) gaps.push("Airport proximity");
  if (!signals.hasLifestyle) gaps.push("Lifestyle & amenities");
  if (!signals.hasInfrastructure) gaps.push("Nearby schools/hospitals");
  return gaps;
}

/**
 * Verdict rules — deterministic and conservative.
 *
 * Foundational signals (BOTH required to leave "Insufficient verified data"):
 *   F1 hasAreaIdentity · F2 hasAddress
 *
 * Depth signals (recorded location substance):
 *   D1 hasBeachProximity · D2 hasAirportProximity · D3 hasLifestyle · D4 hasInfrastructure
 *
 * Rules, in order:
 *   1. Any foundational signal missing               → "Insufficient verified data"
 *      (this includes the "only the location name exists" case — no address.)
 *   2. Both foundational present AND ≥ 2 depth signals → "Ready for preliminary review"
 *   3. Both foundational present AND < 2 depth signals → "More evidence required"
 *
 * The verdict is never expressed as, and never implies, a quality judgement of
 * the location itself. It reports only whether the record carries enough
 * verified location DATA for a preliminary review.
 */
function deriveVerdict(signals: LocationReadinessSignals): {
  readinessVerdict: LocationReadinessVerdict;
  verdictRationale: string;
} {
  const foundationalPresent = signals.hasAreaIdentity && signals.hasAddress;
  const depthCount = [
    signals.hasBeachProximity,
    signals.hasAirportProximity,
    signals.hasLifestyle,
    signals.hasInfrastructure,
  ].filter(Boolean).length;

  if (!foundationalPresent) {
    const missing: string[] = [];
    if (!signals.hasAreaIdentity) missing.push("area identity");
    if (!signals.hasAddress) missing.push("address");
    return {
      readinessVerdict: "Insufficient verified data",
      verdictRationale: `Missing foundational location evidence: ${missing.join(", ")}.`,
    };
  }

  if (depthCount >= 2) {
    return {
      readinessVerdict: "Ready for preliminary review",
      verdictRationale: `Foundational location evidence present with ${depthCount} of 4 supporting signals (beach proximity, airport proximity, lifestyle, nearby infrastructure).`,
    };
  }

  return {
    readinessVerdict: "More evidence required",
    verdictRationale: `Foundational location evidence present but only ${depthCount} of 4 supporting signals (beach proximity, airport proximity, lifestyle, nearby infrastructure).`,
  };
}

/**
 * Derive the Location Intelligence view model for a project. Pure and
 * deterministic: identical `ProjectDetail` input yields identical output.
 */
export function deriveLocationIntelligence(project: ProjectDetail): LocationIntelligence {
  const locationIdentity = deriveLocationIdentity(project);
  const locationDescription = deriveLocationDescription(project);
  const beachProximity = deriveBeachProximity(project);
  const airportProximity = deriveAirportProximity(project);
  const lifestyleEvidence = deriveLifestyleEvidence(project);
  const infrastructureEvidence = deriveInfrastructureEvidence(project);

  const signals: LocationReadinessSignals = {
    hasAreaIdentity: locationIdentity !== NOT_AVAILABLE,
    hasAddress: locationDescription !== NOT_AVAILABLE,
    hasBeachProximity: beachProximity !== NOT_AVAILABLE,
    hasAirportProximity: airportProximity !== NOT_AVAILABLE,
    hasLifestyle: lifestyleEvidence !== NOT_AVAILABLE,
    hasInfrastructure: infrastructureEvidence !== NOT_AVAILABLE,
  };

  const rentalLocationEvidence = deriveFactorEvidence([
    [signals.hasBeachProximity, "beach proximity"],
    [signals.hasAirportProximity, "airport proximity"],
    [signals.hasLifestyle, "lifestyle & amenities"],
  ]);
  const resaleLocationEvidence = deriveFactorEvidence([
    [signals.hasBeachProximity, "beach proximity"],
    [signals.hasAirportProximity, "airport proximity"],
    [signals.hasInfrastructure, "nearby infrastructure"],
  ]);

  const keyDataGaps = deriveKeyDataGaps(signals);
  const { readinessVerdict, verdictRationale } = deriveVerdict(signals);

  return {
    locationIdentity,
    locationDescription,
    beachProximity,
    airportProximity,
    lifestyleEvidence,
    infrastructureEvidence,
    rentalLocationEvidence,
    resaleLocationEvidence,
    keyDataGaps,
    readinessVerdict,
    verdictRationale,
    locationScore: LOCATION_SCORE_UNAVAILABLE,
    signals,
    sources: SOURCES,
  };
}
