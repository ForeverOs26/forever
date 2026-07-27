/**
 * The claims the public project page is allowed to make
 * (FOREVER-PR116-RELEASE-STABILIZATION-001, findings F1, F2, F4, F6).
 *
 * Each case here corresponds to a defect PR #116 shipped: a number presented as
 * something it is not, one side of a contradiction presented as fact, a legal
 * claim with no source, and an endorsement the data cannot support.
 */

import { describe, expect, it } from "vitest";

import { makeProjectDetail, makeUnit } from "@/features/forever-database/tests/fixtures";

import {
  developerIdentity,
  developersMateriallyDisagree,
  normaliseDeveloperName,
  presentableDeveloperName,
} from "./developer-identity";
import {
  listedInventoryHeading,
  listedResidenceCount,
  verifiedTotalProjectUnits,
} from "./inventory-scale";
import { projectSections } from "./project-sections";
import { DEFAULT_UNIT_FILTERS, applyUnitFilters, type UnitSort } from "./unit-presentation";

// ---------------------------------------------------------------------------
// F1 — inventory scale
// ---------------------------------------------------------------------------

describe("inventory scale (F1)", () => {
  it("says the count is of listed rows, not of the development", () => {
    const project = makeProjectDetail({
      units: [makeUnit({ code: "A1" }), makeUnit({ code: "A2" }), makeUnit({ code: "A3" })],
    });

    expect(listedInventoryHeading(project)).toBe("3 listed residences");
  });

  it("qualifies the count the same way when buildings are known", () => {
    const project = makeProjectDetail({
      units: [
        makeUnit({ code: "A1", buildingCode: "A" }),
        makeUnit({ code: "B1", buildingCode: "B" }),
      ],
    });

    expect(listedInventoryHeading(project)).toBe("2 buildings · 2 listed residences");
  });

  it("reads correctly for a single residence and a single building", () => {
    const project = makeProjectDetail({ units: [makeUnit({ code: "A1", buildingCode: "A" })] });
    expect(listedInventoryHeading(project)).toBe("1 building · 1 listed residence");
  });

  /**
   * The heart of F1. Cielo lists 15 of 171 units and Legendary 63 of 637. A
   * total is a different fact with a different source, and no source for it
   * reaches this page: `projects` has no `total_units`, and although
   * `buildings.units_count` is granted to the anonymous role, the detail query
   * does not request it.
   */
  it("never derives a project total from the listed rows", () => {
    for (const count of [0, 1, 15, 63, 304]) {
      const project = makeProjectDetail({
        units: Array.from({ length: count }, (_unused, index) =>
          makeUnit({ id: `u-${index}`, code: `U${index}` }),
        ),
      });

      expect(listedResidenceCount(project)).toBe(count);
      // The total is unavailable — and in particular is never the listed count.
      expect(verifiedTotalProjectUnits(project)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// F2 — developer identity
// ---------------------------------------------------------------------------

describe("developer identity (F2)", () => {
  it("treats a legal-form difference as the same developer", () => {
    expect(normaliseDeveloperName("Rhom Bho Property Public Company Limited")).toEqual(
      normaliseDeveloperName("Rhom Bho Property"),
    );
    expect(
      developersMateriallyDisagree("Rhom Bho Property Public Company Limited", "Rhom Bho Property"),
    ).toBe(false);
  });

  it("ignores punctuation, case and diacritics", () => {
    expect(normaliseDeveloperName("Ôrigin Co., Ltd.")).toEqual(["origin"]);
    expect(normaliseDeveloperName("ORIGIN")).toEqual(["origin"]);
    expect(developersMateriallyDisagree("Ôrigin", "origin")).toBe(false);
  });

  /**
   * Modeva is the real case: the linked `developers` row is named "Title" while
   * Modeva's own official source says "Rhom Bho Property".
   */
  it("withholds the name when two sources name different developers", () => {
    const project = makeProjectDetail({
      core: { developerNameRaw: "Rhom Bho Property" },
      developer: {
        id: "d-1",
        name: "Title",
        description: "",
        website: "",
        contactName: "",
        contactPhone: "",
        contactEmail: "",
        logoUrl: "",
      },
    });

    expect(developersMateriallyDisagree("Title", "Rhom Bho Property")).toBe(true);
    expect(developerIdentity(project).state).toBe("withheld");
    expect(presentableDeveloperName(project)).toBeNull();
    expect(projectSections(project).map((section) => section.id)).not.toContain("developer");
  });

  /**
   * Eight of the nine public projects have no canonical developer row at all —
   * only the raw source name speaks. Hiding Developer for them would be its own
   * dishonesty, so the rule must be per-project rather than global.
   */
  it("still states the name when only one source speaks", () => {
    const rawOnly = makeProjectDetail({
      core: { developerNameRaw: "Rhom Bho Property" },
      developer: null,
    });

    const identity = developerIdentity(rawOnly);
    expect(identity.state).toBe("named");
    expect(identity).toMatchObject({ name: "Rhom Bho Property", verified: false });
    expect(projectSections(rawOnly).map((section) => section.id)).toContain("developer");
  });

  it("states the canonical name when both sources agree", () => {
    const agreeing = makeProjectDetail({
      core: { developerNameRaw: "Rhom Bho Property Co., Ltd." },
      developer: {
        id: "d-1",
        name: "Rhom Bho Property",
        description: "",
        website: "",
        contactName: "",
        contactPhone: "",
        contactEmail: "",
        logoUrl: "",
      },
    });

    expect(developerIdentity(agreeing)).toMatchObject({
      state: "named",
      name: "Rhom Bho Property",
      verified: true,
    });
  });

  it("says nothing when no source names a developer", () => {
    const silent = makeProjectDetail({ core: { developerNameRaw: "" }, developer: null });
    expect(developerIdentity(silent).state).toBe("absent");
    expect(projectSections(silent).map((section) => section.id)).not.toContain("developer");
  });

  it("does not call a single shared word agreement", () => {
    // "Property" alone is too weak to conclude two names mean one company.
    expect(developersMateriallyDisagree("Sunrise", "Sunrise Bay Holdings Group")).toBe(true);
  });

  /**
   * Real-world shapes this has to survive. The rule errs toward withholding
   * when two names cannot be shown to mean one company — the safe direction for
   * a factual claim — but it must not withhold over corporate-form noise, which
   * is what eight of the nine public projects would otherwise trip over.
   */
  it("survives the corporate-form shapes these sources actually use", () => {
    for (const [canonical, raw] of [
      // The real Cielo case: the long legal form of the same developer.
      ["Rhom Bho Property", "Rhom Bho Property Public Company Limited"],
      ["Rhom Bho Property Co., Ltd.", "Rhom Bho Property"],
      ["Sunrise Bay Holdings", "Sunrise Bay Property Group"],
    ] as const) {
      expect(
        developersMateriallyDisagree(canonical, raw),
        `"${canonical}" vs "${raw}" must not read as a conflict`,
      ).toBe(false);
    }
  });

  /**
   * The deliberate cost of the one-token rule, recorded rather than hidden.
   *
   * "Sansiri PCL" and "Sansiri Public Company Limited" are the same developer,
   * and this withholds the name anyway, because after stripping both are the
   * single token "sansiri" and a single token is not enough to distinguish that
   * pair from "Property Perfect" vs "Perfect Group". Omitting a name is
   * recoverable; publishing the wrong one is not.
   *
   * It costs nothing on the nine public projects: eight have no canonical
   * record at all, so only one source speaks and this branch is never reached.
   * If a real project later trips it, the fix is a canonical developer record —
   * a Factory/data decision — not a looser rule here.
   */
  it("accepts a conservative false withhold rather than risk a false claim", () => {
    for (const [canonical, raw] of [
      ["Sansiri PCL", "Sansiri Public Company Limited"],
      ["Origin Property", "Origin Properties"],
    ] as const) {
      expect(developersMateriallyDisagree(canonical, raw)).toBe(true);
    }
  });

  /**
   * Stripping corporate-form words can manufacture an agreement between two
   * genuinely different companies. "Property Perfect Public Company Limited"
   * (SET:PF) and "Perfect Group" both reduce to ["perfect"]. Trusting that
   * would print a contradicted name as fact — the exact failure F2 exists to
   * prevent — so a one-token agreement is only trusted when the names were
   * already identical before stripping.
   */
  it("does not let corporate-form stripping manufacture an agreement", () => {
    for (const [canonical, raw] of [
      ["Property Perfect Public Company Limited", "Perfect Group"],
      ["Phuket Property Development", "Phuket Property Group"],
      ["Property Perfect", "Perfect Property"],
    ] as const) {
      expect(
        developersMateriallyDisagree(canonical, raw),
        `"${canonical}" vs "${raw}" must not be reconciled by a single stripped token`,
      ).toBe(true);
    }

    // Identical before stripping is still agreement.
    expect(developersMateriallyDisagree("Sansiri", "sansiri")).toBe(false);
    expect(developersMateriallyDisagree("Ôrigin", "ORIGIN")).toBe(false);
  });

  it("withholds rather than guess when two names cannot be reconciled", () => {
    for (const [canonical, raw] of [
      ["Title", "Rhom Bho Property"],
      ["AP Thailand", "Asian Property Development"],
      ["Sansiri", "Origin"],
    ] as const) {
      expect(
        developersMateriallyDisagree(canonical, raw),
        `"${canonical}" vs "${raw}" must be treated as a conflict`,
      ).toBe(true);
    }
  });

  /**
   * A name made entirely of corporate-form words still identifies that name.
   * Collapsing it to an empty token list would read as "this source is silent"
   * and let the other side print unopposed.
   */
  it("does not let a name of only legal-form words collapse to silence", () => {
    expect(normaliseDeveloperName("Holdings Ltd")).not.toEqual([]);
    expect(developersMateriallyDisagree("Holdings Ltd", "Rhom Bho Property")).toBe(true);
  });

  it("treats punctuation-only and empty names as silence, not conflict", () => {
    expect(normaliseDeveloperName("   ")).toEqual([]);
    expect(normaliseDeveloperName("—")).toEqual([]);
    expect(developersMateriallyDisagree("—", "Rhom Bho Property")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F6 — the unit sort is not a recommendation
// ---------------------------------------------------------------------------

describe("unit ordering (F6)", () => {
  it("defaults to a neutrally named order", () => {
    expect(DEFAULT_UNIT_FILTERS.sort).toBe("listed-order");
    // The token that claimed an endorsement is gone from the type.
    const sorts: UnitSort[] = ["listed-order", "price-asc", "price-desc", "area-asc", "area-desc"];
    expect(sorts).not.toContain("recommended" as UnitSort);
  });

  /**
   * The rename must not change what the list does: available first, then unit
   * code. That behaviour was always fine — only its name claimed too much.
   */
  it("keeps available-first, then unit-code ordering unchanged", () => {
    const units = [
      makeUnit({ id: "1", code: "B2", availabilityStatus: "available" }),
      makeUnit({ id: "2", code: "A1", availabilityStatus: "sold" }),
      makeUnit({ id: "3", code: "A2", availabilityStatus: "available" }),
    ];

    const ordered = applyUnitFilters(units, { ...DEFAULT_UNIT_FILTERS, includeSold: true });
    expect(ordered.map((unit) => unit.code)).toEqual(["A2", "B2", "A1"]);
  });
});
