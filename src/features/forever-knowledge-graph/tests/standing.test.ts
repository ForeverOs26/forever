import { describe, expect, it } from "vitest";

import {
  KNOWLEDGE_STANDINGS,
  UNVERIFIED_KNOWLEDGE_STANDING,
  isKnownKnowledgeStanding,
  isSettledKnowledgeStanding,
  knowledgeStandingRequiresReview,
} from "..";

describe("knowledge standing vocabulary", () => {
  it("declares the closed uncertainty vocabulary in a stable order", () => {
    expect(KNOWLEDGE_STANDINGS).toEqual([
      "corroborated",
      "unverified",
      "disputed",
      "incomparable",
      "stale",
      "unavailable",
      "missing",
    ]);
  });

  it("guards the vocabulary at runtime", () => {
    for (const standing of KNOWLEDGE_STANDINGS) {
      expect(isKnownKnowledgeStanding(standing)).toBe(true);
    }
    expect(isKnownKnowledgeStanding("verified")).toBe(false);
    expect(isKnownKnowledgeStanding(undefined)).toBe(false);
    expect(isKnownKnowledgeStanding(3)).toBe(false);
  });

  it("states the explicit unverified default", () => {
    expect(UNVERIFIED_KNOWLEDGE_STANDING).toBe("unverified");
  });

  it("only active disagreement requires review", () => {
    expect(knowledgeStandingRequiresReview("disputed")).toBe(true);
    expect(knowledgeStandingRequiresReview("incomparable")).toBe(true);
    for (const standing of [
      "corroborated",
      "unverified",
      "stale",
      "unavailable",
      "missing",
    ] as const) {
      expect(knowledgeStandingRequiresReview(standing)).toBe(false);
    }
  });

  it("only corroborated knowledge is settled", () => {
    expect(isSettledKnowledgeStanding("corroborated")).toBe(true);
    for (const standing of KNOWLEDGE_STANDINGS.filter((value) => value !== "corroborated")) {
      expect(isSettledKnowledgeStanding(standing)).toBe(false);
    }
  });
});
