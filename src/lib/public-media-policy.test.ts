/**
 * The shared presentation policy — the one question every public reader asks
 * (FOREVER-MEDIA-SEMANTIC-PUBLIC-CONTRACT-001).
 *
 * These tests are about the policy itself. The tests that prove each *surface*
 * asks it live beside those surfaces:
 * `src/features/project-detail/media-semantic-contract.test.ts` and
 * `src/features/project-detail/public-readers-contract.test.ts`.
 */

import { describe, expect, it } from "vitest";

import {
  GALLERY_EXCLUDED_ROLES,
  NEVER_PUBLIC_ROLES,
  PHOTOGRAPH_MEDIA_TYPES,
  RETIRED_MEDIA_TYPES,
  isPublicPhotograph,
  isPubliclyPresentable,
  isRetiredMediaType,
  presentableCoverUrl,
  type RecordedMedia,
} from "./public-media-policy";
import { SEMANTIC_ROLES } from "@/features/forever-direct-publish/hero-policy";

describe("what may be shown as a photograph", () => {
  it("admits an eligible role on a cover or a gallery row", () => {
    for (const mediaType of PHOTOGRAPH_MEDIA_TYPES) {
      expect(isPublicPhotograph({ mediaType, semanticRole: "property_exterior" })).toBe(true);
      expect(isPublicPhotograph({ mediaType, semanticRole: "amenity" })).toBe(true);
    }
  });

  it("refuses every prohibited role on every photograph media type", () => {
    for (const mediaType of PHOTOGRAPH_MEDIA_TYPES) {
      for (const role of GALLERY_EXCLUDED_ROLES) {
        expect(
          isPublicPhotograph({ mediaType, semanticRole: role }),
          `${role} must never be a public ${mediaType}`,
        ).toBe(false);
      }
    }
  });

  it("refuses a retired cover whatever role it carries", () => {
    for (const role of [...SEMANTIC_ROLES, null, "", "coined_later"]) {
      expect(isPublicPhotograph({ mediaType: "superseded_cover", semanticRole: role })).toBe(false);
    }
  });

  /**
   * The allow-list is the point. A deny-list would admit any media type invented
   * after this build shipped, and `superseded_cover` is the proof that new
   * presentation states do get invented.
   */
  it("refuses a media type it has never heard of", () => {
    for (const mediaType of ["superseded_hero", "internal_proof", "price_list", "document", ""]) {
      expect(isPublicPhotograph({ mediaType, semanticRole: "property_exterior" })).toBe(false);
    }
  });

  it("shows a row with no recorded role — the pre-backfill rollout guarantee", () => {
    for (const semanticRole of [null, undefined, "", "   "]) {
      expect(isPublicPhotograph({ mediaType: "gallery", semanticRole })).toBe(true);
    }
  });

  it("shows a role this build does not recognise, so a newer server cannot blank a page", () => {
    expect(isPublicPhotograph({ mediaType: "gallery", semanticRole: "role_added_next_year" })).toBe(
      true,
    );
  });

  it("names the retired types explicitly rather than relying on the allow-list", () => {
    expect([...RETIRED_MEDIA_TYPES]).toEqual(["superseded_cover"]);
    expect(isRetiredMediaType("superseded_cover")).toBe(true);
    expect(isRetiredMediaType("cover")).toBe(false);
    expect(isRetiredMediaType(null)).toBe(false);
  });
});

describe("what may appear at all, in any section", () => {
  it("refuses a role whose subject is people, whatever section claims it", () => {
    for (const mediaType of [
      "gallery",
      "cover",
      "floor_plan",
      "master_plan",
      "document",
      "video",
    ]) {
      for (const role of NEVER_PUBLIC_ROLES) {
        expect(
          isPubliclyPresentable({ mediaType, semanticRole: role }),
          `${role} must not appear as a ${mediaType}`,
        ).toBe(false);
      }
    }
  });

  /**
   * The distinction this whole pair of functions exists for. `plan`, `map` and
   * `text_promo` are prohibited among the PHOTOGRAPHS and are exactly what the
   * publish lane records for a plan, a location map and a brochure — see
   * `roleFromCategory` in `hero-policy.ts`. Applying the gallery deny-list to the
   * Documents section would delete every one of them.
   */
  it("keeps plans, maps and brochures, which the gallery list would delete", () => {
    for (const [mediaType, role] of [
      ["floor_plan", "plan"],
      ["master_plan", "plan"],
      ["unit_plan", "plan"],
      ["document", "map"],
      ["brochure", "text_promo"],
    ] as const) {
      expect(isPubliclyPresentable({ mediaType, semanticRole: role })).toBe(true);
      // ...and none of them is a photograph.
      expect(isPublicPhotograph({ mediaType, semanticRole: role })).toBe(false);
    }
  });

  it("refuses a retired cover here too", () => {
    expect(isPubliclyPresentable({ mediaType: "superseded_cover", semanticRole: null })).toBe(
      false,
    );
  });

  it("admits a role-less row of any type", () => {
    for (const mediaType of ["gallery", "floor_plan", "brochure", "document"]) {
      expect(isPubliclyPresentable({ mediaType, semanticRole: null })).toBe(true);
    }
  });

  it("is strictly weaker than the photograph rule, never stronger", () => {
    for (const mediaType of ["cover", "gallery", "floor_plan", "document", "superseded_cover"]) {
      for (const role of [...SEMANTIC_ROLES, null]) {
        if (isPublicPhotograph({ mediaType, semanticRole: role })) {
          expect(
            isPubliclyPresentable({ mediaType, semanticRole: role }),
            `${mediaType}/${role} passes the photograph rule but not the floor`,
          ).toBe(true);
        }
      }
    }
  });
});

describe("resolving the project's own cover column", () => {
  const rows: RecordedMedia[] = [
    {
      mediaType: "cover",
      url: "https://cdn.example.com/promo.png",
      semanticRole: "text_promo",
    },
    {
      mediaType: "gallery",
      url: "https://cdn.example.com/exterior.jpg",
      semanticRole: "property_exterior",
    },
    {
      mediaType: "superseded_cover",
      url: "https://cdn.example.com/old.jpg",
      semanticRole: "property_exterior",
    },
  ];

  it("returns a URL whose recorded row is presentable", () => {
    expect(presentableCoverUrl("https://cdn.example.com/exterior.jpg", rows)).toBe(
      "https://cdn.example.com/exterior.jpg",
    );
  });

  it("refuses a URL whose own row records a prohibited role", () => {
    expect(presentableCoverUrl("https://cdn.example.com/promo.png", rows)).toBeNull();
  });

  it("refuses a URL that is a retired cover", () => {
    expect(presentableCoverUrl("https://cdn.example.com/old.jpg", rows)).toBeNull();
  });

  /**
   * The pre-backfill case, and the one that must not regress: today every
   * published row has `semantic_role = NULL` and most projects have a
   * `main_image_url` with no matching row at all.
   */
  it("returns a URL no row records anything about", () => {
    expect(presentableCoverUrl("https://cdn.example.com/unknown.jpg", rows)).toBe(
      "https://cdn.example.com/unknown.jpg",
    );
    expect(presentableCoverUrl("https://cdn.example.com/unknown.jpg", [])).toBe(
      "https://cdn.example.com/unknown.jpg",
    );
  });

  it("returns null for an absent or blank column", () => {
    expect(presentableCoverUrl(null, rows)).toBeNull();
    expect(presentableCoverUrl(undefined, rows)).toBeNull();
    expect(presentableCoverUrl("   ", rows)).toBeNull();
  });

  /**
   * Where two rows disagree about the same image the strict answer wins. A
   * public surface has to be right about the worst case.
   */
  it("takes the strictest recorded answer when rows disagree", () => {
    const conflicting: RecordedMedia[] = [
      { mediaType: "gallery", url: "https://cdn/x.jpg", semanticRole: "property_exterior" },
      { mediaType: "cover", url: "https://cdn/x.jpg", semanticRole: "event" },
    ];
    expect(presentableCoverUrl("https://cdn/x.jpg", conflicting)).toBeNull();
  });

  /**
   * NEGATIVE CONTROL — the URL is a join key, never a classifier.
   *
   * If the policy ever started reading meaning out of the link text, these two
   * would diverge: the names say "launch party" and "exterior" respectively, and
   * the recorded roles say the opposite.
   */
  it("negative control: decides from the recorded role, not from the filename", () => {
    const misleading: RecordedMedia[] = [
      {
        mediaType: "gallery",
        url: "https://cdn/launch-party-group-photo.jpg",
        semanticRole: "property_exterior",
      },
      { mediaType: "gallery", url: "https://cdn/exterior-hero.jpg", semanticRole: "event" },
    ];
    // Named like a launch party, recorded as an exterior -> shown.
    expect(presentableCoverUrl("https://cdn/launch-party-group-photo.jpg", misleading)).toBe(
      "https://cdn/launch-party-group-photo.jpg",
    );
    // Named like a hero exterior, recorded as an event -> refused.
    expect(presentableCoverUrl("https://cdn/exterior-hero.jpg", misleading)).toBeNull();
  });
});
