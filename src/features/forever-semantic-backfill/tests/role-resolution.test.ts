import { describe, expect, it } from "vitest";

import { needsReview, resolveRoleForUrl, strictnessBand, TIER_ORDER } from "../role-resolution";
import { candidate } from "./fixtures";

const PATH = "direct/x/aaaaaaaaaaaaaaaaaaaaaaaa.jpg";

describe("strictnessBand", () => {
  it("derives the bands from the real policy maps", () => {
    expect(strictnessBand("event")).toBe(0);
    expect(strictnessBand("lifestyle")).toBe(0);
    expect(strictnessBand("text_promo")).toBe(1);
    expect(strictnessBand("plan")).toBe(1);
    expect(strictnessBand("map")).toBe(1);
    expect(strictnessBand("amenity")).toBe(2);
    expect(strictnessBand("landscape")).toBe(2);
    expect(strictnessBand("unknown")).toBe(3);
    expect(strictnessBand("property_interior")).toBe(4);
    expect(strictnessBand("property_exterior")).toBe(5);
    expect(strictnessBand("architecture_render")).toBe(5);
  });
});

describe("the hide-only rule for superseded packages", () => {
  it("refuses a superseded role that would reveal", () => {
    // The documented Villa Kirara defect: the pre-fix run declared
    // villa_exterior for two "House Plan" sheets, because the renamed package
    // file contained the word "villa".
    const decision = resolveRoleForUrl([
      candidate({
        role: "villa_exterior",
        objectPath: PATH,
        tier: "superseded_package_manifest",
      }),
    ]);
    expect(decision.role).toBeNull();
    expect(decision.refusedCandidates).toHaveLength(1);
    expect(decision.refusedCandidates[0].why).toBe("superseded_manifest_may_only_hide");
  });

  it("accepts a superseded role that hides", () => {
    // The same run is the ONLY local record of a role for the images the
    // corrected Factory dropped. Believing it when it hides is what classifies
    // Coralina's launch-party photographs at all.
    const decision = resolveRoleForUrl([
      candidate({ role: "event", objectPath: PATH, tier: "superseded_package_manifest" }),
    ]);
    expect(decision.role).toBe("event");
    expect(decision.restrictiveOverride).toBe(true);
    expect(decision.refusedCandidates).toHaveLength(0);
  });

  it("refuses amenity and landscape from a superseded package, not only exteriors", () => {
    for (const role of ["amenity", "landscape", "property_interior", "unknown"] as const) {
      const decision = resolveRoleForUrl([
        candidate({ role, objectPath: PATH, tier: "superseded_package_manifest" }),
      ]);
      expect(decision.role, role).toBeNull();
    }
  });
});

describe("tier precedence", () => {
  it("orders tiers highest authority first", () => {
    expect(TIER_ORDER[0]).toBe("package_manifest_semantic_role");
    expect(TIER_ORDER[TIER_ORDER.length - 2]).toBe("superseded_package_manifest");
  });

  it("takes the highest non-empty tier even when a lower one is stricter", () => {
    const decision = resolveRoleForUrl([
      candidate({
        role: "property_exterior",
        objectPath: PATH,
        tier: "package_manifest_semantic_role",
      }),
      candidate({ role: "plan", objectPath: PATH, tier: "package_folder_convention" }),
    ]);
    expect(decision.role).toBe("property_exterior");
    expect(decision.conflict?.resolution).toBe("a higher-authority tier decided it");
  });
});

describe("strictest wins inside one tier", () => {
  it("prefers the role that shows less", () => {
    const decision = resolveRoleForUrl([
      candidate({
        role: "property_exterior",
        objectPath: PATH,
        tier: "package_manifest_source_path",
      }),
      candidate({ role: "text_promo", objectPath: PATH, tier: "package_manifest_source_path" }),
    ]);
    expect(decision.role).toBe("text_promo");
    expect(decision.conflict?.losing.map((entry) => entry.role)).toEqual(["property_exterior"]);
    expect(needsReview(decision)).toBe(true);
  });

  it("breaks a same-band tie by vocabulary order, not by input order", () => {
    const forwards = resolveRoleForUrl([
      candidate({ role: "portrait", objectPath: PATH, tier: "package_manifest_source_path" }),
      candidate({ role: "event", objectPath: PATH, tier: "package_manifest_source_path" }),
    ]);
    const backwards = resolveRoleForUrl([
      candidate({ role: "event", objectPath: PATH, tier: "package_manifest_source_path" }),
      candidate({ role: "portrait", objectPath: PATH, tier: "package_manifest_source_path" }),
    ]);
    expect(forwards.role).toBe(backwards.role);
    expect(forwards.role).toBe("event");
    expect(forwards.conflict?.resolution).toContain("vocabulary order");
  });

  it("does not flag review when the winner is still shown", () => {
    const decision = resolveRoleForUrl([
      candidate({
        role: "property_exterior",
        objectPath: PATH,
        tier: "package_manifest_source_path",
      }),
      candidate({
        role: "property_interior",
        objectPath: PATH,
        tier: "package_manifest_source_path",
      }),
    ]);
    expect(decision.role).toBe("property_interior");
    expect(needsReview(decision)).toBe(false);
  });
});

describe("the unknown trap", () => {
  it("never returns unknown as a role", () => {
    const decision = resolveRoleForUrl([
      candidate({
        role: "unknown",
        objectPath: PATH,
        tier: "package_manifest_source_path",
        classifierReason: "no section or filename evidence",
      }),
    ]);
    expect(decision.role).toBeNull();
    expect(decision.refusedCandidates.map((entry) => entry.why)).toContain(
      "classifier_returned_unknown",
    );
  });

  it("still prefers a real role over unknown in the same tier", () => {
    const decision = resolveRoleForUrl([
      candidate({ role: "unknown", objectPath: PATH, tier: "package_manifest_source_path" }),
      candidate({
        role: "property_interior",
        objectPath: PATH,
        tier: "package_manifest_source_path",
      }),
    ]);
    expect(decision.role).toBe("property_interior");
  });
});

describe("no evidence", () => {
  it("returns null rather than a default", () => {
    const decision = resolveRoleForUrl([]);
    expect(decision.role).toBeNull();
    expect(decision.winner).toBeNull();
    expect(decision.conflict).toBeNull();
  });
});
