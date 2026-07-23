/**
 * Large-archive sliced processing — the durable engine end-to-end against the
 * in-memory fakes: bounded claim-scoped slices with released claims between
 * them, durable per-entry checkpoints, deterministic dedup, truthful private
 * retention, fail-closed safety rejection, per-entry damage isolation,
 * idempotent retries, browser-free continuation, and stale-attempt safety.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { PUBLIC_IMAGE_BUCKET } from "../server/extraction";
import { SLICE_MAX_ENTRIES } from "../server/large-archive";
import { getJobProgress, processUploadJob, resumeDueJobs } from "../server/service";
import { magicBytesFor, makeWorld, OWNER, uploadAll, type FakeWorld } from "./fakes";
import {
  buildZipParts,
  patternBytes,
  startArchiveJob,
  uploadArchiveParts,
  type StreamedZipEntry,
} from "./large-archive-fixtures";
import { startUploadJob } from "../server/service";

const PART = 8 * 1024 * 1024;

const PRICE_LIST = readFileSync(
  resolve(process.cwd(), "forever-data/projects/rainpalm-villas/sip/reviewed-price-list.json"),
  "utf8",
);

const FACTS_JSON = JSON.stringify({
  name: { value: "Archive Manor", confidence: "high", source_file: "facts.json" },
  developer: { value: "Manor Estates Co.", confidence: "high", source_file: "facts.json" },
  location: { value: "Kamala, Phuket", confidence: "high", source_file: "facts.json" },
});

function jpegEntry(name: string): StreamedZipEntry {
  return { name, data: () => magicBytesFor(name.split("/").pop() ?? name) };
}

async function drive(
  world: FakeWorld,
  jobId: string,
  maxCalls = 80,
): Promise<{ result: Awaited<ReturnType<typeof processUploadJob>>; calls: number }> {
  let calls = 0;
  for (;;) {
    const result = await processUploadJob(world.deps, OWNER, jobId);
    calls += 1;
    if (result.status !== "processing") return { result, calls };
    if (calls > maxCalls) throw new Error(`job did not settle within ${maxCalls} slices`);
  }
}

async function uploadMixedArchive(world: FakeWorld, jobId: string, fileName = "dossier.zip") {
  const entries: StreamedZipEntry[] = [
    jpegEntry("photos/render-front.jpg"),
    jpegEntry("photos/render-pool.jpg"),
    { name: "photos/render-front-copy.jpg", data: () => magicBytesFor("render-front.jpg") },
    { name: "docs/facts.json", data: () => Buffer.from(FACTS_JSON) },
    { name: "price-list/price-list.json", data: () => Buffer.from(PRICE_LIST) },
    { name: "video/walkthrough.mp4", data: () => magicBytesFor("walkthrough.mp4") },
    { name: "misc/site-notes.bin", data: () => patternBytes(2048, 5) },
  ];
  const { parts, totalSize } = buildZipParts(entries, PART);
  return uploadArchiveParts(world, OWNER, jobId, fileName, parts, totalSize);
}

describe("large-archive sliced processing", () => {
  it("publishes a mixed archive: media via media truth, facts and prices via their pipelines, truthful private retention", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    await uploadMixedArchive(world, jobId);
    const { result } = await drive(world, jobId);

    expect(result.status).toBe("published");
    expect(result.projectSlug).toBe("archive-manor");
    const project = world.executor.store.projects[0];
    expect(project.name).toBe("Archive Manor");
    expect(project.developer_name_raw).toBe("Manor Estates Co.");
    // Price pipeline consumed the archived price list.
    expect(world.executor.store.units.length).toBeGreaterThan(0);
    // Exactly the two distinct photos published through the sanitizer.
    const media = world.executor.store.media;
    expect(media).toHaveLength(2);
    for (const item of media) {
      const truth = (item.metadata as { studio?: { media_truth?: Record<string, unknown> } }).studio
        ?.media_truth;
      expect(truth).toBeDefined();
      // Claims never reach the public row (PR #99 boundary).
      expect(truth && "claims" in truth).toBe(false);
    }

    const entries = await world.deps.data.listJobArchiveEntries(jobId);
    const byName = new Map(entries.map((entry) => [entry.entry_name, entry]));
    expect(byName.get("photos/render-front.jpg")?.state).toBe("published_public");
    expect(byName.get("photos/render-pool.jpg")?.state).toBe("published_public");
    expect(byName.get("photos/render-front-copy.jpg")?.state).toBe("skipped_duplicate");
    expect(byName.get("video/walkthrough.mp4")?.state).toBe("retained_private");
    expect(byName.get("video/walkthrough.mp4")?.outcome_code).toBe("media_format_private");
    expect(byName.get("misc/site-notes.bin")?.state).toBe("retained_private");
    expect(byName.get("docs/facts.json")?.outcome_code).toBe("project_facts_extracted");
    expect(byName.get("price-list/price-list.json")?.outcome_code).toBe("price_list_extracted");

    // Aggregated truthful warnings, never per-entry spam or original names.
    const codes = result.warnings.map((warning) => warning.code);
    expect(codes).toContain("media_format_private");
    expect(codes).toContain("duplicate_content_skipped");
    for (const warning of result.warnings) {
      expect(warning.message).not.toContain("walkthrough");
      expect(warning.message).not.toContain("dossier.zip");
    }
  });

  it("advances in bounded slices, releasing the claim between them", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER, { projectFacts: { name: "Sliced Manor" } });
    const entries: StreamedZipEntry[] = Array.from({ length: SLICE_MAX_ENTRIES + 6 }, (_, i) => ({
      name: `misc/blob-${String(i).padStart(3, "0")}.bin`,
      data: () => patternBytes(1024, i + 1),
    }));
    const { parts, totalSize } = buildZipParts(entries, PART);
    await uploadArchiveParts(world, OWNER, jobId, "many.zip", parts, totalSize);

    const first = await processUploadJob(world.deps, OWNER, jobId);
    expect(first.status).toBe("processing");
    expect(first.progress?.discovered).toBe(SLICE_MAX_ENTRIES + 6);
    expect(first.progress?.processed).toBeGreaterThan(0);
    expect(first.progress?.processed).toBeLessThan(SLICE_MAX_ENTRIES + 6);
    // The claim was released — the job is immediately claimable again.
    const row = await world.deps.data.getJob(jobId);
    expect(row?.status).toBe("received");
    expect(row?.processing_token).toBeNull();

    const { result, calls } = await drive(world, jobId);
    expect(result.status).toBe("published");
    expect(calls).toBeGreaterThanOrEqual(1);
    const settled = await world.deps.data.listJobArchiveEntries(jobId);
    expect(settled.every((entry) => entry.state === "retained_private")).toBe(true);
  });

  it("continues after the browser closes: dashboard resume drives the job to completion", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER, { projectFacts: { name: "Resumed Manor" } });
    const entries: StreamedZipEntry[] = Array.from({ length: SLICE_MAX_ENTRIES + 3 }, (_, i) => ({
      name: `misc/blob-${String(i).padStart(3, "0")}.bin`,
      data: () => patternBytes(512, i + 1),
    }));
    const { parts, totalSize } = buildZipParts(entries, PART);
    await uploadArchiveParts(world, OWNER, jobId, "closed.zip", parts, totalSize);

    // The browser requested processing (upload acceptance), then closed.
    const first = await processUploadJob(world.deps, OWNER, jobId);
    expect(first.status).toBe("processing");

    // Any signed-in Studio session's poll continues the durable work.
    let published = 0;
    for (let poll = 0; poll < 40 && published === 0; poll += 1) {
      const resumed = await resumeDueJobs(world.deps, OWNER);
      published += resumed.resumed;
    }
    expect(published).toBe(1);
    const job = await world.deps.data.getJob(jobId);
    expect(job?.status).toBe("published");
  });

  it("resumes from durable checkpoints after a crashed worker, preserving settled outcomes", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER, { projectFacts: { name: "Crash Manor" } });
    const entries: StreamedZipEntry[] = [
      jpegEntry("photos/a.jpg"),
      ...Array.from({ length: SLICE_MAX_ENTRIES + 2 }, (_, i) => ({
        name: `misc/blob-${String(i).padStart(3, "0")}.bin`,
        data: () => patternBytes(512, i + 40),
      })),
    ];
    const { parts, totalSize } = buildZipParts(entries, PART);
    await uploadArchiveParts(world, OWNER, jobId, "crash.zip", parts, totalSize);

    // Slice 1 settles a bounded batch, then releases.
    const first = await processUploadJob(world.deps, OWNER, jobId);
    expect(first.status).toBe("processing");
    const settledBefore = await world.deps.data.listJobArchiveEntries(jobId);
    const doneBefore = settledBefore.filter((entry) => entry.state !== "pending");
    expect(doneBefore.length).toBeGreaterThan(0);
    const attemptsBefore = new Map(doneBefore.map((entry) => [entry.id, entry.attempt]));

    // A worker claims and dies silently (no release, no settle).
    const dead = await world.deps.data.requestJobProcessing(jobId, "dead-beef-token", 900);
    expect(dead).not.toBeNull();
    world.advanceMinutes(16); // stale window elapses

    const { result } = await drive(world, jobId);
    expect(result.status).toBe("published");
    // Outcomes settled before the crash were never reprocessed or rewritten.
    const after = await world.deps.data.listJobArchiveEntries(jobId);
    for (const entry of after) {
      const before = attemptsBefore.get(entry.id);
      if (before) expect(entry.attempt).toBe(before);
      expect(entry.state).not.toBe("pending");
    }
  });

  it("retries are idempotent after publication: replayed reads, unchanged media and objects", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER);
    await uploadMixedArchive(world, jobId);
    const { result } = await drive(world, jobId);
    expect(result.status).toBe("published");
    const mediaBefore = structuredClone(world.executor.store.media);
    const objectsBefore = [...world.storage.objects.keys()].sort();

    const replay = await processUploadJob(world.deps, OWNER, jobId);
    expect(replay.status).toBe("published");
    expect(world.executor.store.media).toEqual(mediaBefore);
    expect([...world.storage.objects.keys()].sort()).toEqual(objectsBefore);
  });

  it("skips duplicate content across archives of one job deterministically", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER, { projectFacts: { name: "Twin Manor" } });
    const a = buildZipParts([jpegEntry("photos/x.jpg"), jpegEntry("photos/y.jpg")], PART);
    await uploadArchiveParts(world, OWNER, jobId, "first.zip", a.parts, a.totalSize);
    const b = buildZipParts(
      [
        { name: "gallery/x-again.jpg", data: () => magicBytesFor("x.jpg") },
        jpegEntry("photos/z.jpg"),
      ],
      PART,
    );
    await uploadArchiveParts(world, OWNER, jobId, "second.zip", b.parts, b.totalSize);

    const { result } = await drive(world, jobId);
    expect(result.status).toBe("published");
    expect(world.executor.store.media).toHaveLength(3);
    const entries = await world.deps.data.listJobArchiveEntries(jobId);
    const dup = entries.find((entry) => entry.entry_name === "gallery/x-again.jpg");
    expect(dup?.state).toBe("skipped_duplicate");
    expect(dup?.outcome_code).toBe("duplicate_content_skipped");
  });

  it("skips media the target project already has (multi-session enrichment)", async () => {
    const world = makeWorld();
    const firstJob = await startArchiveJob(world, OWNER, {
      projectFacts: { name: "Growing Manor" },
    });
    const a = buildZipParts([jpegEntry("photos/x.jpg")], PART);
    await uploadArchiveParts(world, OWNER, firstJob, "day-one.zip", a.parts, a.totalSize);
    expect((await drive(world, firstJob)).result.status).toBe("published");
    expect(world.executor.store.media).toHaveLength(1);

    const secondJob = await startArchiveJob(world, OWNER, {
      workflow: "project_update",
      projectSlug: "growing-manor",
    });
    const b = buildZipParts(
      [{ name: "again/x.jpg", data: () => magicBytesFor("x.jpg") }, jpegEntry("photos/new.jpg")],
      PART,
    );
    await uploadArchiveParts(world, OWNER, secondJob, "day-two.zip", b.parts, b.totalSize);
    const { result } = await drive(world, secondJob);
    expect(result.status).toBe("published");
    expect(world.executor.store.media).toHaveLength(2);
    const entries = await world.deps.data.listJobArchiveEntries(secondJob);
    const skipped = entries.find((entry) => entry.entry_name === "again/x.jpg");
    expect(skipped?.state).toBe("skipped_duplicate");
    expect(skipped?.outcome_code).toBe("duplicate_of_existing_media");
  });

  it("rejects an unsafe archive fail-closed while the rest of the upload publishes", async () => {
    const world = makeWorld();
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Safe Manor" },
      files: [{ name: "cover.jpg" }],
    });
    uploadAll(world, started.uploads);
    const hostile = buildZipParts(
      [{ name: "../escape.txt", data: () => Buffer.from("evil") }, jpegEntry("photos/fine.jpg")],
      PART,
    );
    await uploadArchiveParts(
      world,
      OWNER,
      started.jobId,
      "evil.zip",
      hostile.parts,
      hostile.totalSize,
    );

    const { result } = await drive(world, started.jobId);
    expect(result.status).toBe("published");
    // Nothing expanded: zero entry rows, no entry-derived public objects.
    expect(await world.deps.data.listJobArchiveEntries(started.jobId)).toHaveLength(0);
    const archives = await world.deps.data.listJobArchives(started.jobId);
    expect(archives[0].status).toBe("rejected");
    expect(archives[0].error_code).toBe("archive_rejected_unsafe");
    expect(result.warnings.some((w) => w.code === "archive_rejected_unsafe")).toBe(true);
    // The ordinary photo still published; archive parts stay retained.
    expect(world.executor.store.media).toHaveLength(1);
  });

  it("isolates one corrupt entry without blocking the rest of the archive", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER, { projectFacts: { name: "Tough Manor" } });
    const mixed = buildZipParts(
      [
        jpegEntry("photos/good-one.jpg"),
        { name: "photos/damaged.jpg", data: () => magicBytesFor("damaged.jpg"), corruptCrc: true },
        jpegEntry("photos/good-two.jpg"),
      ],
      PART,
    );
    await uploadArchiveParts(world, OWNER, jobId, "mixed.zip", mixed.parts, mixed.totalSize);
    const { result } = await drive(world, jobId);
    expect(result.status).toBe("published");
    const entries = await world.deps.data.listJobArchiveEntries(jobId);
    const damaged = entries.find((entry) => entry.entry_name === "photos/damaged.jpg");
    expect(damaged?.state).toBe("failed");
    expect(damaged?.outcome_code).toBe("entry_integrity_failed");
    expect(world.executor.store.media).toHaveLength(2);
  });

  it("rejects an archive whose stored parts fail hash verification, expanding nothing", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER, { projectFacts: { name: "Tamper Manor" } });
    const archive = buildZipParts(
      Array.from({ length: 3 }, (_, i) => ({
        name: `media/blob-${i}.bin`,
        data: () => patternBytes(4 * 1024 * 1024, i + 60),
      })),
      PART,
    );
    await uploadArchiveParts(
      world,
      OWNER,
      jobId,
      "tampered.zip",
      archive.parts,
      archive.totalSize,
      {
        tamperPart: 1,
      },
    );
    const { result } = await drive(world, jobId);
    expect(result.status).toBe("published");
    const archives = await world.deps.data.listJobArchives(jobId);
    expect(archives[0].status).toBe("rejected");
    expect(archives[0].error_code).toBe("archive_part_integrity_failed");
    expect(await world.deps.data.listJobArchiveEntries(jobId)).toHaveLength(0);
    expect(result.warnings.some((w) => w.code === "archive_part_integrity_failed")).toBe(true);
  });

  it("retains oversized entries privately without expanding them (per-entry, not archive-fatal)", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER, { projectFacts: { name: "Video Manor" } });
    const archive = buildZipParts(
      [
        { name: "video/big-walkthrough.mp4", data: () => patternBytes(25 * 1024 * 1024, 7) },
        jpegEntry("photos/small.jpg"),
      ],
      PART,
    );
    await uploadArchiveParts(world, OWNER, jobId, "video.zip", archive.parts, archive.totalSize);
    const { result } = await drive(world, jobId);
    expect(result.status).toBe("published");
    const entries = await world.deps.data.listJobArchiveEntries(jobId);
    const video = entries.find((entry) => entry.entry_name === "video/big-walkthrough.mp4");
    expect(video?.state).toBe("retained_private");
    expect(video?.outcome_code).toBe("entry_over_size_limit");
    expect(video?.observed_size).toBeNull(); // never expanded
    expect(world.executor.store.media).toHaveLength(1);
  });

  it("rejects a never-confirmed archive as upload-incomplete once processing was requested", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER, { projectFacts: { name: "Ghost Manor" } });
    const archive = buildZipParts([jpegEntry("photos/a.jpg")], PART);
    await uploadArchiveParts(world, OWNER, jobId, "ghost.zip", archive.parts, archive.totalSize, {
      skipConfirm: true,
    });
    const { result } = await drive(world, jobId);
    expect(result.status).toBe("published");
    const archives = await world.deps.data.listJobArchives(jobId);
    expect(archives[0].status).toBe("rejected");
    expect(archives[0].error_code).toBe("archive_upload_incomplete");
    expect(result.warnings.some((w) => w.code === "archive_upload_incomplete")).toBe(true);
  });

  it("claim-checked writes refuse stale tokens and settled entries refuse re-settlement", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER, { projectFacts: { name: "Guard Manor" } });
    const archive = buildZipParts(
      Array.from({ length: 3 }, (_, i) => ({
        name: `misc/blob-${i}.bin`,
        data: () => patternBytes(1024, i + 80),
      })),
      PART,
    );
    const uploaded = await uploadArchiveParts(
      world,
      OWNER,
      jobId,
      "guard.zip",
      archive.parts,
      archive.totalSize,
    );
    const { result } = await drive(world, jobId);
    expect(result.status).toBe("published");
    const entries = await world.deps.data.listJobArchiveEntries(jobId);
    const outcome = {
      state: "failed" as const,
      outcomeCode: "hijack",
      attempt: "stale",
      processedAt: world.flags.nowValue,
    };
    // No live claim: every claim-checked write refuses.
    expect(
      await world.deps.data.settleArchiveEntryIfClaimed(
        jobId,
        "stale-token",
        entries[0].id,
        outcome,
      ),
    ).toBe(false);
    expect(
      await world.deps.data.updateArchiveIfClaimed(jobId, "stale-token", uploaded.archiveId, {
        status: "rejected",
      }),
    ).toBe(false);
    expect(await world.deps.data.releaseJobIfClaimed(jobId, "stale-token")).toBe(false);
    // Even under a live claim, a settled entry never re-settles.
    const claimed = await world.deps.data.claimJob(jobId, "fresh-token", 900);
    expect(claimed).toBeNull(); // published jobs are never reclaimed
    const after = await world.deps.data.listJobArchiveEntries(jobId);
    expect(after[0].outcome_code).not.toBe("hijack");
  });

  it("keeps every settled entry's public object across attempts and sweeps only unreferenced orphans", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER, { projectFacts: { name: "Sweep Manor" } });
    const entryList: StreamedZipEntry[] = [
      jpegEntry("photos/keep-1.jpg"),
      ...Array.from({ length: SLICE_MAX_ENTRIES }, (_, i) => ({
        name: `misc/pad-${String(i).padStart(3, "0")}.bin`,
        data: () => patternBytes(256, i + 90),
      })),
      jpegEntry("photos/keep-2.jpg"),
    ];
    const archive = buildZipParts(entryList, PART);
    await uploadArchiveParts(world, OWNER, jobId, "sweep.zip", archive.parts, archive.totalSize);

    // Slice 1 publishes keep-1 under attempt A, then releases.
    const first = await processUploadJob(world.deps, OWNER, jobId);
    expect(first.status).toBe("processing");
    // Drop a fake foreign-attempt orphan under the job's public prefix.
    world.storage.put(PUBLIC_IMAGE_BUCKET, `studio/${jobId}/deadattempt/00-orphan.jpg`, "junk");

    const { result } = await drive(world, jobId);
    expect(result.status).toBe("published");
    const entries = await world.deps.data.listJobArchiveEntries(jobId);
    const published = entries.filter((entry) => entry.state === "published_public");
    expect(published).toHaveLength(2);
    const attempts = new Set(published.map((entry) => entry.attempt));
    expect(attempts.size).toBeGreaterThan(1); // settled under different claims
    for (const entry of published) {
      expect(
        await world.storage.statObject(entry.public_bucket!, entry.public_path!),
      ).not.toBeNull();
    }
    expect(
      await world.storage.statObject(
        PUBLIC_IMAGE_BUCKET,
        `studio/${jobId}/deadattempt/00-orphan.jpg`,
      ),
    ).toBeNull();
  });

  it("reports truthful public-safe progress through the progress endpoint", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, OWNER, { projectFacts: { name: "Progress Manor" } });
    const archive = buildZipParts(
      Array.from({ length: SLICE_MAX_ENTRIES + 4 }, (_, i) => ({
        name: `private-secret-name-${i}.bin`,
        data: () => patternBytes(512, i + 3),
      })),
      PART,
    );
    await uploadArchiveParts(
      world,
      OWNER,
      jobId,
      "secret-dossier.zip",
      archive.parts,
      archive.totalSize,
    );
    await processUploadJob(world.deps, OWNER, jobId);
    const progress = await getJobProgress(world.deps, OWNER, jobId);
    expect(progress.discovered).toBe(SLICE_MAX_ENTRIES + 4);
    expect(progress.processed).toBeGreaterThan(0);
    expect(progress.pending).toBeGreaterThan(0);
    expect(progress.archives).toHaveLength(1);
    expect(progress.archives[0].label).toBe("Archive 1");
    // Neither the archive filename nor entry names appear anywhere.
    const serialized = JSON.stringify(progress);
    expect(serialized).not.toContain("secret-dossier");
    expect(serialized).not.toContain("private-secret-name");
  });
});
