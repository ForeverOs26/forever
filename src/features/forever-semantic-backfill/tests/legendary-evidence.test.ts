/**
 * The Legendary evidence gate, proved against real bytes and the real runner
 * (FOREVER-SEMANTIC-MEDIA-RELEASE-PREP-001).
 *
 * The defect these tests exist for is not a crash. It is a run that SUCCEEDS
 * with the wrong answer: both side tables present gives 40 of 40 classified and
 * the 15 LIFESTYLE photographs off every public surface, and either one absent
 * gives 16 of 40 with those photographs still on the page — no error, no
 * warning, one number in a tier histogram different.
 *
 * So the fixture is a package that genuinely reaches the accepted 40/40 through
 * the real classifier, and every negative case is that same package with one
 * thing taken away or spoiled. A fixture that stubbed the classification would
 * prove only that the gate agrees with itself.
 *
 * Two of the tests spawn the actual controller, because "the failure happens
 * before a database client is created" is a claim about the runner's order and
 * cannot be observed from a unit test of the module it calls.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { syntheticPng } from "@/features/forever-studio/tests/media-truth-fixtures";

import { manifestBodyDigest, policyDigest, POLICY_INPUT_FILES } from "../fingerprints";
import {
  assessLegendaryEvidence,
  assessLegendaryEvidenceInPackages,
  assessLegendaryManifestProject,
  discoverLegendaryEvidence,
  LEGENDARY_ACCEPTED_CLASSIFICATION,
  LEGENDARY_EVIDENCE_EXIT_CODE,
  LEGENDARY_EVIDENCE_INCOMPLETE,
  LEGENDARY_SLUG,
  legendaryEvidenceDigest,
  readLegendaryEvidenceInputs,
  reproduceLegendaryClassification,
} from "../legendary-evidence";
import { resolvePackageEvidence } from "../package-evidence";

const REPO = process.cwd();
const CONTROLLER = join(REPO, "scripts/media/semantic-backfill.mjs");

const roots: string[] = [];
function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `forever-legendary-${tag}-`));
  roots.push(dir);
  return dir;
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The fixture: a package that really does reach the accepted 40/40
// ---------------------------------------------------------------------------

/** A deterministic 64-hex digest per item. Distinct bytes, distinct object. */
function itemDigest(index: number): string {
  return createHash("sha256").update(`legendary-derivative-${index}`).digest("hex");
}

/**
 * The 37 objects the two side tables explain, by the developer's own folder.
 *
 * These folder names are the point of the whole join: `000_LIFESTYLE` is what
 * makes fifteen of these photographs `lifestyle`, and `lifestyle` is in
 * NEVER_PUBLIC_ROLES. Nothing here is matched by filename.
 */
const SIDE_TABLE_ITEMS: ReadonlyArray<{ folder: string; filename: string }> = [
  ...Array.from({ length: 15 }, (_, i) => ({
    folder: "000_LIFESTYLE/PHOTO/SHOW CASE",
    filename: `Legendary-${i + 1}.jpg`,
  })),
  ...Array.from({ length: 7 }, (_, i) => ({
    folder: "11. Perspective/Exterior",
    filename: `Legendary-${i + 1}.jpg`,
  })),
  ...Array.from({ length: 2 }, (_, i) => ({
    folder: "11. Perspective/Exterior",
    filename: `Clubhouse-${i + 1}.jpg`,
  })),
  { folder: "LOCATION MAP", filename: "Legendary-vicinity.jpg" },
  ...Array.from({ length: 12 }, (_, i) => ({
    folder: "FLOOR PLAN",
    filename: `Unit-Type-${i + 1}.jpg`,
  })),
];

interface PackageOptions {
  /** Omit the extracted media manifest — the first required input. */
  withoutManifest?: boolean;
  /** Omit the source inventory — the second required input. */
  withoutInventory?: boolean;
  /** A second, DIFFERENT manifest for the same project. */
  duplicateManifest?: boolean;
  /** A second, DIFFERENT inventory. */
  duplicateInventory?: boolean;
  /** The manifest names another project. */
  foreignSlug?: string;
  /** One item loses its derivative digest — structurally invalid. */
  malformedManifest?: boolean;
  /** One keyed inventory row loses the folder it exists to carry. */
  malformedInventory?: boolean;
  /** One item's digest is replaced, so it addresses a different object. */
  corruptDigests?: number;
}

function writeLegendaryPackage(root: string, options: PackageOptions = {}): string {
  const pkg = join(root, "the-title-legendary-publish");
  mkdirSync(join(pkg, "master-plan"), { recursive: true });

  // Identifies the package to `slugOfPackage`. Not a side table: it carries
  // `media[]`, never `items[]`, so nothing here mistakes it for one.
  writeFileSync(
    join(pkg, "source-manifest.json"),
    JSON.stringify({ project_slug: LEGENDARY_SLUG, task: "FIXTURE", media: [] }, null, 2),
  );

  // The three objects the package's own folders explain, as real image bytes.
  // `master-plan/` is an intake category, so these classify as `plan` without
  // any filename being read.
  for (let i = 0; i < 3; i += 1) {
    writeFileSync(join(pkg, "master-plan", `sheet-${i + 1}.png`), syntheticPng(false, 1, i + 40));
  }

  const items = SIDE_TABLE_ITEMS.map((entry, index) => ({
    derivative_sha256:
      options.corruptDigests && index < options.corruptDigests
        ? createHash("sha256").update(`spoiled-${index}`).digest("hex")
        : itemDigest(index),
    source_original: `originals/${index}-${entry.filename}`,
    public_filename: `${itemDigest(index).slice(0, 24)}.jpg`,
  }));
  if (options.malformedManifest) {
    (items[3] as Record<string, unknown>).derivative_sha256 = "not-a-digest";
  }

  const inventory = SIDE_TABLE_ITEMS.map((entry, index) => ({
    stored_relpath: `originals/${index}-${entry.filename}`,
    folder_name: entry.folder,
    original_filename: entry.filename,
    sha256: createHash("sha256").update(`legendary-original-${index}`).digest("hex"),
  }));
  if (options.malformedInventory) {
    (inventory[5] as Record<string, unknown>).folder_name = "";
  }

  if (!options.withoutManifest) {
    writeFileSync(
      join(pkg, "extracted-media-manifest.json"),
      JSON.stringify({ project_slug: options.foreignSlug ?? LEGENDARY_SLUG, items }, null, 2),
    );
  }
  if (options.duplicateManifest) {
    writeFileSync(
      join(pkg, "extracted-media-manifest.copy.json"),
      // Different bytes AND different content: a re-export that dropped an item.
      JSON.stringify({ project_slug: LEGENDARY_SLUG, items: items.slice(0, 30) }, null, 2),
    );
  }
  if (!options.withoutInventory) {
    writeFileSync(join(pkg, "media-source-inventory.json"), JSON.stringify(inventory, null, 2));
  }
  if (options.duplicateInventory) {
    writeFileSync(
      join(pkg, "media-source-inventory.copy.json"),
      JSON.stringify(inventory.slice(0, 20), null, 2),
    );
  }
  return pkg;
}

async function assess(options: PackageOptions = {}, expectedDigest?: string) {
  const pkg = writeLegendaryPackage(tempDir("pkg"), options);
  const evidenceSets = await resolvePackageEvidence({
    slug: LEGENDARY_SLUG,
    packageDirectories: [pkg],
    supersededPackageRefs: new Set(),
    localSourceTreeDir: null,
  });
  return {
    pkg,
    evidenceSets,
    assessment: await assessLegendaryEvidenceInPackages({
      packageDirectories: [pkg],
      evidenceSets,
      expectedEvidenceDigest: expectedDigest ?? null,
    }),
  };
}

function reasons(assessment: { failures: Array<{ reason: string }> }): string[] {
  return assessment.failures.map((failure) => failure.reason);
}

// ---------------------------------------------------------------------------
// 1. Both inputs present and valid -> 40/40
// ---------------------------------------------------------------------------

describe("1. complete evidence reaches the accepted 40/40", () => {
  it("classifies 40 object paths, 37 from the side tables and 3 from the package's folders", async () => {
    const { assessment, evidenceSets } = await assess();

    expect(assessment.failures).toEqual([]);
    expect(assessment.complete).toBe(true);

    const census = reproduceLegendaryClassification(evidenceSets);
    expect(census.classifiedObjectPaths).toBe(40);
    expect(census.tierCounts.extracted_manifest_source_inventory).toBe(37);
    expect(census.tierCounts.package_folder_convention).toBe(3);

    // The whole point of the join: fifteen photographs the developer filed
    // under 000_LIFESTYLE come back as `lifestyle`, which is in
    // NEVER_PUBLIC_ROLES and therefore leaves every public surface.
    expect(census.roleCounts).toEqual({ ...LEGENDARY_ACCEPTED_CLASSIFICATION.roleCounts });
    expect(census.roleCounts.lifestyle).toBe(15);
  });

  it("publishes a deterministic evidence digest a later run can pin", async () => {
    const first = await assess();
    const second = await assess();
    expect(first.assessment.evidenceDigest).toMatch(/^[a-f0-9]{64}$/);
    // Two independently written copies of the same tables — same digest.
    expect(second.assessment.evidenceDigest).toBe(first.assessment.evidenceDigest);
  });
});

// ---------------------------------------------------------------------------
// 2-4. Missing inputs
// ---------------------------------------------------------------------------

describe("2-4. a missing required input fails closed", () => {
  it("2. refuses when the extracted media manifest is absent", async () => {
    const { assessment } = await assess({ withoutManifest: true });
    expect(assessment.complete).toBe(false);
    expect(reasons(assessment)).toContain("extracted_media_manifest_missing");
  });

  it("3. refuses when the source inventory is absent", async () => {
    const { assessment } = await assess({ withoutInventory: true });
    expect(assessment.complete).toBe(false);
    expect(reasons(assessment)).toContain("source_inventory_missing");
  });

  it("4. refuses when both are absent, and says so about both", async () => {
    const { assessment } = await assess({ withoutManifest: true, withoutInventory: true });
    expect(assessment.complete).toBe(false);
    expect(reasons(assessment)).toContain("extracted_media_manifest_missing");
    expect(reasons(assessment)).toContain("source_inventory_missing");
  });

  it("reproduces the documented 16/40 degradation, and refuses it", async () => {
    // This is the exact failure the gate exists for: not an error, a smaller
    // correct-looking answer. Without the side tables only the three
    // folder-explained sheets survive.
    const { assessment, evidenceSets } = await assess({ withoutInventory: true });
    const census = reproduceLegendaryClassification(evidenceSets);
    expect(census.classifiedObjectPaths).toBeLessThan(40);
    expect(census.roleCounts.lifestyle ?? 0).toBe(0);
    expect(reasons(assessment)).toContain("classification_not_reproduced");
  });

  it("refuses when no Legendary package was supplied at all", async () => {
    const assessment = await assessLegendaryEvidenceInPackages({
      packageDirectories: [],
      evidenceSets: [],
    });
    expect(assessment.complete).toBe(false);
    expect(reasons(assessment)).toEqual(["package_missing"]);
  });
});

// ---------------------------------------------------------------------------
// 5. Wrong content digest
// ---------------------------------------------------------------------------

describe("5. a wrong content digest fails closed", () => {
  it("refuses when the pinned evidence digest does not match the tables on disk", async () => {
    const { assessment } = await assess({}, `${"0".repeat(63)}1`);
    expect(assessment.complete).toBe(false);
    expect(reasons(assessment)).toContain("evidence_digest_mismatch");
  });

  it("accepts the digest it actually published", async () => {
    const baseline = await assess();
    const { assessment } = await assess({}, baseline.assessment.evidenceDigest!);
    expect(assessment.complete).toBe(true);
  });

  it("catches an item whose derivative digest addresses a different object — and only the pinned digest can", async () => {
    // Worth stating precisely, because the obvious expectation is wrong.
    //
    // A spoiled `derivative_sha256` does not make the classification SMALLER.
    // The role still comes from the inventory's folder, so the same 40 paths
    // are still classified and the lifestyle count is still 15 — they are
    // simply 40 paths that address objects production does not hold. A census
    // check cannot see that, and a gate that relied on counts alone would pass
    // this package.
    const spoiled = await assess({ corruptDigests: 6 });
    const census = reproduceLegendaryClassification(spoiled.evidenceSets);
    expect(census.classifiedObjectPaths).toBe(40);
    expect(census.roleCounts.lifestyle).toBe(15);

    // What DOES see it is the content identity of the tables themselves.
    const honest = await assess();
    expect(spoiled.assessment.evidenceDigest).not.toBe(honest.assessment.evidenceDigest);

    // So pinning the reviewed digest is what refuses the spoiled package.
    const pinned = await assess({ corruptDigests: 6 }, honest.assessment.evidenceDigest!);
    expect(pinned.assessment.complete).toBe(false);
    expect(reasons(pinned.assessment)).toContain("evidence_digest_mismatch");
  });

  it("moves the published digest when either table changes", async () => {
    const baseline = await assess();
    const changed = await assess({ malformedInventory: true });
    expect(changed.assessment.evidenceDigest).not.toBe(baseline.assessment.evidenceDigest);
  });
});

// ---------------------------------------------------------------------------
// 6. Structurally invalid evidence
// ---------------------------------------------------------------------------

describe("6. structurally invalid evidence fails closed", () => {
  it("refuses a manifest item whose derivative_sha256 is not a digest", async () => {
    const { assessment } = await assess({ malformedManifest: true });
    expect(assessment.complete).toBe(false);
    expect(reasons(assessment)).toContain("evidence_malformed");
    // And it does NOT quietly fall back to the surviving items — the whole
    // table is refused, because a reader that skips bad records classifies
    // fewer rows and says nothing.
    expect(reasons(assessment)).toContain("extracted_media_manifest_missing");
  });

  it("refuses an inventory row that keys a path but records no folder", async () => {
    const { assessment } = await assess({ malformedInventory: true });
    expect(assessment.complete).toBe(false);
    expect(reasons(assessment)).toContain("evidence_malformed");
    expect(reasons(assessment)).toContain("source_inventory_missing");
  });

  it("treats an empty items[] as malformed rather than as evidence", () => {
    const discovery = discoverLegendaryEvidence([
      {
        packageItemFile: "extracted.json",
        sha256: "a".repeat(64),
        parsed: { project_slug: LEGENDARY_SLUG, items: [] },
      },
    ]);
    expect(discovery.manifests).toHaveLength(0);
    expect(discovery.malformed.map((entry) => entry.kind)).toContain("extracted_media_manifest");
  });
});

// ---------------------------------------------------------------------------
// 7. Duplicate ambiguous candidates
// ---------------------------------------------------------------------------

describe("7. ambiguous duplicates fail closed", () => {
  it("refuses two DIFFERENT extracted media manifests for the same project", async () => {
    const { assessment } = await assess({ duplicateManifest: true });
    expect(assessment.complete).toBe(false);
    expect(reasons(assessment)).toContain("extracted_media_manifest_ambiguous");
  });

  it("refuses two DIFFERENT source inventories", async () => {
    const { assessment } = await assess({ duplicateInventory: true });
    expect(assessment.complete).toBe(false);
    expect(reasons(assessment)).toContain("source_inventory_ambiguous");
  });

  it("does not call two byte-identical copies ambiguous", () => {
    const table = {
      project_slug: LEGENDARY_SLUG,
      items: [{ derivative_sha256: "a".repeat(64), source_original: "x" }],
    };
    const discovery = discoverLegendaryEvidence([
      { packageItemFile: "a.json", sha256: "f".repeat(64), parsed: table },
      { packageItemFile: "b/a.json", sha256: "f".repeat(64), parsed: table },
    ]);
    // One piece of evidence stored twice is untidy; two DIFFERENT tables is the
    // safety problem, and only that is refused.
    expect(discovery.manifests).toHaveLength(1);
  });

  it("refuses more than one package directory claiming Legendary", async () => {
    const root = tempDir("two-packages");
    const first = writeLegendaryPackage(join(root, "a"));
    const second = writeLegendaryPackage(join(root, "b"));
    const assessment = await assessLegendaryEvidenceInPackages({
      packageDirectories: [first, second],
      evidenceSets: [],
    });
    expect(reasons(assessment)).toContain("package_ambiguous");
  });
});

// ---------------------------------------------------------------------------
// 8. Cross-project evidence
// ---------------------------------------------------------------------------

describe("8. cross-project evidence fails closed", () => {
  it("refuses a manifest that names another project", async () => {
    const { assessment } = await assess({ foreignSlug: "coralina" });
    expect(assessment.complete).toBe(false);
    expect(reasons(assessment)).toContain("evidence_cross_project");
    // And it is not silently ignored into a "missing" verdict alone: the
    // package is contaminated, and that is a different thing to fix.
    expect(assessment.failures.some((failure) => failure.detail.includes("coralina"))).toBe(true);
  });

  it("refuses a neighbour's dossier sitting alongside a valid Legendary one", async () => {
    const pkg = writeLegendaryPackage(tempDir("mixed"));
    writeFileSync(
      join(pkg, "neighbour-extracted.json"),
      JSON.stringify({
        project_slug: "the-title-sierra",
        items: [{ derivative_sha256: "b".repeat(64), source_original: "x" }],
      }),
    );
    const assessment = await assessLegendaryEvidenceInPackages({
      packageDirectories: [pkg],
      evidenceSets: await resolvePackageEvidence({
        slug: LEGENDARY_SLUG,
        packageDirectories: [pkg],
        supersededPackageRefs: new Set(),
        localSourceTreeDir: null,
      }),
    });
    expect(assessment.complete).toBe(false);
    expect(reasons(assessment)).toContain("evidence_cross_project");
  });
});

// ---------------------------------------------------------------------------
// 9 & 10. The runner: failure before any client, and without release state
// ---------------------------------------------------------------------------

function runController(args: string[]) {
  const result = spawnSync(process.execPath, [CONTROLLER, ...args], {
    cwd: REPO,
    encoding: "utf8",
    env: {
      ...process.env,
      // Named so no ambient value can supply a target behind the test's back.
      FOREVER_SEMANTIC_BACKFILL_DATABASE_URL: "",
    },
  });
  return { ...result, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

describe("9. the refusal happens before a database client is created", () => {
  it("refuses a live plan whose Legendary evidence is incomplete, without contacting the target", () => {
    const out = tempDir("plan-out");
    const pkg = writeLegendaryPackage(tempDir("plan-pkg"), { withoutInventory: true });

    const result = runController([
      "plan",
      // Deliberately unroutable. If any client were created and used before the
      // gate, this run would fail as a connection error instead.
      "--database-url",
      "postgres://u:p@127.0.0.1:1/postgres",
      "--package",
      pkg,
      "--manifest",
      join(out, "manifest.json"),
      "--exceptions-out",
      join(out, "exceptions.json"),
      "--report",
      join(out, "report.txt"),
    ]);

    expect(result.status).toBe(LEGENDARY_EVIDENCE_EXIT_CODE);
    expect(result.output).toContain(LEGENDARY_EVIDENCE_INCOMPLETE);
    // The proof of ordering: no psql, no connection, no snapshot statement.
    expect(result.output).not.toMatch(/could not connect|connection refused|ECONNREFUSED/i);
    expect(result.output).not.toContain("psql");
  });

  it("10a. writes no manifest, no exceptions file and no report", () => {
    const out = tempDir("plan-none");
    const pkg = writeLegendaryPackage(tempDir("plan-pkg2"), { withoutManifest: true });

    const result = runController([
      "plan",
      "--database-url",
      "postgres://u:p@127.0.0.1:1/postgres",
      "--package",
      pkg,
      "--manifest",
      join(out, "manifest.json"),
      "--exceptions-out",
      join(out, "exceptions.json"),
      "--report",
      join(out, "report.txt"),
    ]);

    expect(result.status).toBe(LEGENDARY_EVIDENCE_EXIT_CODE);
    expect(existsSync(join(out, "manifest.json"))).toBe(false);
    expect(existsSync(join(out, "exceptions.json"))).toBe(false);
    expect(existsSync(join(out, "report.txt"))).toBe(false);
  });

  it("accepts a complete package and proceeds past the gate to the connection", () => {
    const out = tempDir("plan-ok");
    const pkg = writeLegendaryPackage(tempDir("plan-pkg3"));

    const result = runController([
      "plan",
      "--database-url",
      "postgres://u:p@127.0.0.1:1/postgres",
      "--package",
      pkg,
      "--manifest",
      join(out, "manifest.json"),
      "--exceptions-out",
      join(out, "exceptions.json"),
    ]);

    // The gate passes and prints the digest, and only THEN does the run fail on
    // the unroutable target. That ordering is the whole claim.
    expect(result.output).toContain("legendary evidence OK");
    expect(result.status).not.toBe(LEGENDARY_EVIDENCE_EXIT_CODE);
  });
});

/**
 * A genuine manifest describing a degraded Legendary plan.
 *
 * Built with the real digest functions rather than hand-written constants, so
 * the controller's authenticity guards (policy digest, body digest, structural
 * validation) all pass and the run reaches the evidence gate the way a real one
 * would.
 */
function writeDegradedManifest(directory: string): string {
  const classified = 16;
  const total = 40;
  const urls = Array.from({ length: total }, (_, index) => ({
    url: `https://abtvsrcnfwlbawvrjeed.supabase.co/storage/v1/object/public/project-images/direct/${LEGENDARY_SLUG}/${itemDigest(index).slice(0, 24)}.jpg`,
    object_path: `direct/${LEGENDARY_SLUG}/${itemDigest(index).slice(0, 24)}.jpg`,
    rows: [{ media_type: "gallery", sort_order: index, current_semantic_role: null }],
    proposed_semantic_role: index < classified ? "plan" : null,
    evidence_tier: index < classified ? "package_folder_convention" : "none",
    evidence: null,
    origin: null,
    conflict: null,
    no_role_reason: index < classified ? null : "classification_unavailable_no_evidence",
    refused_evidence: [],
    presentation_effect: index < classified ? "leaves_gallery" : "role_less_exception",
    restrictive_override: false,
    requires_acknowledgement: false,
    acknowledgement: null,
  }));

  const policy = policyDigest(
    POLICY_INPUT_FILES.map((path: string) => ({
      path,
      contents: readFileSync(join(REPO, path), "utf8"),
    })),
  );

  const manifest: Record<string, unknown> = {
    schema_version: "forever-semantic-media-backfill.v1",
    generated_at: "2026-07-28T00:00:00.000Z",
    generator_commit: "fixture",
    target: {
      project_ref: "abtvsrcnfwlbawvrjeed",
      refuses_project_refs: ["garjibjhlzeljsnpzisu"],
    },
    digests: {
      policy_digest: policy.digest,
      package_state_digest: "0".repeat(64),
      production_structure_digest: "1".repeat(64),
      planned_change_digest: "2".repeat(64),
      manifest_body_digest: "",
      idempotency_key: "3".repeat(64),
    },
    policy_inputs: policy.inputs,
    apply_rule: "fixture",
    write_scope: {
      columns_written: ["public.project_media.semantic_role"],
      columns_never_written: [],
      relations_never_written: [],
    },
    review_required: [],
    projects: [
      {
        slug: LEGENDARY_SLUG,
        project_id: "b5f16ee3-0205-46fa-bd76-0c823d345a9b",
        packages_consulted: [],
        production_rows: total,
        distinct_urls: total,
        expected_active_cover: null,
        expected_retired_covers: [],
        retirement_candidates: [],
        role_digest_before: "4".repeat(64),
        role_digest_expected_after: "5".repeat(64),
        urls,
        project_totals: {
          urls: total,
          rows: total,
          rows_to_update: classified,
          rows_left_role_less: total - classified,
          proposed_roles: { plan: classified },
          expected_public_gallery_count: 0,
          expected_excluded_by_role: { plan: classified },
          rows_leaving_a_public_surface: classified,
        },
        unchanged_expectations: {
          units: null,
          units_sold: null,
          unit_price_history_rows: null,
          buildings: null,
          project_media_rows: total,
          project_media_non_role_digest: null,
        },
        acceptance: [],
      },
    ],
    exceptions: [],
    totals: { projects: 1, rows: total, rows_to_update: classified, exceptions: 0 },
  };

  (manifest.digests as Record<string, string>).manifest_body_digest = manifestBodyDigest(
    manifest as never,
  );

  const path = join(directory, "degraded-manifest.json");
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return path;
}

describe("10. the refusal creates no journal and no release state", () => {
  it("refuses an execute whose manifest holds a degraded Legendary plan, and writes no journal", () => {
    const out = tempDir("execute");
    const manifestPath = writeDegradedManifest(out);
    const journalPath = join(out, "journal.jsonl");

    const result = runController([
      "execute",
      "--execute",
      "--all",
      "--manifest",
      manifestPath,
      "--journal",
      journalPath,
      "--database-url",
      "postgres://u:p@127.0.0.1:1/postgres",
      "--disposable-target",
    ]);

    expect(result.status).toBe(LEGENDARY_EVIDENCE_EXIT_CODE);
    expect(result.output).toContain(LEGENDARY_EVIDENCE_INCOMPLETE);
    // No journal, so no `run_opened`, no per-project record and nothing a later
    // resume could read as "already applied".
    expect(existsSync(journalPath)).toBe(false);
    expect(result.output).not.toContain("run_opened");
    expect(result.output).not.toContain("project_committed");
  });

  it("the manifest check alone catches a degraded plan, with no package present", () => {
    const assessment = assessLegendaryManifestProject({
      project: {
        slug: LEGENDARY_SLUG,
        urls: Array.from({ length: 40 }, (_, index) => ({
          proposed_semantic_role: index < 16 ? "plan" : null,
          evidence_tier: index < 16 ? "package_folder_convention" : "none",
        })),
        project_totals: { rows_left_role_less: 24 },
      },
      exceptionsForSlug: 24,
    });
    expect(assessment.complete).toBe(false);
    expect(assessment.census?.classifiedObjectPaths).toBe(16);
    // Written exceptions do NOT make a degraded plan acceptable: they are how
    // the 15 lifestyle photographs stayed on the page in the first place.
    expect(
      assessment.failures.some((failure) => failure.detail.includes("written exception")),
    ).toBe(true);
  });

  it("accepts a manifest that reproduces the accepted classification", () => {
    const accepted = LEGENDARY_ACCEPTED_CLASSIFICATION;
    const urls: Array<{ proposed_semantic_role: string | null; evidence_tier: string }> = [];
    for (const [role, count] of Object.entries(accepted.roleCounts)) {
      for (let i = 0; i < count; i += 1)
        urls.push({ proposed_semantic_role: role, evidence_tier: "" });
    }
    let index = 0;
    for (const [tier, count] of Object.entries(accepted.tierCounts)) {
      for (let i = 0; i < (count as number); i += 1) urls[index++].evidence_tier = tier;
    }
    const assessment = assessLegendaryManifestProject({
      project: { slug: LEGENDARY_SLUG, urls, project_totals: { rows_left_role_less: 0 } },
      exceptionsForSlug: 0,
    });
    expect(assessment.failures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 11. Other projects are unaffected
// ---------------------------------------------------------------------------

describe("11. other projects remain unaffected", () => {
  it("a snapshot without Legendary is planned without the gate firing", async () => {
    // The gate is project-scoped by construction: it reads only packages whose
    // own payload names Legendary, and the runner only calls it when Legendary
    // is in scope.
    const dir = tempDir("coralina");
    const pkg = join(dir, "coralina-corrected");
    mkdirSync(join(pkg, "master-plan"), { recursive: true });
    writeFileSync(join(pkg, "master-plan", "coralina-plan.png"), syntheticPng(false, 1, 3));
    writeFileSync(
      join(pkg, "source-manifest.json"),
      JSON.stringify({ project_slug: "coralina", task: "FIXTURE", media: [] }),
    );

    const sets = await resolvePackageEvidence({
      slug: "coralina",
      packageDirectories: [pkg],
      supersededPackageRefs: new Set(),
      localSourceTreeDir: null,
    });
    // Coralina classifies exactly as it did before this gate existed.
    const census = reproduceLegendaryClassification(sets);
    expect(census.classifiedObjectPaths).toBe(1);
    expect(census.roleCounts.plan).toBe(1);
  });

  it("the controller does not evaluate the gate for a run that excludes Legendary", () => {
    const out = tempDir("scope");
    const manifestPath = writeDegradedManifest(out);
    const result = runController([
      "execute",
      "--execute",
      "--project",
      "coralina",
      "--manifest",
      manifestPath,
      "--journal",
      join(out, "journal.jsonl"),
      "--database-url",
      "postgres://u:p@127.0.0.1:1/postgres",
      "--disposable-target",
    ]);
    // Legendary is in the manifest but not in the selection, so the gate is not
    // this run's business. It fails later and for a different reason.
    expect(result.status).not.toBe(LEGENDARY_EVIDENCE_EXIT_CODE);
    expect(result.output).not.toContain(LEGENDARY_EVIDENCE_INCOMPLETE);
  });

  it("evidence about another project never satisfies Legendary's requirement", async () => {
    const { assessment } = await assess({ foreignSlug: "the-title-sierra" });
    expect(assessment.complete).toBe(false);
    expect(reasons(assessment)).toContain("extracted_media_manifest_missing");
  });
});

// ---------------------------------------------------------------------------
// The module's own edges
// ---------------------------------------------------------------------------

describe("discovery reads shape, not filenames", () => {
  it("finds the tables whatever they are called", async () => {
    const pkg = writeLegendaryPackage(tempDir("named"));
    const files = await readLegendaryEvidenceInputs(pkg);
    const discovery = discoverLegendaryEvidence(files);
    expect(discovery.manifests).toHaveLength(1);
    expect(discovery.inventories).toHaveLength(1);
    expect(legendaryEvidenceDigest(discovery)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("hashes every input it reads, so identity is content and not a path", async () => {
    const pkg = writeLegendaryPackage(tempDir("hashes"));
    const files = await readLegendaryEvidenceInputs(pkg);
    for (const file of files) expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns no digest when the pair is incomplete", () => {
    expect(
      legendaryEvidenceDigest({
        manifests: [],
        inventories: [],
        foreignManifests: [],
        malformed: [],
      }),
    ).toBeNull();
  });

  it("reports every established failure at once rather than only the first", () => {
    const assessment = assessLegendaryEvidence({
      packageRefs: ["a", "b"],
      discovery: { manifests: [], inventories: [], foreignManifests: [], malformed: [] },
      evidenceSets: [],
    });
    expect(reasons(assessment)).toContain("package_ambiguous");
    expect(reasons(assessment)).toContain("extracted_media_manifest_missing");
    expect(reasons(assessment)).toContain("source_inventory_missing");
    expect(reasons(assessment)).toContain("classification_not_reproduced");
  });
});
