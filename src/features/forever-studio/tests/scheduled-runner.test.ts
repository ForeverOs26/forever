/**
 * Autonomous background runner — the local seam for the deployed path
 * Cloudflare Cron Trigger → Worker scheduled() export → cloudflare:scheduled
 * Nitro hook → runScheduledStudioTick. These tests drive ONLY the scheduled
 * tick against the fakes: zero open browsers, zero authenticated dashboard
 * polls, repeated ticks, interruption between ticks, eventual completion,
 * and no duplicate rows or objects.
 */

import { describe, expect, it } from "vitest";

import { PUBLIC_IMAGE_BUCKET } from "../server/extraction";
import {
  processUploadJob,
  runScheduledStudioTick,
  SCHEDULED_TICK_MAX_SLICES,
} from "../server/service";
import studioScheduledRunner, { STUDIO_SCHEDULED_HOOK } from "../server/scheduled.plugin";
import { makeWorld, OWNER, PUBLISHER, type FakeWorld } from "./fakes";
import {
  buildZipParts,
  patternBytes,
  startArchiveJob,
  uploadArchiveParts,
  type StreamedZipEntry,
} from "./large-archive-fixtures";
import { magicBytesFor } from "./fakes";

const PART = 8 * 1024 * 1024;

function jpegEntry(name: string): StreamedZipEntry {
  return { name, data: () => magicBytesFor(name.split("/").pop() ?? name) };
}

/**
 * Enough parts and entries that several bounded slices remain after the
 * browser's single processing request (21 parts → two verification slices;
 * 82 entries → four routing slices).
 */
function multiSliceArchive(): { parts: Buffer[]; totalSize: number; entryCount: number } {
  const entries: StreamedZipEntry[] = [
    jpegEntry("photos/hero.jpg"),
    jpegEntry("photos/pool.jpg"),
    ...Array.from({ length: 80 }, (_, index) => ({
      name: `raw/survey-${String(index).padStart(3, "0")}.bin`,
      data: () => patternBytes(2 * 1024 * 1024, index + 1),
    })),
  ];
  const { parts, totalSize } = buildZipParts(entries, PART);
  return { parts, totalSize, entryCount: entries.length };
}

/**
 * The browser's ONLY involvement: upload the archive and confirm storage,
 * then make the single explicit processing request (the durable readiness
 * marker + first slice) — after which it terminates for good.
 */
async function uploadAndRequestThenCloseBrowser(
  world: FakeWorld,
): Promise<{ jobId: string; entryCount: number }> {
  const jobId = await startArchiveJob(world, OWNER, {
    projectFacts: { name: "Background Manor" },
  });
  const { parts, totalSize, entryCount } = multiSliceArchive();
  await uploadArchiveParts(world, OWNER, jobId, "background.zip", parts, totalSize);
  const first = await processUploadJob(world.deps, OWNER, jobId);
  expect(first.status).toBe("processing"); // work remains when the browser dies
  return { jobId, entryCount };
}

describe("scheduled autonomous runner", () => {
  it(
    "advances an explicitly requested job to completion with zero browser or dashboard calls",
    { timeout: 120_000 },
    async () => {
      const world = makeWorld();
      const { jobId, entryCount } = await uploadAndRequestThenCloseBrowser(world);

      // From here on: ONLY scheduled ticks. No processUploadJob, no
      // resumeDueJobs, no authenticated caller of any kind.
      let ticks = 0;
      for (;;) {
        const summary = await runScheduledStudioTick(world.deps, { maxSlices: 3 });
        ticks += 1;
        world.advanceMinutes(5); // cron cadence between invocations
        if (summary.published > 0) break;
        if (ticks > 30) throw new Error("scheduled ticks did not complete the job");
      }

      const job = await world.deps.data.getJob(jobId);
      expect(job?.status).toBe("published");
      const rows = await world.deps.data.listJobArchiveEntries(jobId);
      expect(rows).toHaveLength(entryCount);
      expect(rows.every((row) => row.state !== "pending")).toBe(true);
      // Exactly one durable row per entry and exactly the two photos public —
      // repeated ticks caused no duplicate rows or objects.
      expect(new Set(rows.map((row) => `${row.archive_id}:${row.entry_index}`)).size).toBe(
        entryCount,
      );
      expect(rows.filter((row) => row.state === "published_public")).toHaveLength(2);
      expect(world.executor.store.media).toHaveLength(2);
      expect(world.storage.publicKeys(PUBLIC_IMAGE_BUCKET)).toHaveLength(2);
    },
  );

  it(
    "survives an interruption between ticks: a died claim goes stale and a later tick takes over",
    { timeout: 120_000 },
    async () => {
      const world = makeWorld();
      const { jobId } = await uploadAndRequestThenCloseBrowser(world);

      // One scheduled slice advances work, then a claimed worker dies without
      // releasing (models a killed Worker isolate mid-tick).
      await runScheduledStudioTick(world.deps, { maxSlices: 1 });
      const dead = await world.deps.data.claimJob(jobId, "dead-scheduled-worker", 900);
      expect(dead).not.toBeNull();
      const settledBefore = (await world.deps.data.listJobArchiveEntries(jobId)).filter(
        (row) => row.state !== "pending",
      );

      // While the dead claim is fresh, ticks cannot steal it (single winner).
      const blocked = await runScheduledStudioTick(world.deps);
      expect(blocked.advanced).toBe(0);

      // After the stale window the next ticks recover and finish the job.
      world.advanceMinutes(16);
      let published = 0;
      for (let tick = 0; tick < 30 && published === 0; tick += 1) {
        published = (await runScheduledStudioTick(world.deps)).published;
        world.advanceMinutes(5);
      }
      expect(published).toBe(1);
      const rows = await world.deps.data.listJobArchiveEntries(jobId);
      // Outcomes settled before the interruption were never re-processed.
      for (const before of settledBefore) {
        const after = rows.find((row) => row.id === before.id)!;
        expect(after.attempt).toBe(before.attempt);
        expect(after.processed_at).toBe(before.processed_at);
      }
    },
  );

  it("claims only explicitly processing-requested jobs", async () => {
    const world = makeWorld();
    // Upload complete, storage confirmed — but the explicit processing
    // request never happened (the browser died one step too early).
    const jobId = await startArchiveJob(world, OWNER, { projectFacts: { name: "Unready" } });
    const { parts, totalSize } = buildZipParts([jpegEntry("photos/a.jpg")], PART);
    await uploadArchiveParts(world, OWNER, jobId, "unready.zip", parts, totalSize);

    const summary = await runScheduledStudioTick(world.deps);
    expect(summary.due).toBe(0);
    expect(summary.advanced).toBe(0);
    const job = await world.deps.data.getJob(jobId);
    expect(job?.status).toBe("received");
    expect(job?.processing_requested_at).toBeNull();
    expect(await world.deps.data.listJobArchiveEntries(jobId)).toHaveLength(0);
  });

  it("skips jobs whose source membership is no longer active", async () => {
    const world = makeWorld();
    const jobId = await startArchiveJob(world, PUBLISHER, {
      projectFacts: { name: "Disabled Source" },
    });
    const { parts, totalSize } = buildZipParts([jpegEntry("photos/a.jpg")], PART);
    await uploadArchiveParts(world, PUBLISHER, jobId, "disabled.zip", parts, totalSize);
    const first = await processUploadJob(world.deps, PUBLISHER, jobId);
    expect(["processing", "published"]).toContain(first.status);

    const membership = (await world.data.getMembership(PUBLISHER.userId))!;
    await world.data.upsertMembership({ ...membership, is_active: false });
    const before = await world.deps.data.getJob(jobId);
    const summary = await runScheduledStudioTick(world.deps);
    expect(summary.due).toBe(0); // eligibility applied before the batch
    expect(await world.deps.data.getJob(jobId)).toEqual(before);
  });

  it("is a strict no-op in Partner Demo", { timeout: 120_000 }, async () => {
    const world = makeWorld();
    await uploadAndRequestThenCloseBrowser(world);
    world.flags.partnerDemo = true;
    const summary = await runScheduledStudioTick(world.deps);
    expect(summary).toEqual({ due: 0, advanced: 0, published: 0, failed: 0, skipped: 0 });
  });

  it("respects its per-invocation slice budget", { timeout: 120_000 }, async () => {
    const world = makeWorld();
    await uploadAndRequestThenCloseBrowser(world);
    const summary = await runScheduledStudioTick(world.deps, { maxSlices: 2 });
    expect(summary.advanced).toBe(2); // stopped at the budget with work left
    expect(summary.published).toBe(0);
    // The default budget is bounded too.
    expect(SCHEDULED_TICK_MAX_SLICES).toBeLessThanOrEqual(24);
  });

  it("the Nitro plugin registers the cloudflare:scheduled hook (deploy seam)", () => {
    const registered: Array<{ name: string; fn: unknown }> = [];
    const fakeNitroApp = {
      fetch: async () => new Response(null),
      hooks: {
        hook: (name: string, fn: unknown) => {
          registered.push({ name, fn });
          return () => undefined;
        },
      },
    };
    studioScheduledRunner(fakeNitroApp as never);
    expect(STUDIO_SCHEDULED_HOOK).toBe("cloudflare:scheduled");
    expect(registered).toHaveLength(1);
    expect(registered[0].name).toBe("cloudflare:scheduled");
    expect(typeof registered[0].fn).toBe("function");
  });
});
