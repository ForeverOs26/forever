/**
 * FOREVER-PR130-STRUCTURED-PURPOSE-BOUNDARY-CORRECTION-001 — structured
 * extraction obeys the Owner-selected window.
 *
 * The Owner says what a file IS by choosing an upload window. A file's CONTENT
 * may validate it inside that window; it may never replace it. These tests pin
 * the boundary for the act that is strongest of all — adopting a structured
 * artifact, which overwrites project-wide state (the price list, the project
 * facts) rather than publishing one file:
 *
 *   - a price-list-shaped JSON under Project Photos, Documents / Legal or
 *     Construction Photos updates NOTHING and stays private with a safe
 *     warning, whether it arrives as a direct file, inside a small inline ZIP,
 *     or inside a large resumable ZIP;
 *   - a project-facts-shaped JSON under Price List updates NOTHING either —
 *     the window that admits a price list does not admit everything;
 *   - Full Project Archive, the one window whose meaning is "unsorted — sort it
 *     for me", still classifies its entries individually and still adopts the
 *     artifacts it finds;
 *   - a stored manifest that predates the explicit-purpose contract keeps its
 *     historical behaviour, and no NEW upload can reach that path.
 *
 * Both transport lanes are exercised against the SAME material, because a ZIP
 * crossing the 16 MiB threshold must not change what its entries are allowed
 * to become.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  admittedStructuredArtifacts,
  archiveEntryRouting,
  declareNewDirectJobFiles,
  looksLikePriceList,
  looksLikeProjectFacts,
  PRIVATE_SOURCE_BUCKET,
  STRUCTURED_PURPOSE_MISMATCH_CODE,
  structuredArtifactAllowed,
  structuredPurposeScopeForArchiveEntry,
  structuredPurposeScopeForFile,
  type StructuredArtifactKind,
} from "../server/extraction";
import { archiveMaterialPurpose } from "../server/large-archive";
import { planJobArchiveUpload, processUploadJob, startUploadJob } from "../server/service";
import {
  STUDIO_MATERIAL_PURPOSES,
  type StudioJobFile,
  type StudioMaterialPurpose,
} from "../studio-types";
import { magicBytesFor, makeWorld, OWNER, type FakeWorld } from "./fakes";
import {
  buildZipParts,
  startArchiveJob,
  uploadArchiveParts,
  type StreamedZipEntry,
} from "./large-archive-fixtures";

const PART = 8 * 1024 * 1024;

/** A real reviewed price list — the exact artifact the price pipeline consumes. */
const PRICE_LIST_JSON = readFileSync(
  resolve(process.cwd(), "forever-data/projects/rainpalm-villas/sip/reviewed-price-list.json"),
  "utf8",
);

/** A project-facts artifact in the shape `looksLikeProjectFacts` recognizes. */
const FACTS_JSON = JSON.stringify({
  name: { value: "Structured Facts Manor", confidence: "high", source_file: "facts.json" },
  developer: { value: "Boundary Estates Co.", confidence: "high", source_file: "facts.json" },
  location: { value: "Kamala, Phuket", confidence: "high", source_file: "facts.json" },
});

/**
 * Real ZIP magic so the inline lane recognizes the container by its BYTES, not
 * by the window it arrived through — a Photos-window `.zip` must expand exactly
 * like a Full-Project-Archive one.
 */
function inlineZipBytes(salt: string): Buffer {
  return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(`::${salt}`)]);
}

/** Windows every one of these tests treats as "must adopt nothing". */
const CLOSED_WINDOWS: readonly StudioMaterialPurpose[] = [
  "project_photo",
  "video",
  "developer_profile",
  "payment_plan",
  "master_plan",
  "floor_plan",
  "unit_plan",
  "map_location",
  "construction_photo",
  "construction_video",
  "document_legal",
  "brochure",
];

/** The observable consequences of a structured artifact being adopted (or not). */
interface StructuredOutcome {
  pricesApplied: boolean;
  unitsApplied: boolean;
  projectName: string;
  developer: string | null;
  mismatchWarning: boolean;
  publishedMedia: number;
}

function structuredOutcome(
  world: FakeWorld,
  result: Awaited<ReturnType<typeof processUploadJob>>,
): StructuredOutcome {
  const project = world.executor.store.projects[0];
  return {
    pricesApplied: world.executor.store.prices.length > 0,
    unitsApplied: world.executor.store.units.length > 0,
    projectName: String(project?.name ?? ""),
    developer: (project?.developer_name_raw as string | null) ?? null,
    mismatchWarning: result.warnings.some(
      (warning) => warning.code === STRUCTURED_PURPOSE_MISMATCH_CODE,
    ),
    publishedMedia: world.executor.store.media.length,
  };
}

/** One direct file, uploaded with the given bytes under the given window. */
async function runDirect(
  world: FakeWorld,
  fileName: string,
  purpose: StudioMaterialPurpose,
  body: string,
  extra: { projectName?: string; siblingPhoto?: boolean } = {},
) {
  const files: Array<{ name: string; materialPurpose: StudioMaterialPurpose }> = [
    { name: fileName, materialPurpose: purpose },
  ];
  if (extra.siblingPhoto) files.push({ name: "sibling.jpg", materialPurpose: "project_photo" });
  const started = await startUploadJob(world.deps, OWNER, {
    workflow: "new_development",
    projectFacts: extra.projectName ? { name: extra.projectName } : undefined,
    files,
  });
  for (const target of started.uploads) {
    world.storage.put(
      target.bucket,
      target.path,
      target.name === fileName ? Buffer.from(body) : magicBytesFor(target.name),
    );
  }
  const result = await processUploadJob(world.deps, OWNER, started.jobId);
  return { jobId: started.jobId, result };
}

/** One small inline ZIP filed under `purpose`, holding a price list + a photo. */
async function runInlineZip(world: FakeWorld, purpose: StudioMaterialPurpose, projectName: string) {
  world.archives.set("package.zip", [
    { name: "prices.json", data: Buffer.from(PRICE_LIST_JSON) },
    { name: "photos/site.jpg", data: magicBytesFor("site.jpg") },
  ]);
  const started = await startUploadJob(world.deps, OWNER, {
    workflow: "new_development",
    projectFacts: { name: projectName },
    files: [{ name: "package.zip", materialPurpose: purpose }],
  });
  for (const target of started.uploads) {
    world.storage.put(target.bucket, target.path, inlineZipBytes(target.name));
  }
  const result = await processUploadJob(world.deps, OWNER, started.jobId);
  return { jobId: started.jobId, result };
}

/** The identical ZIP through the resumable part lane, filed under `purpose`. */
async function runLargeZip(world: FakeWorld, purpose: StudioMaterialPurpose, projectName: string) {
  const entries: StreamedZipEntry[] = [
    { name: "prices.json", data: () => Buffer.from(PRICE_LIST_JSON) },
    { name: "photos/site.jpg", data: () => magicBytesFor("site.jpg") },
  ];
  const { parts, totalSize } = buildZipParts(entries, PART);
  const jobId = await startArchiveJob(world, OWNER, { projectFacts: { name: projectName } });
  await uploadArchiveParts(world, OWNER, jobId, "package.zip", parts, totalSize, {
    materialPurpose: purpose,
  });
  let result = await processUploadJob(world.deps, OWNER, jobId);
  for (let slice = 0; slice < 40 && result.status === "processing"; slice += 1) {
    result = await processUploadJob(world.deps, OWNER, jobId);
  }
  return { jobId, result };
}

async function jobFile(world: FakeWorld, jobId: string, name: string): Promise<StudioJobFile> {
  const job = await world.data.getJob(jobId);
  const found = job?.files.find((file) => file.name === name);
  if (!found) throw new Error(`no manifest entry for ${name}`);
  return found;
}

/**
 * Rewrite a job's STORED manifest into what a row written before the explicit
 * -purpose contract reads back as. `getJob` returns a structuredClone, so
 * stripping the fields from its RESULT would leave the real manifest purposed
 * and the legacy path would never run.
 */
function stripStoredPurposes(world: FakeWorld, jobId: string): void {
  const stored = world.data.jobs.get(jobId);
  if (!stored) throw new Error("job missing");
  stored.files = stored.files.map((file) => {
    const legacy = { ...file };
    delete (legacy as Partial<StudioJobFile>).materialPurpose;
    delete (legacy as Partial<StudioJobFile>).purposeSource;
    return legacy;
  });
}

// ---------------------------------------------------------------------------
// The matrix itself
// ---------------------------------------------------------------------------

describe("structured-purpose matrix", () => {
  it("admits a price list ONLY from the Price List window, and no facts with it", () => {
    const scope = { purpose: "price_list" as const, purposeSource: "owner_selected" as const };
    expect(structuredArtifactAllowed(scope, "price_list")).toBe(true);
    // The window that says "this is the price list" does not say "this is
    // anything structured at all": facts still may not be rewritten from here.
    expect(structuredArtifactAllowed(scope, "project_facts")).toBe(false);
  });

  it("admits BOTH artifacts inside a Full Project Archive, and only there", () => {
    const direct = {
      purpose: "project_archive" as const,
      purposeSource: "owner_selected" as const,
    };
    const entry = { purpose: null, purposeSource: "archive_entry_classifier" as const };
    for (const scope of [direct, entry]) {
      expect(structuredArtifactAllowed(scope, "price_list")).toBe(true);
      expect(structuredArtifactAllowed(scope, "project_facts")).toBe(true);
    }
  });

  it("admits NOTHING from every other explicit window, selected or inherited", () => {
    const kinds: StructuredArtifactKind[] = ["price_list", "project_facts"];
    for (const purpose of CLOSED_WINDOWS) {
      for (const purposeSource of ["owner_selected", "inherited_explicit_window"] as const) {
        const admitted = admittedStructuredArtifacts({ purpose, purposeSource });
        expect(admitted.size, `${purpose}/${purposeSource}`).toBe(0);
        for (const kind of kinds) {
          expect(
            structuredArtifactAllowed({ purpose, purposeSource }, kind),
            `${purpose}/${purposeSource}/${kind}`,
          ).toBe(false);
        }
      }
    }
    // Every purpose is accounted for: the closed list plus the two that admit.
    expect(new Set([...CLOSED_WINDOWS, "price_list", "project_archive"]).size).toBe(
      STUDIO_MATERIAL_PURPOSES.length,
    );
  });

  it("preserves the legacy fallback for material with no explicit window at all", () => {
    const legacy = { purpose: null, purposeSource: "filename_fallback" as const };
    expect(structuredArtifactAllowed(legacy, "price_list")).toBe(true);
    expect(structuredArtifactAllowed(legacy, "project_facts")).toBe(true);
  });

  it("fails CLOSED when an explicit source carries no recorded purpose", () => {
    for (const purposeSource of ["owner_selected", "inherited_explicit_window"] as const) {
      expect(admittedStructuredArtifacts({ purpose: null, purposeSource }).size).toBe(0);
    }
  });

  it("derives an archive entry's scope from the SAME decision that gave it its category", () => {
    // Full Project Archive: the classifier routes, and no per-entry purpose is
    // invented (the Owner filed the package, not the entry).
    const sorted = structuredPurposeScopeForArchiveEntry("project_archive", "prices.json");
    expect(sorted).toEqual({ purpose: null, purposeSource: "archive_entry_classifier" });
    expect(archiveEntryRouting("project_archive", "prices.json").purposeSource).toBe(
      "archive_entry_classifier",
    );
    // Any other window is inherited, unchanged, by every entry.
    const inherited = structuredPurposeScopeForArchiveEntry("project_photo", "prices.json");
    expect(inherited).toEqual({
      purpose: "project_photo",
      purposeSource: "inherited_explicit_window",
    });
    expect(archiveEntryRouting("project_photo", "prices.json").category).toBe("photo");
  });

  it("proves the shape detectors WOULD have fired on these fixtures", () => {
    // Without this the refusals below could pass vacuously.
    expect(looksLikePriceList(JSON.parse(PRICE_LIST_JSON))).toBe(true);
    expect(looksLikeProjectFacts(JSON.parse(FACTS_JSON))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Direct files
// ---------------------------------------------------------------------------

describe("structured purpose — direct files", () => {
  it("1. adopts a price list uploaded under the Price List window", async () => {
    const world = makeWorld();
    const { result } = await runDirect(world, "prices.json", "price_list", PRICE_LIST_JSON, {
      projectName: "Price Window",
    });
    expect(result.status).toBe("completed");
    const outcome = structuredOutcome(world, result);
    expect(outcome.pricesApplied).toBe(true);
    expect(outcome.unitsApplied).toBe(true);
    expect(outcome.mismatchWarning).toBe(false);
  });

  it("2. does NOT adopt a price list uploaded under Project Photos", async () => {
    const world = makeWorld();
    const { jobId, result } = await runDirect(
      world,
      "prices.json",
      "project_photo",
      PRICE_LIST_JSON,
      { projectName: "Photo Window" },
    );
    expect(result.status).toBe("completed");
    const outcome = structuredOutcome(world, result);
    expect(outcome.pricesApplied).toBe(false);
    expect(outcome.unitsApplied).toBe(false);
    expect(outcome.mismatchWarning).toBe(true);
    // Not silently moved to another category either.
    const file = await jobFile(world, jobId, "prices.json");
    expect(file.materialPurpose).toBe("project_photo");
    expect(file.category).toBe("photo");
    expect(file.publicPath ?? null).toBeNull();
  });

  it("3. does NOT adopt a price list uploaded under Documents / Legal", async () => {
    const world = makeWorld();
    const { jobId, result } = await runDirect(
      world,
      "prices.json",
      "document_legal",
      PRICE_LIST_JSON,
      { projectName: "Documents Window" },
    );
    expect(result.status).toBe("completed");
    expect(structuredOutcome(world, result).pricesApplied).toBe(false);
    expect(structuredOutcome(world, result).mismatchWarning).toBe(true);
    expect((await jobFile(world, jobId, "prices.json")).category).toBe("legal-document");
  });

  it("2b. does NOT adopt a price list uploaded under Construction Photos", async () => {
    const world = makeWorld();
    const { result } = await runDirect(
      world,
      "prices.json",
      "construction_photo",
      PRICE_LIST_JSON,
      { projectName: "Construction Window" },
    );
    expect(result.status).toBe("completed");
    expect(structuredOutcome(world, result).pricesApplied).toBe(false);
    expect(structuredOutcome(world, result).mismatchWarning).toBe(true);
  });

  it("2c. refuses a price list from EVERY other explicit window, end to end", async () => {
    for (const purpose of CLOSED_WINDOWS) {
      const world = makeWorld();
      const { result } = await runDirect(world, "prices.json", purpose, PRICE_LIST_JSON, {
        projectName: `Window ${purpose}`,
      });
      expect(result.status, purpose).toBe("completed");
      const outcome = structuredOutcome(world, result);
      expect(outcome.pricesApplied, purpose).toBe(false);
      expect(outcome.unitsApplied, purpose).toBe(false);
      expect(outcome.mismatchWarning, purpose).toBe(true);
    }
  });

  it("4. does NOT adopt project facts uploaded under the Price List window", async () => {
    const world = makeWorld();
    const { result } = await runDirect(world, "project-facts.json", "price_list", FACTS_JSON, {
      projectName: "Owner Typed Name",
    });
    expect(result.status).toBe("completed");
    const outcome = structuredOutcome(world, result);
    // Neither the facts nor the derived identity crossed the boundary.
    expect(outcome.developer).toBeNull();
    expect(outcome.projectName).toBe("Owner Typed Name");
    expect(outcome.mismatchWarning).toBe(true);
    expect(outcome.pricesApplied).toBe(false);
  });

  it("4b. DOES adopt project facts uploaded under Full Project Archive (positive control)", async () => {
    // The refusal above is about the WINDOW, not about facts adoption being
    // switched off: the same bytes still work where the Owner asked Studio to
    // sort the material for them.
    const world = makeWorld();
    const { result } = await runDirect(world, "project-facts.json", "project_archive", FACTS_JSON);
    expect(result.status).toBe("completed");
    const outcome = structuredOutcome(world, result);
    expect(outcome.developer).toBe("Boundary Estates Co.");
    expect(outcome.projectName).toBe("Structured Facts Manor");
    expect(outcome.mismatchWarning).toBe(false);
  });

  it("still publishes a normal image under Photos and a normal PDF under Payment Plan", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Ordinary Materials" },
      files: [
        { name: "shot.jpg", materialPurpose: "project_photo" },
        { name: "plan.pdf", materialPurpose: "payment_plan" },
      ],
    });
    for (const target of started.uploads) {
      world.storage.put(target.bucket, target.path, magicBytesFor(target.name));
    }
    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("completed");
    // The photo publishes as gallery media; the payment-plan PDF keeps its
    // window and its private handling — unchanged by this correction.
    expect(world.executor.store.media.map((item) => item.media_type)).toEqual(["gallery"]);
    expect((await jobFile(world, started.jobId, "plan.pdf")).category).toBe("payment-plan");
    expect(
      result.warnings.some((warning) => warning.code === STRUCTURED_PURPOSE_MISMATCH_CODE),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Archives — both lanes
// ---------------------------------------------------------------------------

describe("structured purpose — small inline ZIP lane", () => {
  it("5. does NOT adopt a price list inside a ZIP filed under Project Photos", async () => {
    const world = makeWorld();
    const { result } = await runInlineZip(world, "project_photo", "Inline Photos ZIP");
    expect(result.status).toBe("completed");
    const outcome = structuredOutcome(world, result);
    expect(outcome.pricesApplied).toBe(false);
    expect(outcome.unitsApplied).toBe(false);
    expect(outcome.mismatchWarning).toBe(true);
    // 11. the compatible sibling inside the SAME archive still publishes.
    expect(outcome.publishedMedia).toBe(1);
    expect(world.executor.store.media[0].media_type).toBe("gallery");
  });

  it("7. DOES adopt a price list inside a ZIP filed under Full Project Archive", async () => {
    const world = makeWorld();
    const { result } = await runInlineZip(world, "project_archive", "Inline Package ZIP");
    expect(result.status).toBe("completed");
    const outcome = structuredOutcome(world, result);
    expect(outcome.pricesApplied).toBe(true);
    expect(outcome.unitsApplied).toBe(true);
    expect(outcome.mismatchWarning).toBe(false);
    expect(outcome.publishedMedia).toBe(1);
  });

  it("does NOT adopt project facts inside a ZIP filed under Documents / Legal", async () => {
    const world = makeWorld();
    world.archives.set("dossier.zip", [
      { name: "facts.json", data: Buffer.from(FACTS_JSON) },
      { name: "scan.jpg", data: magicBytesFor("scan.jpg") },
    ]);
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Legal ZIP" },
      files: [{ name: "dossier.zip", materialPurpose: "document_legal" }],
    });
    for (const target of started.uploads) {
      world.storage.put(target.bucket, target.path, inlineZipBytes(target.name));
    }
    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("completed");
    const outcome = structuredOutcome(world, result);
    expect(outcome.developer).toBeNull();
    expect(outcome.projectName).toBe("Legal ZIP");
    expect(outcome.mismatchWarning).toBe(true);
  });
});

describe("structured purpose — large resumable ZIP lane", () => {
  it("6. does NOT adopt a price list inside a large ZIP filed under Project Photos", async () => {
    const world = makeWorld();
    const { jobId, result } = await runLargeZip(world, "project_photo", "Large Photos ZIP");
    expect(result.status).toBe("completed");
    const outcome = structuredOutcome(world, result);
    expect(outcome.pricesApplied).toBe(false);
    expect(outcome.unitsApplied).toBe(false);
    expect(outcome.mismatchWarning).toBe(true);
    // 10/11. the artifact settled privately; the sibling photo still published.
    const entries = await world.deps.data.listJobArchiveEntries(jobId);
    const byName = new Map(entries.map((entry) => [entry.entry_name, entry]));
    expect(byName.get("prices.json")?.state).toBe("retained_private");
    expect(byName.get("prices.json")?.outcome_code).toBe(STRUCTURED_PURPOSE_MISMATCH_CODE);
    expect(byName.get("prices.json")?.public_url ?? null).toBeNull();
    // Independently addressable private evidence was still written for it.
    expect(byName.get("prices.json")?.evidence?.bucket).toBe(PRIVATE_SOURCE_BUCKET);
    expect(byName.get("photos/site.jpg")?.state).toBe("published_public");
    expect(outcome.publishedMedia).toBe(1);
    // The archive kept the Owner's window on its durable row.
    const archives = await world.deps.data.listJobArchives(jobId);
    expect(archiveMaterialPurpose(archives[0])).toBe("project_photo");
    expect(archives[0].extracted?.priceList ?? null).toBeNull();
  });

  it("8. DOES adopt a price list inside a large ZIP filed under Full Project Archive", async () => {
    const world = makeWorld();
    const { jobId, result } = await runLargeZip(world, "project_archive", "Large Package ZIP");
    expect(result.status).toBe("completed");
    const outcome = structuredOutcome(world, result);
    expect(outcome.pricesApplied).toBe(true);
    expect(outcome.unitsApplied).toBe(true);
    expect(outcome.mismatchWarning).toBe(false);
    const entries = await world.deps.data.listJobArchiveEntries(jobId);
    const byName = new Map(entries.map((entry) => [entry.entry_name, entry]));
    expect(byName.get("prices.json")?.outcome_code).toBe("price_list_extracted");
    expect(outcome.publishedMedia).toBe(1);
  });
});

describe("structured purpose — the two lanes agree", () => {
  it("9. produces identical structured results for the small and large lanes", async () => {
    for (const purpose of ["project_photo", "project_archive"] as const) {
      const small = makeWorld();
      const large = makeWorld();
      const smallRun = await runInlineZip(small, purpose, "Lane Parity");
      const largeRun = await runLargeZip(large, purpose, "Lane Parity");
      expect(smallRun.result.status, purpose).toBe("completed");
      expect(largeRun.result.status, purpose).toBe("completed");
      expect(structuredOutcome(large, largeRun.result), purpose).toEqual(
        structuredOutcome(small, smallRun.result),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Warning contract, retry/resume, legacy, precedence
// ---------------------------------------------------------------------------

describe("structured purpose — the mismatch warning", () => {
  it("10. is safe: no filename, no Storage path, no database detail, non-blocking", async () => {
    const world = makeWorld();
    const { jobId, result } = await runDirect(
      world,
      "villa-prices-2026.json",
      "project_photo",
      PRICE_LIST_JSON,
      { projectName: "Warning Safety", siblingPhoto: true },
    );
    expect(result.status).toBe("completed");
    const warning = result.warnings.find(
      (entry) => entry.code === STRUCTURED_PURPOSE_MISMATCH_CODE,
    );
    expect(warning).toBeDefined();
    // Says what happened, in the Owner's terms.
    expect(warning!.message).toMatch(/upload window/i);
    expect(warning!.message).toMatch(/retained privately/i);
    // Leaks nothing.
    for (const secret of [
      "villa-prices-2026.json",
      "villa-prices",
      PRIVATE_SOURCE_BUCKET,
      "jobs/",
      "staging",
      "project_media",
      "studio_jobs",
      "select ",
      "insert ",
      "jsonb",
    ]) {
      expect(warning!.message.toLowerCase(), secret).not.toContain(secret.toLowerCase());
    }
    // Non-blocking: the compatible sibling published anyway...
    expect(world.executor.store.media).toHaveLength(1);
    // ...and the refused artifact is still in private staging, byte for byte.
    const file = await jobFile(world, jobId, "villa-prices-2026.json");
    expect(file.stagingBucket).toBe(PRIVATE_SOURCE_BUCKET);
    const stored = world.storage.objects.get(`${file.stagingBucket}/${file.stagingPath}`);
    expect(stored?.toString("utf8")).toBe(PRICE_LIST_JSON);
    // Nothing about it reached a public bucket.
    expect(world.storage.publicKeys("project-documents")).toHaveLength(0);
  });
});

describe("structured purpose — retry and resume", () => {
  it("12. reaches the same result after a failed attempt is retried", async () => {
    const world = makeWorld();
    world.archives.set("package.zip", [
      { name: "prices.json", data: Buffer.from(PRICE_LIST_JSON) },
      { name: "photos/site.jpg", data: magicBytesFor("site.jpg") },
    ]);
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Retry Boundary" },
      files: [{ name: "package.zip", materialPurpose: "project_photo" }],
    });
    for (const target of started.uploads) {
      world.storage.put(target.bucket, target.path, inlineZipBytes(target.name));
    }

    world.data.failAfterIngest = true;
    const failed = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(failed.status).toBe("failed");
    expect(failed.retryable).toBe(true);
    world.data.failAfterIngest = false;

    const retried = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(retried.status).toBe("completed");
    const outcome = structuredOutcome(world, retried);
    expect(outcome.pricesApplied).toBe(false);
    expect(outcome.mismatchWarning).toBe(true);
    expect(outcome.publishedMedia).toBe(1);

    // A duplicate request stays idempotent and does not re-decide anything.
    const again = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(again.status).toBe("completed");
    expect(world.executor.store.projects).toHaveLength(1);
    expect(world.executor.store.prices).toHaveLength(0);
  });

  it("12b. keeps the refusal stable across every slice of a resumed large archive", async () => {
    const world = makeWorld();
    const { jobId, result } = await runLargeZip(world, "document_legal", "Resumed Boundary");
    expect(result.status).toBe("completed");
    expect(structuredOutcome(world, result).pricesApplied).toBe(false);
    const replay = await processUploadJob(world.deps, OWNER, jobId);
    expect(replay.status).toBe("completed");
    expect(world.executor.store.prices).toHaveLength(0);
    expect(world.executor.store.projects).toHaveLength(1);
  });
});

describe("structured purpose — legacy stored data", () => {
  it("13. still adopts from a STORED pre-contract manifest with no window", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Legacy Prices" },
      // Filed under Photos, which a NEW upload would refuse to adopt from...
      files: [{ name: "prices.json", materialPurpose: "project_photo" }],
    });
    for (const target of started.uploads) {
      world.storage.put(target.bucket, target.path, Buffer.from(PRICE_LIST_JSON));
    }
    // ...but the stored row is then rewritten into a pre-contract manifest,
    // which has no window to obey and keeps its historical behaviour.
    stripStoredPurposes(world, started.jobId);
    const stored = await jobFile(world, started.jobId, "prices.json");
    expect(stored.materialPurpose).toBeUndefined();
    expect(structuredPurposeScopeForFile(stored).purposeSource).toBe("filename_fallback");

    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("completed");
    const outcome = structuredOutcome(world, result);
    expect(outcome.pricesApplied).toBe(true);
    expect(outcome.mismatchWarning).toBe(false);
    // Reading the old manifest did not rewrite it into the new shape.
    const after = await jobFile(world, started.jobId, "prices.json");
    expect(after.materialPurpose).toBeUndefined();
    expect(after.purposeSource).toBeUndefined();
  });

  it("14. cannot be reached from ANY newly created direct upload", async () => {
    // Every declared direct file, for every window, is owner_selected — so no
    // new file can present itself to the boundary as legacy data.
    const declared = declareNewDirectJobFiles(
      "job-new",
      STUDIO_MATERIAL_PURPOSES.map((purpose) => ({
        name: "prices.json",
        materialPurpose: purpose,
      })),
    );
    expect(declared).toHaveLength(STUDIO_MATERIAL_PURPOSES.length);
    for (const file of declared) {
      const scope = structuredPurposeScopeForFile(file);
      expect(scope.purposeSource, String(file.materialPurpose)).toBe("owner_selected");
      expect(scope.purpose, String(file.materialPurpose)).toBe(file.materialPurpose);
    }
    // A new file with no window is refused outright, so "no purpose" can never
    // be created — it can only be read back from pre-contract storage.
    await expect(
      startUploadJob(makeWorld().deps, OWNER, {
        workflow: "new_development",
        projectFacts: { name: "No Window" },
        files: [{ name: "prices.json", materialPurpose: undefined as never }],
      }),
    ).rejects.toMatchObject({ code: "material_purpose_required" });

    // The resumable lane is closed the same way: a planned archive always
    // records a window, so its entries never inherit "no window".
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER, { projectFacts: { name: "Planned" } });
    await expect(
      planJobArchiveUpload(world.deps, OWNER, {
        jobId,
        fileName: "package.zip",
        declaredSize: 1024,
        materialPurpose: undefined as never,
        partSha256: ["0".repeat(64)],
      }),
    ).rejects.toMatchObject({ code: "material_purpose_required" });
  });
});

describe("structured purpose — Owner values keep precedence", () => {
  it("15. keeps a manually entered name and developer over an ADMITTED artifact", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Owner Chosen Name", developerName: "Owner Chosen Developer" },
      // The one direct window that DOES admit a facts artifact.
      files: [{ name: "project-facts.json", materialPurpose: "project_archive" }],
    });
    for (const target of started.uploads) {
      world.storage.put(target.bucket, target.path, Buffer.from(FACTS_JSON));
    }
    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    expect(result.status).toBe("completed");
    const project = world.executor.store.projects[0];
    // The artifact was admitted, yet the Owner's typed values still win.
    expect(project.name).toBe("Owner Chosen Name");
    expect(project.developer_name_raw).toBe("Owner Chosen Developer");
    const provenance = JSON.stringify(project.field_provenance ?? {});
    expect(provenance).toContain("owner_provided");
  });
});
