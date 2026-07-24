/**
 * Truthful verification-state regression on a genuine ~297 MiB / 38-part
 * archive: storage acceptance is never presented as verification, the first
 * 12-part slice CANNOT produce a fully verified UI state, "byte verification
 * passed" becomes true only at 38/38 hash-verified parts, and the EXACT
 * whole-archive SHA-256 (streamed across the ordered parts) is recorded and
 * is distinct from the digest-of-part-digests.
 */

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { SLICE_MAX_VERIFY_PARTS } from "../server/large-archive";
import { getJobProgress, processUploadJob } from "../server/service";
import { makeWorld, OWNER } from "./fakes";
import {
  buildZipParts,
  patternBytes,
  startArchiveJob,
  uploadArchiveParts,
  type StreamedZipEntry,
} from "./large-archive-fixtures";

const PART = 8 * 1024 * 1024;
const MIB = 1024 * 1024;

describe("truthful byte-verification lifecycle (≈297 MiB, 38 parts)", () => {
  it(
    "12 of 38 verified parts is byte_verifying — never a verified UI state",
    { timeout: 300_000 },
    async () => {
      const world = makeWorld();
      const jobId = await startArchiveJob(world, OWNER, {
        projectFacts: { name: "Verified Manor" },
      });
      // 37 × 8 MiB incompressible entries → ~296.01 MiB total → 38 parts.
      const entries: StreamedZipEntry[] = Array.from({ length: 37 }, (_, index) => ({
        name: `raw/survey-${String(index).padStart(3, "0")}.bin`,
        data: () => patternBytes(8 * MIB, index + 1),
      }));
      const { parts, totalSize } = buildZipParts(entries, PART);
      expect(parts).toHaveLength(38);
      expect(totalSize).toBeLessThan(300 * MIB);
      await uploadArchiveParts(world, OWNER, jobId, "huge.zip", parts, totalSize);

      // Storage acceptance: stored, zero parts verified — truthfully
      // uploaded_unverified, and the progress projection says so.
      const stored = await getJobProgress(world.deps, OWNER, jobId);
      expect(stored.archives[0].status).toBe("uploaded_unverified");
      expect(stored.archives[0].uploadedParts).toBe(38);
      expect(stored.archives[0].verifiedParts).toBe(0);

      // FIRST processing slice: exactly the 12-part verification budget.
      const first = await processUploadJob(world.deps, OWNER, jobId);
      expect(first.status).toBe("processing");
      const after12 = await getJobProgress(world.deps, OWNER, jobId);
      expect(after12.archives[0].partCount).toBe(38);
      expect(after12.archives[0].verifiedParts).toBe(SLICE_MAX_VERIFY_PARTS);
      // The regression the review demanded: a 12/38 slice can NEVER present
      // a verified state.
      expect(after12.archives[0].status).toBe("byte_verifying");
      expect(after12.archives[0].verifiedParts).toBeLessThan(after12.archives[0].partCount);

      // Drive to completion, recording every observed (verifiedParts, status)
      // transition: byte_verified (or any later state) must appear ONLY once
      // all 38 parts are verified.
      let result = first;
      let slices = 1;
      const observed: Array<{ verified: number; status: string }> = [
        { verified: after12.archives[0].verifiedParts, status: after12.archives[0].status },
      ];
      while (result.status === "processing") {
        result = await processUploadJob(world.deps, OWNER, jobId);
        slices += 1;
        const progress = await getJobProgress(world.deps, OWNER, jobId);
        observed.push({
          verified: progress.archives[0].verifiedParts,
          status: progress.archives[0].status,
        });
        if (slices > 60) throw new Error("did not settle within 60 slices");
      }
      expect(result.status).toBe("published");
      for (const step of observed) {
        if (step.verified < 38) {
          expect(["uploaded_unverified", "byte_verifying", "rejected"]).toContain(step.status);
        }
      }
      expect(observed.at(-1)?.verified).toBe(38);

      // The exact whole-archive SHA-256 was recorded from the ordered parts
      // and is NOT the digest-of-part-digests.
      const archives = await world.deps.data.listJobArchives(jobId);
      const exact = createHash("sha256");
      for (const part of parts) exact.update(part);
      expect(archives[0].archive_sha256).toBe(exact.digest("hex"));
      expect(archives[0].composite_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(archives[0].archive_sha256).not.toBe(archives[0].composite_sha256);
      // The server-verified per-part hashes are preserved after completion.
      expect(archives[0].parts.every((part) => part.verified && part.sha256)).toBe(true);
    },
  );
});
