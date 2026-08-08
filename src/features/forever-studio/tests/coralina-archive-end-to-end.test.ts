/**
 * The Coralina package, end to end, through the reopened archive lane.
 *
 * WHAT THIS FIXTURE IS
 * --------------------
 * The REAL folder and file names of The Title Coralina Kamala's official
 * package — `11. Perspective/…`, `12. Photo of Show Units/Show Unit @Bangtao/…`,
 * `4. Master Plan/…` and the rest — with synthetic bytes. The paths are what
 * decide routing, so they are exact; the bytes only have to be the right KIND
 * and the right SIZE BAND, so they are generated.
 *
 * The two large-file bands are reproduced faithfully, not literally: an entry
 * is "large" when its UNCOMPRESSED size crosses `maxFileBytes` (24 MiB), which
 * is the single branch Coralina's 151.4 MiB Master Plan PDF, its 36.1/31.5 MiB
 * Floor Plan PDFs, its 26.6 MiB Unit Plan PDF and its 86.2 MiB video all take.
 * The fixture crosses that threshold with entries that deflate well, so the
 * branch is genuinely exercised without a 300 MiB test buffer. Sizes above the
 * threshold differ only in how many evidence parts get written.
 *
 * WHAT IT PROVES
 * --------------
 *   - `Show Unit @Bangtao` never reaches composed public media, and is retained
 *     with a manual-review reason the Owner can act on;
 *   - `Show Unit @Kamala` stays eligible and publishes;
 *   - the second price list is detected and NOT reapplied;
 *   - master plan / floor plan / unit plan / map route to their own categories;
 *   - every over-limit entry is private, with independently retrievable
 *     evidence and a truthful warning — including the video;
 *   - the official documents that used to fall into `unknown` are recognized;
 *   - a retry creates no second job;
 *   - nothing is published: the project lands as an unpublished draft;
 *   - and the whole job finishes through the SCHEDULED runner alone, with the
 *     browser gone after the upload.
 *
 * Nothing here contacts production, staging, real R2 or any real Coralina file.
 */

import { describe, expect, it } from "vitest";

import { runScheduledStudioTick } from "../server/service";
import { composeArchiveMaterials, buildJobProgress } from "../server/large-archive";
import { MANUAL_REVIEW_LOCATION_CONFLICT } from "../server/entry-association";
import {
  confirmJobArchiveUpload,
  planJobArchiveUpload,
  processUploadJob,
  startUploadJob,
} from "../server/service";
import { ARCHIVE_PART_BYTES } from "../studio-types";
import { buildZipParts, manifestForParts, patternBytes } from "./large-archive-fixtures";
import { assertLocalR2Endpoint } from "./local-r2";
import { withWorkerRuntime } from "./local-r2-binding";
import { magicBytesFor, makeWorld, OWNER, TEST_R2_BUCKETS, type FakeWorld } from "./fakes";

const PROJECT_NAME = "The Title Coralina Kamala";
const PROJECT_LOCATION = "Kamala, Phuket";

/** Just over `maxFileBytes` (24 MiB) — the streaming-evidence branch. */
const OVER_LIMIT = 25 * 1024 * 1024;

/**
 * A real, decodable synthetic file of whatever kind the NAME implies, salted by
 * that name so no two entries collide with the duplicate detector.
 *
 * `magicBytesFor` is what the rest of the suite publishes with, so an image
 * here really does survive the public sanitizer — the difference between
 * "published" and "retained" in these assertions is the routing decision under
 * test, never a fixture that failed to decode.
 */
function small(name: string): Buffer {
  return magicBytesFor(name);
}

/**
 * The same file, grown past `maxFileBytes` so it takes the streaming-evidence
 * branch. The real magic bytes stay at the head, so the recorded media class is
 * the true one; the padding is one incompressible block repeated, which crosses
 * the size threshold while staying inside the 200:1 compression-ratio guard.
 */
function large(name: string): Buffer {
  const head = magicBytesFor(name);
  const seed = [...name].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
  const block = patternBytes(200 * 1024, seed);
  const copies = Math.ceil((OVER_LIMIT - head.length) / block.length);
  return Buffer.concat([head, ...Array.from({ length: copies }, () => block)], OVER_LIMIT);
}

/** The Coralina package, by its real paths. */
const CORALINA_ENTRIES = [
  // 11. Perspective — renders
  {
    name: "11. Perspective/Exterior/SKY POOL.jpg",
    data: () => small("11. Perspective/Exterior/SKY POOL.jpg"),
    method: 8 as const,
  },
  {
    name: "11. Perspective/Interior/GRAND LOBBY.jpg",
    data: () => small("11. Perspective/Interior/GRAND LOBBY.jpg"),
    method: 8 as const,
  },
  // 12. Photo of Show Units — @Kamala belongs, @Bangtao is another showroom
  {
    name: "12. Photo of Show Units/Show Unit @Kamala/1 BR L 41 sqm/_DSC6667.jpg",
    data: () => small("12. Photo of Show Units/Show Unit @Kamala/1 BR L 41 sqm/_DSC6667.jpg"),
    method: 8 as const,
  },
  {
    name: "12. Photo of Show Units/Show Unit @Bangtao/1BR M-31/1BR31 -  (1).jpg",
    data: () => small("12. Photo of Show Units/Show Unit @Bangtao/1BR M-31/1BR31 -  (1).jpg"),
    method: 8 as const,
  },
  {
    name: "12. Photo of Show Units/Show Unit @Bangtao/2BR1-64/2BR64 -  (1).jpg",
    data: () => small("12. Photo of Show Units/Show Unit @Bangtao/2BR1-64/2BR64 -  (1).jpg"),
    method: 8 as const,
  },
  // 4. Master Plan — JPG sheets publish, the 151.4 MiB PDF cannot
  {
    name: "4. Master Plan/JPG/20251009_Coralina_Master Plan-09.jpg",
    data: () => small("4. Master Plan/JPG/20251009_Coralina_Master Plan-09.jpg"),
    method: 8 as const,
  },
  {
    name: "4. Master Plan/Coralina Master Plan.pdf",
    data: () => large("4. Master Plan/Coralina Master Plan.pdf"),
    method: 8 as const,
  },
  // 5. Floor Plan — per-building JPGs publish, both large PDFs cannot
  {
    name: "5. Floor Plan/JPG/A/Coralina_Floor Plan_Part 1-08.jpg",
    data: () => small("5. Floor Plan/JPG/A/Coralina_Floor Plan_Part 1-08.jpg"),
    method: 8 as const,
  },
  {
    name: "5. Floor Plan/PDF/Coralina Floor Plan Part 1.pdf",
    data: () => large("5. Floor Plan/PDF/Coralina Floor Plan Part 1.pdf"),
    method: 8 as const,
  },
  {
    name: "5. Floor Plan/PDF/Coralina Floor Plan Part 2.pdf",
    data: () => large("5. Floor Plan/PDF/Coralina Floor Plan Part 2.pdf"),
    method: 8 as const,
  },
  // 6. Unit Plan — type sheets publish, the 26.6 MiB PDF cannot
  {
    name: "6. Unit Plan/JPG/2 Bedroom/20251014_Coralina_Unit Plan_Part3-17.jpg",
    data: () => small("6. Unit Plan/JPG/2 Bedroom/20251014_Coralina_Unit Plan_Part3-17.jpg"),
    method: 8 as const,
  },
  {
    name: "6. Unit Plan/PDF/Coralina_Unit Plan_Part4.pdf",
    data: () => large("6. Unit Plan/PDF/Coralina_Unit Plan_Part4.pdf"),
    method: 8 as const,
  },
  // 9. Map
  {
    name: "9. Map/CORALINA Map 1.jpeg",
    data: () => small("9. Map/CORALINA Map 1.jpeg"),
    method: 8 as const,
  },
  // 8. Living Service + the loose facilities deck — official documents that
  // used to classify as `unknown`
  {
    name: "8. Living Service/THE ESQUIRE Living Services.pdf",
    data: () => small("8. Living Service/THE ESQUIRE Living Services.pdf"),
    method: 8 as const,
  },
  {
    name: "Coralina Facilities.pdf",
    data: () => small("Coralina Facilities.pdf"),
    method: 8 as const,
  },
  // Video — classified, but Forever publishes no video yet
  {
    name: "20260401 Coralina Facilities.mp4",
    data: () => large("20260401 Coralina Facilities.mp4"),
    method: 8 as const,
  },
  // The price list, and the SECOND one that must not be reapplied
  {
    name: "CLK - Price List V.2. - Updated 17.07.26.pdf",
    data: () => small("CLK - Price List V.2. - Updated 17.07.26.pdf"),
    method: 8 as const,
  },
  {
    name: "CLK - Master Plan Price list V.2 - updated 17.07.26.pdf",
    data: () => small("CLK - Master Plan Price list V.2 - updated 17.07.26.pdf"),
    method: 8 as const,
  },
];

const BANGTAO_ENTRIES = CORALINA_ENTRIES.filter((entry) => entry.name.includes("@Bangtao")).map(
  (entry) => entry.name,
);
const OVER_LIMIT_ENTRIES = [
  "4. Master Plan/Coralina Master Plan.pdf",
  "5. Floor Plan/PDF/Coralina Floor Plan Part 1.pdf",
  "5. Floor Plan/PDF/Coralina Floor Plan Part 2.pdf",
  "6. Unit Plan/PDF/Coralina_Unit Plan_Part4.pdf",
  "20260401 Coralina Facilities.mp4",
];

function workerWorld(): FakeWorld {
  const world = makeWorld({ r2Runtime: "worker" });
  assertLocalR2Endpoint(world.r2.endpoint);
  world.flags.writeProvider = "r2";
  return world;
}

/**
 * Upload the package exactly as a browser does — plan, PUT every part through
 * its own presigned target, confirm — and then GO AWAY.
 */
async function uploadCoralinaPackage(world: FakeWorld) {
  const built = buildZipParts(CORALINA_ENTRIES, ARCHIVE_PART_BYTES);
  const partSha256 = manifestForParts(built.parts);

  const started = await withWorkerRuntime(world.workerR2.env, () =>
    startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: PROJECT_NAME, locationText: PROJECT_LOCATION },
      files: [],
    }),
  );

  const plan = await withWorkerRuntime(world.workerR2.env, () =>
    planJobArchiveUpload(world.deps, OWNER, {
      jobId: started.jobId,
      fileName: "Coralina Full Package.zip",
      declaredSize: built.totalSize,
      materialPurpose: "project_archive",
      partSha256,
    }),
  );

  for (const target of plan.parts) {
    const transport = target.transport!;
    if (transport.kind !== "r2_presigned_put") throw new Error("expected an R2 presigned target");
    const response = await world.r2.fetchImpl(transport.url, {
      method: "PUT",
      headers: transport.headers,
      body: new Uint8Array(built.parts[target.index]) as unknown as BodyInit,
    });
    expect(response.ok).toBe(true);
  }

  const confirmed = await withWorkerRuntime(world.workerR2.env, () =>
    confirmJobArchiveUpload(world.deps, OWNER, {
      jobId: started.jobId,
      archiveId: plan.archiveId,
      partSha256,
    }),
  );
  expect(confirmed.accepted).toBe(true);

  // The ONE explicit processing request a browser makes — the durable
  // readiness marker plus the first slice. A package this size cannot finish
  // inside it, which is exactly the point: the browser closes here.
  const first = await withWorkerRuntime(world.workerR2.env, () =>
    processUploadJob(world.deps, OWNER, started.jobId),
  );
  expect(first.status).toBe("processing");

  return { jobId: started.jobId, archiveId: plan.archiveId, built };
}

/**
 * Drive the job to completion using ONLY the scheduled runner.
 *
 * No `processUploadJob`, no dashboard poll, no authenticated caller of any
 * kind — the browser is gone.
 */
async function finishOnScheduledTicks(world: FakeWorld, jobId: string): Promise<number> {
  let ticks = 0;
  for (;;) {
    ticks += 1;
    if (ticks > 60) throw new Error("scheduled ticks did not finish the Coralina job");
    const summary = await withWorkerRuntime(world.workerR2.env, () =>
      runScheduledStudioTick(world.deps, { maxSlices: 3 }),
    );
    world.advanceMinutes(5); // cron cadence between invocations
    if (summary.completed > 0) break;
  }
  const job = await world.deps.data.getJob(jobId);
  expect(job!.status).toBe("published");
  return ticks;
}

interface Settled {
  byName: Map<
    string,
    { state: string; code: string | null; evidence: unknown; sha: string | null }
  >;
}

async function settledEntries(world: FakeWorld, jobId: string): Promise<Settled> {
  const entries = await world.deps.data.listJobArchiveEntries(jobId);
  const byName = new Map<
    string,
    { state: string; code: string | null; evidence: unknown; sha: string | null }
  >();
  for (const entry of entries) {
    byName.set(entry.entry_name, {
      state: entry.state,
      code: entry.outcome_code,
      evidence: entry.evidence ?? null,
      sha: entry.sha256 ?? null,
    });
  }
  return { byName };
}

describe("the Coralina package through the archive lane, on a Worker", () => {
  it("routes every category, quarantines the foreign showroom, and never publishes", async () => {
    const world = workerWorld();
    // The extractor succeeds for EVERY price-list PDF it is handed. That is
    // the point: deciding that the second one must not be applied is Forever's
    // job, not the extractor's, so the extractor is deliberately willing.
    //
    // Keyed on nothing — archive entries carry a neutral `entry N (category)`
    // label rather than their filename, so there is no filename to key on.
    world.deps.extractPriceListPdf = async () => ({
      priceList: { rows: [{ unit_code: "A-101", price: 5236272 }] } as never,
      warnings: [],
    });

    const { jobId, archiveId } = await uploadCoralinaPackage(world);

    // --- nothing has been written to the project yet -----------------------
    expect(world.executor.store.projects).toEqual([]);

    const ticks = await finishOnScheduledTicks(world, jobId);
    // `ticks` is only informative — one tick may legitimately carry several
    // slices. What matters is already proven above: the browser's single
    // request came back `processing`, and every byte after it was routed with
    // no authenticated caller in sight.
    expect(ticks).toBeGreaterThanOrEqual(1);

    const job = await world.deps.data.getJob(jobId);
    expect(job!.status).toBe("published");

    const { byName } = await settledEntries(world, jobId);

    // --- 1. the foreign showroom ------------------------------------------
    for (const name of BANGTAO_ENTRIES) {
      const entry = byName.get(name)!;
      expect(entry, name).toBeDefined();
      expect(entry.state, name).toBe("retained_private");
      expect(entry.code, name).toBe(MANUAL_REVIEW_LOCATION_CONFLICT);
      // Retained means retained: the Owner can still look at it and decide.
      expect(entry.evidence, name).toBeTruthy();
    }

    // --- 2. the showroom that DOES belong ---------------------------------
    const kamala = byName.get(
      "12. Photo of Show Units/Show Unit @Kamala/1 BR L 41 sqm/_DSC6667.jpg",
    )!;
    expect(kamala.state).toBe("published_public");

    // --- 3. plans and renders route to their own categories ---------------
    for (const name of [
      "11. Perspective/Exterior/SKY POOL.jpg",
      "11. Perspective/Interior/GRAND LOBBY.jpg",
      "4. Master Plan/JPG/20251009_Coralina_Master Plan-09.jpg",
      "5. Floor Plan/JPG/A/Coralina_Floor Plan_Part 1-08.jpg",
      "6. Unit Plan/JPG/2 Bedroom/20251014_Coralina_Unit Plan_Part3-17.jpg",
      "9. Map/CORALINA Map 1.jpeg",
    ]) {
      expect(byName.get(name)!.state, name).toBe("published_public");
    }

    // --- 4. over-limit entries: private, with retrievable evidence ---------
    for (const name of OVER_LIMIT_ENTRIES) {
      const entry = byName.get(name)!;
      expect(entry.state, name).toBe("retained_private");
      expect(entry.code, name).toBe("entry_over_size_limit");
      // "Independently retrievable" is the whole claim — evidence parts exist
      // and the server observed the bytes' own digest.
      expect(entry.evidence, name).toBeTruthy();
      expect(entry.sha, name).toMatch(/^[0-9a-f]{64}$/);
    }

    // --- 5. the official documents are recognized, not `unknown` ----------
    for (const name of [
      "8. Living Service/THE ESQUIRE Living Services.pdf",
      "Coralina Facilities.pdf",
    ]) {
      const entry = byName.get(name)!;
      expect(entry.state, name).toBe("retained_private");
      expect(entry.code, name).toBe("document_retained_private");
    }

    // --- 6. the repeated price list is detected and not reapplied ----------
    // Deliberately order-independent: WHICH of the two the archive reaches
    // first is the ZIP's business, and pinning it would test the fixture's
    // ordering rather than the rule. What must hold is that exactly one is
    // applied and the other is explicitly refused as a repeat.
    const priceListNames = [
      "CLK - Price List V.2. - Updated 17.07.26.pdf",
      "CLK - Master Plan Price list V.2 - updated 17.07.26.pdf",
    ];
    const priceListOutcomes = priceListNames.map((name) => byName.get(name)!);
    for (const [index, outcome] of priceListOutcomes.entries()) {
      expect(outcome, priceListNames[index]).toBeDefined();
      // Neither is ever published: a price list is source material.
      expect(outcome.state, priceListNames[index]).toBe("retained_private");
    }
    expect(priceListOutcomes.filter((o) => o.code === "price_list_extracted")).toHaveLength(1);
    expect(priceListOutcomes.filter((o) => o.code === "price_list_duplicate_ignored")).toHaveLength(
      1,
    );
    const adoptedName =
      priceListNames[priceListOutcomes.findIndex((o) => o.code === "price_list_extracted")];

    // --- 7. composed public media excludes Bangtao entirely ---------------
    const composed = await composeArchiveMaterials(world.deps, job!, 0);
    const composedUrls = composed.media.map((item) => item.url).join(" ");
    for (const name of BANGTAO_ENTRIES) {
      const entry = byName.get(name)!;
      expect(entry.sha).toBeTruthy();
      // No public object anywhere carries those bytes.
      expect(composed.media.some((item) => item.url.includes(entry.sha!))).toBe(false);
    }
    expect(composedUrls.toLowerCase()).not.toContain("bangtao");
    // Exactly one price list was adopted.
    expect(composed.priceList).toBeTruthy();
    // The source is the neutral archive label, never the Owner's filename.
    expect(composed.priceListSource).toBeTruthy();
    expect(composed.priceListSource).not.toContain(".pdf");

    // --- 8. the warning vocabulary tells the Owner what to do -------------
    const warningCodes = composed.warnings.map((warning) => warning.code);
    expect(warningCodes).toContain(MANUAL_REVIEW_LOCATION_CONFLICT);
    expect(warningCodes).toContain("entry_over_size_limit");
    expect(warningCodes).toContain("price_list_duplicate_ignored");
    const reviewWarning = composed.warnings.find(
      (warning) => warning.code === MANUAL_REVIEW_LOCATION_CONFLICT,
    )!;
    expect(reviewWarning.message.toLowerCase()).toContain("showroom");
    expect(reviewWarning.message.toLowerCase()).toContain("review");

    // --- 9. progress carries the manual-review COUNT ----------------------
    const progress = await buildJobProgress(world.deps, job!);
    expect(progress.manualReview).toBe(BANGTAO_ENTRIES.length);
    expect(progress.retained).toBeGreaterThanOrEqual(progress.manualReview);
    expect(progress.archives[0].entriesManualReview).toBe(BANGTAO_ENTRIES.length);
    expect(progress.archives[0].archiveId).toBe(archiveId);

    // --- 10. the project is an UNPUBLISHED draft --------------------------
    const project = world.executor.store.projects.find((row) => row.name === PROJECT_NAME);
    expect(project).toBeTruthy();
    expect(project!.public_status).not.toBe("published");

    // --- 11. no video was ever presented as added -------------------------
    const video = byName.get("20260401 Coralina Facilities.mp4")!;
    expect(video.state).toBe("retained_private");
    expect(composed.media.some((item) => item.media_type === "video")).toBe(false);
  }, 180_000);

  it("creates no second job when the browser retries the identical upload", async () => {
    const world = workerWorld();
    const { jobId } = await uploadCoralinaPackage(world);
    const jobsAfterFirst = world.data.jobs.size;
    const archivesAfterFirst = world.data.archives.size;

    // The response was lost, so the browser replans and reconfirms the SAME
    // manifest — twice.
    const built = buildZipParts(CORALINA_ENTRIES, ARCHIVE_PART_BYTES);
    const partSha256 = manifestForParts(built.parts);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const replan = await withWorkerRuntime(world.workerR2.env, () =>
        planJobArchiveUpload(world.deps, OWNER, {
          jobId,
          fileName: "Coralina Full Package.zip",
          declaredSize: built.totalSize,
          materialPurpose: "project_archive",
          partSha256,
        }),
      );
      const again = await withWorkerRuntime(world.workerR2.env, () =>
        confirmJobArchiveUpload(world.deps, OWNER, {
          jobId,
          archiveId: replan.archiveId,
          partSha256,
        }),
      );
      expect(again.accepted).toBe(true);
    }

    expect(world.data.jobs.size).toBe(jobsAfterFirst);
    expect(world.data.archives.size).toBe(archivesAfterFirst);

    await finishOnScheduledTicks(world, jobId);
    expect(world.data.jobs.size).toBe(jobsAfterFirst);
    // One project, not one per attempt.
    expect(world.executor.store.projects.filter((row) => row.name === PROJECT_NAME)).toHaveLength(
      1,
    );
  }, 180_000);

  it("keeps Bangtao eligible when the project itself is in Bangtao", async () => {
    // The rule is about a CONFLICT, not about a place. The identical archive
    // uploaded to a Bangtao project must publish the Bangtao showroom and
    // quarantine the Kamala one instead — proving nothing is hardcoded.
    const world = workerWorld();
    const built = buildZipParts(CORALINA_ENTRIES, ARCHIVE_PART_BYTES);
    const partSha256 = manifestForParts(built.parts);

    const started = await withWorkerRuntime(world.workerR2.env, () =>
      startUploadJob(world.deps, OWNER, {
        workflow: "new_development",
        projectFacts: { name: "The Title Somewhere Bangtao", locationText: "Bangtao, Phuket" },
        files: [],
      }),
    );
    const plan = await withWorkerRuntime(world.workerR2.env, () =>
      planJobArchiveUpload(world.deps, OWNER, {
        jobId: started.jobId,
        fileName: "Coralina Full Package.zip",
        declaredSize: built.totalSize,
        materialPurpose: "project_archive",
        partSha256,
      }),
    );
    for (const target of plan.parts) {
      const transport = target.transport!;
      if (transport.kind !== "r2_presigned_put") throw new Error("expected an R2 presigned target");
      await world.r2.fetchImpl(transport.url, {
        method: "PUT",
        headers: transport.headers,
        body: new Uint8Array(built.parts[target.index]) as unknown as BodyInit,
      });
    }
    await withWorkerRuntime(world.workerR2.env, () =>
      confirmJobArchiveUpload(world.deps, OWNER, {
        jobId: started.jobId,
        archiveId: plan.archiveId,
        partSha256,
      }),
    );
    // The single explicit request, then the browser is gone.
    await withWorkerRuntime(world.workerR2.env, () =>
      processUploadJob(world.deps, OWNER, started.jobId),
    );
    await finishOnScheduledTicks(world, started.jobId);

    const { byName } = await settledEntries(world, started.jobId);
    for (const name of BANGTAO_ENTRIES) {
      expect(byName.get(name)!.state, name).toBe("published_public");
    }
    const kamala = byName.get(
      "12. Photo of Show Units/Show Unit @Kamala/1 BR L 41 sqm/_DSC6667.jpg",
    )!;
    expect(kamala.state).toBe("retained_private");
    expect(kamala.code).toBe(MANUAL_REVIEW_LOCATION_CONFLICT);
  }, 180_000);

  it("cannot claim a conflict when the project has no known location", async () => {
    const world = workerWorld();
    const built = buildZipParts(CORALINA_ENTRIES, ARCHIVE_PART_BYTES);
    const partSha256 = manifestForParts(built.parts);

    const started = await withWorkerRuntime(world.workerR2.env, () =>
      startUploadJob(world.deps, OWNER, {
        workflow: "new_development",
        // No location anywhere: the rule must stay silent rather than guess.
        projectFacts: { name: "Unknown Location Project" },
        files: [],
      }),
    );
    const plan = await withWorkerRuntime(world.workerR2.env, () =>
      planJobArchiveUpload(world.deps, OWNER, {
        jobId: started.jobId,
        fileName: "Coralina Full Package.zip",
        declaredSize: built.totalSize,
        materialPurpose: "project_archive",
        partSha256,
      }),
    );
    for (const target of plan.parts) {
      const transport = target.transport!;
      if (transport.kind !== "r2_presigned_put") throw new Error("expected an R2 presigned target");
      await world.r2.fetchImpl(transport.url, {
        method: "PUT",
        headers: transport.headers,
        body: new Uint8Array(built.parts[target.index]) as unknown as BodyInit,
      });
    }
    await withWorkerRuntime(world.workerR2.env, () =>
      confirmJobArchiveUpload(world.deps, OWNER, {
        jobId: started.jobId,
        archiveId: plan.archiveId,
        partSha256,
      }),
    );
    // The single explicit request, then the browser is gone.
    await withWorkerRuntime(world.workerR2.env, () =>
      processUploadJob(world.deps, OWNER, started.jobId),
    );
    await finishOnScheduledTicks(world, started.jobId);

    const { byName } = await settledEntries(world, started.jobId);
    for (const name of BANGTAO_ENTRIES) {
      expect(byName.get(name)!.code, name).not.toBe(MANUAL_REVIEW_LOCATION_CONFLICT);
    }
    const progress = await buildJobProgress(
      world.deps,
      (await world.deps.data.getJob(started.jobId))!,
    );
    expect(progress.manualReview).toBe(0);
  }, 180_000);
});

describe("the private archive bucket keeps the original package", () => {
  it("retains every uploaded part after the job completes", async () => {
    const world = workerWorld();
    const { jobId, archiveId } = await uploadCoralinaPackage(world);
    await finishOnScheduledTicks(world, jobId);

    const parts = world.r2
      .keys(TEST_R2_BUCKETS.projectArchives)
      .filter((key) => key.includes(`/${archiveId}/parts/`));
    expect(parts.length).toBeGreaterThan(0);
    // Nothing public ever landed in the archive bucket.
    for (const key of parts) expect(key.startsWith("studio/archives/")).toBe(true);
  }, 180_000);
});
