/**
 * The Coralina / Sierra / Villa Kirara acceptance criteria, against fixtures
 * shaped like the real census.
 *
 * These go through `src/lib/public-media-policy.ts` — the module the catalogue,
 * the project page, the Open Graph tag and the JSON-LD reader all call. A test
 * that reimplemented the rule would prove only that the test agrees with
 * itself.
 */

import { describe, expect, it } from "vitest";

import type { RecordedMedia } from "@/lib/public-media-policy";

import { acceptanceExpectations, evaluateProjectAcceptance } from "../acceptance";
import { buildBackfillManifest } from "../plan";
import type { BackfillManifest, ManifestProject } from "../types";
import {
  GENERATED_AT,
  GENERATOR_COMMIT,
  POLICY,
  URLS,
  snapshot,
  standardEvidence,
} from "./fixtures";

const manifest: BackfillManifest = buildBackfillManifest({
  snapshot: snapshot(),
  evidenceBySlug: standardEvidence(),
  policy: POLICY,
  generatorCommit: GENERATOR_COMMIT,
  generatedAt: GENERATED_AT,
  acknowledgements: [
    { projectSlug: "coralina", url: URLS.coralinaOldEventCover, acknowledgement: "confirmed" },
    { projectSlug: "the-title-sierra", url: URLS.sierraHoliday, acknowledgement: "confirmed" },
    { projectSlug: "the-title-sierra", url: URLS.sierraLifestyle, acknowledgement: "confirmed" },
  ],
});

const projectBySlug = (slug: string): ManifestProject =>
  manifest.projects.find((project) => project.slug === slug)!;

/** The rows as they will be once this plan is applied. */
function afterRows(slug: string): RecordedMedia[] {
  const project = projectBySlug(slug);
  const roleByUrl = new Map(project.urls.map((entry) => [entry.url, entry.proposed_semantic_role]));
  return project.urls.flatMap((entry) =>
    entry.rows.map((row) => ({
      mediaType: row.media_type,
      url: entry.url,
      semanticRole: roleByUrl.get(entry.url) ?? null,
    })),
  );
}

/** The URLs the manifest's own exceptions block accounts for, per project. */
function excused(slug: string): Set<string> {
  return new Set(
    manifest.exceptions.filter((entry) => entry.projectSlug === slug).map((entry) => entry.url),
  );
}

function results(slug: string, mainImageUrl: string | null) {
  const list = evaluateProjectAcceptance(
    projectBySlug(slug),
    afterRows(slug),
    mainImageUrl,
    excused(slug),
  );
  return new Map(list.map((result) => [result.id, result]));
}

describe("every project promises something checkable", () => {
  it("never emits an empty acceptance list", () => {
    for (const project of manifest.projects) {
      expect(project.acceptance.length, project.slug).toBeGreaterThan(0);
    }
    expect(acceptanceExpectations("some-other-project").map((entry) => entry.id)).toEqual([
      "some-other-project.no_role_less_public_photograph",
      "some-other-project.cover_presentable_or_absent",
    ]);
  });
});

describe("coralina", () => {
  const verdicts = results("coralina", URLS.coralinaActiveCover);

  it("keeps exactly one presentable, exterior cover", () => {
    const result = verdicts.get("coralina.single_active_exterior_cover")!;
    expect(result.verdict).toBe("pass");
    expect(result.observed).toContain("property_exterior");
  });

  it("bars the superseded launch-event cover from every photograph surface", () => {
    expect(verdicts.get("coralina.old_event_cover_not_presentable")!.verdict).toBe("pass");
  });

  it("excludes people and text", () => {
    expect(verdicts.get("coralina.people_and_text_excluded")!.verdict).toBe("pass");
  });

  it("retains the property photographs rather than emptying the gallery", () => {
    const result = verdicts.get("coralina.architecture_retained")!;
    expect(result.verdict).toBe("pass");
    expect(result.observed).toContain("2 public gallery URL(s)");
  });

  it("leaves no role-less public photograph", () => {
    expect(verdicts.get("coralina.no_role_less_public_photograph")!.verdict).toBe("pass");
  });

  it("fails honestly when the launch-event cover is left unclassified", () => {
    // The check must be able to fail. Forcing the expected answer would delete
    // the only signal that the classification went wrong.
    const project = JSON.parse(JSON.stringify(projectBySlug("coralina"))) as ManifestProject;
    const entry = project.urls.find((url) => url.url === URLS.coralinaOldEventCover)!;
    entry.proposed_semantic_role = null;
    const rows = afterRows("coralina").map((row) =>
      row.url === URLS.coralinaOldEventCover ? { ...row, semanticRole: null } : row,
    );
    // Deliberately NOT excused: an unclassified launch-event cover that nobody
    // wrote a reason for is exactly the case that must be visible.
    const list = evaluateProjectAcceptance(project, rows, URLS.coralinaActiveCover, new Set());
    const byId = new Map(list.map((result) => [result.id, result]));
    expect(byId.get("coralina.old_event_cover_not_presentable")!.verdict).toBe("fail");
    expect(byId.get("coralina.no_role_less_public_photograph")!.verdict).toBe("fail");
  });
});

describe("the-title-sierra", () => {
  const verdicts = results("the-title-sierra", URLS.sierraHero);

  it("keeps the active render as the cover, on both of its rows", () => {
    const result = verdicts.get("sierra.single_active_exterior_cover")!;
    expect(result.verdict).toBe("pass");
    expect(result.observed).toContain("architecture_render");
  });

  it("bars the advertising graphic", () => {
    expect(verdicts.get("sierra.holiday_moments_excluded")!.verdict).toBe("pass");
  });

  it("bars lifestyle photography from every section, not only the gallery", () => {
    expect(verdicts.get("sierra.lifestyle_excluded")!.verdict).toBe("pass");
  });

  it("reports the reader check as not checkable rather than as a pass", () => {
    // There is no deployed public origin. Reporting a pass for a check that
    // never ran is how a release record becomes fiction.
    expect(verdicts.get("sierra.no_unsafe_reader_selects_prohibited")!.verdict).toBe(
      "not_checkable",
    );
  });

  it("loses the hero if the two rows of one URL disagree", () => {
    // The concrete reason the plan is per URL: prohibitedPhotographUrls bars a
    // URL when ANY of its rows records a prohibited role.
    const rows = afterRows("the-title-sierra").map((row) =>
      row.url === URLS.sierraHero && row.mediaType === "gallery"
        ? { ...row, semanticRole: "text_promo" }
        : row,
    );
    const list = evaluateProjectAcceptance(
      projectBySlug("the-title-sierra"),
      rows,
      URLS.sierraHero,
    );
    const cover = list.find((r) => r.id === "sierra.single_active_exterior_cover")!;
    expect(cover.verdict).toBe("fail");
    expect(cover.observed).toContain("null");
  });
});

describe("the-title-villa-kirara", () => {
  const verdicts = results("the-title-villa-kirara", URLS.kiraraEvent);

  it("ends with no eligible cover at all", () => {
    expect(verdicts.get("kirara.no_eligible_cover")!.verdict).toBe("pass");
    expect(verdicts.get("kirara.no_eligible_cover")!.observed).toContain("null");
  });

  it("ends with no eligible property gallery", () => {
    expect(verdicts.get("kirara.no_eligible_property_gallery")!.verdict).toBe("pass");
  });

  it("bars the event photographs from every section", () => {
    expect(verdicts.get("kirara.event_group_excluded")!.verdict).toBe("pass");
  });

  it("keeps the plans, which the gallery list would have deleted", () => {
    // GALLERY_EXCLUDED_ROLES contains plan, map and text_promo. Applying it to
    // the Documents section would delete every plan Forever publishes.
    expect(verdicts.get("kirara.plans_documents_retained")!.verdict).toBe("pass");
  });

  it("takes no hero-eligible role from a superseded package", () => {
    expect(verdicts.get("kirara.no_fabricated_exterior_role")!.verdict).toBe("pass");
  });

  it("would fail no_eligible_cover if the launch photograph were called an exterior", () => {
    const rows = afterRows("the-title-villa-kirara").map((row) =>
      row.url === URLS.kiraraEvent ? { ...row, semanticRole: "villa_exterior" } : row,
    );
    const list = evaluateProjectAcceptance(
      projectBySlug("the-title-villa-kirara"),
      rows,
      URLS.kiraraEvent,
    );
    expect(list.find((r) => r.id === "kirara.no_eligible_cover")!.verdict).toBe("fail");
    expect(list.find((r) => r.id === "kirara.no_eligible_property_gallery")!.verdict).toBe("fail");
  });

  it("reports the empty-state check as not checkable", () => {
    expect(verdicts.get("kirara.neutral_placeholder")!.verdict).toBe("not_checkable");
  });
});

describe("a project with nothing classifiable", () => {
  it("passes the generic checks, because a written exception accounts for the row", () => {
    const verdicts = results("seeded-placeholder-villas", null);
    expect(verdicts.get("seeded-placeholder-villas.cover_presentable_or_absent")!.verdict).toBe(
      "pass",
    );
    expect(verdicts.get("seeded-placeholder-villas.no_role_less_public_photograph")!.verdict).toBe(
      "pass",
    );
  });

  it("fails once the exception is removed, matching what the gate would do", () => {
    const verdicts = new Map(
      evaluateProjectAcceptance(
        projectBySlug("seeded-placeholder-villas"),
        afterRows("seeded-placeholder-villas"),
        null,
        new Set(),
      ).map((result) => [result.id, result]),
    );
    expect(verdicts.get("seeded-placeholder-villas.no_role_less_public_photograph")!.verdict).toBe(
      "fail",
    );
  });
});
