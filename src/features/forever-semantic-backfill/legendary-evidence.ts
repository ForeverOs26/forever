/**
 * The Legendary evidence gate — fail closed, before anything is contacted
 * (FOREVER-SEMANTIC-MEDIA-RELEASE-PREP-001).
 *
 * `the-title-legendary` is the one project in this release whose classification
 * depends on evidence the evidence reader discovers BY SHAPE rather than by
 * being handed it. That is the right way to read a package — a filename is not
 * identity — but it has one failure mode that nothing else in this lane has:
 *
 *   with both side tables present   40 of 40 rows classified, 0 exceptions,
 *                                   and the 15 LIFESTYLE photographs leave
 *                                   every public surface;
 *
 *   with either one absent          the reader finds no side-table evidence,
 *                                   falls back to folder convention, classifies
 *                                   16 of 40, and those 15 photographs stay
 *                                   publicly visible behind written exceptions.
 *
 * Both outcomes are "successful" runs. Nothing failed, no guard fired, and the
 * difference is visible only to somebody who reads a tier histogram in a plan
 * report and knows what number to expect. PR #120 shipped this as a documented
 * operational dependency — "not code-enforced, the runbook says how to check" —
 * and a runbook step that a tired operator can skip is not a control.
 *
 * So it is enforced here, and it is enforced BEFORE the target is contacted.
 * Not because contacting the target would itself be harmful, but because the
 * order is the whole property: a run that opens a transaction, writes a journal
 * record and then discovers its evidence was incomplete has already produced a
 * release record describing a classification nobody accepted. The refusal has to
 * happen while the run still has no state at all.
 *
 * WHAT COUNTS AS EVIDENCE HERE. Not a filename. The package already carries
 * stronger identity than its own directory listing and this module reads only
 * that:
 *
 *   - the extracted media manifest is recognised by its SHAPE
 *     (`{ project_slug, items[] }` with `derivative_sha256` + `source_original`)
 *     and is required to NAME Legendary in its own `project_slug`;
 *   - the source inventory is recognised by its SHAPE (rows keyed by
 *     `stored_relpath`, carrying the developer's `folder_name`);
 *   - each is identified by the SHA-256 of its own bytes, and the pair is
 *     identified by a digest over those two hashes, so "changed since it was
 *     reviewed" is a detectable event rather than an assumption;
 *   - the binding to production rows stays content-addressed —
 *     `derivative_sha256` → `publicMediaPath` → `direct/<slug>/<sha24>.<ext>` —
 *     exactly as `package-evidence` already does it.
 *
 * Pure except for `readLegendaryEvidenceInputs`, which reads bytes. No network,
 * no database, no credentials, nothing echoed.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";

import { digestRecords, record, sha256Hex } from "./canonical";
import { GuardError } from "./guards";
import {
  candidatesByObjectPath,
  parseExtractedMediaManifest,
  parseSourceInventory,
  type ParsedExtractedManifest,
  type SourceInventoryEntry,
} from "./package-evidence";
import { resolveRoleForUrl } from "./role-resolution";
import type { EvidenceTier, PackageEvidenceSet } from "./types";

export const LEGENDARY_SLUG = "the-title-legendary";

/** The failure code the Owner's runbook, the report and the tests all name. */
export const LEGENDARY_EVIDENCE_INCOMPLETE = "legendary_evidence_incomplete";

/**
 * Its own exit code, above the thirteen the controller already uses.
 *
 * Reusing `EXIT.manifest` or `EXIT.blocked` would fold "the evidence was
 * incomplete" into "the manifest was edited", and a release script that branches
 * on the exit code could not tell the two apart. They call for different
 * actions: one is re-staging two files, the other is a re-review.
 */
export const LEGENDARY_EVIDENCE_EXIT_CODE = 14;

/**
 * The two inputs, named. This is the "explicitly identified" requirement: the
 * gate does not ask "did the reader find enough", it asks for these two things.
 */
export const LEGENDARY_REQUIRED_EVIDENCE = [
  {
    kind: "extracted_media_manifest",
    what: "an extracted media manifest — { project_slug, items[] } carrying derivative_sha256 and source_original",
    why: "it is the only local record that addresses each published Legendary object by the hash the publish lane itself computed",
  },
  {
    kind: "source_inventory",
    what: "a media source inventory — rows keyed by stored_relpath carrying folder_name and original_filename",
    why: "it is the only local record that maps those objects back to the developer's own section folders, where 000_LIFESTYLE lives",
  },
] as const;

export type LegendaryEvidenceKind = (typeof LEGENDARY_REQUIRED_EVIDENCE)[number]["kind"];

/**
 * The classification the Owner accepted, pinned.
 *
 * These are not aspirational numbers: they are what PR #120's reviewed manifest
 * records for `the-title-legendary` — 40 URLs, 40 rows to update, 0 role-less, 0
 * exceptions, 37 URLs explained by the two side tables and 3 by the package's
 * own folders. Pinning them is what makes "incapable of reproducing the accepted
 * 40/40 classification" a checkable statement rather than a hope.
 *
 * Compared with `>=`, not `===`. A package that carries MORE evidence than the
 * review saw is not a degradation and must not be refused — but every one of
 * these counts falling short is, and the 16/40 fallback falls short of all of
 * them at once: 24 fewer classified paths, 37 fewer side-table tiers, and all 15
 * `lifestyle` roles gone.
 */
export const LEGENDARY_ACCEPTED_CLASSIFICATION = {
  slug: LEGENDARY_SLUG,
  classifiedObjectPaths: 40,
  tierCounts: {
    extracted_manifest_source_inventory: 37,
    package_folder_convention: 3,
  } as Readonly<Partial<Record<EvidenceTier, number>>>,
  roleCounts: {
    amenity: 2,
    lifestyle: 15,
    map: 1,
    plan: 15,
    property_exterior: 7,
  } as Readonly<Record<string, number>>,
} as const;

// ---------------------------------------------------------------------------
// Reading the package
// ---------------------------------------------------------------------------

/** Mirrors `package-evidence`: these directories never hold a side table. */
const SKIPPED_DIRECTORIES = new Set([
  "progressive",
  "node_modules",
  ".git",
  ".intake-workspace",
  ".sip-workspace",
]);

/** Side tables are text; anything larger than this is not one. */
const MAX_SIDE_TABLE_BYTES = 32 * 1024 * 1024;

export interface LegendaryEvidenceFile {
  /** Path inside the package. Reported, never classified. */
  packageItemFile: string;
  /** SHA-256 of the bytes on disk — this file's content identity. */
  sha256: string;
  /** The parsed JSON, or `undefined` when the bytes were not JSON at all. */
  parsed: unknown;
}

async function listJsonFiles(root: string): Promise<string[]> {
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
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) files.push(absolute);
    }
  }
  return files.sort();
}

/**
 * Every JSON file in one package directory, hashed and parsed.
 *
 * `progressive/` is skipped for the same reason `package-evidence` skips it —
 * it holds the publish payload, not evidence — so a payload that happened to
 * contain an `items[]` array can never be mistaken for a side table.
 */
export async function readLegendaryEvidenceInputs(
  directory: string,
): Promise<LegendaryEvidenceFile[]> {
  const out: LegendaryEvidenceFile[] = [];
  for (const absolute of await listJsonFiles(directory)) {
    try {
      if ((await stat(absolute)).size > MAX_SIDE_TABLE_BYTES) continue;
    } catch {
      continue;
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(absolute);
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8")) as unknown;
    } catch {
      parsed = undefined;
    }
    out.push({
      packageItemFile: relative(directory, absolute).split(sep).join("/"),
      sha256: sha256Hex(bytes),
      parsed,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Discovery — by shape, with ambiguity and foreignness kept visible
// ---------------------------------------------------------------------------

export interface DiscoveredTable<T> {
  packageItemFile: string;
  sha256: string;
  value: T;
}

export interface LegendaryEvidenceDiscovery {
  /** Distinct (by content hash) manifests that name Legendary. */
  manifests: Array<DiscoveredTable<ParsedExtractedManifest>>;
  /** Distinct (by content hash) inventories. */
  inventories: Array<DiscoveredTable<Map<string, SourceInventoryEntry>>>;
  /** Manifest-shaped tables naming some OTHER project, found in this package. */
  foreignManifests: Array<{ packageItemFile: string; sha256: string; projectSlug: string }>;
  /** Tables of the right shape whose contents are internally malformed. */
  malformed: Array<{ packageItemFile: string; sha256: string; kind: string; detail: string }>;
}

function isHex64(value: unknown): boolean {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value.trim());
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Is this raw value manifest-shaped at all — before judging whose it is?
 *
 * `parseExtractedMediaManifest` returns null both for "not a manifest" and for
 * "a manifest whose every item is unusable", and this gate has to tell those
 * apart: the first is an ordinary JSON file sitting in the package, the second
 * is corrupted evidence that must fail the run rather than be skipped.
 */
function manifestShaped(raw: unknown): { projectSlug: string; items: unknown[] } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  if (!nonEmptyString(source.project_slug) || !Array.isArray(source.items)) return null;
  return { projectSlug: (source.project_slug as string).trim(), items: source.items };
}

/**
 * Every item must be structurally sound, not merely most of them.
 *
 * `parseExtractedMediaManifest` DROPS an item whose `derivative_sha256` is not a
 * string, and `extractedManifestCandidates` then skips one whose hash is not 64
 * hex characters. Both are the right behaviour for a reader that must not crash
 * on a stray record — and both are silent, which is the behaviour this gate
 * exists to refuse. A manifest that lost three items to a truncated write still
 * parses, still produces candidates, and still classifies fewer rows than the
 * review accepted.
 */
function manifestStructureProblem(items: readonly unknown[]): string | null {
  if (items.length === 0) return "items[] is empty";
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return `items[${index}] is not an object`;
    }
    const entry = item as Record<string, unknown>;
    if (!isHex64(entry.derivative_sha256)) {
      return `items[${index}].derivative_sha256 is not a 64-character hex digest`;
    }
    if (!nonEmptyString(entry.source_original)) {
      return `items[${index}].source_original is missing or empty`;
    }
  }
  return null;
}

/** Inventory rows are keyed by `stored_relpath`; a keyed row must be complete. */
function inventoryStructureProblem(rows: readonly unknown[]): string | null {
  if (rows.length === 0) return "the inventory is empty";
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return `row ${index} is not an object`;
    }
    const entry = row as Record<string, unknown>;
    if (!nonEmptyString(entry.stored_relpath)) continue; // not a keyed row; carries nothing
    if (!nonEmptyString(entry.folder_name)) {
      return (
        `row ${index} keys ${String(entry.stored_relpath)} but records no folder_name — ` +
        `the section it was filed under is exactly what this table exists to carry`
      );
    }
    if (!nonEmptyString(entry.original_filename)) {
      return `row ${index} keys ${String(entry.stored_relpath)} but records no original_filename`;
    }
  }
  return null;
}

/** Does this raw value look like a source inventory — an array of keyed rows? */
function inventoryShaped(raw: unknown): unknown[] | null {
  if (!Array.isArray(raw)) return null;
  const keyed = raw.filter(
    (row) =>
      row &&
      typeof row === "object" &&
      !Array.isArray(row) &&
      nonEmptyString((row as Record<string, unknown>).stored_relpath),
  );
  return keyed.length > 0 ? raw : null;
}

/**
 * Sort every discovered table by content hash.
 *
 * Discovery order is directory listing order, which differs between machines. A
 * gate whose "which one is ambiguous" answer depended on that would report a
 * different offending file on the Owner's laptop than in the harness.
 */
function byHash<T extends { sha256: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => (a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0));
}

export function discoverLegendaryEvidence(
  files: readonly LegendaryEvidenceFile[],
): LegendaryEvidenceDiscovery {
  const manifests = new Map<string, DiscoveredTable<ParsedExtractedManifest>>();
  const inventories = new Map<string, DiscoveredTable<Map<string, SourceInventoryEntry>>>();
  const foreignManifests: LegendaryEvidenceDiscovery["foreignManifests"] = [];
  const malformed: LegendaryEvidenceDiscovery["malformed"] = [];

  for (const file of files) {
    if (file.parsed === undefined) continue; // not JSON; not evidence of any kind

    const shapedManifest = manifestShaped(file.parsed);
    if (shapedManifest) {
      if (shapedManifest.projectSlug !== LEGENDARY_SLUG) {
        // Kept rather than ignored. A neighbour's dossier inside this package
        // means the package is not the thing it claims to be, and every join
        // built from it would still LOOK well-formed: the object path is built
        // from our slug, so a foreign manifest produces plausible-looking paths
        // that address other projects' pictures.
        foreignManifests.push({
          packageItemFile: file.packageItemFile,
          sha256: file.sha256,
          projectSlug: shapedManifest.projectSlug,
        });
        continue;
      }
      const problem = manifestStructureProblem(shapedManifest.items);
      if (problem) {
        malformed.push({
          packageItemFile: file.packageItemFile,
          sha256: file.sha256,
          kind: "extracted_media_manifest",
          detail: problem,
        });
        continue;
      }
      const parsed = parseExtractedMediaManifest(file.parsed);
      if (!parsed) {
        malformed.push({
          packageItemFile: file.packageItemFile,
          sha256: file.sha256,
          kind: "extracted_media_manifest",
          detail: "no item survived parsing",
        });
        continue;
      }
      // Byte-identical copies of one table are one piece of evidence, not two.
      // A package that ships the same manifest twice is untidy; a package that
      // ships two DIFFERENT manifests is ambiguous, and only the second is a
      // safety problem.
      manifests.set(file.sha256, {
        packageItemFile: file.packageItemFile,
        sha256: file.sha256,
        value: parsed,
      });
      continue;
    }

    const shapedInventory = inventoryShaped(file.parsed);
    if (shapedInventory) {
      const problem = inventoryStructureProblem(shapedInventory);
      if (problem) {
        malformed.push({
          packageItemFile: file.packageItemFile,
          sha256: file.sha256,
          kind: "source_inventory",
          detail: problem,
        });
        continue;
      }
      const parsed = parseSourceInventory(file.parsed);
      if (!parsed) {
        malformed.push({
          packageItemFile: file.packageItemFile,
          sha256: file.sha256,
          kind: "source_inventory",
          detail: "no row survived parsing",
        });
        continue;
      }
      inventories.set(file.sha256, {
        packageItemFile: file.packageItemFile,
        sha256: file.sha256,
        value: parsed,
      });
    }
  }

  return {
    manifests: byHash([...manifests.values()]),
    inventories: byHash([...inventories.values()]),
    foreignManifests: byHash(foreignManifests),
    malformed: byHash(malformed),
  };
}

/**
 * The identity of the evidence PAIR.
 *
 * A digest over the two content hashes and the kinds they satisfy. This is what
 * "changed since it was reviewed" is measured against: either side table being
 * regenerated, re-exported or edited moves it, and it moves for a reason a
 * reviewer can name.
 */
export function legendaryEvidenceDigest(discovery: LegendaryEvidenceDiscovery): string | null {
  const manifest = discovery.manifests[0];
  const inventory = discovery.inventories[0];
  if (!manifest || !inventory) return null;
  return digestRecords([
    record("extracted_media_manifest", manifest.sha256),
    record("source_inventory", inventory.sha256),
  ]);
}

// ---------------------------------------------------------------------------
// The reproduced classification
// ---------------------------------------------------------------------------

export interface LegendaryClassificationCensus {
  classifiedObjectPaths: number;
  tierCounts: Partial<Record<EvidenceTier, number>>;
  roleCounts: Record<string, number>;
}

/**
 * What this evidence would actually classify, decided the way the planner
 * decides it.
 *
 * `candidatesByObjectPath` + `resolveRoleForUrl` are the planner's own two
 * steps, called here rather than reimplemented. A private reimplementation would
 * let the gate pass a plan the planner then classified differently — the gate
 * asserting agreement with itself instead of with the run it is guarding.
 */
export function reproduceLegendaryClassification(
  sets: readonly PackageEvidenceSet[],
): LegendaryClassificationCensus {
  const census: LegendaryClassificationCensus = {
    classifiedObjectPaths: 0,
    tierCounts: {},
    roleCounts: {},
  };
  for (const [, candidates] of candidatesByObjectPath(sets)) {
    const decision = resolveRoleForUrl(candidates);
    if (!decision.role || !decision.winner) continue;
    census.classifiedObjectPaths += 1;
    census.tierCounts[decision.winner.tier] = (census.tierCounts[decision.winner.tier] ?? 0) + 1;
    census.roleCounts[decision.role] = (census.roleCounts[decision.role] ?? 0) + 1;
  }
  return census;
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export interface LegendaryEvidenceFailure {
  reason: string;
  detail: string;
}

export interface AssessLegendaryEvidenceInput {
  /** Package directories whose payload names Legendary. Basenames only. */
  packageRefs: readonly string[];
  discovery: LegendaryEvidenceDiscovery | null;
  /** Legendary's resolved evidence, exactly as the planner will resolve it. */
  evidenceSets: readonly PackageEvidenceSet[];
  /**
   * A digest recorded at review time, when the operator has one.
   *
   * Optional by design: the first plan run is what establishes it, and demanding
   * it before it exists would make the gate impossible to satisfy the first
   * time. Once supplied it is binding.
   */
  expectedEvidenceDigest?: string | null;
}

export interface LegendaryEvidenceAssessment {
  complete: boolean;
  failures: LegendaryEvidenceFailure[];
  evidenceDigest: string | null;
  census: LegendaryClassificationCensus | null;
}

function shortfall(
  observed: Record<string, number> | Partial<Record<string, number>>,
  required: Readonly<Record<string, number>> | Readonly<Partial<Record<string, number>>>,
): string[] {
  const missing: string[] = [];
  for (const key of Object.keys(required).sort()) {
    const need = (required as Record<string, number>)[key] ?? 0;
    const have = (observed as Record<string, number>)[key] ?? 0;
    if (have < need) missing.push(`${key}: ${have} of ${need}`);
  }
  return missing;
}

/**
 * Assess, without throwing, so a report can print every reason at once.
 *
 * An operator who is told only the first of four problems fixes it, re-runs, and
 * is told the second. Every failure that can be established from the inputs is
 * established.
 */
export function assessLegendaryEvidence(
  input: AssessLegendaryEvidenceInput,
): LegendaryEvidenceAssessment {
  const failures: LegendaryEvidenceFailure[] = [];

  if (input.packageRefs.length === 0) {
    return {
      complete: false,
      failures: [
        {
          reason: "package_missing",
          detail:
            `No package directory identifying itself as ${LEGENDARY_SLUG} was supplied. Its two ` +
            `side tables are the only local record of what its 40 published objects depict; ` +
            `without them 15 LIFESTYLE photographs stay publicly visible.`,
        },
      ],
      evidenceDigest: null,
      census: null,
    };
  }
  if (input.packageRefs.length > 1) {
    failures.push({
      reason: "package_ambiguous",
      detail:
        `${input.packageRefs.length} package directories claim ${LEGENDARY_SLUG} ` +
        `(${[...input.packageRefs].sort().join(", ")}). Which one supplies the side tables would ` +
        `then depend on directory order.`,
    });
  }

  const discovery = input.discovery;
  if (!discovery) {
    return {
      complete: false,
      failures: [
        ...failures,
        {
          reason: "evidence_unreadable",
          detail: `The ${LEGENDARY_SLUG} package could not be read for evidence.`,
        },
      ],
      evidenceDigest: null,
      census: null,
    };
  }

  for (const entry of discovery.malformed) {
    failures.push({
      reason: "evidence_malformed",
      detail: `${entry.packageItemFile} is ${entry.kind}-shaped but ${entry.detail}. A reader would skip the bad records silently and classify fewer rows.`,
    });
  }
  for (const entry of discovery.foreignManifests) {
    failures.push({
      reason: "evidence_cross_project",
      detail:
        `${entry.packageItemFile} is an extracted media manifest for "${entry.projectSlug}", not ` +
        `${LEGENDARY_SLUG}. Evidence about another project inside this package makes every join ` +
        `built from this directory unverifiable.`,
    });
  }
  if (discovery.manifests.length === 0) {
    failures.push({
      reason: "extracted_media_manifest_missing",
      detail:
        `No extracted media manifest naming ${LEGENDARY_SLUG} was found in the package. This is ` +
        `the table that addresses each published object by its derivative_sha256; without it the ` +
        `reader falls back to folder convention and classifies 16 of 40.`,
    });
  }
  if (discovery.manifests.length > 1) {
    failures.push({
      reason: "extracted_media_manifest_ambiguous",
      detail:
        `${discovery.manifests.length} DIFFERENT extracted media manifests name ${LEGENDARY_SLUG} ` +
        `(${discovery.manifests.map((entry) => entry.packageItemFile).join(", ")}). The reader ` +
        `takes the first it visits, so which roles are proposed would depend on traversal order.`,
    });
  }
  if (discovery.inventories.length === 0) {
    failures.push({
      reason: "source_inventory_missing",
      detail:
        `No media source inventory was found in the package. This is the table that maps each ` +
        `object back to the developer's own folder — 000_LIFESTYLE among them — and without it ` +
        `the manifest alone classifies nothing.`,
    });
  }
  if (discovery.inventories.length > 1) {
    failures.push({
      reason: "source_inventory_ambiguous",
      detail:
        `${discovery.inventories.length} DIFFERENT source inventories were found ` +
        `(${discovery.inventories.map((entry) => entry.packageItemFile).join(", ")}). Two tables ` +
        `keyed the same way resolve the same stored_relpath to different folders.`,
    });
  }

  const evidenceDigest = legendaryEvidenceDigest(discovery);
  const expected = (input.expectedEvidenceDigest ?? "").trim();
  if (expected && evidenceDigest && expected !== evidenceDigest) {
    failures.push({
      reason: "evidence_digest_mismatch",
      detail:
        `The Legendary side tables have changed since this run was approved. Expected evidence ` +
        `digest ${expected}, found ${evidenceDigest}. Re-plan and re-review: a regenerated table ` +
        `can move a role without moving anything the operator would notice.`,
    });
  }
  if (expected && !evidenceDigest) {
    failures.push({
      reason: "evidence_digest_mismatch",
      detail:
        `An evidence digest (${expected}) was required, but the two side tables were not both ` +
        `present, so no digest could be computed.`,
    });
  }

  const census = reproduceLegendaryClassification(input.evidenceSets);
  if (census.classifiedObjectPaths < LEGENDARY_ACCEPTED_CLASSIFICATION.classifiedObjectPaths) {
    failures.push({
      reason: "classification_not_reproduced",
      detail:
        `This evidence classifies ${census.classifiedObjectPaths} object path(s); the accepted ` +
        `review classified ${LEGENDARY_ACCEPTED_CLASSIFICATION.classifiedObjectPaths}. ` +
        `A Legendary run must not proceed with a smaller classification than the one that was approved.`,
    });
  }
  const tierShort = shortfall(census.tierCounts, LEGENDARY_ACCEPTED_CLASSIFICATION.tierCounts);
  if (tierShort.length > 0) {
    failures.push({
      reason: "classification_not_reproduced",
      detail: `Evidence-tier shortfall against the accepted review — ${tierShort.join("; ")}.`,
    });
  }
  const roleShort = shortfall(census.roleCounts, LEGENDARY_ACCEPTED_CLASSIFICATION.roleCounts);
  if (roleShort.length > 0) {
    failures.push({
      reason: "classification_not_reproduced",
      detail:
        `Role shortfall against the accepted review — ${roleShort.join("; ")}. ` +
        `Every role short here is an image that stays on a public surface it was accepted out of.`,
    });
  }

  return { complete: failures.length === 0, failures, evidenceDigest, census };
}

/**
 * Read one or more candidate Legendary packages and assess them.
 *
 * The only I/O in the gate, and it is confined to reading JSON out of package
 * directories the operator already named on the command line.
 */
export async function assessLegendaryEvidenceInPackages(input: {
  packageDirectories: readonly string[];
  evidenceSets: readonly PackageEvidenceSet[];
  expectedEvidenceDigest?: string | null;
}): Promise<LegendaryEvidenceAssessment> {
  const directories = [...input.packageDirectories].sort();
  const packageRefs = directories.map((directory) => basename(directory));
  if (directories.length === 0) {
    return assessLegendaryEvidence({
      packageRefs: [],
      discovery: null,
      evidenceSets: input.evidenceSets,
      expectedEvidenceDigest: input.expectedEvidenceDigest,
    });
  }
  // Discovery runs over the FIRST directory only when there is exactly one; with
  // more than one the run is already refused as ambiguous, and reading them all
  // would only decide arbitrarily which contradiction to report.
  const files = await readLegendaryEvidenceInputs(directories[0]);
  return assessLegendaryEvidence({
    packageRefs,
    discovery: discoverLegendaryEvidence(files),
    evidenceSets: input.evidenceSets,
    expectedEvidenceDigest: input.expectedEvidenceDigest,
  });
}

/**
 * The same acceptance, asked of a manifest instead of a package.
 *
 * `execute` and `verify` do not need the packages: the roles they will write are
 * in the manifest, and `manifest_body_digest` already proves the file is the one
 * that was reviewed. What that digest CANNOT say is whether the plan behind it
 * was produced with complete evidence — a manifest generated by an older build,
 * or by this build before the gate existed, is authentic and degraded at the
 * same time. So the manifest is asked the acceptance question directly, and it
 * is asked before the connection for the same reason the package is.
 *
 * This is also why the check does not merely count exceptions: a degraded plan
 * writes its 24 unclassified Legendary rows as perfectly well-formed written
 * exceptions. The exceptions file would look complete. The 15 LIFESTYLE
 * photographs would still be on the page.
 */
export function assessLegendaryManifestProject(input: {
  project: {
    slug: string;
    urls: ReadonlyArray<{ proposed_semantic_role: string | null; evidence_tier: string }>;
    project_totals: { rows_left_role_less: number };
  } | null;
  exceptionsForSlug: number;
}): LegendaryEvidenceAssessment {
  const failures: LegendaryEvidenceFailure[] = [];
  const project = input.project;
  if (!project) {
    return {
      complete: false,
      failures: [
        {
          reason: "classification_not_reproduced",
          detail: `The manifest contains no project ${LEGENDARY_SLUG}, but the run selected it.`,
        },
      ],
      evidenceDigest: null,
      census: null,
    };
  }

  const census: LegendaryClassificationCensus = {
    classifiedObjectPaths: 0,
    tierCounts: {},
    roleCounts: {},
  };
  for (const url of project.urls) {
    if (url.proposed_semantic_role === null) continue;
    census.classifiedObjectPaths += 1;
    const tier = url.evidence_tier as EvidenceTier;
    census.tierCounts[tier] = (census.tierCounts[tier] ?? 0) + 1;
    census.roleCounts[url.proposed_semantic_role] =
      (census.roleCounts[url.proposed_semantic_role] ?? 0) + 1;
  }

  if (census.classifiedObjectPaths < LEGENDARY_ACCEPTED_CLASSIFICATION.classifiedObjectPaths) {
    failures.push({
      reason: "classification_not_reproduced",
      detail:
        `The manifest classifies ${census.classifiedObjectPaths} of ${LEGENDARY_SLUG}'s URLs; the ` +
        `accepted review classified ${LEGENDARY_ACCEPTED_CLASSIFICATION.classifiedObjectPaths}. ` +
        `This plan was built without complete evidence.`,
    });
  }
  if (project.project_totals.rows_left_role_less > 0) {
    failures.push({
      reason: "classification_not_reproduced",
      detail:
        `The manifest leaves ${project.project_totals.rows_left_role_less} ${LEGENDARY_SLUG} row(s) ` +
        `role-less. The accepted review left none: a role-less media row is SHOWN.`,
    });
  }
  if (input.exceptionsForSlug > 0) {
    failures.push({
      reason: "classification_not_reproduced",
      detail:
        `The manifest carries ${input.exceptionsForSlug} written exception(s) for ${LEGENDARY_SLUG}. ` +
        `The accepted review carried none — an exception here excuses a photograph onto the page ` +
        `rather than classifying it off.`,
    });
  }
  const tierShort = shortfall(census.tierCounts, LEGENDARY_ACCEPTED_CLASSIFICATION.tierCounts);
  if (tierShort.length > 0) {
    failures.push({
      reason: "classification_not_reproduced",
      detail: `Evidence-tier shortfall in the manifest — ${tierShort.join("; ")}.`,
    });
  }
  const roleShort = shortfall(census.roleCounts, LEGENDARY_ACCEPTED_CLASSIFICATION.roleCounts);
  if (roleShort.length > 0) {
    failures.push({
      reason: "classification_not_reproduced",
      detail:
        `Role shortfall in the manifest — ${roleShort.join("; ")}. Every role short here is an ` +
        `image left on a public surface the review took it off.`,
    });
  }

  return { complete: failures.length === 0, failures, evidenceDigest: null, census };
}

export function formatLegendaryEvidenceFailure(assessment: LegendaryEvidenceAssessment): string {
  const lines = [
    `Legendary evidence is incomplete. Refusing before any database client is created.`,
    ``,
    `Required, and not satisfied:`,
  ];
  for (const failure of assessment.failures) {
    lines.push(`  - ${failure.reason}: ${failure.detail}`);
  }
  lines.push(``, `The two inputs this project requires:`);
  for (const requirement of LEGENDARY_REQUIRED_EVIDENCE) {
    lines.push(`  - ${requirement.kind} — ${requirement.what}`);
    lines.push(`      ${requirement.why}`);
  }
  if (assessment.census) {
    lines.push(
      ``,
      `Reproduced classification: ${assessment.census.classifiedObjectPaths} object path(s) ` +
        `against the accepted ${LEGENDARY_ACCEPTED_CLASSIFICATION.classifiedObjectPaths}.`,
    );
  }
  lines.push(
    ``,
    `Nothing was contacted, no transaction was opened and no journal or release record exists.`,
  );
  return lines.join("\n");
}

/**
 * The gate itself. Throws `GuardError(legendary_evidence_incomplete)`.
 *
 * Callers place this before the connection is opened, not before the write:
 * `execute --dry-run` opens a real transaction and a run that had already
 * written `run_opened` to a journal has produced release state describing a
 * classification nobody accepted.
 */
export function assertLegendaryEvidenceComplete(assessment: LegendaryEvidenceAssessment): void {
  if (assessment.complete) return;
  throw new GuardError(
    LEGENDARY_EVIDENCE_INCOMPLETE,
    LEGENDARY_EVIDENCE_EXIT_CODE,
    formatLegendaryEvidenceFailure(assessment),
  );
}
