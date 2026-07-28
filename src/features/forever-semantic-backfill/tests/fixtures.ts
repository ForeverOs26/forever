/**
 * Fixtures shaped like the real production census
 * (FOREVER-SEMANTIC-MEDIA-BACKFILL-001).
 *
 * Every awkward shape here is one production actually holds, because a test
 * built on a tidy fixture proves the code works on tidy data:
 *
 *   Coralina  — TWO `cover` rows, both at sort_order 0. Re-publication appends
 *               rather than replaces, so `sort_order` is not a key.
 *   Sierra    — one URL on TWO rows (`cover`@0 and `gallery`@8), plus a second
 *               `cover` row for the advertising graphic. `(media_type, url)` is
 *               not a key either.
 *   Kirara    — a photograph set that is entirely launch-event material, and
 *               plans that must survive.
 *   Surin     — a `gallery` row whose `url` is the bundled-asset key
 *               `villaSeeded` and not a URL at all.
 */

import type {
  EvidenceCandidate,
  EvidenceTier,
  PackageEvidenceSet,
  ProductionSnapshot,
  SemanticRole,
  SnapshotProject,
} from "../types";
import { SNAPSHOT_SCHEMA_VERSION } from "../types";

export const ORIGIN =
  "https://abtvsrcnfwlbawvrjeed.supabase.co/storage/v1/object/public/project-images";

export function objectUrl(slug: string, sha24: string, ext = "jpg"): string {
  return `${ORIGIN}/direct/${slug}/${sha24}.${ext}`;
}

export const IDS = {
  coralina: "e8ba14a6-7df5-4f7c-a2d2-f43582a514d6",
  sierra: "c95cdc3f-44ae-47fe-a0e1-211cfd68a56e",
  kirara: "00ff7e57-feb2-4ec2-91c1-325de14152f7",
  seeded: "5533a906-1b80-4e4f-abf5-1f0613585a60",
};

export const URLS = {
  coralinaActiveCover: objectUrl("coralina", "bd2d9040b80ad05e338aec9d"),
  coralinaOldEventCover: objectUrl("coralina", "257e5181e8c072efc9bbfeff"),
  coralinaInterior: objectUrl("coralina", "aaaa1111bbbb2222cccc3333"),
  coralinaLogo: objectUrl("coralina", "dddd4444eeee5555ffff6666", "png"),
  coralinaMasterPlan: objectUrl("coralina", "1111aaaa2222bbbb3333cccc", "png"),
  sierraHero: objectUrl("the-title-sierra", "37fa558ae05e339e3bdf1dc6", "png"),
  sierraHoliday: objectUrl("the-title-sierra", "002eead3ab4f1eb34b63a992", "png"),
  sierraLifestyle: objectUrl("the-title-sierra", "9999888877776666555544c4"),
  kiraraEvent: objectUrl("the-title-villa-kirara", "a53e31a10d1e499c7562a9bb"),
  kiraraHousePlan: objectUrl("the-title-villa-kirara", "beefbeefbeefbeefbeefbeef", "png"),
  seededBundleKey: "villaSeeded",
};

interface RowSpec {
  mediaType: string;
  url: string;
  sortOrder: number;
  semanticRole?: string | null;
}

function project(
  projectId: string,
  slug: string,
  mainImageUrl: string | null,
  rows: RowSpec[],
): SnapshotProject {
  return {
    projectId,
    slug,
    name: slug,
    isActive: true,
    publicStatus: "published",
    mainImageUrl,
    media: rows.map((row) => ({
      projectId,
      mediaType: row.mediaType,
      url: row.url,
      sortOrder: row.sortOrder,
      semanticRole: row.semanticRole ?? null,
    })),
  };
}

export function snapshot(overrides: Partial<ProductionSnapshot> = {}): ProductionSnapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    capturedAt: "2026-07-28T00:00:00.000Z",
    source: "postgrest_get",
    projectRef: "abtvsrcnfwlbawvrjeed",
    semanticRoleColumnPresent: false,
    projects: [
      project(IDS.coralina, "coralina", URLS.coralinaActiveCover, [
        { mediaType: "cover", url: URLS.coralinaActiveCover, sortOrder: 0 },
        // Both covers at sort_order 0 — the reason sort_order is not a key.
        { mediaType: "cover", url: URLS.coralinaOldEventCover, sortOrder: 0 },
        { mediaType: "gallery", url: URLS.coralinaActiveCover, sortOrder: 0 },
        { mediaType: "gallery", url: URLS.coralinaInterior, sortOrder: 1 },
        { mediaType: "gallery", url: URLS.coralinaLogo, sortOrder: 2 },
        { mediaType: "master_plan", url: URLS.coralinaMasterPlan, sortOrder: 0 },
      ]),
      project(IDS.sierra, "the-title-sierra", URLS.sierraHero, [
        // One URL, two rows. Different roles here would bar the hero everywhere.
        { mediaType: "cover", url: URLS.sierraHero, sortOrder: 0 },
        { mediaType: "gallery", url: URLS.sierraHero, sortOrder: 8 },
        { mediaType: "cover", url: URLS.sierraHoliday, sortOrder: 0 },
        { mediaType: "gallery", url: URLS.sierraLifestyle, sortOrder: 1 },
      ]),
      project(IDS.kirara, "the-title-villa-kirara", URLS.kiraraEvent, [
        { mediaType: "cover", url: URLS.kiraraEvent, sortOrder: 0 },
        { mediaType: "gallery", url: URLS.kiraraEvent, sortOrder: 0 },
        { mediaType: "unit_plan", url: URLS.kiraraHousePlan, sortOrder: 0 },
      ]),
      project(IDS.seeded, "seeded-placeholder-villas", null, [
        { mediaType: "gallery", url: URLS.seededBundleKey, sortOrder: 0 },
      ]),
    ],
    businessBaseline: {
      capturedBy: "head_count_exact",
      projects: [
        { projectId: IDS.coralina, units: 12, unitsSold: 3, unitPriceHistoryRows: 0, buildings: 2 },
        { projectId: IDS.sierra, units: 8, unitsSold: 1, unitPriceHistoryRows: 0, buildings: 1 },
        { projectId: IDS.kirara, units: 0, unitsSold: 0, unitPriceHistoryRows: 0, buildings: 0 },
        { projectId: IDS.seeded, units: 0, unitsSold: 0, unitPriceHistoryRows: 0, buildings: 0 },
      ],
    },
    ...overrides,
  };
}

export function candidate(
  overrides: Partial<EvidenceCandidate> & { role: SemanticRole; objectPath: string },
): EvidenceCandidate {
  return {
    tier: "package_manifest_semantic_role" as EvidenceTier,
    input: "media[].semantic_role",
    inputValue: overrides.role,
    classifierReason: "role recorded by the source package",
    packageRef: "pkg",
    packageItemFile: "images/item.jpg",
    originalSha256: "0".repeat(64),
    derivativeSha256: "1".repeat(64),
    ...overrides,
  };
}

export function evidenceSet(
  packageRef: string,
  candidates: EvidenceCandidate[],
  overrides: Partial<PackageEvidenceSet> = {},
): PackageEvidenceSet {
  return {
    packageRef,
    batchFingerprint: "f".repeat(64),
    producedByTask: "FIXTURE",
    itemCount: candidates.length,
    carriesSemanticRole: candidates.some((c) => c.tier === "package_manifest_semantic_role"),
    superseded: false,
    candidates,
    ...overrides,
  };
}

/** Object path of a fixture URL, the way the planner derives it. */
export function pathOf(url: string): string {
  const match = /(direct\/[^/?#]+\/[a-f0-9]{24}\.[a-z0-9]+)/.exec(url);
  if (!match) throw new Error(`fixture url has no object path: ${url}`);
  return match[1];
}

/**
 * Evidence that classifies the fixture set the way the real packages would.
 *
 * Deliberately leaves Coralina's old event cover to a SUPERSEDED package: that
 * is its real situation, and it is what exercises the hide-only rule.
 */
export function standardEvidence(): Map<string, PackageEvidenceSet[]> {
  const map = new Map<string, PackageEvidenceSet[]>();
  map.set("coralina", [
    evidenceSet("coralina-corrected", [
      candidate({ role: "property_exterior", objectPath: pathOf(URLS.coralinaActiveCover) }),
      candidate({ role: "property_interior", objectPath: pathOf(URLS.coralinaInterior) }),
      candidate({
        role: "text_promo",
        objectPath: pathOf(URLS.coralinaLogo),
        tier: "planner_geometry_rule",
        input: "bytes per declared pixel",
        inputValue: "1200 bytes / 800x600",
        classifierReason: "flat artwork, not a photograph",
      }),
      candidate({
        role: "plan",
        objectPath: pathOf(URLS.coralinaMasterPlan),
        tier: "package_folder_convention",
        input: "package folder category",
        inputValue: "master-plan/site.png → master-plan",
        classifierReason: "classified as master-plan",
      }),
    ]),
    evidenceSet(
      "coralina-prefix-run-1",
      [
        candidate({
          role: "event",
          objectPath: pathOf(URLS.coralinaOldEventCover),
          tier: "superseded_package_manifest",
        }),
      ],
      { superseded: true },
    ),
  ]);
  map.set("the-title-sierra", [
    evidenceSet("sierra-corrected", [
      candidate({ role: "architecture_render", objectPath: pathOf(URLS.sierraHero) }),
    ]),
    evidenceSet(
      "sierra-prefix-run-1",
      [
        candidate({
          role: "text_promo",
          objectPath: pathOf(URLS.sierraHoliday),
          tier: "superseded_package_manifest",
        }),
        candidate({
          role: "lifestyle",
          objectPath: pathOf(URLS.sierraLifestyle),
          tier: "superseded_package_manifest",
        }),
      ],
      { superseded: true },
    ),
  ]);
  map.set("the-title-villa-kirara", [
    evidenceSet("kirara-corrected", [
      candidate({ role: "event", objectPath: pathOf(URLS.kiraraEvent) }),
      candidate({
        role: "plan",
        objectPath: pathOf(URLS.kiraraHousePlan),
        tier: "package_manifest_source_path",
        input: "media[].drive_source_path",
        inputValue: "root/07. Plan/House Plan A.png",
        classifierReason: 'source section states "plan"',
      }),
    ]),
    evidenceSet(
      "kirara-prefix-run-1",
      [
        // The documented slug-word defect: a renamed package file containing
        // "villa" was read as evidence of a villa exterior.
        candidate({
          role: "villa_exterior",
          objectPath: pathOf(URLS.kiraraHousePlan),
          tier: "superseded_package_manifest",
        }),
      ],
      { superseded: true },
    ),
  ]);
  map.set("seeded-placeholder-villas", []);
  return map;
}

export const POLICY = {
  digest: "a".repeat(64),
  inputs: [
    { path: "src/features/forever-direct-publish/hero-policy.ts", sha256: "b".repeat(64) },
    { path: "src/features/forever-direct-publish/role-completeness.ts", sha256: "c".repeat(64) },
    { path: "src/lib/public-media-policy.ts", sha256: "d".repeat(64) },
  ],
};

export const GENERATED_AT = "2026-07-28T12:00:00.000Z";
export const GENERATOR_COMMIT = "1b34200c6728f1797af1012a4c7d13243e20cac3";
