import type { IntelligenceInput, ScoreResult } from "../intelligence-types";

function band(score: number): ScoreResult["band"] {
  if (score >= 85) return "excellent";
  if (score >= 70) return "strong";
  if (score >= 50) return "fair";
  if (score > 0) return "weak";
  return "unknown";
}

function beachScore(distanceMeters: number | null): number {
  if (distanceMeters === null) return 0;
  if (distanceMeters <= 300) return 30;
  if (distanceMeters <= 800) return 24;
  if (distanceMeters <= 1500) return 16;
  if (distanceMeters <= 3000) return 8;
  return 3;
}

export function scoreLocation(input: IntelligenceInput): ScoreResult {
  const fields = input.fields;
  let score = 0;

  score += beachScore(fields.distanceToBeachMeters);
  score += Math.min(fields.nearbySchoolsCount * 8, 16);
  score += Math.min(fields.nearbyHospitalsCount * 8, 16);
  score += Math.min(fields.lifestyleCount * 5, 20);
  if (fields.locationArea) score += 10;
  if (fields.distanceToAirportText) score += 8;

  const finalScore = Math.min(100, Math.round(score));

  return {
    key: "location",
    label: "Location",
    score: finalScore,
    maxScore: 100,
    band: band(finalScore),
    summary: "Location score uses beach access, area, airport, schools, hospitals, and lifestyle anchors.",
    sourceFields: [
      "location.distanceToBeach",
      "location.distanceToAirport",
      "location.nearbySchools",
      "location.nearbyHospitals",
      "location.lifestyle",
      "core.location",
    ],
    sourceValues: {
      distanceToBeachText: fields.distanceToBeachText,
      distanceToBeachMeters: fields.distanceToBeachMeters,
      distanceToAirportText: fields.distanceToAirportText,
      nearbySchoolsCount: fields.nearbySchoolsCount,
      nearbyHospitalsCount: fields.nearbyHospitalsCount,
      lifestyleCount: fields.lifestyleCount,
      locationArea: fields.locationArea,
    },
  };
}
