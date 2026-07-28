/**
 * The semantic role reaches the public record, and an unknown one never does
 * (FOREVER-MEDIA-SEMANTIC-PUBLIC-CONTRACT-001).
 *
 * The Factory already classified every file and the planner already recorded
 * the result on each planned item. What was missing was the last step: the
 * publish writer emitted `media_type`, `url` and `sort_order` and dropped the
 * role one line before the database.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { SEMANTIC_ROLES, isSemanticRole, type SemanticRole } from "../hero-policy";
import {
  assertPlanSemanticRoles,
  invalidSemanticRoles,
  type MediaPlan,
  type PlannedMediaItem,
} from "../media-plan";
import { publishProject } from "../publish";
import { FakeProductionWorld, OWNER_AUTHORIZATION } from "./fakes";
import { pkg } from "./publish-fixtures";

function plannedItem(overrides: Partial<PlannedMediaItem> = {}): PlannedMediaItem {
  return {
    path: "source/gallery/a.jpg",
    category: "gallery" as PlannedMediaItem["category"],
    mediaType: "gallery",
    sha256: "a".repeat(64),
    size: 1000,
    isHero: false,
    sortOrder: 0,
    ...overrides,
  };
}

function plan(items: PlannedMediaItem[]): MediaPlan {
  return {
    hero: null,
    heroAssessment: null,
    heroConsidered: [],
    items,
    excluded: [],
  } as unknown as MediaPlan;
}

describe("semantic role validation before any write", () => {
  it("accepts every role in the vocabulary", () => {
    const items = SEMANTIC_ROLES.map((role, index) =>
      plannedItem({ path: `source/${index}.jpg`, semanticRole: role }),
    );
    expect(invalidSemanticRoles(plan(items))).toEqual([]);
    expect(() => assertPlanSemanticRoles(plan(items))).not.toThrow();
  });

  it("accepts an item with no role at all", () => {
    // The Factory formed no opinion. That is not an error; readers show it.
    expect(invalidSemanticRoles(plan([plannedItem()]))).toEqual([]);
  });

  /**
   * The database enforces the same vocabulary, but a CHECK violation arrives
   * after the images are already in public storage: the write fails and the
   * bytes stay. This has to fail in `--dry-run`, before a client exists.
   */
  it("rejects a role outside the vocabulary, naming the file", () => {
    const bad = plan([
      plannedItem({ path: "source/gallery/logo.png", semanticRole: "logo" as SemanticRole }),
    ]);

    expect(invalidSemanticRoles(bad)).toEqual([{ path: "source/gallery/logo.png", role: "logo" }]);
    expect(() => assertPlanSemanticRoles(bad)).toThrowError(/logo/);

    try {
      assertPlanSemanticRoles(bad);
      expect.unreachable("must throw");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("semantic_role_unknown");
    }
  });

  it("rejects a near-miss rather than guessing what was meant", () => {
    for (const role of ["Property_Exterior", "property exterior", "exterior", "verified_amenity"]) {
      const bad = plan([plannedItem({ semanticRole: role as SemanticRole })]);
      expect(invalidSemanticRoles(bad), role).toHaveLength(1);
    }
  });
});

describe("the published media row", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/features/forever-direct-publish/publish.ts"),
    "utf8",
  );

  /**
   * The write, EXECUTED — the assertion this file was missing.
   *
   * Everything else here reads the text of `publish.ts`. That is the same class
   * of proof that let the original defect ship: the role was added to a
   * TypeScript object literal, the database never read it, and every assertion
   * passed because none of them ran the write. A grep cannot tell an emitted
   * field from a field-shaped comment.
   *
   * So this runs the real `publishProject` against the fake production world and
   * reads the role off the rows that actually landed. Delete the spread in
   * `publish.ts` and this fails; leave the literal behind in a comment and it
   * still fails.
   */
  it("actually lands the role on the rows a real publish writes", async () => {
    const world = new FakeProductionWorld();
    await publishProject(pkg(), world.deps(), OWNER_AUTHORIZATION);

    const rows = world.media.filter(
      (row) => row.mediaType === "cover" || row.mediaType === "gallery",
    );
    expect(rows.length).toBeGreaterThan(0);
    // Every photograph carries a role from the vocabulary — none is left null by
    // the lane that classifies them.
    for (const row of rows) {
      expect(isSemanticRole(row.semanticRole), `${row.url} -> ${row.semanticRole}`).toBe(true);
    }

    // And the non-photograph media too, which had no role at all until the
    // reader started depending on one for its own sections.
    const plan = world.media.find((row) => row.mediaType === "master_plan");
    expect(plan?.semanticRole).toBe("plan");
  });

  /**
   * Replay writes the same roles and creates no second semantic state.
   */
  it("writes identical roles on replay", async () => {
    const world = new FakeProductionWorld();
    await publishProject(pkg(), world.deps(), OWNER_AUTHORIZATION);
    const first = world.media
      .map((row) => `${row.mediaType}:${row.url}:${row.semanticRole}`)
      .sort();

    await publishProject(pkg(), world.deps(), OWNER_AUTHORIZATION);
    const second = world.media
      .map((row) => `${row.mediaType}:${row.url}:${row.semanticRole}`)
      .sort();

    expect(second).toEqual(first);
  });

  it("is written with the role as presentation data, never through metadata", () => {
    // The role joins media_type/url/sort_order in the public row literal.
    expect(source).toContain("...(item.semanticRole ? { semantic_role: item.semanticRole } : {})");
    // And the validation runs before anything is uploaded.
    //
    // Scoped to `publishProject`'s own body: `publishPlannedMedia` — which does
    // the uploading — is *defined* earlier in the file than the function that
    // calls it, so a whole-file index comparison would measure declaration
    // order rather than execution order.
    const body = source.slice(source.indexOf("export async function publishProject("));
    const validation = body.indexOf("assertPlanSemanticRoles(plan);");
    const upload = body.indexOf("await publishPlannedMedia(");

    expect(validation).toBeGreaterThan(-1);
    expect(upload).toBeGreaterThan(-1);
    expect(validation).toBeLessThan(upload);
  });

  /**
   * Replay idempotency is what makes a re-publish safe. Public objects are
   * content-addressed, so identical bytes land on an identical path and the
   * same role is written again — no duplicate row, no second semantic state.
   */
  it("omits the key entirely when no role was classified", () => {
    // Spread-when-present, so an unclassified item and a pre-contract row are
    // indistinguishable to every reader.
    expect(source).not.toContain("semantic_role: item.semanticRole ?? null");
  });
});
