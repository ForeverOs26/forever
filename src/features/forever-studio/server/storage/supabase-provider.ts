/**
 * Forever Studio — the LEGACY Supabase Storage provider.
 *
 * It is the same behaviour production runs today, expressed through the
 * provider contract: signed-upload tokens for ordinary files, many fixed-size
 * part objects in the private staging bucket for a large archive, and public
 * derivatives in the Supabase public buckets served from their Supabase URLs.
 *
 * It exists for exactly one reason after the cutover: jobs and manifests
 * created BEFORE the cutover must keep resuming, retrying and reading through
 * the path they were created on. It is never selected as a fallback for a
 * failing R2 operation — only for a job that genuinely records `supabase` (or
 * records no provider at all, which is the same thing).
 *
 * This module contains no R2 concept whatsoever.
 */

import type { StudioArchivePartTarget } from "../../studio-types";
import type { StudioStorage } from "../contracts";
import { archivePartFolder, archivePartIndexFromName, archivePartPath } from "./archive-paths";
import { PartedArchiveReader, type PartedArchiveLayout } from "./parted-archive-reader";
import type {
  StudioAcceptedPart,
  StudioAllocatedUpload,
  StudioArchiveGeometry,
  StudioArchiveStorageState,
  StudioObjectLocator,
  StudioStorageProvider,
} from "./provider";
import { bucketKindForLogicalBucket, LOGICAL_PRIVATE_SOURCE_BUCKET } from "./r2-layout";

/**
 * Where the legacy Supabase lane keeps one archive's parts. Byte-identical to
 * the paths production already wrote — this names them, it does not move them.
 */
const SUPABASE_ARCHIVE_LAYOUT: PartedArchiveLayout = {
  bucket: LOGICAL_PRIVATE_SOURCE_BUCKET,
  pathFor: (geometry, index) => archivePartPath(geometry.jobId, geometry.archiveId, index),
};

export function createSupabaseStorageProvider(storage: StudioStorage): StudioStorageProvider {
  const partTarget = async (
    geometry: StudioArchiveGeometry,
    index: number,
  ): Promise<StudioArchivePartTarget> => {
    const path = archivePartPath(geometry.jobId, geometry.archiveId, index);
    const { token } = await storage.createSignedUpload(LOGICAL_PRIVATE_SOURCE_BUCKET, path);
    return {
      index,
      bucket: LOGICAL_PRIVATE_SOURCE_BUCKET,
      path,
      token,
      transport: { kind: "supabase_signed", bucket: LOGICAL_PRIVATE_SOURCE_BUCKET, path, token },
    };
  };

  return {
    id: "supabase",
    objects: storage,

    // The Supabase lane keeps an archive as many permanent part objects, so
    // "which parts does storage hold" is an ordinary bounded folder listing.
    // That authority exists on every host, so the lane is always available.
    archiveControlPlane: "available",

    async allocateOrdinaryUpload(input): Promise<StudioAllocatedUpload> {
      const { token } = await storage.createSignedUpload(input.bucket, input.path);
      return {
        bucket: input.bucket,
        path: input.path,
        transport: {
          kind: "supabase_signed",
          bucket: input.bucket,
          path: input.path,
          token,
        },
      };
    },

    async beginArchiveUpload(): Promise<StudioArchiveStorageState> {
      // Part objects are addressed deterministically from (job, archive, index);
      // there is nothing extra to remember.
      return { provider: "supabase" };
    },

    async archivePartTargets({ geometry, indexes }) {
      const targets: StudioArchivePartTarget[] = [];
      for (const index of indexes) targets.push(await partTarget(geometry, index));
      return targets;
    },

    async listAcceptedArchiveParts({ geometry }) {
      const listed = await storage.listObjects(
        LOGICAL_PRIVATE_SOURCE_BUCKET,
        archivePartFolder(geometry.jobId, geometry.archiveId),
      );
      const accepted = new Map<number, StudioAcceptedPart>();
      for (const object of listed) {
        const index = archivePartIndexFromName(object.name);
        if (index === null) continue;
        accepted.set(index, { size: object.size });
      }
      return accepted;
    },

    async completeArchiveUpload({ state }) {
      // Acceptance IS completion on this lane: the parts are already durable
      // objects and the ranged reader assembles them on demand.
      return state;
    },

    async abortArchiveUpload() {
      // Never destructive: a Supabase archive's parts are the privately
      // retained original and must survive an abandoned upload.
    },

    async discardArchiveParts({ geometry, indexes }) {
      if (!indexes.length) return;
      await storage.remove(
        LOGICAL_PRIVATE_SOURCE_BUCKET,
        indexes.map((index) => archivePartPath(geometry.jobId, geometry.archiveId, index)),
      );
    },

    archiveReader({ geometry, totalSize }) {
      return new PartedArchiveReader(storage, SUPABASE_ARCHIVE_LAYOUT, geometry, totalSize);
    },

    buildPublicUrl(bucket, path) {
      if (bucketKindForLogicalBucket(bucket) !== "public_media") {
        throw new Error("studio_public_url_forbidden_bucket");
      }
      return storage.publicUrl(bucket, path);
    },

    locatorFor(bucket, path): StudioObjectLocator {
      const bucketKind = bucketKindForLogicalBucket(bucket);
      if (!bucketKind) throw new Error("studio_unknown_logical_bucket");
      return { storageProvider: "supabase", bucketKind, bucket, objectKey: path };
    },
  };
}
