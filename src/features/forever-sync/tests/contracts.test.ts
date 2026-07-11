import { describe, expect, it } from "vitest";

import type { ForeverMedia } from "@/features/forever-database";
import type { ImportBatch, ReferenceScope } from "@/features/forever-import";

import {
  AbstractSyncJob,
  createSyncResult,
  defineSyncConnector,
  emptySyncStats,
  type SyncConnector,
  type SyncContext,
  type SyncJob,
} from "..";
import { makeJob, makeMetadata, makePolicy, makeSource, makeTarget } from "./fixtures";

/** A pure connector that plans every media record for synchronization. No IO. */
const mediaConnector: SyncConnector<ForeverMedia> = defineSyncConnector<ForeverMedia>({
  system: "marketplace",
  entityKind: "media",
  direction: "push",
  plan(records, context: SyncContext) {
    return createSyncResult({
      data: [...records],
      stats: { ...emptySyncStats(), total: records.length, synced: records.length },
      metadata: makeMetadata({ job: context.job, recordCount: records.length }),
    });
  },
});

/** A concrete job whose `collect()` returns in-memory records — no IO. */
class TestMediaSyncJob extends AbstractSyncJob<ForeverMedia> {
  readonly job: SyncJob = makeJob({
    entityKind: "media",
    source: makeSource({ system: "forever_database", id: "fdb-media" }),
    target: makeTarget({ system: "marketplace", id: "market-media" }),
  });

  constructor(
    private readonly records: ForeverMedia[],
    private readonly scope: ReferenceScope = {},
  ) {
    super(mediaConnector, makePolicy());
  }

  protected collect(): readonly ForeverMedia[] {
    return this.records;
  }

  protected toBatch(data: ForeverMedia[]): ImportBatch {
    return { media: data };
  }

  protected referenceScope(): ReferenceScope {
    return this.scope;
  }
}

const media = (overrides: Partial<ForeverMedia> = {}): ForeverMedia => ({
  id: "m-1",
  projectId: "p-1",
  mediaType: "gallery_image",
  title: "Pool",
  url: "https://cdn.example.com/pool.jpg",
  sortOrder: 0,
  isPublic: true,
  ...overrides,
});

describe("AbstractSyncJob wiring", () => {
  it("plans then validates, succeeding when references resolve via scope", () => {
    const job = new TestMediaSyncJob([media()], { projectIds: new Set(["p-1"]) });
    const result = job.plan({ job: job.job, now: "2026-01-01T00:00:00.000Z" });
    expect(result.ok).toBe(true);
    expect(result.status).toBe("succeeded");
    expect(result.data).toHaveLength(1);
    expect(result.stats.synced).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it("surfaces validation errors when a reference cannot be resolved", () => {
    const job = new TestMediaSyncJob([media({ projectId: "ghost" })]);
    const result = job.plan({ job: job.job });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.errors.some((e) => e.code === "unresolved_reference")).toBe(true);
    expect(result.stats.synced).toBe(0);
    expect(result.stats.failed).toBe(1);
  });

  it("carries connector metadata through the job unchanged", () => {
    const job = new TestMediaSyncJob([], { projectIds: new Set(["p-1"]) });
    const context = { job: job.job, now: "2026-01-01T00:00:00.000Z" };
    const result = job.plan(context);
    expect(result.metadata.direction).toBe("push");
    expect(result.metadata.syncedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("noop");
  });
});
