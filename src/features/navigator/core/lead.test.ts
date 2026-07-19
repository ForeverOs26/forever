import { describe, expect, it } from "vitest";

import type { Property } from "@/lib/data";
import { validateLead } from "@/lib/lead-service";
import {
  BOOTH_LEAD_SOURCE,
  buildBoothLeadPayload,
  buildForeverStory,
  buildRecommendationPath,
  evaluateMatch,
  deriveDecisionProfile,
  purchasePurpose,
  type BoothContactDetails,
  type NavigatorAnswers,
} from "./index";

const answers: NavigatorAnswers = {
  motivations: ["investment", "second_home"],
  goals: ["rental_income"],
  budget: "500k_1m",
  timeline: "ready_now",
  concerns: ["rental_returns"],
  note: "West coast preferred",
};

const contact: BoothContactDetails = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  phone: "+66 81 234 5678",
  country: "United Kingdom",
  staffNote: "Serious buyer, ready this quarter",
};

function project(): Property {
  return {
    slug: "the-modeva-bang-tao",
    name: "The Modeva",
    developer: "Dev",
    location: "Bang Tao",
    propertyType: "Residence",
    constructionStatus: "Ready",
    status: "Available",
    tagline: "Coastal residences",
    description: "",
    highlights: [],
    beds: "",
    area: "",
    price: "From ฿20M",
    startingPriceTHB: 20_000_000,
    priceRange: "",
    pricePerSqm: "",
    lastPriceUpdate: "",
    verifiedPrice: "",
    promotion: "",
    foreverVerified: true,
    trustScore: 0,
    trustNote: "",
    investmentValue: 0,
    marketPosition: "In line with market",
    verdict: "Strong Buy",
    distanceToBeach: "",
    distanceToAirport: "",
    nearbySchools: [],
    nearbyHospitals: [],
    lifestyle: [],
    rentalYield: "6%",
    rentalDemand: "High",
    capitalGrowthEstimate: "",
    startDate: "",
    completionDate: "",
    lastInspection: "",
    image: "",
    gallery: [],
    floorPlans: [],
    brochures: [],
    videos: [],
  };
}

function buildInput() {
  const p = project();
  const profile = deriveDecisionProfile(answers);
  return buildBoothLeadPayload({
    contact,
    answers,
    story: buildForeverStory(answers),
    recommendation: buildRecommendationPath(answers),
    project: p,
    reasons: evaluateMatch(profile, p),
  });
}

describe("booth lead payload maps to the existing lead-service contract", () => {
  it("maps required + booth-specific fields exactly (task §12)", () => {
    const payload = buildInput();

    expect(payload.firstName).toBe("Ada");
    expect(payload.lastName).toBe("Lovelace");
    expect(payload.email).toBe("ada@example.com");
    expect(payload.phone).toBe("+66 81 234 5678");
    expect(payload.country).toBe("United Kingdom");

    expect(payload.source).toBe("booth");
    expect(BOOTH_LEAD_SOURCE).toBe("booth");
    // Runtime selected-project slug (published record slug, not import-engine).
    expect(payload.projectSlug).toBe("the-modeva-bang-tao");
    // Approved NAV-001 budget answer (label).
    expect(payload.budget).toBe("$500k–1M");
    // Selected project + confirmed purchase purpose.
    expect(payload.interest).toContain("The Modeva");
    expect(payload.interest).toContain(purchasePurpose(answers));
  });

  it("passes the existing validation contract with no errors", () => {
    expect(validateLead(buildInput())).toEqual({});
  });

  it("writes a deterministic, readable session summary into message", () => {
    const message = buildInput().message ?? "";
    expect(message).toContain("NAV-001 answers");
    expect(message).toContain("$500k–1M"); // budget answer
    expect(message).toContain("Confirmed Forever Story");
    expect(message).toContain("Recommendation path");
    expect(message).toContain("The Modeva"); // selected project
    // Supported reason: rental-yield evidence. No budget reason may appear —
    // USD bands and THB prices are not comparable without a canonical rate.
    expect(message).toContain("Purchase goal supported by available project evidence");
    expect(message).not.toContain("Within selected budget");
    expect(message).toContain("Serious buyer, ready this quarter"); // staff note
    // Deterministic: same inputs, same output.
    expect(buildInput().message).toBe(buildInput().message);
  });

  it("does not invent an email address", () => {
    const payload = buildBoothLeadPayload({
      contact: { ...contact, email: "" },
      answers,
      story: null,
      recommendation: buildRecommendationPath(answers),
      project: project(),
      reasons: [],
    });
    expect(payload.email).toBe("");
  });
});
