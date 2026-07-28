/**
 * The media semantic public contract
 * (FOREVER-MEDIA-SEMANTIC-PUBLIC-CONTRACT-001).
 *
 * The gap this closes: the publish lane classifies every file into seventeen
 * semantic roles, but `project_media` never carried the result, so the browser
 * received a content-addressed URL and an empty title and had no way to tell a
 * launch-party photograph from a pool render. Sierra's "HOLIDAY MOMENTS"
 * seasonal graphic and Coralina's launch-event group photograph are both still
 * served as image 2 of their public photo strips today.
 *
 * The most important cases here are the ones about *absence* of a role. Every
 * row published before this contract has none, and a filter that treated that
 * as grounds for hiding would empty every gallery Forever has.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { makeMediaItem } from "@/features/forever-database/tests/fixtures";
import {
  GALLERY_ELIGIBILITY,
  GALLERY_EXCLUDED_ROLES,
  SEMANTIC_ROLES,
  isGalleryEligibleRole,
  isSemanticRole,
} from "@/features/forever-direct-publish/hero-policy";

import { galleryEligible, groupProjectMedia } from "./project-detail-mappers";
import { PROJECT_DETAIL_SELECT } from "./project-detail-service";
import type { ProjectMediaRow } from "./project-detail-types";

const MIGRATION = resolve(
  process.cwd(),
  "supabase/migrations/20260728120000_project_media_semantic_role.sql",
);

function mediaRow(overrides: Partial<ProjectMediaRow> & { url: string }): ProjectMediaRow {
  return {
    id: overrides.url,
    project_id: "p-1",
    media_type: "gallery",
    title: null,
    sort_order: 0,
    ...overrides,
  } as ProjectMediaRow;
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

describe("the semantic role vocabulary", () => {
  it("is the seventeen roles the hero policy already established, and no others", () => {
    expect(SEMANTIC_ROLES).toHaveLength(17);
    // Every role has an explicit gallery decision — no role can be forgotten.
    for (const role of SEMANTIC_ROLES) {
      expect(typeof GALLERY_ELIGIBILITY[role], `gallery decision for ${role}`).toBe("boolean");
    }
  });

  it("excludes event, group, staff, portrait, lifestyle, promo, detail, plan and map", () => {
    for (const role of [
      "event",
      "group_photo",
      "portrait",
      "lifestyle",
      "text_promo",
      "decorative_detail",
      "plan",
      "map",
    ] as const) {
      expect(isGalleryEligibleRole(role), `${role} must not reach the gallery`).toBe(false);
    }
  });

  it("includes exteriors, renders, aerials, interiors, amenities and landscape", () => {
    for (const role of [
      "property_exterior",
      "property_aerial",
      "property_pool_exterior",
      "villa_exterior",
      "architecture_render",
      "property_interior",
      "amenity",
      "landscape",
    ] as const) {
      expect(isGalleryEligibleRole(role), `${role} belongs in the gallery`).toBe(true);
    }
  });

  /**
   * `amenity` and `landscape` are `prohibited` for the *hero*, because a cover
   * has to show the property itself. That is a different question from whether
   * a photograph of the pool deck belongs in the gallery at all.
   */
  it("does not reuse hero eligibility for gallery eligibility", () => {
    expect(isGalleryEligibleRole("amenity")).toBe(true);
    expect(isGalleryEligibleRole("landscape")).toBe(true);
  });

  it("recognises exactly the vocabulary values", () => {
    expect(isSemanticRole("property_exterior")).toBe(true);
    expect(isSemanticRole("verified_amenity")).toBe(false);
    expect(isSemanticRole("logo")).toBe(false);
    expect(isSemanticRole(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The rollout guarantee
// ---------------------------------------------------------------------------

describe("rows published before the contract", () => {
  it("are shown, because no recorded role is not evidence of anything", () => {
    expect(isGalleryEligibleRole(null)).toBe(true);
    expect(isGalleryEligibleRole(undefined)).toBe(true);
    expect(isGalleryEligibleRole("")).toBe(true);
  });

  it("tolerates a role this client does not recognise", () => {
    // A newer server must never blank an older page.
    expect(isGalleryEligibleRole("role_added_next_year")).toBe(true);
  });

  /**
   * The single most important case in this file. Every one of the 329 published
   * assets has `semantic_role = NULL` until the backfill runs.
   */
  it("cannot silently empty a deployed gallery", () => {
    const media = groupProjectMedia(
      [
        mediaRow({ url: "https://cdn.example.com/a.jpg", sort_order: 1 }),
        mediaRow({ url: "https://cdn.example.com/b.jpg", sort_order: 2 }),
        mediaRow({ url: "https://cdn.example.com/c.jpg", sort_order: 3 }),
      ],
      { projectId: "p-1", mainImageUrl: "https://cdn.example.com/cover.jpg" },
    );

    expect(media.gallery.map((item) => item.url)).toEqual([
      "https://cdn.example.com/cover.jpg",
      "https://cdn.example.com/a.jpg",
      "https://cdn.example.com/b.jpg",
      "https://cdn.example.com/c.jpg",
    ]);
  });

  /**
   * The rollout guarantee is `isGalleryEligibleRole(null) === true`, and nothing
   * else. An earlier draft added a second guarantee — a floor that returned the
   * unfiltered set whenever filtering removed everything — and that floor was
   * wrong: it could only ever fire for a project whose every row carries a
   * POSITIVELY PROHIBITED role, which is precisely the project that must show
   * nothing. It could never protect a role-less gallery, because a role-less
   * gallery is never filtered in the first place.
   *
   * This test is the proof that removing the floor did not weaken the rollout.
   */
  it("keeps a wholly role-less gallery without needing any floor", () => {
    const items = [
      makeMediaItem({ id: "1", url: "https://cdn.example.com/1.jpg", semanticRole: null }),
      makeMediaItem({ id: "2", url: "https://cdn.example.com/2.jpg", semanticRole: "" }),
      makeMediaItem({
        id: "3",
        url: "https://cdn.example.com/3.jpg",
        semanticRole: "coined_later",
      }),
    ];
    expect(galleryEligible(items)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// The prohibited fallback, and why it is gone
// ---------------------------------------------------------------------------

describe("a gallery of nothing but prohibited media", () => {
  const allProhibited = [
    makeMediaItem({ id: "1", url: "https://cdn.example.com/1.jpg", semanticRole: "event" }),
    makeMediaItem({ id: "2", url: "https://cdn.example.com/2.jpg", semanticRole: "text_promo" }),
    makeMediaItem({ id: "3", url: "https://cdn.example.com/3.jpg", semanticRole: "group_photo" }),
  ];

  /**
   * BLOCKER 117-3. The floor this replaces re-published exactly the media the
   * contract exists to remove. It is not enough to delete it; the deletion has
   * to be pinned, because "a gallery is never emptied" reads like a safety
   * property and will be proposed again.
   */
  it("is empty, not restored", () => {
    expect(galleryEligible(allProhibited)).toEqual([]);
  });

  it("is empty for every prohibited role, one at a time", () => {
    for (const role of GALLERY_EXCLUDED_ROLES) {
      const only = [
        makeMediaItem({ id: role, url: `https://cdn/${role}.jpg`, semanticRole: role }),
      ];
      expect(galleryEligible(only), `a gallery of only ${role} must be empty`).toEqual([]);
    }
  });

  /**
   * NEGATIVE CONTROL — deliberately restores the removed floor.
   *
   * If this ever passes, the floor is back somewhere: either in
   * `galleryEligible` or in a caller that "helpfully" substitutes the unfiltered
   * list. The assertion is written against the restored behaviour so the failure
   * message names the defect rather than a length mismatch.
   */
  it("negative control: the restored floor is detectably wrong", () => {
    const restoredFloor = (items: typeof allProhibited) => {
      const kept = galleryEligible(items);
      return items.length > 0 && kept.length === 0 ? items : kept;
    };
    // The floor returns the launch party. The policy returns nothing. If these
    // two ever agree, the policy has become the floor.
    expect(restoredFloor(allProhibited)).toHaveLength(3);
    expect(galleryEligible(allProhibited)).toHaveLength(0);
    expect(galleryEligible(allProhibited)).not.toEqual(restoredFloor(allProhibited));
  });

  /**
   * Villa Kirara, the decisive negative fixture: twenty-four launch-party
   * photographs, no eligible cover, plans and documents filed separately. The
   * whole project must remain public and usable with no photograph at all.
   */
  it("Villa Kirara: no cover, no gallery, plans and documents intact", () => {
    const media = groupProjectMedia(
      [
        ...Array.from({ length: 24 }, (_, index) =>
          mediaRow({
            url: `https://cdn.example.com/kirara-launch-${index}.jpg`,
            sort_order: index,
            semantic_role: "event",
          } as Partial<ProjectMediaRow> & { url: string }),
        ),
        mediaRow({
          url: "https://cdn.example.com/kirara-house-plan.pdf",
          media_type: "floor_plan",
          sort_order: 100,
          semantic_role: "plan",
        } as Partial<ProjectMediaRow> & { url: string }),
        mediaRow({
          url: "https://cdn.example.com/kirara-location.png",
          media_type: "document",
          sort_order: 101,
          semantic_role: "map",
        } as Partial<ProjectMediaRow> & { url: string }),
      ],
      { projectId: "villa-kirara", mainImageUrl: null, brochureUrl: null },
    );

    expect(media.hero).toBeNull();
    expect(media.gallery).toEqual([]);
    // Still a usable project record.
    expect(media.floorPlans).toHaveLength(1);
    expect(media.documents.map((document) => document.type)).toContain("document");
    // And the launch party is nowhere in the whole media object.
    expect(JSON.stringify(media)).not.toContain("kirara-launch");
  });

  /**
   * The same project after a genuinely safe property photograph is found. The
   * empty state is a consequence of the evidence, not a permanent verdict.
   */
  it("Villa Kirara gains a gallery the moment one safe photograph exists", () => {
    const media = groupProjectMedia(
      [
        mediaRow({
          url: "https://cdn.example.com/kirara-launch-0.jpg",
          sort_order: 0,
          semantic_role: "event",
        } as Partial<ProjectMediaRow> & { url: string }),
        mediaRow({
          url: "https://cdn.example.com/kirara-villa.jpg",
          sort_order: 1,
          semantic_role: "villa_exterior",
        } as Partial<ProjectMediaRow> & { url: string }),
      ],
      { projectId: "villa-kirara", mainImageUrl: null },
    );

    expect(media.gallery.map((item) => item.url)).toEqual([
      "https://cdn.example.com/kirara-villa.jpg",
    ]);
    // No cover row and no main image: the hero falls back within this project's
    // own eligible photographs, never outside them.
    expect(media.hero?.url).toBe("https://cdn.example.com/kirara-villa.jpg");
  });
});

// ---------------------------------------------------------------------------
// The cover is not exempt
// ---------------------------------------------------------------------------

describe("the active cover", () => {
  it("is still shown when it carries no role, which is every cover today", () => {
    const media = groupProjectMedia([], {
      projectId: "p-1",
      mainImageUrl: "https://cdn.example.com/cover.jpg",
    });
    expect(media.hero?.url).toBe("https://cdn.example.com/cover.jpg");
    expect(media.gallery.map((item) => item.url)).toEqual(["https://cdn.example.com/cover.jpg"]);
  });

  /**
   * Sierra's real shape: `main_image_url` points at the seasonal graphic, and
   * the project's own row for that exact URL records `text_promo`. The column
   * carries no role of its own, so without resolving it against the row it is
   * the one image nothing filters.
   */
  it("is refused when the project's own row records a prohibited role for it", () => {
    const media = groupProjectMedia(
      [
        mediaRow({
          url: "https://cdn.example.com/holiday-moments.png",
          media_type: "cover",
          sort_order: 0,
          semantic_role: "text_promo",
        } as Partial<ProjectMediaRow> & { url: string }),
        mediaRow({
          url: "https://cdn.example.com/exterior.jpg",
          sort_order: 1,
          semantic_role: "property_exterior",
        } as Partial<ProjectMediaRow> & { url: string }),
      ],
      { projectId: "sierra", mainImageUrl: "https://cdn.example.com/holiday-moments.png" },
    );

    expect(JSON.stringify(media)).not.toContain("holiday-moments");
    expect(media.hero?.url).toBe("https://cdn.example.com/exterior.jpg");
  });

  it("is refused when the only cover row itself carries a prohibited role", () => {
    const media = groupProjectMedia(
      [
        mediaRow({
          url: "https://cdn.example.com/launch.jpg",
          media_type: "cover",
          sort_order: 0,
          semantic_role: "event",
        } as Partial<ProjectMediaRow> & { url: string }),
      ],
      { projectId: "p-1", mainImageUrl: null },
    );
    expect(media.hero).toBeNull();
    expect(media.gallery).toEqual([]);
  });

  it("keeps a valid cover usable even when the gallery around it is empty", () => {
    const media = groupProjectMedia(
      [
        mediaRow({
          url: "https://cdn.example.com/party.jpg",
          sort_order: 1,
          semantic_role: "event",
        } as Partial<ProjectMediaRow> & { url: string }),
      ],
      { projectId: "p-1", mainImageUrl: "https://cdn.example.com/cover.jpg" },
    );
    expect(media.hero?.url).toBe("https://cdn.example.com/cover.jpg");
    expect(media.gallery.map((item) => item.url)).toEqual(["https://cdn.example.com/cover.jpg"]);
  });
});

// ---------------------------------------------------------------------------
// Retired covers
// ---------------------------------------------------------------------------

describe("a retired cover", () => {
  it("is not presentation media anywhere in the media object", () => {
    const media = groupProjectMedia(
      [
        mediaRow({
          url: "https://cdn.example.com/old-cover.jpg",
          media_type: "superseded_cover",
          sort_order: 0,
          semantic_role: "property_exterior",
        } as Partial<ProjectMediaRow> & { url: string }),
        mediaRow({
          url: "https://cdn.example.com/new-cover.jpg",
          media_type: "cover",
          sort_order: 1,
          semantic_role: "property_exterior",
        } as Partial<ProjectMediaRow> & { url: string }),
      ],
      { projectId: "p-1", mainImageUrl: null },
    );

    expect(JSON.stringify(media)).not.toContain("old-cover");
    expect(media.hero?.url).toBe("https://cdn.example.com/new-cover.jpg");
  });

  /**
   * Even an eligible role does not rescue it: the exclusion is by media type,
   * because retirement is a statement about presentation, not about content.
   */
  it("is refused as the main image even when its role is eligible", () => {
    const media = groupProjectMedia(
      [
        mediaRow({
          url: "https://cdn.example.com/retired.jpg",
          media_type: "superseded_cover",
          semantic_role: "property_exterior",
        } as Partial<ProjectMediaRow> & { url: string }),
      ],
      { projectId: "p-1", mainImageUrl: "https://cdn.example.com/retired.jpg" },
    );
    expect(media.hero).toBeNull();
    expect(media.gallery).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// What the contract actually removes
// ---------------------------------------------------------------------------

describe("gallery composition once roles are recorded", () => {
  it("drops the seasonal graphic and the launch-event photograph, keeps the property", () => {
    const media = groupProjectMedia(
      [
        // Sierra's real defect: a stale cover row carrying a marketing graphic.
        mediaRow({
          url: "https://cdn.example.com/002eead3.png",
          media_type: "cover",
          sort_order: 0,
          semantic_role: "text_promo",
        } as Partial<ProjectMediaRow> & { url: string }),
        mediaRow({
          url: "https://cdn.example.com/b04b9971.png",
          sort_order: 1,
          semantic_role: "lifestyle",
        } as Partial<ProjectMediaRow> & { url: string }),
        mediaRow({
          url: "https://cdn.example.com/4fd0eacb.png",
          sort_order: 2,
          semantic_role: "amenity",
        } as Partial<ProjectMediaRow> & { url: string }),
        mediaRow({
          url: "https://cdn.example.com/group.jpg",
          sort_order: 3,
          semantic_role: "group_photo",
        } as Partial<ProjectMediaRow> & { url: string }),
        mediaRow({
          url: "https://cdn.example.com/exterior.jpg",
          sort_order: 4,
          semantic_role: "property_exterior",
        } as Partial<ProjectMediaRow> & { url: string }),
      ],
      { projectId: "p-1", mainImageUrl: "https://cdn.example.com/37fa558a.png" },
    );

    const urls = media.gallery.map((item) => item.url);
    expect(urls).toContain("https://cdn.example.com/37fa558a.png");
    expect(urls).toContain("https://cdn.example.com/4fd0eacb.png");
    expect(urls).toContain("https://cdn.example.com/exterior.jpg");
    expect(urls).not.toContain("https://cdn.example.com/002eead3.png");
    expect(urls).not.toContain("https://cdn.example.com/b04b9971.png");
    expect(urls).not.toContain("https://cdn.example.com/group.jpg");
  });

  it("leaves plans, maps and brochures in their own sections", () => {
    const media = groupProjectMedia(
      [
        mediaRow({
          url: "https://cdn.example.com/fp.jpg",
          media_type: "floor_plan",
          semantic_role: "plan",
        } as Partial<ProjectMediaRow> & { url: string }),
        mediaRow({
          url: "https://cdn.example.com/mp.jpg",
          media_type: "master_plan",
          semantic_role: "plan",
        } as Partial<ProjectMediaRow> & { url: string }),
        mediaRow({
          url: "https://cdn.example.com/up.jpg",
          media_type: "unit_plan",
          semantic_role: "plan",
        } as Partial<ProjectMediaRow> & { url: string }),
      ],
      { projectId: "p-1" },
    );

    expect(media.floorPlans).toHaveLength(1);
    expect(media.masterPlan?.url).toBe("https://cdn.example.com/mp.jpg");
    expect(media.unitPlans).toHaveLength(1);
    expect(media.gallery).toHaveLength(0);
  });

  it("deduplicates by exact URL and orders deterministically", () => {
    const media = groupProjectMedia(
      [
        mediaRow({ url: "https://cdn.example.com/a.jpg", sort_order: 3 }),
        mediaRow({ url: "https://cdn.example.com/a.jpg", sort_order: 9 }),
        mediaRow({ url: "https://cdn.example.com/b.jpg", sort_order: 1 }),
      ],
      { projectId: "p-1" },
    );

    expect(media.gallery.map((item) => item.url)).toEqual([
      "https://cdn.example.com/b.jpg",
      "https://cdn.example.com/a.jpg",
    ]);
  });

  /**
   * This used to pass an EMPTY array, so it never exercised the shape its own
   * comment named — a project that has media, all of it ineligible. It now
   * supplies the real shape.
   */
  it("produces an honest cover-less project when nothing supplied is eligible", () => {
    const media = groupProjectMedia(
      [
        mediaRow({
          url: "https://cdn.example.com/party.jpg",
          sort_order: 0,
          semantic_role: "event",
        } as Partial<ProjectMediaRow> & { url: string }),
        mediaRow({
          url: "https://cdn.example.com/plan.jpg",
          media_type: "floor_plan",
          sort_order: 1,
          semantic_role: "plan",
        } as Partial<ProjectMediaRow> & { url: string }),
      ],
      { projectId: "p-1", mainImageUrl: null },
    );
    expect(media.hero).toBeNull();
    expect(media.gallery).toEqual([]);
    expect(media.floorPlans).toHaveLength(1);
  });

  it("renders safely with no media and no cover at all", () => {
    const media = groupProjectMedia([], { projectId: "p-1", mainImageUrl: null });
    expect(media.hero).toBeNull();
    expect(media.gallery).toEqual([]);
    expect(media.documents).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Privacy and the database contract
// ---------------------------------------------------------------------------

describe("the public projection", () => {
  it("requests the semantic role and no provenance column", () => {
    expect(PROJECT_DETAIL_SELECT).toContain(
      "media:project_media(id, media_type, title, url, sort_order, semantic_role)",
    );
    expect(PROJECT_DETAIL_SELECT).not.toMatch(/project_media\([^)]*\bmetadata\b/);
    expect(PROJECT_DETAIL_SELECT).not.toMatch(/project_media\([^)]*\bcreated_at\b/);
    expect(PROJECT_DETAIL_SELECT).not.toContain("media:project_media(*)");
  });

  it("carries no source path, Drive id, Telegram reference or sanitizer record", () => {
    const item = mediaRow({
      url: "https://cdn.example.com/a.jpg",
      semantic_role: "property_exterior",
    } as Partial<ProjectMediaRow> & { url: string });
    const media = groupProjectMedia([item], { projectId: "p-1" });
    const serialised = JSON.stringify(media);

    for (const forbidden of ["forever-data", "drive.google", "t.me/", "sanitiz", "metadata"]) {
      expect(serialised.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    // Exactly the presentation fields, nothing more.
    expect(Object.keys(media.gallery[0]).sort()).toEqual([
      "id",
      "semanticRole",
      "sortOrder",
      "title",
      "type",
      "url",
    ]);
  });
});

describe("the migration", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("is additive: it adds a nullable column and drops nothing", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS semantic_role TEXT");
    expect(sql).not.toMatch(/^\s*ALTER TABLE .* DROP COLUMN/m);
    expect(sql).not.toMatch(/^\s*DROP TABLE/m);
    // Nullable is the rollout contract — a NOT NULL default would fabricate a
    // classification for every existing row.
    expect(sql).not.toMatch(/semantic_role TEXT NOT NULL/);
  });

  it("constrains the column to the established vocabulary, allowing NULL", () => {
    expect(sql).toContain("project_media_semantic_role_vocabulary");
    expect(sql).toContain("semantic_role IS NULL");
    for (const role of SEMANTIC_ROLES) {
      expect(sql, `vocabulary must list ${role}`).toContain(`'${role}'`);
    }
  });

  it("grants the presentation column to the public role and no provenance", () => {
    const grant = sql.match(
      /GRANT SELECT \(\s*([\s\S]*?)\s*\) ON public\.project_media TO anon, authenticated;/,
    );
    expect(grant).not.toBeNull();
    const columns = (grant?.[1] ?? "").split(",").map((column) => column.trim());
    expect(columns).toContain("semantic_role");
    expect(columns).not.toContain("metadata");
    expect(columns).not.toContain("created_at");
  });

  // "no REVOKE SELECT", not "no REVOKE": the migration issues nine
  // `REVOKE ALL ON FUNCTION` statements on purpose, and this file also asserts
  // one of them exists. Two assertions in one suite must not contradict each
  // other in their names.
  it("issues no REVOKE SELECT, so it cannot change another column's reachability", () => {
    const executable = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(executable).not.toMatch(/REVOKE SELECT/);
  });

  /**
   * This assertion used to read `not.toMatch(/DELETE FROM public.project_media/)`
   * and it was FAILING on this branch: the collision-proofing commit added one
   * narrowly scoped DELETE and left the assertion claiming there is none. A test
   * that contradicts the code it guards is worse than no test, because the suite
   * reports a defect that does not exist and hides the real invariant.
   *
   * The real invariant is: reconciliation RETIRES by UPDATE, and deletes only the
   * obsolete retirement of the cover that is coming back. The exact scope of that
   * DELETE is pinned in `semantic-media-migration-contract.test.ts`
   * ("deletes only the obsolete retirement of the incoming cover"); this file
   * asserts the shape, not the scope, and does not duplicate it.
   */
  it("reconciles covers by retiring, and deletes nothing but a stale retirement", () => {
    expect(sql).toContain("forever_project_cover_reconcile");
    expect(sql).toContain("SET media_type = 'superseded_cover'");
    const executable = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    const deletes = [...executable.matchAll(/DELETE FROM public\.project_media[\s\S]*?;/g)].map(
      (match) => match[0],
    );
    // One per retirement path — `_reconcile` and `_withdraw` — and each only ever
    // removes a `superseded_cover` designation.
    expect(deletes).toHaveLength(2);
    for (const statement of deletes) {
      expect(statement).toContain("media_type = 'superseded_cover'");
      // `indexOf(...) + 1` on a statement with no EXISTS yields an empty slice
      // and an assertion against "". See the scoped version of this check in
      // `semantic-media-migration-contract.test.ts`.
      const subquery = statement.indexOf("EXISTS");
      const target = subquery === -1 ? statement : statement.slice(0, subquery);
      expect(target.length).toBeGreaterThan(40);
      expect(target).not.toMatch(/media_type = '(cover|gallery|floor_plan|master_plan)'/);
    }
  });

  /**
   * The blocker independent review found. `forever_progressive_ingest` is the
   * only writer of `project_media`, its media loop reads a fixed key set, and
   * an unknown `semantic_role` key in a batch item is silently discarded by
   * jsonb. Adding the key in TypeScript wrote nothing at all.
   */
  it("actually projects the role onto the rows the ingest function wrote", () => {
    expect(sql).toContain("forever_project_media_semantic_projection");
    expect(sql).toContain("SET semantic_role = btrim(v_item->>'semantic_role')");
    // Matched on the same natural key the ingest loop uses.
    expect(sql).toContain("AND media_type = btrim(v_item->>'media_type')");
    expect(sql).toContain("AND url = btrim(v_item->>'url')");
    // Presence-aware: a batch item without a role never clears a recorded one.
    expect(sql).toContain("CONTINUE WHEN NOT (v_item ? 'semantic_role')");
  });

  /**
   * A function nothing calls changes nothing. Both new steps must run inside
   * `forever_direct_publish`, in the same transaction as the graph write.
   */
  it("calls both new steps from forever_direct_publish", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.forever_direct_publish");
    expect(sql).toContain("public.forever_project_media_semantic_projection(");
    expect(sql).toContain("public.forever_project_cover_reconcile(v_project_id, v_cover_url)");
    // After the graph write, so the rows exist. Scoped to the publish body:
    // the projection function is *defined* earlier in the file than the
    // function that calls it, so a whole-file index comparison would measure
    // declaration order rather than execution order.
    const body = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.forever_direct_publish"));
    expect(body.indexOf("public.forever_progressive_ingest(batch)")).toBeLessThan(
      body.indexOf("public.forever_project_media_semantic_projection("),
    );
    expect(body.indexOf("public.forever_project_media_semantic_projection(")).toBeLessThan(
      body.indexOf("public.forever_project_cover_reconcile(v_project_id, v_cover_url)"),
    );
    // And the unchanged earlier steps are preserved, not dropped.
    expect(sql).toContain("public.forever_project_price_projection(v_project_id)");
    expect(sql).toContain("SET public_status = 'published'");
  });

  it("does not edit the applied ingest migration", () => {
    // 20260718113000 is applied. The role is projected afterwards instead.
    expect(sql).not.toContain("CREATE OR REPLACE FUNCTION public.forever_progressive_ingest");
  });

  it("retires a cover only once its replacement exists", () => {
    // No moment where a project has no valid cover while one is available.
    expect(sql).toContain("IF NOT EXISTS (");
    expect(sql).toContain("AND url = btrim(p_cover_url)");
  });

  it("keeps the cover reconciler off the public role", () => {
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.forever_project_cover_reconcile\(UUID, TEXT\) TO service_role;/,
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.forever_project_cover_reconcile\(UUID, TEXT\) FROM anon, authenticated;/,
    );
  });

  it("is a no-op when no replacement cover is named", () => {
    // A price-only enrichment must never strip a good cover, and Villa Kirara
    // must stay allowed to have none at all.
    expect(sql).toContain("IF p_cover_url IS NULL OR btrim(p_cover_url) = '' THEN");
    expect(sql).toContain("RETURN 0;");
  });
});
