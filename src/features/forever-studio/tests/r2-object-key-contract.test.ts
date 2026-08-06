/**
 * FOREVER-STUDIO-R2-MANUAL-E2E-FAILURE-FORENSICS-006 — the object-key contract.
 *
 * A manual end-to-end attempt on the PR #140 candidate produced four files
 * whose transfer the browser could not confirm, three processing notes, and a
 * page published with 0 units, 0 prices and 0 media.
 *
 * SUPERSEDED WORDING, quoted once and refuted immediately: those notes then read
 * "was declared but never arrived in storage; continuing without it." That
 * sentence asserts physical absence, which a failed lookup cannot establish. The
 * canonical message now reports the lookup and stops there, and
 * FOREVER-PR142-EVIDENCE-SAFE-RENDER-009 derives the rendered message from the
 * warning CODE so a job persisted with the old sentence cannot display it.
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
 *
 * ---------------------------------------------------------------------------
 * THE FORENSIC BOUNDARY, STATED AT THE STRENGTH THE EVIDENCE SUPPORTS
 * (FOREVER-PR141-PR142-EVIDENCE-REVIEW-CORRECTIONS-007)
 * ---------------------------------------------------------------------------
 *
 * An earlier account of this incident said the physical R2 transfer is PROVEN
 * to have failed. It is not. Here is the whole of what was actually observed:
 *
 *   - the browser-side transfer/acknowledgement path REPORTED failure;
 *   - the client placed those files in `failedUploads`;
 *   - later server processing received `statObject = null` for the declared
 *     storage location;
 *   - physical R2 existence remains INACCESSIBLE (`403 code 10000`).
 *
 * The correct classification is therefore:
 *
 *     FIRST OBSERVED FAILURE: BROWSER-TO-R2 TRANSFER OR ACKNOWLEDGEMENT PATH
 *
 * and these three possibilities remain UNRESOLVED between one another:
 *
 *   (a) the bytes never reached R2;
 *   (b) the bytes reached R2 but the acknowledgement — or CORS on the response
 *       — failed, so the browser recorded a failure for a transfer that
 *       physically completed;
 *   (c) an object exists under a production location this environment cannot
 *       enumerate, or under one that differs from the declared path.
 *
 * `statObject = null` distinguishes none of them. It is a NEGATIVE READ through
 * the same credential and code path whose behaviour is in question, not a proof
 * of physical absence.
 *
 * SUPABASE STORAGE, CORRECTED. An earlier account said Supabase Storage holds
 * zero buckets and that file bodies physically cannot be there. That overstates
 * an anonymous `200 []`. Supabase documents that listing buckets requires
 * `SELECT` on `storage.buckets`, so an empty list from an anon caller proves
 * only what that caller was permitted to see. The supportable statement is:
 *
 *     NO SUPABASE STORAGE BUCKETS WERE VISIBLE TO THE ANON CALLER —
 *     PHYSICAL ABSENCE NOT PROVEN
 *
 * The no-fallback assertion at the end of this file remains valuable, but it is
 * CODE-CONTRACT evidence about what this repository does, not production
 * physical evidence about where any particular byte ended up.
 *
 * NOTHING HERE AUTHORIZES A RETRY of the Owner's upload, and nothing here
 * repairs the transport failure. This file, and the PR it belongs to, repair
 * the FINAL-RESULT INTEGRITY defect only.
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
    // them WHICH files were unconfirmed. Pinned here so the privacy contract
    // holds and so the reason for that ambiguity is recorded rather than
    // rediscovered.
    //
    // The wording is also pinned as EVIDENCE-SAFE: it reports the failed lookup
    // and stops there. It must never again assert physical absence
    // (FOREVER-PR142-EVIDENCE-SAFE-RENDER-009).
    for (const warning of missing) {
      expect(warning.message).toContain("Private source file");
      expect(warning.message).toContain("could not be found through its declared storage path");
      expect(warning.message).toContain("Physical storage state is unresolved");
      expect(warning.message).not.toContain("never arrived");
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
    // CODE-CONTRACT EVIDENCE, NOT PRODUCTION PHYSICAL EVIDENCE. This proves
    // what THIS REPOSITORY does on the R2 lane. It says nothing about where any
    // production byte physically is, and it must never be cited as proof that
    // Supabase Storage holds nothing: the anonymous bucket listing that was
    // read returned `200 []`, which reflects that caller's RLS visibility, not
    // physical absence. See the forensic boundary at the top of this file.
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
