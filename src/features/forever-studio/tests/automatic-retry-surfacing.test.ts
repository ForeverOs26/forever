/**
 * FOREVER-PR134-AUTOMATIC-RETRY-SURFACING-FIX-001 — a job the automatic lane
 * has given up on must stop being OFFERED to it.
 *
 * THE FINDING THIS PINS
 * ---------------------
 * The bounded retry policy stopped the scheduler from PROCESSING an exhausted
 * job, but the database went on returning it. `studio_list_due_jobs` owns its
 * own `ORDER BY created_at ASC` and `LIMIT 5`, so five old exhausted rows sat
 * at the front of the ordering and consumed every slot — permanently, because
 * exhausted rows never change and never move. Every genuinely eligible job
 * behind them starved. `studio_count_active_jobs` had the same problem in a
 * different shape: it is the single number that decides whether the dashboard
 * polls every five seconds, calls automatic resume, and tells the Owner
 * "Processing N uploads… this continues automatically even if you close the
 * page" — all three false for a job nothing will ever pick up.
 *
 * Filtering in application code could not fix it: an application filter runs
 * after the SQL LIMIT, so the sixth job was never in the result to rescue.
 *
 * THREE STATES, NOT TWO
 * ---------------------
 * These tests exist mostly to keep two ideas apart that a single boolean kept
 * merging:
 *
 *   automatically eligible   — the scheduler may run it
 *   automatically exhausted  — the scheduler must not; a PERSON still may
 *   terminally nonretryable  — nobody may, until the row is repaired
 *
 * `retryable` is the database's admission gate for BOTH lanes, so it cannot
 * also carry automatic-lane state; that is what closed the Owner's own retry
 * the first time. The automatic state lives in the job's existing `facts`
 * JSONB as a closed enum, and the SQL predicate reads that exact literal.
 *
 * Nothing here contacts production, staging or real R2.
 */

import { describe, expect, it, vi } from "vitest";

import {
  getOverview,
  processUploadJob,
  resumeDueJobs,
  runScheduledStudioTick,
  startUploadJob,
} from "../server/service";
import {
  automaticFailureCount,
  automaticRetryBudgetExhausted,
  automaticRetryState,
  jobRetryDisposition,
  JOB_RETRY_FACTS_KEY,
  retryFactsPatch,
  STUDIO_AUTOMATIC_RETRY_LIMIT,
} from "../server/retry-policy";
import { STUDIO_AUTOMATIC_RETRY_STATES } from "../studio-types";
import { makeWorld, OWNER, PUBLISHER, type FakeWorld } from "./fakes";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A job that is explicitly ready and therefore visible to the due query. */
async function readyJob(world: FakeWorld, name: string, actor = OWNER): Promise<string> {
  const started = await startUploadJob(world.deps, actor, {
    workflow: "new_development",
    projectFacts: { name },
    files: [],
  });
  await world.data.requestJobProcessing(started.jobId, `ready-${started.jobId}`, 900);
  return started.jobId;
}

/**
 * Put a job into one of the three dispositions DIRECTLY.
 *
 * Deliberately not by driving five real failures: this suite is about which
 * rows the queries return, and hand-setting the row keeps each case exact,
 * fast, and independent of whatever the processing pipeline happens to do.
 * `automatic-retry-cap` behaviour itself is proven end to end elsewhere.
 */
function setDisposition(
  world: FakeWorld,
  jobId: string,
  disposition: "automatically_eligible" | "automatically_exhausted" | "terminally_nonretryable",
): void {
  const job = world.data.jobs.get(jobId)!;
  job.status = "failed";
  job.processing_token = null;
  job.error_code = "object_stat_failed";
  job.error = "Forever could not confirm the uploaded files in storage.";
  job.attempt_count = disposition === "automatically_eligible" ? 1 : STUDIO_AUTOMATIC_RETRY_LIMIT;
  job.retryable = disposition !== "terminally_nonretryable";
  job.facts = {
    ...job.facts,
    ...retryFactsPatch(disposition === "automatically_eligible" ? 1 : STUDIO_AUTOMATIC_RETRY_LIMIT),
  };
}

// ---------------------------------------------------------------------------
// 20 — one closed vocabulary, three dispositions
// ---------------------------------------------------------------------------

describe("the canonical automatic-eligibility predicate", () => {
  it("(20) keeps automatic exhaustion and Owner retryability as separate concepts", () => {
    expect([...STUDIO_AUTOMATIC_RETRY_STATES].sort()).toEqual(["eligible", "exhausted"]);

    const eligible = { retryable: true, facts: retryFactsPatch(1) };
    const exhausted = { retryable: true, facts: retryFactsPatch(STUDIO_AUTOMATIC_RETRY_LIMIT) };
    const terminal = { retryable: false, facts: retryFactsPatch(STUDIO_AUTOMATIC_RETRY_LIMIT) };

    expect(jobRetryDisposition(eligible)).toBe("automatically_eligible");
    expect(jobRetryDisposition(exhausted)).toBe("automatically_exhausted");
    expect(jobRetryDisposition(terminal)).toBe("terminally_nonretryable");

    // Exhausted is NOT terminal: the database gate for the Owner's lane is
    // still open, which is the entire distinction.
    expect(exhausted.retryable).toBe(true);
    expect(terminal.retryable).toBe(false);
  });

  it("(20, 21) reads exactly what the SQL predicate reads, and survives a restart", () => {
    // The SQL is `COALESCE(facts->'retry'->>'automatic','eligible') = 'exhausted'`.
    // Anything that is not that literal is eligible, on BOTH sides — no
    // fallback to the numeric streak, because a fallback the database does not
    // share is drift by construction.
    expect(automaticRetryState({ facts: {} })).toBe("eligible");
    expect(automaticRetryState({ facts: null })).toBe("eligible");
    expect(automaticRetryState({ facts: { retry: {} } })).toBe("eligible");
    expect(automaticRetryState({ facts: { retry: { automatic: "eligible" } } })).toBe("eligible");
    expect(automaticRetryState({ facts: { retry: { automatic: "exhausted" } } })).toBe("exhausted");
    expect(automaticRetryState({ facts: { retry: { automatic: "banana" } } })).toBe("eligible");
    // A streak alone never implies exhaustion: only the written state does.
    expect(automaticRetryState({ facts: { retry: { automaticFailures: 99 } } })).toBe("eligible");

    // The count and the state are written together from one number, so a
    // disagreeing pair cannot be persisted...
    expect(retryFactsPatch(STUDIO_AUTOMATIC_RETRY_LIMIT - 1)[JOB_RETRY_FACTS_KEY]).toEqual({
      automaticFailures: STUDIO_AUTOMATIC_RETRY_LIMIT - 1,
      automatic: "eligible",
    });
    expect(retryFactsPatch(STUDIO_AUTOMATIC_RETRY_LIMIT)[JOB_RETRY_FACTS_KEY]).toEqual({
      automaticFailures: STUDIO_AUTOMATIC_RETRY_LIMIT,
      automatic: "exhausted",
    });

    // ...and (21) it is all row state. Nothing is held in the process, so a
    // Worker restart — or a second instance — reads the same answer. Round-trip
    // through JSON to model exactly what the database hands back.
    const persisted = JSON.parse(
      JSON.stringify({ facts: retryFactsPatch(STUDIO_AUTOMATIC_RETRY_LIMIT), retryable: true }),
    );
    expect(automaticRetryBudgetExhausted(persisted)).toBe(true);
    expect(jobRetryDisposition(persisted)).toBe("automatically_exhausted");
  });

  it("takes the state ONLY from persisted facts, never from a field on the job", () => {
    // `automaticRetry` is a field the SERVER puts on the overview payload for
    // the browser to render. If it were ever read back as input, a caller could
    // hand the scheduler a job that claims to be eligible — and the database,
    // which reads only `facts`, would disagree. The predicate must ignore it.
    const exhausted = {
      retryable: true,
      facts: retryFactsPatch(STUDIO_AUTOMATIC_RETRY_LIMIT),
      automaticRetry: "eligible",
      automatic: "eligible",
      automaticFailures: 0,
    };
    expect(automaticRetryState(exhausted)).toBe("exhausted");
    expect(automaticRetryBudgetExhausted(exhausted)).toBe(true);
    expect(jobRetryDisposition(exhausted)).toBe("automatically_exhausted");

    // And the reverse: a spoofed "exhausted" cannot retire an eligible job.
    const eligible = {
      retryable: true,
      facts: retryFactsPatch(0),
      automaticRetry: "exhausted",
      automatic: "exhausted",
    };
    expect(automaticRetryState(eligible)).toBe("eligible");
    expect(jobRetryDisposition(eligible)).toBe("automatically_eligible");
  });

  it("(20) the fake data layer answers the same question the SQL does", async () => {
    // The fake is the only reason the rest of this suite means anything, so it
    // is checked against the predicate directly rather than trusted.
    const world = makeWorld();
    const jobId = await readyJob(world, "Predicate Parity");
    world.advanceMinutes(20);

    for (const disposition of [
      "automatically_eligible",
      "automatically_exhausted",
      "terminally_nonretryable",
    ] as const) {
      setDisposition(world, jobId, disposition);
      const row = world.data.jobs.get(jobId)!;
      const offered = (await world.data.listDueJobs(900, 5)).some((job) => job.id === jobId);
      const counted = (await world.data.countActiveJobs()) > 0;
      const expected = jobRetryDisposition(row) === "automatically_eligible";
      expect(offered, `${disposition} due`).toBe(expected);
      expect(counted, `${disposition} counted`).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// 1–4 — the due query and the active count
// ---------------------------------------------------------------------------

describe("the due query no longer offers exhausted jobs", () => {
  it("(1) excludes an exhausted job that is otherwise perfectly due", async () => {
    const world = makeWorld();
    const jobId = await readyJob(world, "Exhausted");
    world.advanceMinutes(20);

    expect((await world.data.listDueJobs(900, 5)).map((job) => job.id)).toEqual([jobId]);

    setDisposition(world, jobId, "automatically_exhausted");

    expect(await world.data.listDueJobs(900, 5)).toEqual([]);
  });

  it("(4) excludes an exhausted job from the active count", async () => {
    const world = makeWorld();
    const jobId = await readyJob(world, "Counted");
    world.advanceMinutes(20);
    expect(await world.data.countActiveJobs()).toBe(1);

    setDisposition(world, jobId, "automatically_exhausted");

    expect(await world.data.countActiveJobs()).toBe(0);
    expect((await getOverview(world.deps, OWNER)).activeJobs).toBe(0);
  });

  it("(19) a terminally nonretryable job is absent from both, and unclaimable", async () => {
    const world = makeWorld();
    const jobId = await readyJob(world, "Terminal");
    world.advanceMinutes(20);
    setDisposition(world, jobId, "terminally_nonretryable");

    expect(await world.data.listDueJobs(900, 5)).toEqual([]);
    expect(await world.data.countActiveJobs()).toBe(0);

    // Neither lane can move it. The Owner's own retry is refused too, because
    // `retryable = false` is the database's admission gate for both.
    const result = await processUploadJob(world.deps, OWNER, jobId);
    expect(result.status).toBe("failed");
    expect(world.data.jobs.get(jobId)!.attempt_count).toBe(STUDIO_AUTOMATIC_RETRY_LIMIT);
    expect(jobRetryDisposition(world.data.jobs.get(jobId)!)).toBe("terminally_nonretryable");
  });
});

// ---------------------------------------------------------------------------
// 2, 3 — queue starvation
// ---------------------------------------------------------------------------

describe("five exhausted jobs cannot starve the queue", () => {
  /**
   * The exact shape the review described: five OLDEST exhausted jobs sitting at
   * the front of `ORDER BY created_at ASC`, one newer genuinely due job behind
   * them, one Owner-retryable exhausted job, and one terminally nonretryable
   * job. The batch limit is five, so before the fix the newer job could never
   * appear.
   */
  async function starvationWorld(): Promise<{
    world: FakeWorld;
    capped: string[];
    due: string;
    ownerRetryable: string;
    terminal: string;
  }> {
    const world = makeWorld();
    const capped: string[] = [];
    for (let index = 0; index < STUDIO_AUTOMATIC_RETRY_LIMIT; index += 1) {
      capped.push(await readyJob(world, `Capped ${index}`));
      world.advanceMinutes(1);
    }
    const ownerRetryable = await readyJob(world, "Owner retryable");
    world.advanceMinutes(1);
    const terminal = await readyJob(world, "Terminal");
    world.advanceMinutes(1);
    // Newest of all, so it is last in the ordering and first to starve.
    const due = await readyJob(world, "Genuinely due");
    world.advanceMinutes(20);

    for (const jobId of capped) setDisposition(world, jobId, "automatically_exhausted");
    setDisposition(world, ownerRetryable, "automatically_exhausted");
    setDisposition(world, terminal, "terminally_nonretryable");
    return { world, capped, due, ownerRetryable, terminal };
  }

  it("(2, 3) returns the newer eligible job instead of five older exhausted ones", async () => {
    const { world, capped, due } = await starvationWorld();

    const batch = await world.data.listDueJobs(900, 5);

    // (3) The sixth job is returned...
    expect(batch.map((job) => job.id)).toEqual([due]);
    // ...(2) and not one exhausted row consumed a slot. If the exclusion ran
    // after ORDER BY/LIMIT the batch would have been the five capped ids and
    // this would be empty.
    for (const jobId of capped) {
      expect(batch.map((job) => job.id)).not.toContain(jobId);
    }
    expect(batch).toHaveLength(1);
  });

  it("(2) the exclusion is applied before the limit, not after it", async () => {
    const { world, due } = await starvationWorld();

    // A limit of ONE is the sharpest form of the question: with the predicate
    // applied first, the single returned row is the eligible job; applied
    // afterwards, the one row taken would be the oldest capped job and the
    // result would be empty.
    const batch = await world.data.listDueJobs(900, 1);

    expect(batch.map((job) => job.id)).toEqual([due]);
  });

  it("(3, 11) processes the genuinely due job and touches no exhausted one", async () => {
    const { world, capped, due, ownerRetryable, terminal } = await starvationWorld();
    const attemptsBefore = new Map(
      [...capped, ownerRetryable, terminal].map((id) => [
        id,
        world.data.jobs.get(id)!.attempt_count,
      ]),
    );
    const storageBefore = world.storage.objects.size;

    const resumed = await resumeDueJobs(world.deps, OWNER);

    expect(resumed.results.map((result) => result.jobId)).toEqual([due]);
    expect(world.data.jobs.get(due)!.status).toBe("published");
    // (11) Not one exhausted job was claimed, so not one attempt_count moved...
    for (const [jobId, before] of attemptsBefore) {
      expect(world.data.jobs.get(jobId)!.attempt_count, jobId).toBe(before);
      expect(world.data.jobs.get(jobId)!.status, jobId).toBe("failed");
    }
    // ...and none of them touched storage.
    expect(world.storage.objects.size).toBe(storageBefore);
  });

  it("(10, 11) the scheduled tick cannot claim an exhausted job either", async () => {
    const { world, capped, due } = await starvationWorld();
    const attemptsBefore = capped.map((id) => world.data.jobs.get(id)!.attempt_count);

    const tick = await runScheduledStudioTick(world.deps, {});

    // The tick saw exactly the eligible job — the exhausted ones were never
    // even offered, so they are not "skipped", they are absent.
    expect(tick.due).toBe(1);
    expect(tick.published).toBe(1);
    expect(tick.skipped).toBe(0);
    expect(world.data.jobs.get(due)!.status).toBe("published");
    capped.forEach((id, index) => {
      expect(world.data.jobs.get(id)!.attempt_count).toBe(attemptsBefore[index]);
    });
  });

  it("(4, 5) the active count reflects only genuine automatic work", async () => {
    const { world, due } = await starvationWorld();

    // Seven failed jobs exist; exactly one is automatic work.
    expect(await world.data.countActiveJobs()).toBe(1);
    const overview = await getOverview(world.deps, OWNER);
    expect(overview.activeJobs).toBe(1);

    await resumeDueJobs(world.deps, OWNER);
    expect(world.data.jobs.get(due)!.status).toBe("published");

    // (5, 6) With the last genuine job published, the number the dashboard
    // polls on reaches zero even though seven failed jobs remain on the row.
    expect(await world.data.countActiveJobs()).toBe(0);
    expect((await getOverview(world.deps, OWNER)).activeJobs).toBe(0);
  });

  it("(7) every failure stays fully visible in history", async () => {
    const { world, capped, ownerRetryable, terminal } = await starvationWorld();

    const overview = await getOverview(world.deps, OWNER);
    const byId = new Map(overview.jobs.map((job) => [job.id, job]));

    for (const jobId of [...capped, ownerRetryable]) {
      const job = byId.get(jobId)!;
      expect(job.status).toBe("failed");
      expect(job.errorCode).toBe("object_stat_failed");
      expect(job.attemptCount).toBe(STUDIO_AUTOMATIC_RETRY_LIMIT);
      // (8) Still the Owner's to retry, and the UI is told so explicitly.
      expect(job.retryable).toBe(true);
      expect(job.automaticRetry).toBe("exhausted");
    }
    const terminalJob = byId.get(terminal)!;
    expect(terminalJob.status).toBe("failed");
    expect(terminalJob.retryable).toBe(false);
    expect(terminalJob.attemptCount).toBe(STUDIO_AUTOMATIC_RETRY_LIMIT);
  });
});

// ---------------------------------------------------------------------------
// 8, 9, 12–18 — the Owner-controlled lane
// ---------------------------------------------------------------------------

describe("Owner-controlled retry of an exhausted job", () => {
  it("(9, 12) claims and publishes it, without resetting attempt_count", async () => {
    const world = makeWorld();
    const jobId = await readyJob(world, "Owner Retry");
    world.advanceMinutes(20);
    setDisposition(world, jobId, "automatically_exhausted");
    const attemptsBefore = world.data.jobs.get(jobId)!.attempt_count;

    // Exactly what the dashboard Retry control calls. No SQL, no hand-editing.
    const result = await processUploadJob(world.deps, OWNER, jobId);

    expect(result.status).toBe("published");
    const job = world.data.jobs.get(jobId)!;
    expect(job.attempt_count).toBeGreaterThan(attemptsBefore);
    expect(job.attempt_count).toBe(attemptsBefore + 1);
  });

  it("(13) a failed controlled retry hands a fresh bounded budget back", async () => {
    // A RETRYABLE failure, not a refusal: a provider refusal is a
    // StudioAccessError and therefore terminal by design, which would prove
    // nothing about the budget. A transport fault on the object plane is the
    // real shape — it is exactly what exhausted this job in the first place.
    const world = makeWorld({ r2Runtime: "worker" });
    world.flags.writeProvider = "r2";
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Budget Refresh" },
      files: [{ name: "material-01.jpg", materialPurpose: "project_photo" }],
    });
    const { uploadAllViaTransport } = await import("./fakes");
    await uploadAllViaTransport(world, started.uploads);
    await world.data.requestJobProcessing(started.jobId, `ready-${started.jobId}`, 900);
    world.advanceMinutes(20);
    setDisposition(world, started.jobId, "automatically_exhausted");
    expect(await world.data.listDueJobs(900, 5)).toEqual([]);

    const restore = world.workerR2.failBinding("private_source", "head");
    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    restore();

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("object_stat_failed");
    const job = world.data.jobs.get(started.jobId)!;
    // The Owner's decision restored the automatic lane: streak zeroed, state
    // eligible, `retryable` untouched — and the due query offers it again.
    expect(automaticFailureCount(job)).toBe(0);
    expect(automaticRetryState(job)).toBe("eligible");
    expect(job.retryable).toBe(true);
    expect(jobRetryDisposition(job)).toBe("automatically_eligible");
    expect((await world.data.listDueJobs(900, 5)).map((row) => row.id)).toEqual([started.jobId]);
    // And the new sequence is bounded again, not unbounded.
    expect(automaticFailureCount(job)).toBeLessThan(STUDIO_AUTOMATIC_RETRY_LIMIT);
  });

  it("(14, 15) concurrent controlled retries have exactly one winner", async () => {
    const world = makeWorld();
    const jobId = await readyJob(world, "Concurrent Retry");
    world.advanceMinutes(20);
    setDisposition(world, jobId, "automatically_exhausted");
    const attemptsBefore = world.data.jobs.get(jobId)!.attempt_count;

    const results = await Promise.all([
      processUploadJob(world.deps, OWNER, jobId),
      processUploadJob(world.deps, OWNER, jobId),
      processUploadJob(world.deps, OWNER, jobId),
    ]);

    // Exactly one request claimed and published. The losers report the state
    // they observed rather than inventing a second attempt — the claim is the
    // single winner, not the response.
    expect(results.filter((result) => result.status === "published")).toHaveLength(1);
    expect(results.every((result) => result.status !== "failed")).toBe(true);
    expect(world.data.jobs.get(jobId)!.status).toBe("published");
    // One claim, so exactly one increment...
    expect(world.data.jobs.get(jobId)!.attempt_count).toBe(attemptsBefore + 1);
    // ...(15) and one project, not three.
    expect(world.executor.store.projects).toHaveLength(1);
  });

  it("(15, 16, 17, 18) recovers the existing job in place, with no re-upload", async () => {
    const world = makeWorld();
    world.flags.writeProvider = "r2";
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Sanitized Pilot Equivalent" },
      files: [
        { name: "material-01.jpg", materialPurpose: "project_photo" },
        { name: "material-02.jpg", materialPurpose: "project_photo" },
        { name: "material-03.jpg", materialPurpose: "project_photo" },
        { name: "material-04.pdf", materialPurpose: "brochure" },
        { name: "material-05.pdf", materialPurpose: "price_list" },
        { name: "material-06.pdf", materialPurpose: "developer_profile" },
      ],
    });
    const { uploadAllViaTransport, TEST_R2_BUCKETS } = await import("./fakes");
    await uploadAllViaTransport(world, started.uploads);
    await world.data.requestJobProcessing(started.jobId, `ready-${started.jobId}`, 900);
    world.advanceMinutes(20);
    setDisposition(world, started.jobId, "automatically_exhausted");

    const objectsBefore = world.r2.keys(TEST_R2_BUCKETS.privateSources).slice().sort();
    expect(objectsBefore).toHaveLength(6);
    const jobsBefore = world.data.jobs.size;

    const result = await processUploadJob(world.deps, OWNER, started.jobId);

    expect(result.status).toBe("published");
    // (15) Exactly one project, (16) the SAME six objects reused untouched,
    // (17) nothing in Supabase Storage, (18) the provider unchanged.
    expect(world.executor.store.projects).toHaveLength(1);
    expect(world.r2.keys(TEST_R2_BUCKETS.privateSources).slice().sort()).toEqual(objectsBefore);
    expect(world.storage.objects.size).toBe(0);
    expect(
      (world.data.jobs.get(started.jobId)!.facts as { storage?: { provider?: string } }).storage
        ?.provider,
    ).toBe("r2");
    expect(world.data.jobs.size).toBe(jobsBefore);
  });
});

// ---------------------------------------------------------------------------
// 5, 6 — what the dashboard is told
// ---------------------------------------------------------------------------

describe("what the dashboard is told about an exhausted job", () => {
  it("(5, 6) reports zero active work, so no banner and no polling", async () => {
    const world = makeWorld();
    const jobId = await readyJob(world, "Only Capped");
    world.advanceMinutes(20);
    setDisposition(world, jobId, "automatically_exhausted");

    const overview = await getOverview(world.deps, OWNER);

    // The dashboard's banner condition is `activeJobs > 0`, its polling
    // condition is `activeJobs > 0`, and its automatic-resume effect returns
    // early on `activeJobs <= 0`. One number decides all three.
    expect(overview.activeJobs).toBe(0);
    // The job is still there, still failed, still explicable, still retryable.
    expect(overview.jobs.map((job) => job.id)).toContain(jobId);
  });

  it("(6) a dashboard-shaped poll loop makes no resume call at all", async () => {
    const world = makeWorld();
    await readyJob(world, "Only Capped");
    world.advanceMinutes(20);
    setDisposition(world, [...world.data.jobs.keys()][0], "automatically_exhausted");
    const resumeSpy = vi.spyOn(world.data, "listDueJobs");

    // Three polls of the exact dashboard logic.
    for (let poll = 0; poll < 3; poll += 1) {
      const overview = await getOverview(world.deps, OWNER);
      if (overview.activeJobs > 0) await resumeDueJobs(world.deps, OWNER);
    }

    expect(resumeSpy).not.toHaveBeenCalled();
    resumeSpy.mockRestore();
  });

  it("(5) an eligible job still produces active work, so the banner is honest", async () => {
    const world = makeWorld();
    const capped = await readyJob(world, "Capped");
    world.advanceMinutes(1);
    const live = await readyJob(world, "Live");
    world.advanceMinutes(20);
    setDisposition(world, capped, "automatically_exhausted");

    const overview = await getOverview(world.deps, OWNER);

    expect(overview.activeJobs).toBe(1);
    expect(overview.jobs.find((job) => job.id === live)!.automaticRetry).toBe("eligible");
    expect(overview.jobs.find((job) => job.id === capped)!.automaticRetry).toBe("exhausted");
  });

  it("counts per actor, so one publisher's exhausted job never inflates another view", async () => {
    const world = makeWorld();
    const ownerJob = await readyJob(world, "Owner live", OWNER);
    world.advanceMinutes(1);
    const publisherJob = await readyJob(world, "Publisher capped", PUBLISHER);
    world.advanceMinutes(20);
    setDisposition(world, publisherJob, "automatically_exhausted");

    expect((await getOverview(world.deps, PUBLISHER)).activeJobs).toBe(0);
    expect((await getOverview(world.deps, OWNER)).activeJobs).toBe(1);
    expect(ownerJob).toBeTruthy();
  });
});
