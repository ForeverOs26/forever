/**
 * Joining local packages to live production rows, by content
 * (FOREVER-SEMANTIC-MEDIA-BACKFILL-001).
 *
 * The join is the whole safety argument. A backfill writes "this image depicts
 * X" onto a row identified by a URL, and if the identification is wrong the
 * write is a false statement about a different picture. So there is exactly one
 * join here and it is the publish lane's own:
 *
 *     bytes on disk
 *       -> detectSanitizableImageType (leading bytes, not the extension)
 *       -> createPublicDerivative     (the sanitizer that actually ran)
 *       -> publicMediaPath(slug, derivative.sha256, format)
 *       -> `direct/<slug>/<sha24>.<ext>`, compared to the live object path
 *
 * Identical bytes always produce the identical path, which is what made the
 * publish lane idempotent in the first place. Reusing it means the join is
 * true by construction rather than by resemblance.
 *
 * A package that no longer ships the bytes, but DID record the hash the lane
 * computed, joins the same way without them:
 *
 *     extracted media manifest items[].derivative_sha256
 *       -> publicMediaPath(slug, that hash, the recorded output format)
 *       -> `direct/<slug>/<sha24>.<ext>`, compared to the live object path
 *
 * That is the same content address, read out of a record rather than recomputed
 * — see `extractedManifestCandidates`. It is what closes the Legendary project,
 * whose hand-built package carries a facts dossier instead of a `media[]` and
 * therefore explained only its plan sheets by folder convention, leaving its
 * cover and its fifteen LIFESTYLE photographs role-less and public.
 *
 * WHAT IS NOT A JOIN, and is refused by omission: a filename, a URL substring,
 * a slug, a `sort_order`, a position in an array, a "looks like the same
 * project" heuristic. The Villa Kirara defect — 24 launch-party photographs
 * classified `villa_exterior` because the renamed package file contained the
 * word "villa" — is what filename reasoning does at this scale.
 *
 * Note the one thing content addressing does NOT give: it identifies the
 * OBJECT, not the row. A URL can hold several rows with different media types,
 * which is why the caller plans per URL and emits per row.
 */

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";

import {
  classifySemanticRole,
  SEMANTIC_ROLES,
  type SemanticRole,
} from "../forever-direct-publish/hero-policy";
import { readImageDimensions } from "../forever-direct-publish/image-geometry";
import {
  DERIVATIVE_EXTENSION,
  detectSanitizableImageType,
  publicMediaPath,
} from "../forever-direct-publish/public-object-path";
import { createPublicDerivative } from "../forever-studio/server/media-truth";
import { classifyPath } from "../../intake/classify";
import type { EvidenceCandidate, EvidenceTier, PackageEvidenceSet } from "./types";

export type { EvidenceCandidate, EvidenceTier, PackageEvidenceSet };

/** Directories inside a package that never hold publishable media. */
const SKIPPED_DIRECTORIES = new Set([
  "progressive",
  "node_modules",
  ".git",
  ".intake-workspace",
  ".sip-workspace",
]);

const MANIFEST_FILENAME = "source-manifest.json";
/** Matches the sanitizer's own ceiling; anything larger was never published. */
const MAX_MEDIA_FILE_BYTES = 24 * 1024 * 1024;

function sha256Bytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift()!;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name.toLowerCase())) continue;
        queue.push(absolute);
        continue;
      }
      if (entry.isFile()) files.push(absolute);
    }
  }
  return files;
}

function logical(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join("/");
}

/** One `media[]` entry of a source manifest, in the several shapes they take. */
interface ManifestItem {
  file?: string;
  published_filename?: string;
  semantic_role?: string;
  /** The section-bearing original path — the highest-value evidence a package carries. */
  drive_source_path?: string;
  source_ref?: string;
  sha256?: string;
  media_type?: string;
  role?: string;
}

interface ParsedManifest {
  batchFingerprint: string;
  producedByTask: string;
  items: ManifestItem[];
  /** Keyed by both `file` and `published_filename`, whichever the package used. */
  byName: Map<string, ManifestItem>;
  bySha256: Map<string, ManifestItem>;
  carriesSemanticRole: boolean;
}

function parseManifest(raw: unknown): ParsedManifest {
  const empty: ParsedManifest = {
    batchFingerprint: "",
    producedByTask: "",
    items: [],
    byName: new Map(),
    bySha256: new Map(),
    carriesSemanticRole: false,
  };
  if (!raw || typeof raw !== "object") return empty;
  const source = raw as Record<string, unknown>;
  const media = Array.isArray(source.media) ? (source.media as ManifestItem[]) : [];
  const byName = new Map<string, ManifestItem>();
  const bySha256 = new Map<string, ManifestItem>();
  let carriesSemanticRole = false;
  for (const item of media) {
    if (!item || typeof item !== "object") continue;
    for (const name of [item.file, item.published_filename]) {
      if (typeof name === "string" && name) byName.set(name.split("\\").join("/"), item);
    }
    if (typeof item.sha256 === "string" && item.sha256) bySha256.set(item.sha256, item);
    if (typeof item.semantic_role === "string" && item.semantic_role) carriesSemanticRole = true;
  }
  return {
    batchFingerprint: typeof source.batch_fingerprint === "string" ? source.batch_fingerprint : "",
    producedByTask:
      typeof source.task === "string"
        ? source.task
        : typeof source.produced_by_task === "string"
          ? source.produced_by_task
          : "",
    items: media,
    byName,
    bySha256,
    carriesSemanticRole,
  };
}

async function readJsonIfPresent(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as unknown;
  } catch {
    return null;
  }
}

function isSemanticRole(value: unknown): value is SemanticRole {
  return typeof value === "string" && (SEMANTIC_ROLES as readonly string[]).includes(value);
}

/**
 * Index a source tree by content hash.
 *
 * Coralina is the reason this exists: 27 of its rows are explained only by a
 * pre-contract package whose manifest predates `semantic_role`, and the only
 * way back to their section-bearing original paths
 * (`root/11. Perspective/Exterior/…`) is an exact byte match against the
 * repo-adjacent source tree. The hash is of the ORIGINAL bytes, so this is the
 * same identity the manifest records — no filename is consulted.
 */
async function indexSourceTree(directory: string): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  for (const absolute of await listFiles(directory)) {
    let info;
    try {
      info = await stat(absolute);
    } catch {
      continue;
    }
    if (info.size > MAX_MEDIA_FILE_BYTES) continue;
    const bytes = await readFile(absolute);
    const digest = sha256Bytes(bytes);
    // First path wins, deterministically: byte-identical duplicates in a source
    // tree are common and either path is equally true evidence, but the plan
    // must not change because a directory listed in a different order.
    const path = logical(directory, absolute);
    const existing = index.get(digest);
    if (existing === undefined || path < existing) index.set(digest, path);
  }
  return index;
}

// ---------------------------------------------------------------------------
// Extracted media manifest + source inventory
// ---------------------------------------------------------------------------

/**
 * A package that records its own publish result in two side tables.
 *
 * The Legendary package is hand-built rather than Factory-generated, so its
 * `source-manifest.json` is a facts dossier and carries no `media[]` at all.
 * What it carries instead is a pair of tables that between them state more than
 * a Factory manifest does:
 *
 *   an EXTRACTED MEDIA MANIFEST — `{ project_slug, items[] }`, where each item
 *   records the `derivative_sha256` of the object that was published and the
 *   `source_original` relative path the bytes were taken from; and
 *
 *   a SOURCE INVENTORY — one row per downloaded original, mapping that same
 *   `stored_relpath` back to the `folder_name` and `original_filename` it had
 *   in the developer's own folder tree.
 *
 * Joining them recovers the one input this policy was written to read: the
 * section-bearing original path. `000_LIFESTYLE/PHOTO/SHOW CASE/Legendary-3.jpg`
 * is a photograph the developer filed under LIFESTYLE, and `lifestyle` is in
 * `NEVER_PUBLIC_ROLES`. Without this join those fifteen photographs carry no
 * role, and a role-less row is SHOWN — the exact inversion this contract exists
 * to prevent.
 *
 * THE JOIN TO PRODUCTION IS STILL CONTENT-ADDRESSED. `derivative_sha256` is the
 * hash the publish lane itself computed, and `publicMediaPath` turns it into the
 * live object path. Nothing here matches by position, by `sort_order`, by
 * filename resemblance or by slug.
 *
 * `items[].url` IS NEVER READ. It records the pre-Direct-Publish storage layout
 * (`project-images/<slug>/<name>.jpg`) and no longer resolves to anything; a
 * reader that trusted it would match zero rows today and — worse — would start
 * matching the wrong rows the day that layout was reused. `sort_order` is never
 * read either: position is not identity.
 */
interface ExtractedManifestItem {
  /** The sanitized object's content hash. The only join key used. */
  derivative_sha256?: unknown;
  /** Path of the original the bytes came from — the inventory's key. */
  source_original?: unknown;
  /** Recorded output name; read ONLY for its extension. Never classified. */
  public_filename?: unknown;
  storage_path?: unknown;
  derivative_bytes?: unknown;
  width?: unknown;
  height?: unknown;
}

export interface ParsedExtractedManifest {
  projectSlug: string;
  items: ExtractedManifestItem[];
}

export interface SourceInventoryEntry {
  /** The section-bearing folder in the developer's own tree. */
  folderName: string;
  originalFilename: string;
  /** Content hash of the ORIGINAL, as the inventory recorded it. */
  sha256: string;
}

/** Extension -> derivative format, inverted from the publish lane's own map. */
const FORMAT_BY_EXTENSION: ReadonlyMap<string, string> = new Map(
  Object.entries(DERIVATIVE_EXTENSION).map(([format, extension]) => [extension, format]),
);

/** Side tables are text; anything larger than this is not one. */
const MAX_SIDE_TABLE_BYTES = 32 * 1024 * 1024;

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.split("\\").join("/").trim() : "";
}

function asPositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Recognise an extracted media manifest BY SHAPE, not by filename.
 *
 * A package can name its tables anything; what makes a table this table is that
 * it declares a project and lists items carrying a derivative hash and a source
 * path. Returns null for everything else, including a Factory `source-manifest`.
 */
export function parseExtractedMediaManifest(raw: unknown): ParsedExtractedManifest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const projectSlug = typeof source.project_slug === "string" ? source.project_slug.trim() : "";
  if (!projectSlug || !Array.isArray(source.items)) return null;
  const items = (source.items as unknown[]).filter((item): item is ExtractedManifestItem => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const entry = item as ExtractedManifestItem;
    return typeof entry.derivative_sha256 === "string" && typeof entry.source_original === "string";
  });
  return items.length > 0 ? { projectSlug, items } : null;
}

/**
 * Recognise a source inventory BY SHAPE, keyed by `stored_relpath`.
 *
 * Where two rows claim the same stored path, the one whose reconstructed
 * section path sorts first wins. Byte-identical originals downloaded twice are
 * ordinary in these dossiers and either row is equally true evidence — but the
 * plan must not change because a JSON array was written in a different order.
 */
export function parseSourceInventory(raw: unknown): Map<string, SourceInventoryEntry> | null {
  if (!Array.isArray(raw)) return null;
  const byStoredRelpath = new Map<string, SourceInventoryEntry>();
  for (const row of raw) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const entry = row as Record<string, unknown>;
    const storedRelpath = asTrimmedString(entry.stored_relpath);
    const folderName = asTrimmedString(entry.folder_name);
    const originalFilename = asTrimmedString(entry.original_filename);
    if (!storedRelpath || !folderName || !originalFilename) continue;
    const sha256 = typeof entry.sha256 === "string" ? entry.sha256.trim().toLowerCase() : "";
    const candidate: SourceInventoryEntry = {
      folderName,
      originalFilename,
      sha256: /^[a-f0-9]{64}$/.test(sha256) ? sha256 : "",
    };
    const existing = byStoredRelpath.get(storedRelpath);
    if (
      existing === undefined ||
      `${candidate.folderName}/${candidate.originalFilename}` <
        `${existing.folderName}/${existing.originalFilename}`
    ) {
      byStoredRelpath.set(storedRelpath, candidate);
    }
  }
  return byStoredRelpath.size > 0 ? byStoredRelpath : null;
}

export interface ExtractedManifestEvidenceInput {
  slug: string;
  packageRef: string;
  manifest: ParsedExtractedManifest;
  inventory: ReadonlyMap<string, SourceInventoryEntry>;
  superseded: boolean;
}

/**
 * One candidate per item that both tables account for. Pure.
 *
 * Every refusal below produces NO candidate rather than a weaker guess, so the
 * URL falls through to a written exception:
 *
 *   - the manifest describes a different project than the one being planned;
 *   - the derivative hash is not a hash, so no object path can be computed;
 *   - the recorded output extension is not one the sanitizer can produce;
 *   - the inventory has no row for this `source_original`, so no section is
 *     known — this is the case the Legendary map and master-plan sheets hit;
 *   - the classifier read the reconstructed path and returned `unknown`.
 */
export function extractedManifestCandidates(
  input: ExtractedManifestEvidenceInput,
): EvidenceCandidate[] {
  // A side table that names another project is not evidence about this one. A
  // package directory can hold a neighbour's dossier by accident; nothing else
  // in this module would notice, because the object path is built from OUR slug
  // and would look perfectly well-formed.
  if (input.manifest.projectSlug !== input.slug) return [];

  // Byte order over (derivative hash, source path), not array order. An array's
  // order in a file is stable, but a re-export of the same table would reorder
  // it and move `package_state_digest` without one fact having changed.
  const candidates: EvidenceCandidate[] = [];
  const ordered = [...input.manifest.items].sort((a, b) => {
    const key = (item: ExtractedManifestItem) =>
      `${asTrimmedString(item.derivative_sha256)}\u001f${asTrimmedString(item.source_original)}`;
    return Buffer.compare(Buffer.from(key(a), "utf8"), Buffer.from(key(b), "utf8"));
  });

  for (const item of ordered) {
    const derivativeSha256 = asTrimmedString(item.derivative_sha256).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(derivativeSha256)) continue;

    // The recorded output name is read for its EXTENSION ONLY, and only because
    // the object path ends in one. Which of the three formats the sanitizer
    // emitted is a fact about the published object, recorded by the run that
    // published it; the 24 hex characters before it are what identify the row.
    const recordedName =
      asTrimmedString(item.public_filename) || asTrimmedString(item.storage_path);
    const extension = /\.([A-Za-z0-9]+)$/.exec(recordedName)?.[1]?.toLowerCase() ?? "";
    const format = FORMAT_BY_EXTENSION.get(extension);
    if (!format) continue;
    const objectPath = publicMediaPath(input.slug, derivativeSha256, format);

    const storedRelpath = asTrimmedString(item.source_original);
    const entry = storedRelpath ? input.inventory.get(storedRelpath) : undefined;
    if (!entry) continue;

    const sourcePath = `${entry.folderName}/${entry.originalFilename}`;

    // Geometry is passed only as a MATCHED PAIR. `derivative_bytes` and
    // `width`/`height` describe the same published object; the inventory's
    // `byte_size` describes the original and pairs with nothing here. Passing an
    // unpaired size would put a zero (or an original's bytes) over the
    // derivative's pixels, and the flat-artwork rule — "fewer than 0.04 bytes
    // per pixel is not a photograph" — would fire on real photographs.
    const bytes = asPositiveNumber(item.derivative_bytes);
    const width = asPositiveNumber(item.width);
    const height = asPositiveNumber(item.height);
    const paired = bytes !== null && width !== null && height !== null;

    const assessment = classifySemanticRole({
      path: sourcePath,
      size: paired ? bytes : 0,
      width: paired ? width : null,
      height: paired ? height : null,
      category: classifyPath(sourcePath).category,
      slug: input.slug,
    });
    if (assessment.role === "unknown") continue;

    candidates.push({
      tier: input.superseded
        ? "superseded_package_manifest"
        : "extracted_manifest_source_inventory",
      role: assessment.role,
      input:
        "extracted manifest items[].source_original → source inventory folder_name/original_filename",
      inputValue: `${storedRelpath} → ${sourcePath}`,
      classifierReason: assessment.reason,
      packageRef: input.packageRef,
      packageItemFile: recordedName,
      originalSha256: entry.sha256,
      derivativeSha256,
      objectPath,
    });
  }
  return candidates;
}

/**
 * Find the two side tables anywhere inside one package, by shape.
 *
 * Both must be in the same package: an inventory from one dossier keyed against
 * another dossier's manifest would join on coincidence. Files are visited in
 * byte order and the first match of each kind wins, so a package holding two
 * candidate tables resolves the same way on every machine.
 */
async function readSideTables(
  files: readonly string[],
  slug: string,
): Promise<{
  manifest: ParsedExtractedManifest | null;
  inventory: Map<string, SourceInventoryEntry> | null;
}> {
  let manifest: ParsedExtractedManifest | null = null;
  let inventory: Map<string, SourceInventoryEntry> | null = null;
  for (const absolute of files) {
    if (manifest && inventory) break;
    if (!absolute.toLowerCase().endsWith(".json")) continue;
    try {
      if ((await stat(absolute)).size > MAX_SIDE_TABLE_BYTES) continue;
    } catch {
      continue;
    }
    const raw = await readJsonIfPresent(absolute);
    if (raw === null) continue;
    if (!manifest) {
      const parsed = parseExtractedMediaManifest(raw);
      // Matched against the slug being planned here rather than inside
      // `extractedManifestCandidates`, so a neighbour's dossier does not shadow
      // this project's own table by sorting earlier.
      if (parsed && parsed.projectSlug === slug) manifest = parsed;
    }
    if (!inventory) inventory = parseSourceInventory(raw);
  }
  return { manifest, inventory };
}

export interface ResolvePackageEvidenceInput {
  slug: string;
  packageDirectories: readonly string[];
  /**
   * Packages produced by a policy version known to be wrong.
   *
   * Named by directory basename, because a package's identity in every report
   * is its `ref` and never its absolute path.
   */
  supersededPackageRefs: ReadonlySet<string>;
  /** Optional repo-adjacent source tree, indexed by content hash. */
  localSourceTreeDir?: string | null;
}

/**
 * Read every package for one slug and produce its evidence candidates.
 *
 * Every candidate carries the literal input the classifier read and the reason
 * string it returned, verbatim. A reviewer has to be able to disagree with the
 * input, not only with the verdict — "this file sits in a folder called
 * `Exterior`" is checkable; "the tool said property_exterior" is not.
 */
export async function resolvePackageEvidence(
  input: ResolvePackageEvidenceInput,
): Promise<PackageEvidenceSet[]> {
  const sourceTree = input.localSourceTreeDir
    ? await indexSourceTree(input.localSourceTreeDir)
    : new Map<string, string>();

  const sets: PackageEvidenceSet[] = [];

  for (const directory of [...input.packageDirectories].sort()) {
    const packageRef = basename(directory);
    const superseded = input.supersededPackageRefs.has(packageRef);
    const manifest = parseManifest(await readJsonIfPresent(join(directory, MANIFEST_FILENAME)));
    const candidates: EvidenceCandidate[] = [];
    let itemCount = 0;

    const files = (await listFiles(directory)).sort();

    for (const absolute of files) {
      const path = logical(directory, absolute);
      if (path === MANIFEST_FILENAME || path.endsWith("payload.json")) continue;

      let info;
      try {
        info = await stat(absolute);
      } catch {
        continue;
      }
      if (info.size > MAX_MEDIA_FILE_BYTES) continue;

      const bytes = await readFile(absolute);
      const observedContentType = detectSanitizableImageType(bytes);
      if (!observedContentType) continue; // not an image this lane ever published
      itemCount += 1;

      const originalSha256 = sha256Bytes(bytes);
      const derivative = createPublicDerivative({
        bytes,
        originalSha256,
        originalSize: bytes.length,
        observedContentType,
      });
      if (!derivative.eligible || !derivative.record.derivative) continue;
      const derivativeSha256 = derivative.record.derivative.sha256;
      const objectPath = publicMediaPath(input.slug, derivativeSha256, derivative.format);

      const item = manifest.byName.get(path) ?? manifest.bySha256.get(originalSha256);
      const geometry = readImageDimensions(bytes);
      const base = {
        packageRef,
        packageItemFile: path,
        originalSha256,
        derivativeSha256,
        objectPath,
      };

      const push = (
        tier: EvidenceTier,
        role: SemanticRole,
        field: string,
        value: string,
        reason: string,
      ) => {
        candidates.push({
          tier,
          role,
          input: field,
          inputValue: value,
          classifierReason: reason,
          ...base,
        });
      };

      // 1. A role the Factory recorded. Highest authority in a current package;
      //    demoted to hide-only when the package is superseded.
      if (isSemanticRole(item?.semantic_role)) {
        push(
          superseded ? "superseded_package_manifest" : "package_manifest_semantic_role",
          item.semantic_role,
          "media[].semantic_role",
          item.semantic_role,
          superseded
            ? "role recorded by a superseded source package"
            : "role recorded by the source package",
        );
      }

      // 2. The section-bearing original path. Real evidence, and the input
      //    `classifySemanticRole` was written to read.
      const sourcePath =
        typeof item?.drive_source_path === "string" && item.drive_source_path
          ? item.drive_source_path
          : null;
      if (sourcePath) {
        const assessment = classifySemanticRole({
          path: sourcePath,
          size: bytes.length,
          width: geometry?.width ?? null,
          height: geometry?.height ?? null,
          category: classifyPath(sourcePath).category,
          slug: input.slug,
        });
        if (assessment.role !== "unknown") {
          push(
            superseded ? "superseded_package_manifest" : "package_manifest_source_path",
            assessment.role,
            "media[].drive_source_path",
            sourcePath,
            assessment.reason,
          );
        }
      }

      // 3. The same evidence recovered by exact content hash, when the package
      //    itself recorded no path. This is what closes Coralina's 27
      //    pre-contract rows.
      const treePath = sourceTree.get(originalSha256);
      if (!sourcePath && treePath) {
        const assessment = classifySemanticRole({
          path: treePath,
          size: bytes.length,
          width: geometry?.width ?? null,
          height: geometry?.height ?? null,
          category: classifyPath(treePath).category,
          slug: input.slug,
        });
        if (assessment.role !== "unknown") {
          push(
            superseded ? "superseded_package_manifest" : "local_source_tree_content_hash",
            assessment.role,
            "local source tree path matched by original sha256",
            treePath,
            assessment.reason,
          );
        }
      }

      // 4. The package's own folder. `images/` says nothing, but
      //    `master-plan/`, `floor-plans/`, `unit-plan/`, `payment-plan/`,
      //    `brochure/` and `maps/` are the categories the Factory filed the
      //    item under, and `roleFromCategory` turns them into plan/map/
      //    text_promo without looking at any filename.
      const folderCategory = classifyPath(path).category;
      const folderAssessment = classifySemanticRole({
        path,
        size: bytes.length,
        width: geometry?.width ?? null,
        height: geometry?.height ?? null,
        category: folderCategory,
        slug: input.slug,
      });
      if (folderAssessment.reason.startsWith("classified as")) {
        push(
          superseded ? "superseded_package_manifest" : "package_folder_convention",
          folderAssessment.role,
          "package folder category",
          `${path} → ${folderCategory}`,
          folderAssessment.reason,
        );
      } else if (
        folderAssessment.role === "text_promo" &&
        (folderAssessment.reason === "flat artwork, not a photograph" ||
          folderAssessment.reason === "filed as a logo asset")
      ) {
        // 5. Geometry. A statement about bytes-per-pixel, true whatever the
        //    folders say — this is what catches `CORALINA LOGO-01.png`.
        push(
          superseded ? "superseded_package_manifest" : "planner_geometry_rule",
          "text_promo",
          "bytes per declared pixel",
          `${bytes.length} bytes / ${geometry ? `${geometry.width}x${geometry.height}` : "unknown"}`,
          folderAssessment.reason,
        );
      }
    }

    // 6. The package's own side tables, when it keeps them: an extracted media
    //    manifest addressed by derivative hash, joined to a source inventory
    //    that still holds the developer's folder names. Appended after the
    //    per-file pass so the candidate order — and therefore
    //    `package_state_digest` — does not depend on where in the tree the
    //    tables happened to sit.
    const sideTables = await readSideTables(files, input.slug);
    if (sideTables.manifest && sideTables.inventory) {
      candidates.push(
        ...extractedManifestCandidates({
          slug: input.slug,
          packageRef,
          manifest: sideTables.manifest,
          inventory: sideTables.inventory,
          superseded,
        }),
      );
    }

    sets.push({
      packageRef,
      batchFingerprint: manifest.batchFingerprint,
      producedByTask: manifest.producedByTask,
      itemCount,
      carriesSemanticRole: manifest.carriesSemanticRole,
      superseded,
      candidates,
    });
  }

  return sets;
}

/**
 * Index every candidate by the object path it resolves to.
 *
 * The planner matches a production URL by its path component, never by the
 * whole URL: a storage origin can legitimately change (a custom domain, a CDN)
 * without any object changing, and matching the origin too would silently drop
 * every row on the day it did.
 */
export function candidatesByObjectPath(
  sets: readonly PackageEvidenceSet[],
): Map<string, EvidenceCandidate[]> {
  const index = new Map<string, EvidenceCandidate[]>();
  for (const set of sets) {
    for (const candidate of set.candidates) {
      // "Superseded" is recorded on the SET and enforced on the CANDIDATE, and
      // those are two places for one fact. Normalising here means the hide-only
      // rule cannot be bypassed by a candidate that was built with a
      // higher-authority tier — which is exactly what a hand-assembled or
      // future caller would produce, and the resolver has no way to notice.
      const normalised: EvidenceCandidate =
        set.superseded && candidate.tier !== "superseded_package_manifest"
          ? { ...candidate, tier: "superseded_package_manifest" }
          : candidate;
      const existing = index.get(normalised.objectPath);
      if (existing) existing.push(normalised);
      else index.set(normalised.objectPath, [normalised]);
    }
  }
  return index;
}

/**
 * The `direct/<slug>/<sha24>.<ext>` suffix of a production URL, or null.
 *
 * Null for the six seeded villa rows, whose `url` is the bundled-asset key
 * `villaSurin` and not a URL at all. Returning null rather than guessing is
 * what routes those rows to a written exception instead of to a role.
 */
export function objectPathFromUrl(url: string): string | null {
  const trimmed = url.trim();
  const match = /(direct\/[^/?#]+\/[a-f0-9]{24}\.[a-z0-9]+)(?:[?#]|$)/.exec(trimmed);
  return match ? match[1] : null;
}
