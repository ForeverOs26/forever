import { describe, expect, it } from "vitest";

import { canonicalJson } from "../canonical";
import {
  idempotencyKey,
  manifestBodyDigest,
  packageStateDigest,
  policyDigest,
  POLICY_INPUT_FILES,
  plannedChangeDigest,
  productionRoleDigest,
  productionStructureDigest,
} from "../fingerprints";
import { buildBackfillManifest } from "../plan";
import { BACKFILL_SCHEMA_VERSION } from "../types";
import {
  GENERATED_AT,
  GENERATOR_COMMIT,
  IDS,
  POLICY,
  URLS,
  evidenceSet,
  candidate,
  pathOf,
  snapshot,
  standardEvidence,
} from "./fixtures";

const build = (overrides = {}) =>
  buildBackfillManifest({
    snapshot: snapshot(),
    evidenceBySlug: standardEvidence(),
    policy: POLICY,
    generatorCommit: GENERATOR_COMMIT,
    generatedAt: GENERATED_AT,
    acknowledgements: [],
    ...overrides,
  });

describe("policyDigest", () => {
  it("covers the three files that decide what a role means and does", () => {
    expect(POLICY_INPUT_FILES).toEqual([
      "src/features/forever-direct-publish/hero-policy.ts",
      "src/features/forever-direct-publish/role-completeness.ts",
      "src/lib/public-media-policy.ts",
    ]);
  });

  it("ignores line-ending differences between platforms", () => {
    const lf = policyDigest([{ path: "a.ts", contents: "x\ny\n" }]);
    const crlf = policyDigest([{ path: "a.ts", contents: "x\r\ny\r\n" }]);
    expect(lf.digest).toBe(crlf.digest);
  });

  it("moves when a single byte of policy changes", () => {
    const before = policyDigest([{ path: "a.ts", contents: "role = 'plan'" }]);
    const after = policyDigest([{ path: "a.ts", contents: "role = 'plans'" }]);
    expect(after.digest).not.toBe(before.digest);
  });

  it("is independent of the order the files were read in", () => {
    const files = [
      { path: "b.ts", contents: "b" },
      { path: "a.ts", contents: "a" },
    ];
    expect(policyDigest(files).digest).toBe(policyDigest([...files].reverse()).digest);
  });
});

describe("packageStateDigest", () => {
  const base = [
    evidenceSet("pkg", [
      candidate({ role: "plan", objectPath: "direct/x/" + "a".repeat(24) + ".png" }),
    ]),
  ];

  it("is stable", () => {
    expect(packageStateDigest(base)).toBe(packageStateDigest(base));
  });

  it("moves when a package file's bytes change", () => {
    const changed = [
      evidenceSet("pkg", [
        candidate({
          role: "plan",
          objectPath: "direct/x/" + "a".repeat(24) + ".png",
          originalSha256: "9".repeat(64),
        }),
      ]),
    ];
    expect(packageStateDigest(changed)).not.toBe(packageStateDigest(base));
  });

  it("moves when the batch fingerprint changes even though the files do not", () => {
    // Two packages with identical files but different sources are not
    // interchangeable evidence.
    const regenerated = [
      evidenceSet("pkg", base[0].candidates, { batchFingerprint: "0".repeat(64) }),
    ];
    expect(packageStateDigest(regenerated)).not.toBe(packageStateDigest(base));
  });
});

describe("productionStructureDigest", () => {
  it("moves when a row is added", () => {
    const before = productionStructureDigest(snapshot());
    const changed = snapshot();
    changed.projects[0].media.push({
      projectId: IDS.coralina,
      mediaType: "gallery",
      url: `${URLS.coralinaInterior}?v=2`,
      sortOrder: 9,
      semanticRole: null,
    });
    expect(productionStructureDigest(changed)).not.toBe(before);
  });

  it("does NOT move when only a semantic_role changes", () => {
    // Roles are what the run changes. Folding them in would make the structure
    // guard fail against a partially applied run instead of letting the
    // per-project three-way classification recognise it.
    const before = productionStructureDigest(snapshot());
    const partiallyApplied = snapshot();
    partiallyApplied.projects[0].media[0].semanticRole = "property_exterior";
    expect(productionStructureDigest(partiallyApplied)).toBe(before);
  });

  it("moves when main_image_url changes", () => {
    const before = productionStructureDigest(snapshot());
    const changed = snapshot();
    changed.projects[0].mainImageUrl = URLS.coralinaInterior;
    expect(productionStructureDigest(changed)).not.toBe(before);
  });
});

describe("productionRoleDigest", () => {
  it("is the md5 of media_type|url|role lines, byte-sorted and newline-joined", () => {
    // Same shape as PROJECT_ROLE_DIGEST_SQL, which sorts with COLLATE "C". A
    // client digest the server cannot reproduce would be decoration.
    const rows = [
      { projectId: "p", mediaType: "cover", url: "u1", sortOrder: 0, semanticRole: null },
      { projectId: "p", mediaType: "gallery", url: "u2", sortOrder: 1, semanticRole: "plan" },
    ];
    expect(productionRoleDigest(rows)).toBe(productionRoleDigest([...rows].reverse()));
    expect(productionRoleDigest(rows)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("scopes to one project when asked", () => {
    const rows = [
      { projectId: "a", mediaType: "cover", url: "u1", sortOrder: 0, semanticRole: null },
      { projectId: "b", mediaType: "cover", url: "u2", sortOrder: 0, semanticRole: null },
    ];
    expect(productionRoleDigest(rows, "a")).not.toBe(productionRoleDigest(rows, "b"));
  });
});

describe("plannedChangeDigest", () => {
  it("moves when a proposed role changes", () => {
    const manifest = build();
    const before = plannedChangeDigest(manifest.projects, manifest.exceptions);
    const changed = JSON.parse(JSON.stringify(manifest));
    changed.projects[0].urls[0].proposed_semantic_role = "amenity";
    expect(plannedChangeDigest(changed.projects, changed.exceptions)).not.toBe(before);
  });

  it("moves when an exception is added", () => {
    const manifest = build();
    const before = plannedChangeDigest(manifest.projects, manifest.exceptions);
    expect(
      plannedChangeDigest(manifest.projects, [
        ...manifest.exceptions,
        { ...manifest.exceptions[0], url: "villaOther" },
      ]),
    ).not.toBe(before);
  });
});

describe("idempotencyKey", () => {
  const digests = {
    policy_digest: "1".repeat(64),
    package_state_digest: "2".repeat(64),
    production_structure_digest: "3".repeat(64),
    planned_change_digest: "4".repeat(64),
    manifest_body_digest: "5".repeat(64),
  };

  it("binds the target ref, so one plan's journal cannot be replayed against another database", () => {
    const production = idempotencyKey(digests, "abtvsrcnfwlbawvrjeed", BACKFILL_SCHEMA_VERSION);
    const other = idempotencyKey(digests, "someotherprojectref0", BACKFILL_SCHEMA_VERSION);
    expect(production).not.toBe(other);
  });

  it("moves when any constituent digest moves", () => {
    const base = idempotencyKey(digests, "abtvsrcnfwlbawvrjeed", BACKFILL_SCHEMA_VERSION);
    for (const key of Object.keys(digests) as Array<keyof typeof digests>) {
      const mutated = { ...digests, [key]: "f".repeat(64) };
      expect(idempotencyKey(mutated, "abtvsrcnfwlbawvrjeed", BACKFILL_SCHEMA_VERSION)).not.toBe(
        base,
      );
    }
  });
});

describe("stale-manifest refusal", () => {
  it("detects a hand-edited classifier reason", () => {
    // The reasons are the reviewable part: reword one and the approval is void.
    const manifest = build();
    const tampered = JSON.parse(JSON.stringify(manifest));
    const target = tampered.projects
      .flatMap(
        (project: { urls: Array<{ evidence: { classifier_reason: string } | null }> }) =>
          project.urls,
      )
      .find((entry: { evidence: unknown }) => entry.evidence)!;
    target.evidence.classifier_reason = "looks fine to me";
    expect(manifestBodyDigest(tampered)).not.toBe(manifest.digests.manifest_body_digest);
  });

  it("survives a round trip through the file that is actually written", () => {
    const manifest = build();
    expect(manifestBodyDigest(JSON.parse(canonicalJson(manifest)))).toBe(
      manifest.digests.manifest_body_digest,
    );
  });
});

describe("candidate paths", () => {
  it("derives object paths from fixture urls the way the planner does", () => {
    expect(pathOf(URLS.sierraHero)).toBe("direct/the-title-sierra/37fa558ae05e339e3bdf1dc6.png");
  });
});
