import { describe, expect, it } from "vitest";

import { SOURCE_TRUST_LEVELS, sourceTrustRank } from "@/features/forever-source-registry";

import {
  PROJECT_SOURCE_AUTHORITY_KINDS,
  PROJECT_SOURCE_TRUST_LEVELS,
  compareProjectSourceAuthority,
  defaultTrustForProjectSourceAuthorityKind,
  isKnownProjectSourceAuthorityKind,
  meetsProjectSourceTrust,
  projectSourceAuthority,
  projectSourceAuthorityMeets,
  projectSourceTrustRank,
} from "..";

describe("authority kinds", () => {
  it("declares the issuer vocabulary with an explicit unknown", () => {
    expect(PROJECT_SOURCE_AUTHORITY_KINDS).toEqual([
      "developer_official",
      "government",
      "forever_verified",
      "agency",
      "third_party",
      "unknown",
    ]);
    expect(isKnownProjectSourceAuthorityKind("government")).toBe(true);
    expect(isKnownProjectSourceAuthorityKind("oracle")).toBe(false);
  });

  it("maps every kind to a deterministic default trust; unattributed stays unverified", () => {
    for (const kind of PROJECT_SOURCE_AUTHORITY_KINDS) {
      expect(PROJECT_SOURCE_TRUST_LEVELS).toContain(
        defaultTrustForProjectSourceAuthorityKind(kind),
      );
    }
    expect(defaultTrustForProjectSourceAuthorityKind("government")).toBe("authoritative");
    expect(defaultTrustForProjectSourceAuthorityKind("developer_official")).toBe("high");
    expect(defaultTrustForProjectSourceAuthorityKind("unknown")).toBe("unverified");
  });
});

describe("trust reuse", () => {
  it("is the RC3.3 trust ladder verbatim — same levels, same ranks", () => {
    expect(PROJECT_SOURCE_TRUST_LEVELS).toBe(SOURCE_TRUST_LEVELS);
    for (const level of PROJECT_SOURCE_TRUST_LEVELS) {
      expect(projectSourceTrustRank(level)).toBe(sourceTrustRank(level));
    }
    expect(meetsProjectSourceTrust("high", "standard")).toBe(true);
    expect(meetsProjectSourceTrust("low", "standard")).toBe(false);
  });
});

describe("authority builder and comparison", () => {
  it("defaults trust through the kind mapping and attaches verifiedBy only when supplied", () => {
    expect(projectSourceAuthority("developer_official")).toEqual({
      kind: "developer_official",
      trust: "high",
    });
    expect(
      projectSourceAuthority("agency", { trust: "high", verifiedBy: "Forever intake" }),
    ).toEqual({ kind: "agency", trust: "high", verifiedBy: "Forever intake" });
  });

  it("orders authorities most-trusted first and checks a required bar", () => {
    const government = projectSourceAuthority("government");
    const third = projectSourceAuthority("third_party");
    expect(compareProjectSourceAuthority(government, third)).toBeLessThan(0);
    expect(compareProjectSourceAuthority(third, government)).toBeGreaterThan(0);
    expect(projectSourceAuthorityMeets(government, "high")).toBe(true);
    expect(projectSourceAuthorityMeets(third, "high")).toBe(false);
  });
});
