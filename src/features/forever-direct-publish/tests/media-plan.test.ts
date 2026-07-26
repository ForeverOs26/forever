import { describe, expect, it } from "vitest";

import { syntheticJpeg, syntheticPng } from "@/features/forever-studio/tests/media-truth-fixtures";

import { isCrossProjectMaterial, planPublicMedia, type SourceMediaCandidate } from "../media-plan";

function photo(path: string, salt = 0): SourceMediaCandidate {
  return { path, bytes: syntheticJpeg(false, 1, salt) };
}

describe("planPublicMedia", () => {
  it("selects a hero, a gallery and the plans without human approval", () => {
    const plan = planPublicMedia(
      [
        photo("photos/exterior-1.jpg", 1),
        photo("photos/exterior-2.jpg", 2),
        { path: "master-plan/site.png", bytes: syntheticPng(false, 1, 3) },
        { path: "floor-plans/type-a.png", bytes: syntheticPng(false, 1, 4) },
      ],
      { slug: "the-title-legendary" },
    );

    expect(plan.hero).not.toBeNull();
    expect(plan.hero!.mediaType).toBe("cover");
    const types = plan.items.map((item) => item.mediaType);
    expect(types[0]).toBe("cover");
    expect(types).toContain("gallery");
    expect(types).toContain("master_plan");
    expect(types).toContain("floor_plan");
    // Dense, stable ordering.
    expect(plan.items.map((item) => item.sortOrder)).toEqual([0, 1, 2, 3]);
  });

  it("is deterministic: the same package plans identically regardless of input order", () => {
    const files = [
      photo("photos/b.jpg", 1),
      photo("photos/a.jpg", 2),
      { path: "master-plan/site.png", bytes: syntheticPng(false, 1, 3) },
    ];
    const first = planPublicMedia(files, { slug: "demo-project" });
    const second = planPublicMedia([...files].reverse(), { slug: "demo-project" });
    expect(second.items.map((item) => [item.path, item.mediaType, item.sortOrder])).toEqual(
      first.items.map((item) => [item.path, item.mediaType, item.sortOrder]),
    );
    expect(second.hero?.path).toBe(first.hero?.path);
  });

  it("excludes byte-identical duplicates, keeping the first in path order", () => {
    const bytes = syntheticJpeg(false, 1, 7);
    const plan = planPublicMedia(
      [
        { path: "photos/b-second.jpg", bytes },
        { path: "photos/a-first.jpg", bytes },
      ],
      { slug: "demo-project" },
    );
    // Selection is path-ordered, not input-ordered, so the winner is stable.
    expect(plan.items.map((item) => item.path)).toEqual(["photos/a-first.jpg"]);
    expect(plan.excluded).toEqual([
      { path: "photos/b-second.jpg", reason: "duplicate_bytes", detail: "photos/a-first.jpg" },
    ]);
  });

  it("excludes material that belongs to a different project", () => {
    const plan = planPublicMedia(
      [photo("photos/legendary-pool.jpg", 1), photo("photos/layan-green-park-lobby.jpg", 2)],
      { slug: "the-title-legendary", otherProjectSlugs: ["layan-green-park"] },
    );
    expect(plan.items.map((item) => item.path)).toEqual(["photos/legendary-pool.jpg"]);
    expect(plan.excluded).toEqual([
      {
        path: "photos/layan-green-park-lobby.jpg",
        reason: "cross_project_material",
        detail: "layan-green-park",
      },
    ]);
    expect(plan.warnings.map((warning) => warning.code)).toContain(
      "cross_project_material_excluded",
    );
  });

  it("keeps non-publishable evidence private", () => {
    const plan = planPublicMedia(
      [
        { path: "price-list/LEB-price-list.pdf", bytes: Buffer.from("%PDF-1.4 price list") },
        { path: "legal/reservation-agreement.pdf", bytes: Buffer.from("%PDF-1.4 legal") },
        photo("photos/render.jpg", 1),
      ],
      { slug: "demo-project" },
    );
    expect(plan.items).toHaveLength(1);
    expect(plan.excluded.map((entry) => entry.reason)).toEqual([
      "not_publishable_media",
      "not_publishable_media",
    ]);
  });

  it("caps the gallery at a useful size and says so", () => {
    const files = Array.from({ length: 25 }, (_unused, index) =>
      photo(`photos/render-${String(index).padStart(2, "0")}.jpg`, index + 1),
    );
    const plan = planPublicMedia(files, { slug: "demo-project", maxGallery: 20 });
    // 20 selected: one promoted to cover, 19 remain gallery.
    expect(plan.items).toHaveLength(20);
    expect(plan.items.filter((item) => item.mediaType === "gallery")).toHaveLength(19);
    expect(plan.excluded.filter((entry) => entry.reason === "gallery_limit")).toHaveLength(5);
    expect(plan.warnings.map((warning) => warning.code)).toContain("gallery_truncated");
  });

  it("warns rather than fails when no photograph was supplied", () => {
    const plan = planPublicMedia(
      [{ path: "master-plan/site.png", bytes: syntheticPng(false, 1, 1) }],
      { slug: "demo-project" },
    );
    expect(plan.hero).toBeNull();
    expect(plan.items.map((item) => item.mediaType)).toEqual(["master_plan"]);
    expect(plan.warnings.map((warning) => warning.code)).toContain("hero_image_missing");
  });
});

describe("isCrossProjectMaterial", () => {
  it("does not condemn a file that names the target project", () => {
    expect(
      isCrossProjectMaterial("the-title-legendary/photos/pool.jpg", "the-title-legendary", [
        "layan-green-park",
      ]),
    ).toBeNull();
  });

  it("requires the full foreign token set, so generic words are safe", () => {
    // "park" alone must not condemn this file.
    expect(
      isCrossProjectMaterial("photos/park-view.jpg", "demo-project", ["layan-green-park"]),
    ).toBeNull();
  });

  it("names the foreign project it matched", () => {
    expect(
      isCrossProjectMaterial("photos/layan-green-park-entry.jpg", "demo-project", [
        "layan-green-park",
      ]),
    ).toBe("layan-green-park");
  });
});
