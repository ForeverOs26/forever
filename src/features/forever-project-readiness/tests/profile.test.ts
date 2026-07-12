import { describe, expect, it } from "vitest";

import { defineReadinessProfile, describeReadinessProfile, validateReadinessProfile } from "..";
import { makeProfile, makeRequirements } from "./fixtures";

describe("profile", () => {
  it("describes a profile deterministically from stated requirements", () => {
    expect(JSON.stringify(makeProfile())).toBe(JSON.stringify(makeProfile()));
    const profile = makeProfile();
    expect(profile.id).toBe("rprf_minimum-intake");
    expect(profile.slug).toBe("minimum-intake");
    expect(profile.name).toBe("Minimum viable intake");
    expect(profile.requirements).toEqual(makeRequirements());
  });

  it("defaults the name to the normalized slug and states no metadata", () => {
    const profile = describeReadinessProfile({ slug: "Publication Bar" });
    expect(profile.id).toBe("rprf_publication-bar");
    expect(profile.name).toBe("publication-bar");
    expect(profile.requirements).toEqual([]);
    expect(profile.metadata).toBeUndefined();
  });

  it("never aliases its input", () => {
    const requirements = makeRequirements();
    const profile = describeReadinessProfile({ slug: "bar", requirements });
    requirements[0].path = "mutated";
    expect(profile.requirements[0].path).toBe("pricing.basePrice");
    profile.requirements[1].path = "also-mutated";
    expect(requirements[1].path).toBe("pricing.basePrice");
  });

  it("defineReadinessProfile is the identity", () => {
    const profile = makeProfile();
    expect(defineReadinessProfile(profile)).toBe(profile);
  });

  it("the default profile passes its own validator", () => {
    expect(validateReadinessProfile(makeProfile())).toEqual([]);
  });
});
