/**
 * In-memory production stand-in for direct-publish tests.
 *
 * Mirrors the parts of the real boundary the operation depends on:
 *   - `forever_progressive_ingest` semantics for create/enrich, fingerprint
 *     replay, and `project_slug_exists`;
 *   - the `forever_direct_publish` wrapper's atomic publish;
 *   - storage upserts keyed by bucket/path.
 *
 * The publish step is applied only if the ingest step succeeded, and a thrown
 * ingest discards every change, which is what lets a test assert that a failed
 * publication leaves nothing public.
 */

import { createHash } from "node:crypto";

import type { ProgressiveBatch } from "@/features/forever-ingestion/batch-types";

import type { DirectPublishDeps, DirectPublishSummary, PublicMediaUpload } from "../publish";
import { PRODUCTION_PROJECT_REF, type VerifiedTarget } from "../target";

export const PRODUCTION_TARGET: VerifiedTarget = {
  target: "production",
  projectRef: PRODUCTION_PROJECT_REF,
  url: `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
};

export interface FakeProject {
  id: string;
  slug: string;
  name: string;
  publicStatus: string;
  isActive: boolean;
  mainImageUrl: string | null;
  fields: Record<string, unknown>;
}

export interface FakeMediaRow {
  projectId: string;
  mediaType: string;
  url: string;
  sortOrder: number;
}

function payloadHash(batch: ProgressiveBatch): string {
  const { batch_fingerprint: _ignored, ...body } = batch;
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

export class FakeProductionWorld {
  projects: FakeProject[] = [];
  media: FakeMediaRow[] = [];
  units: Array<{ projectId: string; unitCode: string; availability: string }> = [];
  prices: Array<{ projectId: string; unitCode: string; price: number }> = [];
  buildings: Array<{ projectId: string; buildingCode: string }> = [];
  batches: Array<{
    projectId: string;
    fingerprint: string;
    payloadHash: string;
    summary: DirectPublishSummary;
  }> = [];
  storage = new Map<string, { bytes: Buffer; contentType: string }>();
  directPublishCalls: Array<{ batch: ProgressiveBatch; options: Record<string, string | null> }> =
    [];
  /** Set to make the atomic RPC throw AFTER validation, to test rollback. */
  failDirectPublish: string | null = null;
  /** Set to make one specific public upload fail. */
  failUploadPathIncludes: string | null = null;

  private nextId = 1;

  find(slug: string): FakeProject | undefined {
    return this.projects.find((project) => project.slug === slug);
  }

  private ingest(batch: ProgressiveBatch): DirectPublishSummary {
    const slug = batch.project.slug;
    const existing = this.find(slug);
    const hash = payloadHash(batch);

    if (existing) {
      const stored = this.batches.find(
        (row) => row.projectId === existing.id && row.fingerprint === batch.batch_fingerprint,
      );
      if (stored) {
        if (stored.payloadHash === hash) return { ...stored.summary, replayed: true };
        throw new Error("forever_progressive_ingest: fingerprint_payload_mismatch");
      }
      if (batch.mode === "create")
        throw new Error("forever_progressive_ingest: project_slug_exists");
    } else if (batch.mode === "enrich") {
      throw new Error("forever_progressive_ingest: project_not_found");
    }

    let project = existing;
    if (!project) {
      project = {
        id: `project-${this.nextId++}`,
        slug,
        name: String(batch.project.name ?? slug),
        // Matches the real function: a fresh progressive create is a draft.
        publicStatus: "draft",
        isActive: true,
        mainImageUrl: (batch.project.main_image_url as string | undefined) ?? null,
        fields: { ...batch.project },
      };
      this.projects.push(project);
    } else {
      const set = (batch.project.set ?? {}) as Record<string, unknown>;
      for (const [key, value] of Object.entries(set)) {
        if (value === undefined || value === null) continue;
        project.fields[key] = value;
        if (key === "name") project.name = String(value);
        if (key === "main_image_url") project.mainImageUrl = String(value);
      }
      if (batch.project.publish === true) project.publicStatus = "published";
      if (batch.project.publish === false) project.publicStatus = "draft";
    }

    for (const building of batch.buildings ?? []) {
      if (
        !this.buildings.some(
          (row) => row.projectId === project!.id && row.buildingCode === building.building_code,
        )
      ) {
        this.buildings.push({ projectId: project.id, buildingCode: building.building_code });
      }
    }
    for (const unit of batch.units ?? []) {
      const row = this.units.find(
        (candidate) => candidate.projectId === project!.id && candidate.unitCode === unit.unit_code,
      );
      if (row) row.availability = unit.availability_status ?? row.availability;
      else
        this.units.push({
          projectId: project.id,
          unitCode: unit.unit_code,
          availability: unit.availability_status ?? "available",
        });
    }
    for (const price of batch.prices ?? []) {
      const row = this.prices.find(
        (candidate) =>
          candidate.projectId === project!.id && candidate.unitCode === price.unit_code,
      );
      if (row) row.price = price.price;
      else
        this.prices.push({ projectId: project.id, unitCode: price.unit_code, price: price.price });
    }
    for (const item of batch.media ?? []) {
      const row = this.media.find(
        (candidate) => candidate.projectId === project!.id && candidate.url === item.url,
      );
      if (row) row.sortOrder = item.sort_order ?? row.sortOrder;
      else
        this.media.push({
          projectId: project.id,
          mediaType: item.media_type,
          url: item.url,
          sortOrder: item.sort_order ?? 0,
        });
    }

    const summary: DirectPublishSummary = {
      schema_version: "1",
      mode: batch.mode,
      project_id: project.id,
      project_slug: slug,
      public_status: project.publicStatus,
      counts: {
        buildings: batch.buildings?.length ?? 0,
        units: batch.units?.length ?? 0,
        prices: batch.prices?.length ?? 0,
        media: batch.media?.length ?? 0,
        warnings: batch.warnings?.length ?? 0,
      },
      replayed: false,
    };
    this.batches.push({
      projectId: project.id,
      fingerprint: batch.batch_fingerprint,
      payloadHash: hash,
      summary,
    });
    return summary;
  }

  /** Arrow properties so `this` stays the world without aliasing it. */
  deps = (overrides: Partial<DirectPublishDeps> = {}): DirectPublishDeps => ({
    target: PRODUCTION_TARGET,
    siteOrigin: "https://forever.example",

    projectExists: async (slug) => Boolean(this.find(slug)),

    knownProjectSlugs: async () => this.projects.map((project) => project.slug),

    directPublish: async (batch, options) => {
      this.directPublishCalls.push({ batch, options });
      if (options.source_trust !== "owner_approved_official") {
        throw new Error("forever_direct_publish: source_trust_required");
      }
      if (options.publication_mode !== "direct") {
        throw new Error("forever_direct_publish: publication_mode_required");
      }
      // Snapshot for all-or-nothing behaviour.
      const snapshot = {
        projects: structuredClone(this.projects),
        media: structuredClone(this.media),
        units: structuredClone(this.units),
        prices: structuredClone(this.prices),
        buildings: structuredClone(this.buildings),
        batches: structuredClone(this.batches),
      };
      try {
        const summary = this.ingest(batch);
        if (this.failDirectPublish) throw new Error(this.failDirectPublish);
        const project = this.projects.find((row) => row.id === summary.project_id)!;
        project.publicStatus = "published";
        project.isActive = true;
        return { ...summary, public_status: "published", direct_published: true };
      } catch (error) {
        this.projects = snapshot.projects;
        this.media = snapshot.media;
        this.units = snapshot.units;
        this.prices = snapshot.prices;
        this.buildings = snapshot.buildings;
        this.batches = snapshot.batches;
        throw error;
      }
    },

    uploadPublicMedia: async (item: PublicMediaUpload) => {
      if (this.failUploadPathIncludes && item.path.includes(this.failUploadPathIncludes)) {
        throw new Error("storage upload failed: injected");
      }
      this.storage.set(`${item.bucket}/${item.path}`, {
        bytes: item.bytes,
        contentType: item.contentType,
      });
      return `${PRODUCTION_TARGET.url}/storage/v1/object/public/${item.bucket}/${item.path}`;
    },

    retainEvidence: async (item: PublicMediaUpload) => {
      this.storage.set(`${item.bucket}/${item.path}`, {
        bytes: item.bytes,
        contentType: item.contentType,
      });
    },

    ...overrides,
  });
}

export const OWNER_AUTHORIZATION = {
  role: "owner",
  actorId: "00000000-0000-4000-8000-000000000001",
  actorEmail: null,
};
