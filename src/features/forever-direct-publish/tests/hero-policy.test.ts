/**
 * Semantic hero policy (FOREVER-HERO-SELECTION-AND-CORRECTION-001).
 *
 * The fixtures are the real source layouts these projects actually ship:
 * `11. Perspective__Exterior__...` is the flattened Coralina dossier,
 * `000_MARKETING MATERIAL/PHOTO FOR IG AND FACEBOOK/...` and
 * `011_Perspective/PERSPECTIVE_WITH LOGO/...` are Sierra's Drive folders, and
 * `13. Photo in the Event/...` is Villa Kirara's. Each of the three covers the
 * Owner rejected is reproduced here as the case it came from.
 */
import { describe, expect, it } from "vitest";

import {
  syntheticDisplayP3IccProfile,
  syntheticJpegWithDimensions,
  syntheticJpegWithIccProfile,
  syntheticPng,
  syntheticSrgbIccProfile,
} from "@/features/forever-studio/tests/media-truth-fixtures";

import {
  classifySemanticRole,
  heroEligibility,
  isHeroProhibited,
  selectHero,
  type HeroCandidate,
} from "../hero-policy";
import { planPublicMedia, type SourceMediaCandidate } from "../media-plan";
import { selectMedia, type MediaCandidate } from "../../forever-package-factory/media-selection";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A candidate with stated geometry, so aspect and density are real inputs. */
function candidate(
  path: string,
  options: { width?: number; height?: number; size?: number; sha?: string } = {},
): HeroCandidate {
  const width = options.width ?? 4500;
  const height = options.height ?? 2835;
  return {
    path,
    width,
    height,
    size: options.size ?? Math.round(width * height * 0.5),
    sha256: (options.sha ?? path).padEnd(64, "0").slice(0, 64),
  };
}

/**
 * A photo whose declared geometry the planner can actually read, padded to a
 * photographic bytes-per-pixel. Unpadded, a fixture is a few dozen bytes for
 * millions of declared pixels, which the policy would correctly call flat
 * artwork and which no real photograph ever is.
 */
function photo(path: string, width = 4500, height = 2835, extra = 0): SourceMediaCandidate {
  const base = syntheticJpegWithDimensions(width, height);
  const target = Math.round(width * height * 0.5) + extra;
  return {
    path,
    bytes: Buffer.concat([base, Buffer.alloc(Math.max(0, target - base.length), 7)]),
  };
}

const role = (path: string, extra?: Parameters<typeof candidate>[1]) =>
  classifySemanticRole(candidate(path, extra)).role;

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

describe("classifySemanticRole", () => {
  it("reads the source section, so an event folder is event material", () => {
    const assessment = classifySemanticRole(
      candidate("13. Photo in the Event/08082025 The Title Villa KIRARA-15.jpg"),
    );
    expect(assessment.role).toBe("event");
    expect(assessment.peopleProminent).toBe(true);
    expect(isHeroProhibited(assessment.role)).toBe(true);
  });

  it("reads advertising folders as lifestyle, however the file is named", () => {
    expect(
      role("000_MARKETING MATERIAL/PHOTO FOR IG AND FACEBOOK/01_HOLIDAY MOMENT/FB/1.png"),
    ).toBe("lifestyle");
  });

  it("lets the filename refine its own section", () => {
    // These sit in the same `Exterior` folder. Only their names separate them,
    // which is why classifying by folder alone is not enough.
    expect(role("11. Perspective__Exterior__Coralina Entrance.jpg")).toBe("property_exterior");
    expect(role("11. Perspective__Exterior__FOOT SPA & ONZEN IN THE GARDEN.jpg")).toBe("amenity");
    expect(role("11. Perspective__Exterior__PET CLUB.jpg")).toBe("amenity");
    expect(role("11. Perspective__Exterior__POOL BAR.jpg")).toBe("property_pool_exterior");
  });

  it("names a building an exterior even when the building is an amenity", () => {
    expect(role("11. Perspective__Exterior__CLUBHOUSE & PARKING BUILDING.jpg")).toBe(
      "property_exterior",
    );
  });

  it("separates a logo asset from a render that merely carries the logo", () => {
    expect(
      role("012_Logo/PNG/SIERRA Logo-01.png", { width: 1042, height: 1042, size: 24418 }),
    ).toBe("text_promo");
    expect(
      role("011_Perspective/PERSPECTIVE_WITH LOGO/The Title Sierra_Drop Off_LOGO.png", {
        width: 1920,
        height: 1080,
        size: 4874358,
      }),
    ).toBe("property_exterior");
  });

  it("calls flat artwork what it is, from its bytes per pixel alone", () => {
    const assessment = classifySemanticRole(
      candidate("images/CORALINA LOGO-01.png", { width: 1933, height: 993, size: 34639 }),
    );
    expect(assessment.role).toBe("text_promo");
    expect(assessment.textDominant).toBe(true);
  });

  it("takes the shared classifier's word for plans and maps", () => {
    expect(classifySemanticRole({ ...candidate("m.jpg"), category: "master-plan" }).role).toBe(
      "plan",
    );
    expect(classifySemanticRole({ ...candidate("m.jpg"), category: "unit-plan" }).role).toBe(
      "plan",
    );
    expect(classifySemanticRole({ ...candidate("m.jpg"), category: "map-location" }).role).toBe(
      "map",
    );
    expect(classifySemanticRole({ ...candidate("b.jpg"), category: "brochure" }).role).toBe(
      "text_promo",
    );
  });

  it("says unknown when nothing is known, rather than guessing", () => {
    const assessment = classifySemanticRole(candidate("images/coralina-gallery-07.jpg"));
    expect(assessment.role).toBe("unknown");
    expect(heroEligibility(assessment.role)).toBe("last_resort");
  });

  it("uses a role recorded by the package only where the path says nothing", () => {
    expect(
      classifySemanticRole({
        ...candidate("images/coralina-gallery-07.jpg"),
        declaredRole: "property_exterior",
      }).role,
    ).toBe("property_exterior");
    // A declaration can never launder evidence that contradicts it.
    expect(
      classifySemanticRole({
        ...candidate("13. Photo in the Event/party-01.jpg"),
        declaredRole: "property_exterior",
      }).role,
    ).toBe("event");
  });
});

// ---------------------------------------------------------------------------
// The three covers the Owner rejected
// ---------------------------------------------------------------------------

describe("selectHero - the rejected production covers", () => {
  it("an exterior beats the launch-party group photograph (Coralina)", () => {
    const selection = selectHero([
      // The real one: 7008x4672, 16.3 MB, the largest file in the set.
      candidate("The Title 17.10.2025/The Title 17.10.2025-1084.jpg", {
        width: 7008,
        height: 4672,
        size: 17_067_148,
      }),
      candidate("11. Perspective__Exterior__Coralina Entrance.jpg", { size: 4_839_033 }),
    ]);
    expect(selection.hero?.path).toBe("11. Perspective__Exterior__Coralina Entrance.jpg");
    expect(selection.assessment?.role).toBe("property_exterior");
  });

  it("an exterior beats the seasonal advertising image (Sierra)", () => {
    const selection = selectHero([
      candidate("000_MARKETING MATERIAL/PHOTO FOR IG AND FACEBOOK/01_HOLIDAY MOMENT/FB/1.png", {
        width: 5000,
        height: 2500,
        size: 14_396_201,
      }),
      candidate("011_Perspective/PERSPECTIVE_WITH LOGO/The Title Sierra_Drop Off_LOGO.png", {
        width: 1920,
        height: 1080,
        size: 4_874_358,
      }),
    ]);
    expect(selection.hero?.path).toContain("Drop Off");
  });

  it("a villa exterior beats a kitchen and a decorative wall (Villa Kirara)", () => {
    const selection = selectHero([
      candidate("8. Perspective/Aura/KIRARA Aura Kitchen.jpg"),
      candidate("8. Perspective/Aura/KIRARA Aura Villa Exterior.jpg"),
      candidate("8. Perspective/ClubHouse/material board wall decoration.jpg"),
    ]);
    expect(selection.hero?.path).toBe("8. Perspective/Aura/KIRARA Aura Villa Exterior.jpg");
    expect(selection.assessment?.role).toBe("villa_exterior");
  });
});

// ---------------------------------------------------------------------------
// The policy's stated rules
// ---------------------------------------------------------------------------

describe("selectHero - eligibility", () => {
  it("prefers an exterior over an interior detail", () => {
    const selection = selectHero([
      candidate("11. Perspective__Interior__CO-KITCHEN SPACE.jpg"),
      candidate("11. Perspective__Exterior__Coralina Entrance.jpg"),
    ]);
    expect(selection.assessment?.role).toBe("property_exterior");
  });

  it("prefers a pool with the buildings over a generic amenity", () => {
    const selection = selectHero([
      candidate("11. Perspective__Exterior__PET CLUB.jpg"),
      candidate("11. Perspective__Exterior__POOL BAR.jpg"),
    ]);
    expect(selection.hero?.path).toBe("11. Perspective__Exterior__POOL BAR.jpg");
    expect(selection.assessment?.role).toBe("property_pool_exterior");
  });

  it("prefers an architecture render over a group photograph", () => {
    const selection = selectHero([
      candidate("13. Photo in the Event/group photo of the sales team.jpg"),
      candidate("011_Perspective/perspective 04.jpg"),
    ]);
    expect(selection.assessment?.role).toBe("architecture_render");
  });

  it("uses an interior only when no exterior candidate exists", () => {
    const interiorOnly = selectHero([
      candidate("013_Photo Of Show Unit/1 Bedroom_30 SQ.M./show unit 01.jpg"),
      candidate("11. Perspective__Interior__GRAND LOBBY.jpg"),
    ]);
    expect(interiorOnly.assessment?.eligibility).toBe("fallback");
    expect(interiorOnly.assessment?.role).toBe("property_interior");

    const withExterior = selectHero([
      candidate("013_Photo Of Show Unit/1 Bedroom_30 SQ.M./show unit 01.jpg"),
      candidate("11. Perspective__Exterior__SKY POOL.jpg"),
    ]);
    expect(withExterior.assessment?.eligibility).toBe("eligible");
  });

  it("never lets a plan, a map or a brochure become the cover", () => {
    const categories = [
      "master-plan",
      "floor-plan",
      "unit-plan",
      "payment-plan",
      "map-location",
      "brochure",
    ] as const;
    for (const category of categories) {
      const selection = selectHero([{ ...candidate(`x/${category}.jpg`), category }]);
      expect(selection.hero).toBeNull();
      expect(selection.missingReason).toBeTruthy();
    }
  });

  it("reads a drawing as a plan from its path, not only from its category", () => {
    // Villa Kirara files its villa layouts under "5. House Plan". Before this,
    // "house" matched the villa vocabulary and one of those sheets was proposed
    // as the project cover.
    expect(role("5. House Plan/KIRARA Present Part 4-08_0.jpg")).toBe("plan");
    expect(role("Drawings/Typical Floor Plan Building A.jpg")).toBe("plan");
    expect(role("7. Map/Villa Kirara_Map1.jpg")).toBe("map");
    const selection = selectHero([
      candidate("5. House Plan/KIRARA Present Part 4-08_0.jpg"),
      candidate("7. Map/Villa Kirara_Map1.jpg"),
    ]);
    expect(selection.hero).toBeNull();
  });

  it("refuses a brochure cover dominated by text", () => {
    const selection = selectHero([
      candidate("marketing/Coralina brochure cover page.jpg", {
        width: 2480,
        height: 3508,
        size: 900_000,
      }),
    ]);
    expect(selection.hero).toBeNull();
  });
});

describe("selectHero - a filename is never an override", () => {
  it("rejects an Owner-named hero.jpg that is a group photograph", () => {
    const selection = selectHero([
      candidate("13. Photo in the Event/hero.jpg"),
      candidate("11. Perspective__Exterior__Coralina Entrance.jpg"),
    ]);
    expect(selection.hero?.path).toBe("11. Perspective__Exterior__Coralina Entrance.jpg");
  });

  it("rejects a cover.jpg that is a decorative detail, even when it is alone", () => {
    const selection = selectHero([candidate("12. Photo of Show Units/material board cover.jpg")]);
    expect(selection.hero).toBeNull();
    expect(selection.missingReason).toContain("decorative_detail");
  });

  it("still honours a designation when nothing else is known", () => {
    // The generated-package round trip: every path has been renamed away.
    const selection = selectHero([
      candidate("images/coralina-gallery-03.jpg"),
      candidate("images/coralina-cover.jpg"),
      candidate("images/coralina-gallery-11.jpg"),
    ]);
    expect(selection.hero?.path).toBe("images/coralina-cover.jpg");
  });
});

describe("selectHero - explicit package preference", () => {
  it("is honoured when it passes the semantic gate", () => {
    // The Owner prefers the pool view; the policy would have chosen the
    // entrance. Both depict the property, so the preference stands.
    const selection = selectHero(
      [
        candidate("11. Perspective__Exterior__Coralina Entrance.jpg"),
        candidate("11. Perspective__Exterior__POOL BAR.jpg"),
      ],
      { preferredPath: "11. Perspective__Exterior__POOL BAR.jpg" },
    );
    expect(selection.hero?.path).toBe("11. Perspective__Exterior__POOL BAR.jpg");
    expect(selection.preferenceRejected).toBeNull();
  });

  it("is refused when it names a prohibited role, and the reason is recorded", () => {
    const selection = selectHero(
      [
        candidate("13. Photo in the Event/hero.jpg"),
        candidate("11. Perspective__Exterior__Coralina Entrance.jpg"),
      ],
      { preferredPath: "13. Photo in the Event/hero.jpg" },
    );
    expect(selection.hero?.path).toBe("11. Perspective__Exterior__Coralina Entrance.jpg");
    expect(selection.preferenceRejected?.code).toBe("prohibited_semantic_role");
  });

  it("is refused when it names a file this project does not publish", () => {
    const selection = selectHero([candidate("11. Perspective__Exterior__Coralina Entrance.jpg")], {
      preferredPath: "somewhere/else.jpg",
    });
    expect(selection.preferenceRejected?.code).toBe("not_in_candidate_set");
    expect(selection.hero?.path).toBe("11. Perspective__Exterior__Coralina Entrance.jpg");
  });
});

describe("selectHero - determinism", () => {
  it("does not depend on enumeration order", () => {
    const files = [
      candidate("11. Perspective__Exterior__CORAL ISLAND.jpg", { sha: "aa" }),
      candidate("11. Perspective__Exterior__THE BEACH.jpg", { sha: "bb" }),
      candidate("11. Perspective__Exterior__Coralina 1.jpg", { sha: "cc" }),
    ];
    const forward = selectHero(files).hero?.path;
    const backward = selectHero([...files].reverse()).hero?.path;
    const shuffled = selectHero([files[1], files[2], files[0]]).hero?.path;
    expect(backward).toBe(forward);
    expect(shuffled).toBe(forward);
  });

  it("breaks a total tie on the content hash, not on file size", () => {
    // Same role, same geometry: only the hash may decide, and the much larger
    // file must not win for being larger.
    const small = candidate("a/x.jpg", { sha: "0a", size: 2_000_000 });
    const large = candidate("a/y.jpg", { sha: "ff", size: 20_000_000 });
    expect(selectHero([small, large]).hero?.path).toBe("a/x.jpg");
    expect(selectHero([large, small]).hero?.path).toBe("a/x.jpg");
  });

  it("ranks a wide image above a square one of the same role", () => {
    const wide = candidate("11. Perspective__Exterior__wide facade.jpg", {
      width: 3000,
      height: 1800,
      sha: "ee",
    });
    const square = candidate("11. Perspective__Exterior__square facade.jpg", {
      width: 3000,
      height: 3000,
      sha: "11",
    });
    expect(selectHero([square, wide]).hero?.path).toContain("wide");
  });
});

describe("selectHero - no eligible candidate", () => {
  it("returns no cover rather than an arbitrary one", () => {
    const selection = selectHero([
      candidate("13. Photo in the Event/EV-15.jpg"),
      candidate("13. Photo in the Event/EV-17.jpg"),
      candidate("000_MARKETING MATERIAL/lifestyle couple.jpg"),
    ]);
    expect(selection.hero).toBeNull();
    expect(selection.missingReason).toContain("event");
  });
});

// ---------------------------------------------------------------------------
// Through the real planner
// ---------------------------------------------------------------------------

describe("planPublicMedia with the semantic policy", () => {
  it("raises hero_candidate_missing and still publishes the rest", () => {
    const plan = planPublicMedia(
      [
        photo("13. Photo in the Event/EV-15.jpg", 6000, 4000),
        photo("13. Photo in the Event/EV-17.jpg", 5947, 3965),
        { path: "master-plan/site.png", bytes: syntheticPng(false, 1, 3) },
      ],
      { slug: "the-title-villa-kirara" },
    );
    expect(plan.hero).toBeNull();
    expect(plan.warnings.map((w) => w.code)).toContain("hero_candidate_missing");
    // The project still publishes: the gallery and the plan are unaffected.
    expect(plan.items.filter((item) => item.mediaType === "gallery")).toHaveLength(2);
    expect(plan.items.filter((item) => item.mediaType === "master_plan")).toHaveLength(1);
  });

  it("considers every eligible photograph, not only those inside the cap", () => {
    // The establishing shot sorts last by path, so the old cap-then-choose
    // order could never have seen it.
    const filler = Array.from({ length: 24 }, (_unused, index) =>
      photo(`13. Photo in the Event/a-${String(index).padStart(2, "0")}.jpg`, 6000, 4000, index),
    );
    const establishing = photo("11. Perspective__Exterior__zz Entrance.jpg", 4500, 2835, 999);
    const plan = planPublicMedia([...filler, establishing], {
      slug: "demo-project",
      maxGallery: 24,
    });
    expect(plan.hero?.path).toBe("11. Perspective__Exterior__zz Entrance.jpg");
    // The cap still counts the cover, so the published total is unchanged.
    expect(plan.items).toHaveLength(24);
  });

  it("never takes a cover from another project's material", () => {
    const plan = planPublicMedia(
      [
        photo("11. Perspective__Exterior__layan-green-park entrance.jpg", 6000, 4000),
        photo("11. Perspective__Exterior__demo project facade.jpg", 4500, 2835),
      ],
      { slug: "demo-project", otherProjectSlugs: ["layan-green-park"] },
    );
    expect(plan.hero?.path).toBe("11. Perspective__Exterior__demo project facade.jpg");
    expect(plan.excluded.map((entry) => entry.reason)).toContain("cross_project_material");
  });

  it("records the role it assigned to every candidate it considered", () => {
    const plan = planPublicMedia(
      [
        photo("13. Photo in the Event/EV-15.jpg", 6000, 4000),
        photo("11. Perspective__Exterior__Coralina Entrance.jpg", 4500, 2835),
      ],
      { slug: "coralina" },
    );
    expect(plan.heroConsidered.map((entry) => entry.role)).toEqual(["property_exterior", "event"]);
    expect(plan.heroConsidered[1].peopleProminent).toBe(true);
  });

  it("carries a package's recorded roles across the rename", () => {
    const plan = planPublicMedia(
      [photo("images/x-gallery-00.jpg", 6000, 4000), photo("images/x-gallery-01.jpg", 4000, 3000)],
      {
        slug: "x",
        declaredRoles: new Map([
          ["images/x-gallery-00.jpg", "event"],
          ["images/x-gallery-01.jpg", "property_exterior"],
        ] as const),
      },
    );
    expect(plan.hero?.path).toBe("images/x-gallery-01.jpg");
  });

  it("leaves an already-correct cover alone", () => {
    // Modeva's package, re-planned. Nothing about it should move.
    const files = [
      photo("images/modeva-cover.jpg", 6146, 4374),
      photo("images/modeva-gallery-00.jpg", 4000, 3000),
      photo("images/modeva-gallery-01.jpg", 3000, 2000),
    ];
    const before = planPublicMedia(files, { slug: "modeva" });
    const after = planPublicMedia(files, { slug: "modeva" });
    expect(before.hero?.path).toBe("images/modeva-cover.jpg");
    expect(after.hero?.path).toBe(before.hero?.path);
    expect(after.items.map((i) => [i.path, i.mediaType])).toEqual(
      before.items.map((i) => [i.path, i.mediaType]),
    );
  });
});

// ---------------------------------------------------------------------------
// Colour safety is unchanged
// ---------------------------------------------------------------------------

describe("colour safety is untouched by the hero policy", () => {
  // Distinct byte lengths, so nothing is collapsed as a duplicate or a near
  // duplicate and each candidate really is considered on its own.
  const distinct = (bytes: Buffer, salt: number) =>
    Buffer.concat([
      bytes.subarray(0, bytes.length - 2),
      Buffer.alloc(salt * 97, salt),
      Buffer.from([0xff, 0xd9]),
    ]);
  const p3 = (path: string, salt = 1): MediaCandidate => ({
    path,
    ref: path.split("/").pop()!,
    bytes: distinct(syntheticJpegWithIccProfile(syntheticDisplayP3IccProfile()), salt),
  });
  const srgb = (path: string, salt = 1): MediaCandidate => ({
    path,
    ref: path.split("/").pop()!,
    bytes: distinct(syntheticJpegWithIccProfile(syntheticSrgbIccProfile()), salt),
  });

  it("retains a Display P3 exterior privately rather than publishing it", () => {
    const selection = selectMedia([p3("8. Perspective/Aura/villa exterior.jpg")], {
      slug: "the-title-villa-kirara",
    });
    expect(selection.selected).toHaveLength(0);
    expect(selection.excluded[0]?.code).toBe("unsupported_color_profile");
    expect(selection.retainedPrivate).toContain("villa exterior.jpg");
  });

  it("publishes a plain-sRGB exterior and makes it the cover", () => {
    const selection = selectMedia(
      [
        srgb("11. Perspective__Exterior__Coralina Entrance.jpg", 1),
        srgb("13. Photo in the Event/EV-15.jpg", 2),
      ],
      { slug: "coralina" },
    );
    const hero = selection.selected.find((item) => item.isHero);
    expect(hero?.sourceRef).toBe("11. Perspective__Exterior__Coralina Entrance.jpg");
    expect(hero?.semanticRole).toBe("property_exterior");
  });

  it("reports hero_candidate_missing when every render was retained privately", () => {
    const selection = selectMedia(
      [
        p3("8. Perspective/Aura/villa exterior.jpg", 1),
        srgb("13. Photo in the Event/EV-15.jpg", 2),
        srgb("13. Photo in the Event/EV-17.jpg", 3),
      ],
      { slug: "the-title-villa-kirara" },
    );
    expect(selection.selected.some((item) => item.isHero)).toBe(false);
    expect(selection.plan?.warnings.map((w) => w.code)).toContain("hero_candidate_missing");
  });
});

describe("the Factory's explicit hero preference", () => {
  // Distinct geometry, so neither is collapsed as a near duplicate of the other,
  // and small enough that the bytes-per-pixel stays photographic.
  const image = (path: string, width: number, height: number): MediaCandidate => ({
    path,
    ref: path.split("/").pop()!,
    bytes: syntheticJpegWithDimensions(width, height),
  });

  it("uses the named image when the policy allows it", () => {
    const selection = selectMedia(
      [
        image("11. Perspective__Exterior__Coralina Entrance.jpg", 12, 8),
        image("11. Perspective__Exterior__POOL BAR.jpg", 16, 10),
      ],
      { slug: "coralina", heroPreferenceRef: "11. Perspective__Exterior__POOL BAR.jpg" },
    );
    expect(selection.selected.find((item) => item.isHero)?.sourceRef).toBe(
      "11. Perspective__Exterior__POOL BAR.jpg",
    );
  });

  it("refuses a preferred group photograph and says so", () => {
    const selection = selectMedia(
      [
        image("13. Photo in the Event/hero.jpg", 16, 10),
        image("11. Perspective__Exterior__Coralina Entrance.jpg", 12, 8),
      ],
      { slug: "coralina", heroPreferenceRef: "hero.jpg" },
    );
    expect(selection.selected.find((item) => item.isHero)?.sourceRef).toBe(
      "11. Perspective__Exterior__Coralina Entrance.jpg",
    );
    expect(selection.plan?.warnings.map((w) => w.code)).toContain("hero_preference_rejected");
  });
});
