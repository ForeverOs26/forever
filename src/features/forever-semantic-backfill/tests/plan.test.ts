import { describe, expect, it } from "vitest";

import { canonicalJson } from "../canonical";
import { manifestBodyDigest, productionRoleDigest } from "../fingerprints";
import { buildBackfillManifest } from "../plan";
import { rpcPayloadForProject } from "../apply-plan";
import type { BackfillManifest } from "../types";
import {
  GENERATED_AT,
  GENERATOR_COMMIT,
  IDS,
  POLICY,
  URLS,
  snapshot,
  standardEvidence,
} from "./fixtures";

function build(): BackfillManifest {
  return buildBackfillManifest({
    snapshot: snapshot(),
    evidenceBySlug: standardEvidence(),
    policy: POLICY,
    generatorCommit: GENERATOR_COMMIT,
    generatedAt: GENERATED_AT,
    acknowledgements: [
      {
        projectSlug: "coralina",
        url: URLS.coralinaOldEventCover,
        acknowledgement:
          "Confirmed from the recorded visual audit: this is the 17.10.2025 launch event.",
      },
      {
        projectSlug: "the-title-sierra",
        url: URLS.sierraHoliday,
        acknowledgement: "The HOLIDAY MOMENTS advertising graphic, confirmed visually.",
      },
      {
        projectSlug: "the-title-sierra",
        url: URLS.sierraLifestyle,
        acknowledgement: "Lifestyle photography, confirmed visually.",
      },
    ],
  });
}

const manifest = build();
const projectBySlug = (slug: string) => manifest.projects.find((p) => p.slug === slug)!;
const urlEntry = (slug: string, url: string) =>
  projectBySlug(slug).urls.find((entry) => entry.url === url)!;

describe("determinism", () => {
  it("produces byte-identical bytes for identical inputs", () => {
    const a = canonicalJson(build());
    const b = canonicalJson(build());
    expect(a).toBe(b);
  });

  it("is independent of the order projects and evidence arrive in", () => {
    const reversed = snapshot();
    reversed.projects = [...reversed.projects].reverse();
    const shuffled = new Map([...standardEvidence()].reverse());
    const other = buildBackfillManifest({
      snapshot: reversed,
      evidenceBySlug: shuffled,
      policy: POLICY,
      generatorCommit: GENERATOR_COMMIT,
      generatedAt: GENERATED_AT,
      acknowledgements: [],
    });
    expect(other.projects.map((p) => p.slug)).toEqual(manifest.projects.map((p) => p.slug));
    expect(other.digests.production_structure_digest).toBe(
      manifest.digests.production_structure_digest,
    );
  });

  it("records the body digest the file re-reads to", () => {
    const reread = JSON.parse(canonicalJson(manifest));
    expect(manifestBodyDigest(reread)).toBe(manifest.digests.manifest_body_digest);
  });

  it("keeps the body digest stable when only the timestamp and commit differ", () => {
    const later = buildBackfillManifest({
      snapshot: snapshot(),
      evidenceBySlug: standardEvidence(),
      policy: POLICY,
      generatorCommit: "0".repeat(40),
      generatedAt: "2027-01-01T00:00:00.000Z",
      acknowledgements: [],
    });
    // Acknowledgements differ between the two builds, so compare a build with
    // the same acknowledgements as `later`.
    const same = buildBackfillManifest({
      snapshot: snapshot(),
      evidenceBySlug: standardEvidence(),
      policy: POLICY,
      generatorCommit: GENERATOR_COMMIT,
      generatedAt: GENERATED_AT,
      acknowledgements: [],
    });
    expect(later.digests.manifest_body_digest).toBe(same.digests.manifest_body_digest);
    expect(later.digests.idempotency_key).toBe(same.digests.idempotency_key);
  });
});

describe("matching", () => {
  it("matches on (project_id, url) and never on sort_order", () => {
    // Coralina holds TWO cover rows both at sort_order 0. Keying on sort_order
    // would collapse them.
    const covers = projectBySlug("coralina").urls.filter((entry) =>
      entry.rows.some((row) => row.media_type === "cover"),
    );
    expect(covers).toHaveLength(2);
    expect(covers.every((entry) => entry.rows[0].sort_order === 0)).toBe(true);
  });

  it("does not key on (media_type, url) — Coralina's superseded image is a cover here and a gallery item in the package", () => {
    const entry = urlEntry("coralina", URLS.coralinaOldEventCover);
    expect(entry.rows.map((row) => row.media_type)).toEqual(["cover"]);
    expect(entry.proposed_semantic_role).toBe("event");
  });

  it("refuses to match a bundled-asset key", () => {
    const entry = urlEntry("seeded-placeholder-villas", "villaSeeded");
    expect(entry.object_path).toBeNull();
    expect(entry.proposed_semantic_role).toBeNull();
    expect(entry.no_role_reason).toBe("not_a_public_url_bundled_asset_key");
  });
});

describe("plan per URL, emit per row", () => {
  it("gives Sierra's dual-typed hero ONE role across both of its rows", () => {
    const entry = urlEntry("the-title-sierra", URLS.sierraHero);
    expect(entry.rows.map((row) => `${row.media_type}@${row.sort_order}`).sort()).toEqual([
      "cover@0",
      "gallery@8",
    ]);
    expect(entry.proposed_semantic_role).toBe("architecture_render");
    const payload = rpcPayloadForProject(projectBySlug("the-title-sierra"));
    const hero = payload.filter((item) => item.url === URLS.sierraHero);
    expect(hero).toHaveLength(2);
    expect(new Set(hero.map((item) => item.semantic_role)).size).toBe(1);
  });

  it("fans out to every production row, because the RPC keys on media_type too", () => {
    const project = projectBySlug("coralina");
    const payload = rpcPayloadForProject(project);
    expect(payload).toHaveLength(project.project_totals.rows_to_update);
    expect(
      payload.some(
        (item) => item.media_type === "gallery" && item.url === URLS.coralinaActiveCover,
      ),
    ).toBe(true);
    expect(
      payload.some((item) => item.media_type === "cover" && item.url === URLS.coralinaActiveCover),
    ).toBe(true);
  });
});

describe("the unknown trap", () => {
  it("writes no role at all rather than unknown", () => {
    const everyRole = manifest.projects.flatMap((project) =>
      project.urls.map((entry) => entry.proposed_semantic_role),
    );
    expect(everyRole).not.toContain("unknown");
    expect(rpcPayloadForProject(projectBySlug("seeded-placeholder-villas"))).toHaveLength(0);
  });
});

describe("presentation effect", () => {
  it("is computed from the real policy", () => {
    expect(urlEntry("coralina", URLS.coralinaActiveCover).presentation_effect).toBe(
      "visible_unchanged",
    );
    expect(urlEntry("coralina", URLS.coralinaLogo).presentation_effect).toBe("leaves_gallery");
    expect(urlEntry("coralina", URLS.coralinaOldEventCover).presentation_effect).toBe(
      "leaves_every_surface",
    );
    expect(urlEntry("seeded-placeholder-villas", "villaSeeded").presentation_effect).toBe(
      "role_less_exception",
    );
  });

  it("distinguishes a demoted gallery image from one that is also the cover", () => {
    expect(urlEntry("the-title-villa-kirara", URLS.kiraraEvent).presentation_effect).toBe(
      "leaves_every_surface",
    );
    // Sierra's advertising graphic is not main_image_url, so it leaves the
    // gallery only.
    expect(urlEntry("the-title-sierra", URLS.sierraHoliday).presentation_effect).toBe(
      "leaves_gallery",
    );
  });
});

describe("retirement", () => {
  it("never plans a retirement and records the candidates instead", () => {
    for (const project of manifest.projects) {
      expect(project.expected_retired_covers).toEqual([]);
    }
    const candidates = projectBySlug("coralina").retirement_candidates;
    expect(candidates.map((entry) => entry.url)).toEqual([URLS.coralinaOldEventCover]);
    expect(candidates[0].handled_by).toContain("bars it");
  });
});

describe("role digests", () => {
  it("predicts the post-state the transaction will assert", () => {
    const project = projectBySlug("coralina");
    const before = productionRoleDigest(
      snapshot().projects.find((p) => p.projectId === IDS.coralina)!.media,
    );
    expect(project.role_digest_before).toBe(before);
    expect(project.role_digest_expected_after).not.toBe(before);
  });

  it("predicts no change for a project nothing classifies", () => {
    const project = projectBySlug("seeded-placeholder-villas");
    expect(project.role_digest_before).toBe(project.role_digest_expected_after);
  });
});

describe("review and acknowledgement", () => {
  it("requires an acknowledgement for every role taken from a superseded package", () => {
    const overridden = manifest.projects.flatMap((project) =>
      project.urls.filter((entry) => entry.restrictive_override),
    );
    expect(overridden.length).toBeGreaterThan(0);
    expect(overridden.every((entry) => entry.requires_acknowledgement)).toBe(true);
    expect(overridden.every((entry) => Boolean(entry.acknowledgement))).toBe(true);
  });

  it("records the refused evidence so a reviewer can disagree with the refusal", () => {
    const entry = urlEntry("the-title-villa-kirara", URLS.kiraraHousePlan);
    expect(entry.proposed_semantic_role).toBe("plan");
    expect(entry.refused_evidence.map((r) => r.role)).toContain("villa_exterior");
    expect(entry.refused_evidence[0].why).toBe("superseded_manifest_may_only_hide");
  });
});

describe("totals", () => {
  it("counts rows, not URLs, for rows_to_update", () => {
    const sierra = projectBySlug("the-title-sierra");
    // hero on two rows + advertisement + lifestyle = 4 rows over 3 URLs.
    expect(sierra.project_totals.urls).toBe(3);
    expect(sierra.project_totals.rows).toBe(4);
    expect(sierra.project_totals.rows_to_update).toBe(4);
  });

  it("states the expected public gallery count", () => {
    // Coralina keeps the exterior and the interior; the logo leaves.
    expect(projectBySlug("coralina").project_totals.expected_public_gallery_count).toBe(2);
  });
});
