/**
 * The join, exercised against real bytes.
 *
 * These tests write a package to a temporary directory and let
 * `resolvePackageEvidence` read it, because the join's whole claim is that it
 * reproduces the publish lane's object path from actual file contents. A
 * fixture that stubbed the derivative would prove only that the plumbing runs.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { createPublicDerivative } from "@/features/forever-studio/server/media-truth";
import { syntheticPng } from "@/features/forever-studio/tests/media-truth-fixtures";
import { createHash } from "node:crypto";

import { publicMediaPath } from "../../forever-direct-publish/public-object-path";
import {
  candidatesByObjectPath,
  extractedManifestCandidates,
  objectPathFromUrl,
  parseExtractedMediaManifest,
  parseSourceInventory,
  resolvePackageEvidence,
} from "../package-evidence";
import { evidenceSet, candidate } from "./fixtures";

const roots: string[] = [];
function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `forever-backfill-${tag}-`));
  roots.push(dir);
  return dir;
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The object path the publish lane would have written for these bytes. */
function expectedObjectPath(slug: string, bytes: Buffer): string {
  const derivative = createPublicDerivative({
    bytes,
    originalSha256: sha256(bytes),
    originalSize: bytes.length,
    observedContentType: "image/png",
  });
  if (!derivative.eligible || !derivative.record.derivative)
    throw new Error("fixture not eligible");
  return publicMediaPath(slug, derivative.record.derivative.sha256, derivative.format);
}

describe("objectPathFromUrl", () => {
  it("extracts the content-addressed path from a live URL", () => {
    expect(
      objectPathFromUrl(
        "https://abtvsrcnfwlbawvrjeed.supabase.co/storage/v1/object/public/project-images/direct/coralina/bd2d9040b80ad05e338aec9d.jpg",
      ),
    ).toBe("direct/coralina/bd2d9040b80ad05e338aec9d.jpg");
  });

  it("ignores the origin, so a CDN or custom domain does not break the join", () => {
    expect(objectPathFromUrl("https://cdn.example.com/x/direct/s/" + "a".repeat(24) + ".png")).toBe(
      `direct/s/${"a".repeat(24)}.png`,
    );
  });

  it("returns null for a bundled-asset key rather than guessing", () => {
    // The six seeded villa rows. Returning null is what routes them to a
    // written exception instead of to a role.
    expect(objectPathFromUrl("villaSurin")).toBeNull();
    expect(objectPathFromUrl("")).toBeNull();
  });

  it("returns null for a URL that merely mentions the slug", () => {
    expect(objectPathFromUrl("https://example.com/coralina/hero.jpg")).toBeNull();
  });
});

describe("the content-addressed join", () => {
  it("matches a package file to the object path production holds", async () => {
    const dir = tempDir("join");
    const pkg = join(dir, "coralina-corrected");
    mkdirSync(join(pkg, "images"), { recursive: true });
    const bytes = syntheticPng(false, 1, 7);
    writeFileSync(join(pkg, "images", "coralina-gallery-00.png"), bytes);
    writeFileSync(
      join(pkg, "source-manifest.json"),
      JSON.stringify({
        task: "FIXTURE",
        batch_fingerprint: "a".repeat(64),
        media: [
          {
            file: "images/coralina-gallery-00.png",
            sha256: sha256(bytes),
            semantic_role: "property_exterior",
            drive_source_path: "root/11. Perspective/Exterior/1. Main Entrance.jpg",
          },
        ],
      }),
    );

    const sets = await resolvePackageEvidence({
      slug: "coralina",
      packageDirectories: [pkg],
      supersededPackageRefs: new Set(),
    });

    expect(sets).toHaveLength(1);
    expect(sets[0].packageRef).toBe("coralina-corrected");
    expect(sets[0].carriesSemanticRole).toBe(true);
    const paths = new Set(sets[0].candidates.map((entry) => entry.objectPath));
    expect(paths.has(expectedObjectPath("coralina", bytes))).toBe(true);
  });

  it("reads the declared role and the section path as separate, ranked evidence", async () => {
    const dir = tempDir("tiers");
    const pkg = join(dir, "pkg");
    mkdirSync(join(pkg, "images"), { recursive: true });
    const bytes = syntheticPng(false, 1, 11);
    writeFileSync(join(pkg, "images", "x-gallery-01.png"), bytes);
    writeFileSync(
      join(pkg, "source-manifest.json"),
      JSON.stringify({
        media: [
          {
            file: "images/x-gallery-01.png",
            semantic_role: "property_interior",
            drive_source_path: "root/12. Photo in the Event/party 3.jpg",
          },
        ],
      }),
    );
    const sets = await resolvePackageEvidence({
      slug: "x",
      packageDirectories: [pkg],
      supersededPackageRefs: new Set(),
    });
    const tiers = sets[0].candidates.map((entry) => `${entry.tier}:${entry.role}`);
    expect(tiers).toContain("package_manifest_semantic_role:property_interior");
    expect(tiers).toContain("package_manifest_source_path:event");
    // The reason string is carried verbatim, so a reviewer can disagree with
    // the input rather than only with the verdict.
    const bySection = sets[0].candidates.find((entry) => entry.role === "event")!;
    expect(bySection.inputValue).toBe("root/12. Photo in the Event/party 3.jpg");
    expect(bySection.classifierReason).toMatch(/source section states/);
  });

  it("recovers the original path by content hash when the package records none", async () => {
    // This is what closes Coralina's pre-contract rows: the package renamed the
    // file, but the bytes still identify the original.
    const dir = tempDir("tree");
    const pkg = join(dir, "pkg");
    const tree = join(dir, "source");
    mkdirSync(join(pkg, "images"), { recursive: true });
    mkdirSync(join(tree, "11. Perspective", "Exterior"), { recursive: true });
    const bytes = syntheticPng(false, 1, 13);
    writeFileSync(join(pkg, "images", "renamed-gallery-04.png"), bytes);
    writeFileSync(join(tree, "11. Perspective", "Exterior", "01 Main Entrance.png"), bytes);
    writeFileSync(join(pkg, "source-manifest.json"), JSON.stringify({ media: [] }));

    const sets = await resolvePackageEvidence({
      slug: "coralina",
      packageDirectories: [pkg],
      supersededPackageRefs: new Set(),
      localSourceTreeDir: tree,
    });
    const recovered = sets[0].candidates.find(
      (entry) => entry.tier === "local_source_tree_content_hash",
    );
    expect(recovered).toBeDefined();
    expect(recovered!.role).toBe("property_exterior");
    expect(recovered!.inputValue).toContain("Exterior");
  });

  it("does not classify from the package filename alone", async () => {
    // The Villa Kirara defect at its source: a renamed package file containing
    // the word "villa" must not become evidence of a villa exterior.
    const dir = tempDir("nofilename");
    const pkg = join(dir, "pkg");
    mkdirSync(join(pkg, "images"), { recursive: true });
    writeFileSync(
      join(pkg, "images", "the-title-villa-kirara-gallery-00.png"),
      syntheticPng(false, 1, 17),
    );
    const sets = await resolvePackageEvidence({
      slug: "the-title-villa-kirara",
      packageDirectories: [pkg],
      supersededPackageRefs: new Set(),
    });
    expect(sets[0].candidates.map((entry) => entry.role)).not.toContain("villa_exterior");
    expect(sets[0].candidates).toHaveLength(0);
  });

  it("reads the package folder as a category, which is a filing decision and not a filename", async () => {
    const dir = tempDir("folder");
    const pkg = join(dir, "pkg");
    mkdirSync(join(pkg, "master-plan"), { recursive: true });
    writeFileSync(join(pkg, "master-plan", "s-master-plan-00.png"), syntheticPng(false, 1, 19));
    const sets = await resolvePackageEvidence({
      slug: "s",
      packageDirectories: [pkg],
      supersededPackageRefs: new Set(),
    });
    const folder = sets[0].candidates.find((entry) => entry.tier === "package_folder_convention");
    expect(folder?.role).toBe("plan");
    expect(folder?.classifierReason).toBe("classified as master-plan");
  });

  it("marks a superseded package's evidence as such", async () => {
    const dir = tempDir("superseded");
    const pkg = join(dir, "prefix-run-1");
    mkdirSync(join(pkg, "images"), { recursive: true });
    writeFileSync(join(pkg, "images", "a.png"), syntheticPng(false, 1, 23));
    writeFileSync(
      join(pkg, "source-manifest.json"),
      JSON.stringify({ media: [{ file: "images/a.png", semantic_role: "event" }] }),
    );
    const sets = await resolvePackageEvidence({
      slug: "s",
      packageDirectories: [pkg],
      supersededPackageRefs: new Set(["prefix-run-1"]),
    });
    expect(sets[0].superseded).toBe(true);
    expect(sets[0].candidates[0].tier).toBe("superseded_package_manifest");
  });

  it("ignores a file that is not an image this lane could have published", async () => {
    const dir = tempDir("nonimage");
    const pkg = join(dir, "pkg");
    mkdirSync(join(pkg, "brochure"), { recursive: true });
    writeFileSync(join(pkg, "brochure", "b.pdf"), Buffer.from("%PDF-1.7\n"));
    const sets = await resolvePackageEvidence({
      slug: "s",
      packageDirectories: [pkg],
      supersededPackageRefs: new Set(),
    });
    expect(sets[0].itemCount).toBe(0);
    expect(sets[0].candidates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The extracted media manifest + source inventory side tables
// ---------------------------------------------------------------------------

/**
 * Fixtures in the exact shape the Legendary dossier uses.
 *
 * Field names, nesting and the stale `url` are copied from the real tables
 * rather than simplified: the whole point of this reader is that it consumes
 * that shape, and a tidied-up fixture would stop proving it.
 */
const LEGENDARY_SLUG = "the-title-legendary";
const COVER_SHA = "d32546ae86436862d9de0376d3ed88fcb306eb7b2bbc3dd9da1792f27eb73dfb";
const LIFESTYLE_SHA = "2f02c589cc17b703feb4e20b2b66aaf1c99e1e07cad4193b618d1e2c065df361";
const ORPHAN_SHA = "f5b9ad02da82ced5a828b465a11b2c3d4e5f60718293a4b5c6d7e8f901234567";

function legendaryManifest(): unknown {
  return {
    project_slug: LEGENDARY_SLUG,
    bucket: "project-images",
    count: 3,
    items: [
      {
        sort_order: 0,
        media_type: "cover",
        title: "The Title Legendary Bang-Tao",
        public_filename: "the-title-legendary-cover.jpg",
        storage_path: "the-title-legendary/the-title-legendary-cover.jpg",
        bucket: "project-images",
        // STALE. Records the pre-Direct-Publish layout and must never be read.
        url: `https://abtvsrcnfwlbawvrjeed.supabase.co/storage/v1/object/public/project-images/${LEGENDARY_SLUG}/the-title-legendary-cover.jpg`,
        derivative_sha256: COVER_SHA,
        derivative_bytes: 710102,
        width: 2560,
        height: 1443,
        source_original: "exterior_render/The Title Legendary_Ex001.jpg",
        duplicate_of: null,
      },
      {
        sort_order: 1,
        media_type: "gallery",
        title: "Lagoon pool and residences at sunset",
        public_filename: "the-title-legendary-lagoon-pool-sunset.jpg",
        storage_path: "the-title-legendary/the-title-legendary-lagoon-pool-sunset.jpg",
        bucket: "project-images",
        url: `https://abtvsrcnfwlbawvrjeed.supabase.co/storage/v1/object/public/project-images/${LEGENDARY_SLUG}/the-title-legendary-lagoon-pool-sunset.jpg`,
        derivative_sha256: LIFESTYLE_SHA,
        derivative_bytes: 558108,
        width: 2048,
        height: 1152,
        source_original: "lifestyle_photo/Legendary-335.jpg",
        duplicate_of: null,
      },
      {
        // Present in the publish manifest, absent from the inventory — the real
        // Legendary map and master-plan sheets are exactly this case.
        sort_order: 24,
        media_type: "map",
        public_filename: "the-title-legendary-location-map.jpg",
        storage_path: "the-title-legendary/the-title-legendary-location-map.jpg",
        bucket: "project-images",
        url: `https://abtvsrcnfwlbawvrjeed.supabase.co/storage/v1/object/public/project-images/${LEGENDARY_SLUG}/the-title-legendary-location-map.jpg`,
        derivative_sha256: ORPHAN_SHA,
        derivative_bytes: 218747,
        width: 1600,
        height: 1131,
        source_original: "003_Map/Location Map.jpg",
        duplicate_of: null,
      },
    ],
  };
}

function legendaryInventory(): unknown {
  return [
    {
      byte_size: 3542266,
      drive_file_id: "1Z8jqTqoRnh6Ig0aV7f3NWT_bxXHU2_jY",
      duplicate_of: null,
      folder_name: "010_Furniture Package/011_Perspective/Exterior",
      group: "exterior_render",
      original_filename: "The Title Legendary_Ex001.jpg",
      sha256: "a".repeat(64),
      status: "downloaded",
      stored_relpath: "exterior_render/The Title Legendary_Ex001.jpg",
    },
    {
      byte_size: 12660229,
      drive_file_id: "1ueITQ5eJBJG5xtJWZZ4X-EcRj038iOUW",
      duplicate_of: null,
      folder_name: "000_LIFESTYLE/PHOTO/SHOW CASE",
      group: "lifestyle_photo",
      original_filename: "Legendary-335.jpg",
      sha256: "b".repeat(64),
      status: "downloaded",
      stored_relpath: "lifestyle_photo/Legendary-335.jpg",
    },
  ];
}

function resolveSideTables(overrides: { manifest?: unknown; inventory?: unknown } = {}) {
  const manifest = parseExtractedMediaManifest(overrides.manifest ?? legendaryManifest());
  const inventory = parseSourceInventory(overrides.inventory ?? legendaryInventory());
  if (!manifest || !inventory) throw new Error("fixture did not parse");
  return extractedManifestCandidates({
    slug: LEGENDARY_SLUG,
    packageRef: "the-title-legendary-publish",
    manifest,
    inventory,
    superseded: false,
  });
}

describe("extracted media manifest joined to a source inventory", () => {
  it("reaches the classifier's role through the new tier, addressed by derivative hash", () => {
    const candidates = resolveSideTables();
    const cover = candidates.find((entry) => entry.derivativeSha256 === COVER_SHA);

    expect(cover).toBeDefined();
    expect(cover!.tier).toBe("extracted_manifest_source_inventory");
    // The role is the repo's own classifier reading the recovered section path,
    // not a role this module chose.
    expect(cover!.role).toBe("property_exterior");
    expect(cover!.classifierReason).toBe('source section states "exterior"');
    expect(cover!.inputValue).toContain("010_Furniture Package/011_Perspective/Exterior");
    // Content-addressed: the first 24 hex characters of the recorded derivative
    // hash, which is what the live row's URL ends in.
    expect(cover!.objectPath).toBe(`direct/${LEGENDARY_SLUG}/${COVER_SHA.slice(0, 24)}.jpg`);
    expect(cover!.originalSha256).toBe("a".repeat(64));
  });

  it("classifies a LIFESTYLE-sectioned photograph as lifestyle, which is never public", () => {
    // The fifteen rows this whole change exists for. `lifestyle` is in
    // NEVER_PUBLIC_ROLES; left role-less these are SHOWN.
    const photo = resolveSideTables().find((entry) => entry.derivativeSha256 === LIFESTYLE_SHA);
    expect(photo?.role).toBe("lifestyle");
    expect(photo?.classifierReason).toBe('source section states "lifestyle"');
  });

  it("never uses the stale items[].url to match a row", () => {
    const candidates = resolveSideTables();
    for (const entry of candidates) {
      // The stale layout is `project-images/<slug>/<name>.jpg`. Nothing derived
      // from it may appear in the object path or in the recorded evidence.
      expect(entry.objectPath).toMatch(
        new RegExp(`^direct/${LEGENDARY_SLUG}/[a-f0-9]{24}\\.(?:jpg|png|webp)$`),
      );
      expect(entry.objectPath).not.toContain("project-images");
      expect(entry.objectPath).not.toContain("supabase.co");
      expect(entry.inputValue).not.toContain("http");
    }
  });

  it("still matches when the stale url is wrong, absent or points at another project", () => {
    const manifest = legendaryManifest() as { items: Array<Record<string, unknown>> };
    manifest.items[0].url = "https://example.invalid/project-images/some-other-slug/whatever.jpg";
    delete manifest.items[1].url;
    const candidates = resolveSideTables({ manifest });
    expect(candidates.find((entry) => entry.derivativeSha256 === COVER_SHA)?.objectPath).toBe(
      `direct/${LEGENDARY_SLUG}/${COVER_SHA.slice(0, 24)}.jpg`,
    );
    expect(candidates.find((entry) => entry.derivativeSha256 === LIFESTYLE_SHA)?.role).toBe(
      "lifestyle",
    );
  });

  it("yields nothing for an item the inventory does not account for", () => {
    // No section is known, so no role is claimed. The URL falls through to a
    // written exception, which is the correct outcome — a guess is not.
    const candidates = resolveSideTables();
    expect(candidates.map((entry) => entry.derivativeSha256)).not.toContain(ORPHAN_SHA);
    expect(candidates).toHaveLength(2);
  });

  it("ignores sort_order entirely — position is not identity", () => {
    const manifest = legendaryManifest() as { items: Array<Record<string, unknown>> };
    // Reverse the array and scramble every sort_order. The roles must not move.
    manifest.items.reverse();
    manifest.items.forEach((item, index) => {
      item.sort_order = 900 - index;
    });
    const byHash = new Map(
      resolveSideTables({ manifest }).map((e) => [e.derivativeSha256, e.role]),
    );
    expect(byHash.get(COVER_SHA)).toBe("property_exterior");
    expect(byHash.get(LIFESTYLE_SHA)).toBe("lifestyle");
  });

  it("refuses a side table that names a different project", () => {
    // A neighbour's dossier in the same directory would otherwise produce
    // perfectly well-formed object paths under OUR slug.
    const manifest = parseExtractedMediaManifest({
      ...(legendaryManifest() as object),
      project_slug: "the-title-sierra",
    })!;
    expect(
      extractedManifestCandidates({
        slug: LEGENDARY_SLUG,
        packageRef: "pkg",
        manifest,
        inventory: parseSourceInventory(legendaryInventory())!,
        superseded: false,
      }),
    ).toHaveLength(0);
  });

  it("does not call a photograph flat artwork when the byte count is missing", () => {
    // `derivative_bytes` and `width`/`height` are only usable as a pair. An
    // unpaired size of zero over real pixels is below the flat-artwork
    // threshold, and every photograph would come back text_promo.
    const manifest = legendaryManifest() as { items: Array<Record<string, unknown>> };
    delete manifest.items[0].derivative_bytes;
    const cover = resolveSideTables({ manifest }).find((e) => e.derivativeSha256 === COVER_SHA);
    expect(cover?.role).toBe("property_exterior");
  });

  it("demotes to hide-only evidence when the package is superseded", () => {
    const candidates = extractedManifestCandidates({
      slug: LEGENDARY_SLUG,
      packageRef: "prefix-run-1",
      manifest: parseExtractedMediaManifest(legendaryManifest())!,
      inventory: parseSourceInventory(legendaryInventory())!,
      superseded: true,
    });
    expect(candidates.every((entry) => entry.tier === "superseded_package_manifest")).toBe(true);
  });

  it("recognises the tables by shape, so a Factory source-manifest is not one", () => {
    expect(parseExtractedMediaManifest({ media: [{ file: "a.png" }] })).toBeNull();
    expect(parseExtractedMediaManifest({ project_slug: "s", items: [] })).toBeNull();
    // An item with no derivative hash is not addressable and is dropped.
    expect(
      parseExtractedMediaManifest({ project_slug: "s", items: [{ source_original: "a" }] }),
    ).toBeNull();
    expect(parseSourceInventory({ rows: [] })).toBeNull();
    expect(parseSourceInventory([{ folder_name: "x" }])).toBeNull();
  });

  it("is found inside a package with no bytes on disk, and produces a role", async () => {
    // End to end through the real resolver: the Legendary package no longer has
    // to ship the images for its recorded hashes to identify production rows.
    const dir = tempDir("sidetables");
    const pkg = join(dir, "the-title-legendary-publish");
    mkdirSync(join(pkg, "extracted"), { recursive: true });
    writeFileSync(
      join(pkg, "extracted", "media_manifest.json"),
      JSON.stringify(legendaryManifest()),
    );
    writeFileSync(
      join(pkg, "extracted", "media_source_inventory.json"),
      JSON.stringify(legendaryInventory()),
    );
    // A facts dossier, exactly as the hand-built package carries: no `media[]`.
    writeFileSync(
      join(pkg, "source-manifest.json"),
      JSON.stringify({ project_slug: LEGENDARY_SLUG, official_sources: [] }),
    );

    const sets = await resolvePackageEvidence({
      slug: LEGENDARY_SLUG,
      packageDirectories: [pkg],
      supersededPackageRefs: new Set(),
    });

    expect(sets[0].itemCount).toBe(0);
    const roles = sets[0].candidates
      .filter((entry) => entry.tier === "extracted_manifest_source_inventory")
      .map((entry) => entry.role)
      .sort();
    expect(roles).toEqual(["lifestyle", "property_exterior"]);
    const index = candidatesByObjectPath(sets);
    expect(index.get(`direct/${LEGENDARY_SLUG}/${COVER_SHA.slice(0, 24)}.jpg`)?.[0].role).toBe(
      "property_exterior",
    );
  });

  it("produces nothing when only one of the two tables is present", async () => {
    // The join needs both. An inventory keyed against another dossier's
    // manifest would join on coincidence, so a lone table is not evidence.
    const dir = tempDir("halftable");
    const pkg = join(dir, "pkg");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "media_manifest.json"), JSON.stringify(legendaryManifest()));
    const sets = await resolvePackageEvidence({
      slug: LEGENDARY_SLUG,
      packageDirectories: [pkg],
      supersededPackageRefs: new Set(),
    });
    expect(sets[0].candidates).toHaveLength(0);
  });
});

describe("candidatesByObjectPath", () => {
  it("forces the superseded tier even when a candidate claims a higher one", () => {
    // "Superseded" is recorded on the set; enforcing it on the candidate here
    // means the hide-only rule cannot be bypassed by how the set was built.
    const index = candidatesByObjectPath([
      evidenceSet("s", [candidate({ role: "villa_exterior", objectPath: "direct/x/aaa.png" })], {
        superseded: true,
      }),
    ]);
    expect(index.get("direct/x/aaa.png")![0].tier).toBe("superseded_package_manifest");
  });

  it("collects candidates for the same object from several packages", () => {
    const index = candidatesByObjectPath([
      evidenceSet("a", [candidate({ role: "plan", objectPath: "direct/x/p.png" })]),
      evidenceSet("b", [candidate({ role: "map", objectPath: "direct/x/p.png" })]),
    ]);
    expect(index.get("direct/x/p.png")).toHaveLength(2);
  });
});
