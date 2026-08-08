/**
 * Updating the EXISTING Coralina draft with the full package.
 *
 * The sibling suite (`coralina-archive-end-to-end.test.ts`) proves a
 * `new_development`. This one proves the case that actually matters next: the
 * Owner has a draft with 8 buildings, 198 units and 198 prices already
 * imported, and now uploads the developer's whole package to it.
 *
 * That upload carries a price list. The draft already HAS its pricing. So the
 * question this suite exists to answer is not "does the media arrive" — it is
 * "can a re-upload of the developer's package damage commercial data that is
 * already correct". The answer has to be no, and counting rows is not enough
 * to show it: 198 wrong prices count the same as 198 right ones. Every unit and
 * every price is therefore compared by DEEP EQUALITY, identity included,
 * against a snapshot taken before the upload.
 *
 * Nothing here contacts production, staging, real R2 or any real Coralina file.
 */

import { describe, expect, it } from "vitest";

import { buildJobProgress, composeArchiveMaterials } from "../server/large-archive";
import { MANUAL_REVIEW_LOCATION_CONFLICT } from "../server/entry-association";
import {
  confirmJobArchiveUpload,
  planJobArchiveUpload,
  processUploadJob,
  runScheduledStudioTick,
  startUploadJob,
} from "../server/service";
import type { ExtractedPriceList } from "@/import/types";
import { ARCHIVE_PART_BYTES } from "../studio-types";
import { CORALINA_ENTRIES, BANGTAO_ENTRIES, OVER_LIMIT_ENTRIES } from "./coralina-fixture";
import { buildZipParts, manifestForParts } from "./large-archive-fixtures";
import { assertLocalR2Endpoint } from "./local-r2";
import { withWorkerRuntime } from "./local-r2-binding";
import { makeWorld, OWNER, type FakeWorld } from "./fakes";

const CORALINA_SLUG = "new-project-2026-08-08-ed66405c";
const CORALINA_ID = "project-coralina-existing";
const CORALINA_NAME = "The Title Coralina Kamala";
const BUILDING_CODES = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
const UNIT_COUNT = 198;

/** A second, unrelated project that must be provably untouched. */
const SIERRA_SLUG = "title-sierra";

function workerWorld(): FakeWorld {
  const world = makeWorld({ r2Runtime: "worker" });
  assertLocalR2Endpoint(world.r2.endpoint);
  world.flags.writeProvider = "r2";
  return world;
}

/**
 * The draft exactly as the Owner left it: unpublished, with its buildings,
 * units and prices already imported from the official price list.
 */
function seedExistingCoralinaDraft(world: FakeWorld): void {
  const store = world.executor.store;

  store.projects.push({
    id: CORALINA_ID,
    slug: CORALINA_SLUG,
    name: CORALINA_NAME,
    developer_id: null,
    location_id: null,
    developer_name_raw: "Rhom Bho Property Public Company Limited",
    location_name_raw: "Kamala, Phuket",
    location_area: "Kamala",
    // Draft / Not public — the state the whole release rests on.
    public_status: "draft",
    is_active: false,
    forever_verified: false,
    field_provenance: {},
  });
  world.data.objectOwners.set(`project:${CORALINA_ID}`, OWNER.userId);

  for (const [index, code] of BUILDING_CODES.entries()) {
    store.buildings.push({
      id: `building-${code}`,
      project_id: CORALINA_ID,
      building_code: code,
      name: `Building ${code}`,
      floors_count: 7,
      units_count: null,
      metadata: { seeded: true, ordinal: index },
    });
  }

  // 198 units spread over the eight buildings, each with exactly one price —
  // the shape the earlier price-list import left behind.
  for (let index = 0; index < UNIT_COUNT; index += 1) {
    const code = BUILDING_CODES[index % BUILDING_CODES.length];
    const unitCode = `${code}-${String(index + 1).padStart(3, "0")}`;
    store.units.push({
      id: `unit-${unitCode}`,
      project_id: CORALINA_ID,
      building_id: `building-${code}`,
      unit_code: unitCode,
      unit_type: index % 3 === 0 ? "1 Bedroom" : "2 Bedroom",
      bedrooms: index % 3 === 0 ? 1 : 2,
      bathrooms: 1,
      size_sqm: 41 + (index % 7),
      floor: 1 + (index % 7),
      availability_status: "available",
      metadata: { seeded: true },
    });
    store.prices.push({
      id: `price-${unitCode}`,
      unit_id: `unit-${unitCode}`,
      price: 5_236_272 + index * 1000,
      currency: "THB",
      price_source: "official_price_list",
      source_file: "CLK - Price List V.2. - Updated 17.07.26.pdf",
      source_page: 1,
      price_list_date: "2026-07-17",
      metadata: { seeded: true },
    });
  }

  // An unrelated project, to prove the blast radius is one project wide.
  store.projects.push({
    id: "project-title-sierra",
    slug: SIERRA_SLUG,
    name: "Title Sierra",
    developer_id: null,
    location_id: null,
    developer_name_raw: null,
    location_name_raw: "Bangtao, Phuket",
    location_area: "Bangtao",
    public_status: "published",
    is_active: true,
    forever_verified: false,
    field_provenance: {},
  });
  world.data.objectOwners.set("project:project-title-sierra", OWNER.userId);
}

/**
 * A price list that would REALLY damage the draft if it were applied.
 *
 * A vacuous fixture would make the deep-equality assertions pass for the wrong
 * reason, so this one is shaped exactly like a parsed price list and aimed
 * straight at the seeded units: the same unit codes, a different price, a
 * different availability and a different price-list date. If Forever ever
 * applies it, the before/after comparison cannot come back equal.
 */
function collidingPriceList(): ExtractedPriceList {
  const fact = <T>(value: T) => ({ value, status: "source_verified" as const });
  return {
    price_list_date: fact("2026-08-08"),
    unit_inventory: Array.from({ length: 12 }, (_, index) => {
      const code = BUILDING_CODES[index % BUILDING_CODES.length];
      return {
        source_row: index + 1,
        unit_code: fact(`${code}-${String(index + 1).padStart(3, "0")}`),
        price: fact(999_999),
        currency: fact("THB"),
        availability_status: fact("sold"),
      };
    }),
  };
}

/** A structural snapshot deep enough that 198 WRONG rows cannot pass as 198 right ones. */
function snapshot(world: FakeWorld) {
  const store = world.executor.store;
  const clone = <T>(rows: T[]) =>
    structuredClone(rows).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {
    projects: clone(store.projects),
    buildings: clone(store.buildings.filter((row) => row.project_id === CORALINA_ID)),
    units: clone(store.units.filter((row) => row.project_id === CORALINA_ID)),
    prices: clone(
      store.prices.filter((row) =>
        store.units.some((unit) => unit.id === row.unit_id && unit.project_id === CORALINA_ID),
      ),
    ),
    sierra: clone(store.projects.filter((row) => row.slug === SIERRA_SLUG)),
  };
}

/** Upload the whole package into the EXISTING draft, then close the browser. */
async function updateExistingDraft(world: FakeWorld) {
  const built = buildZipParts(CORALINA_ENTRIES, ARCHIVE_PART_BYTES);
  const partSha256 = manifestForParts(built.parts);

  const started = await withWorkerRuntime(world.workerR2.env, () =>
    startUploadJob(world.deps, OWNER, {
      workflow: "project_update",
      // The existing slug is SELECTED, not derived. Nothing here states a
      // name, a location or a fact: this upload is materials only.
      projectSlug: CORALINA_SLUG,
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

  const first = await withWorkerRuntime(world.workerR2.env, () =>
    processUploadJob(world.deps, OWNER, started.jobId),
  );
  expect(first.status).toBe("processing");
  return { jobId: started.jobId, archiveId: plan.archiveId, built, partSha256 };
}

async function finishOnScheduledTicks(world: FakeWorld, jobId: string): Promise<void> {
  for (let ticks = 1; ; ticks += 1) {
    if (ticks > 60) throw new Error("scheduled ticks did not finish the update job");
    const summary = await withWorkerRuntime(world.workerR2.env, () =>
      runScheduledStudioTick(world.deps, { maxSlices: 3 }),
    );
    world.advanceMinutes(5);
    if (summary.completed > 0) break;
  }
  const job = await world.deps.data.getJob(jobId);
  expect(job!.status).toBe("published");
}

describe("updating the existing Coralina draft with the full package", () => {
  it("adds approved material without touching one unit, one price or the draft's identity", async () => {
    const world = workerWorld();
    seedExistingCoralinaDraft(world);
    // The extractor is willing — refusing the archive price list has to be
    // Forever's decision, not a fixture that happened to fail.
    world.deps.extractPriceListPdf = async () => ({
      priceList: collidingPriceList(),
      warnings: [],
    });

    const before = snapshot(world);
    expect(before.units).toHaveLength(UNIT_COUNT);
    expect(before.prices).toHaveLength(UNIT_COUNT);
    expect(before.buildings).toHaveLength(BUILDING_CODES.length);

    const { jobId, archiveId } = await updateExistingDraft(world);
    await finishOnScheduledTicks(world, jobId);

    const after = snapshot(world);
    const store = world.executor.store;

    // --- 1. still exactly ONE Coralina, same identity --------------------
    const coralinas = store.projects.filter(
      (row) => row.slug === CORALINA_SLUG || row.name === CORALINA_NAME,
    );
    expect(coralinas).toHaveLength(1);
    expect(coralinas[0].id).toBe(CORALINA_ID);
    expect(coralinas[0].slug).toBe(CORALINA_SLUG);

    // --- 2. still Draft / Not public, with no public page ----------------
    expect(coralinas[0].public_status).toBe("draft");
    expect(coralinas[0].is_active).toBe(false);
    // "Not public" is exactly the two-field condition the public site reads:
    // published AND active. Asserting the pair is what makes this a statement
    // about visibility rather than about one column — and the only project that
    // satisfies it is the unrelated one that was already published.
    const publiclyVisible = store.projects.filter(
      (row) => row.is_active && row.public_status === "published",
    );
    expect(publiclyVisible.map((row) => row.slug)).toEqual([SIERRA_SLUG]);

    // --- 3. buildings, units and prices are DEEPLY unchanged -------------
    expect(after.buildings).toEqual(before.buildings);
    expect(after.units).toEqual(before.units);
    expect(after.prices).toEqual(before.prices);
    // Counts too, stated separately so a regression names itself clearly.
    expect(after.units).toHaveLength(UNIT_COUNT);
    expect(after.prices).toHaveLength(UNIT_COUNT);

    // --- 4. the archive price list was refused, and said so --------------
    const composed = await composeArchiveMaterials(
      world.deps,
      (await world.deps.data.getJob(jobId))!,
      0,
    );
    // The archive DID contain one — the refusal is a decision, not an absence.
    expect(composed.priceList).toBeTruthy();
    const job = await world.deps.data.getJob(jobId);
    const resultWarnings = (job!.result_summary?.warnings ?? []) as Array<{
      code: string;
      message: string;
    }>;
    const preserved = resultWarnings.find(
      (warning) => warning.code === "price_list_existing_project_ignored",
    );
    expect(preserved, "the Owner must be told the existing pricing was kept").toBeTruthy();
    expect(preserved!.message.toLowerCase()).toContain("not applied");
    expect(preserved!.message.toLowerCase()).toContain("preserved");

    // --- 5. approved media DID land, on this draft only ------------------
    const coralinaMedia = store.media.filter((row) => row.project_id === CORALINA_ID);
    expect(coralinaMedia.length).toBeGreaterThan(0);
    expect(store.media.every((row) => row.project_id === CORALINA_ID)).toBe(true);

    // --- 6. Bangtao stayed private, with the review reason ---------------
    const entries = await world.deps.data.listJobArchiveEntries(jobId);
    const byName = new Map(entries.map((entry) => [entry.entry_name, entry]));
    for (const name of BANGTAO_ENTRIES) {
      expect(byName.get(name)!.state, name).toBe("retained_private");
      expect(byName.get(name)!.outcome_code, name).toBe(MANUAL_REVIEW_LOCATION_CONFLICT);
    }
    // And none of those bytes reached the project's media.
    for (const name of BANGTAO_ENTRIES) {
      const sha = byName.get(name)!.sha256!;
      expect(coralinaMedia.some((row) => row.url.includes(sha))).toBe(false);
    }

    // --- 7. large files: private, truthful, independently retrievable ----
    for (const name of OVER_LIMIT_ENTRIES) {
      const entry = byName.get(name)!;
      expect(entry.state, name).toBe("retained_private");
      expect(entry.outcome_code, name).toBe("entry_over_size_limit");
      expect(entry.evidence, name).toBeTruthy();
      expect(entry.sha256, name).toMatch(/^[0-9a-f]{64}$/);
    }
    // No video was presented as added.
    expect(coralinaMedia.some((row) => row.media_type === "video")).toBe(false);

    // --- 8. the review count reaches the Owner ---------------------------
    const progress = await buildJobProgress(world.deps, job!);
    expect(progress.manualReview).toBe(BANGTAO_ENTRIES.length);
    expect(progress.archives[0].archiveId).toBe(archiveId);

    // --- 9. the unrelated project is untouched ---------------------------
    expect(after.sierra).toEqual(before.sierra);
  }, 240_000);

  it("stays idempotent: a retried upload creates no second job, archive or project", async () => {
    const world = workerWorld();
    seedExistingCoralinaDraft(world);
    world.deps.extractPriceListPdf = async () => ({
      priceList: collidingPriceList(),
      warnings: [],
    });

    const before = snapshot(world);
    const { jobId, built, partSha256 } = await updateExistingDraft(world);
    const jobsAfterFirst = world.data.jobs.size;
    const archivesAfterFirst = world.data.archives.size;

    // The browser lost the response and repeats plan + confirm twice.
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

    const after = snapshot(world);
    expect(world.executor.store.projects.filter((row) => row.slug === CORALINA_SLUG)).toHaveLength(
      1,
    );
    expect(world.data.jobs.size).toBe(jobsAfterFirst);
    // The retry changed nothing about the commercial data either.
    expect(after.units).toEqual(before.units);
    expect(after.prices).toEqual(before.prices);
    expect(after.buildings).toEqual(before.buildings);
  }, 240_000);
});
