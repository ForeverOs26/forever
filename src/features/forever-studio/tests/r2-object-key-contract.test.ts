/**
 * FOREVER-STUDIO-R2-MANUAL-E2E-FAILURE-FORENSICS-006 — the object-key contract.
 *
 * A manual end-to-end attempt on the PR #140 candidate produced four files the
 * UI reported as failed to upload, three enrichment notes reading "was declared
 * but never arrived in storage; continuing without it", and a page published
 * with 0 units, 0 prices and 0 media.
 *
 * One hypothesis for "never arrived" is a KEY MISMATCH: the application writes
 * an object under one R2 key and later looks for it under another. The R2 and
 * Supabase lanes genuinely do use different staging-path schemes
 * (`stagingPathForProvider`), and the filenames in question carry spaces, a
 * hyphen-space-hyphen run, multiple dots and a `sq.m.` fragment — exactly the
 * shapes that break naive key handling.
 *
 * THIS TEST EXISTS TO SETTLE THAT MECHANICALLY RATHER THAN BY INSPECTION, and
 * it is deliberately written to FAIL LOUDLY if a mismatch is ever introduced.
 * It traces the whole path with the Owner's real filenames:
 *
 *   browser declaration → upload authorization → provider key → presigned PUT
 *   → physical object → persisted metadata → extraction `statObject` lookup
 *
 * It runs against the in-process, disposable S3-compatible harness, which
 * recomputes the same SigV4 signature production uses. No socket leaves the
 * process; nothing here can reach production R2 or Supabase.
 *
 * NOTE ON SCOPE. Proving the key round-trips locally does NOT prove why the
 * Owner's production upload failed. Physical R2 inspection for that attempt
 * remains UNRESOLVED pending read access. This test constrains the search: if
 * it passes, the storage-key design is not the fault and must not be "fixed".
 */

import { describe, expect, it } from "vitest";

import { PRIVATE_SOURCE_BUCKET } from "../server/extraction";
import { processUploadJob, startUploadJob } from "../server/service";
import { assertLocalR2Endpoint } from "./local-r2";
import {
  makeWorld,
  OWNER,
  TEST_R2_BUCKETS,
  tinyPdf,
  uploadAllViaTransport,
  type FakeWorld,
} from "./fakes";

/** The Owner's actual filenames from the failed manual attempt, verbatim. */
const PRICE_LIST = "SUB - Price List V.1. - Updated 24.07.2026.pdf";
const SIERRA_PHOTOS = [
  "The Title Sierra Show Unit 30 sq.m.-01.jpg",
  "The Title Sierra Show Unit 30 sq.m.-02.jpg",
  "The Title Sierra Show Unit 30 sq.m.-03.jpg",
];

function r2World(): FakeWorld {
  const world = makeWorld();
  assertLocalR2Endpoint(world.r2.endpoint);
  world.flags.writeProvider = "r2";
  return world;
}

async function startOwnerJob(world: FakeWorld) {
  return startUploadJob(world.deps, OWNER, {
    workflow: "new_development",
    projectFacts: { name: "Sierra Key Contract" },
    files: [
      { name: PRICE_LIST, materialPurpose: "price_list" },
      ...SIERRA_PHOTOS.map((name) => ({ name, materialPurpose: "project_photo" as const })),
    ],
  });
}

/** Bytes that match each declared type, so nothing is rejected on content. */
function bodies(): Record<string, Buffer> {
  const out: Record<string, Buffer> = { [PRICE_LIST]: tinyPdf() };
  for (const name of SIERRA_PHOTOS) out[name] = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]);
  return out;
}

describe("R2 object-key contract — the Owner's exact failed filenames", () => {
  it("derives a staging key that carries NO filename fragment at all", async () => {
    const world = r2World();
    const started = await startOwnerJob(world);

    expect(started.uploads).toHaveLength(4);
    started.uploads.forEach((target, index) => {
      // The R2 lane's key is job id + server-assigned index, by design.
      expect(target.path).toBe(
        `jobs/${started.jobId}/staging/${String(index).padStart(3, "0")}/object`,
      );
    });

    // No fragment of any filename may appear in any key: not the spaces, not
    // the dots, not "sq.m.", not the extension. A key that embedded them is
    // where an encoding bug would live.
    const keys = started.uploads.map((target) => target.path).join("\n");
    for (const fragment of ["SUB", "Price", "Sierra", "sq.m", "24.07.2026", ".pdf", ".jpg", " "]) {
      expect(keys, `filename fragment leaked into an R2 key: ${fragment}`).not.toContain(fragment);
    }
  });

  it("PUTs to, and later stats, the SAME physical key — no mismatch", async () => {
    const world = r2World();
    const started = await startOwnerJob(world);

    await uploadAllViaTransport(world, started.uploads, bodies());

    // The physical object exists at the key the presigned PUT was signed for.
    started.uploads.forEach((target, index) => {
      const physical = `${TEST_R2_BUCKETS.privateSources}/studio/jobs/${started.jobId}/staging/${String(index).padStart(3, "0")}/object`;
      expect(world.r2.objects.has(physical), `missing physical object: ${physical}`).toBe(true);
    });

    // …and extraction's statObject lookup finds every one of them. This is the
    // assertion that settles the hypothesis: a write/read key divergence would
    // surface here as `file_upload_missing`, which is the exact warning the
    // Owner saw in production.
    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    const missing = result.warnings.filter((warning) => warning.code === "file_upload_missing");
    expect(
      missing,
      `statObject failed to find an object that was demonstrably written: ${JSON.stringify(missing)}`,
    ).toEqual([]);

    const job = await world.deps.data.getJob(started.jobId);
    for (const file of job!.files) {
      expect(file.status, `${file.name} did not reach "uploaded"`).not.toBe("missing");
      expect(file.storageProvider).toBe("r2");
      expect(file.stagingBucket).toBe(PRIVATE_SOURCE_BUCKET);
    }
  });

  it("NEGATIVE CONTROL: an object that was never PUT does report file_upload_missing", async () => {
    // Without this, the assertion above could pass because nothing ever checks.
    // Uploading only the price list must leave the three photos missing.
    const world = r2World();
    const started = await startOwnerJob(world);

    const priceListOnly = started.uploads.filter((target) => target.name === PRICE_LIST);
    expect(priceListOnly).toHaveLength(1);
    await uploadAllViaTransport(world, priceListOnly, bodies());

    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    const missing = result.warnings.filter((warning) => warning.code === "file_upload_missing");
    expect(missing).toHaveLength(3);

    // The note is REDACTED by design — `fileWarning` replaces the filename with
    // a neutral label because names carry personal data. This is why the Owner
    // saw three identical "Private source file …" notes and could not tell from
    // them WHICH files were lost. Pinned here so the privacy contract holds and
    // so the reason for that ambiguity is recorded rather than rediscovered.
    for (const warning of missing) {
      expect(warning.message).toContain("Private source file");
      expect(warning.message).toContain("never arrived in storage");
      for (const name of SIERRA_PHOTOS) expect(warning.message).not.toContain(name);
    }
  });

  it("keeps the Supabase lane's own key round-trip intact", async () => {
    // The two lanes use different schemes on purpose. The Supabase scheme keeps
    // a sanitized filename; it must still round-trip for the same names.
    const world = makeWorld();
    world.flags.writeProvider = "supabase";
    const started = await startOwnerJob(world);

    await uploadAllViaTransport(world, started.uploads, bodies());
    const result = await processUploadJob(world.deps, OWNER, started.jobId);

    expect(result.warnings.filter((warning) => warning.code === "file_upload_missing")).toEqual([]);
  });

  it("never writes a private source body into Supabase Storage on the R2 lane", async () => {
    const world = r2World();
    const started = await startOwnerJob(world);
    await uploadAllViaTransport(world, started.uploads, bodies());
    await processUploadJob(world.deps, OWNER, started.jobId);

    // The R2 lane must not fall back to the Supabase object store for bodies.
    const supabaseKeys = [...world.storage.objects.keys()].filter((key) =>
      key.includes(`jobs/${started.jobId}/staging/`),
    );
    expect(supabaseKeys, `Supabase Storage fallback occurred: ${supabaseKeys.join(", ")}`).toEqual(
      [],
    );
  });
});
