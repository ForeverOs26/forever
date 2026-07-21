/**
 * In-memory Forever Studio dependency fakes.
 *
 * The progressive RPC is modelled by the existing FakeIngestExecutor
 * (statement-for-statement mirror of the verified migration), so the Studio
 * orchestrator is exercised against the same transactional contract the
 * production RPC enforces. Everything else is a small deterministic
 * in-memory double.
 */

import type { ProgressiveWarning } from "@/features/forever-ingestion/batch-types";
import type { ExistingProjectState } from "@/features/forever-ingestion/build-batch";
import { mediaStateKey, priceStateKey } from "@/features/forever-ingestion/build-batch";
import type {
  DependencyCandidate,
  DependencyReader,
} from "@/features/forever-ingestion/dependency-resolution";
import type { FieldProvenanceMap } from "@/features/forever-ingestion/provenance";
import { FakeIngestExecutor } from "@/features/forever-ingestion/tests/fake-ingest-executor";

import type {
  PriceListPdfExtraction,
  StudioActor,
  StudioAuditEntry,
  StudioData,
  StudioDeps,
  StudioJobRow,
  StudioListingRow,
  StudioMembershipRow,
  StudioProjectRow,
  StudioStorage,
} from "../server/contracts";

// ---------------------------------------------------------------------------

export class FakeStorage implements StudioStorage {
  objects = new Map<string, Buffer>();
  signedUploads: string[] = [];

  private key(bucket: string, path: string): string {
    return `${bucket}/${path}`;
  }

  /** Simulates the browser's uploadToSignedUrl. */
  put(bucket: string, path: string, data: Buffer | string): void {
    this.objects.set(this.key(bucket, path), Buffer.isBuffer(data) ? data : Buffer.from(data));
  }

  async createSignedUpload(bucket: string, path: string): Promise<{ token: string }> {
    this.signedUploads.push(this.key(bucket, path));
    return { token: `signed-${path}` };
  }

  async listNames(bucket: string, prefix: string): Promise<Set<string>> {
    const names = new Set<string>();
    const fullPrefix = `${bucket}/${prefix}/`;
    for (const key of this.objects.keys()) {
      if (!key.startsWith(fullPrefix)) continue;
      const rest = key.slice(fullPrefix.length);
      if (!rest.includes("/")) names.add(rest);
    }
    return names;
  }

  async download(bucket: string, path: string): Promise<Buffer | null> {
    return this.objects.get(this.key(bucket, path)) ?? null;
  }

  async upload(bucket: string, path: string, data: Buffer): Promise<void> {
    this.objects.set(this.key(bucket, path), data);
  }

  publicUrl(bucket: string, path: string): string {
    return `https://cdn.test/${bucket}/${path}`;
  }
}

// ---------------------------------------------------------------------------

interface FakeListingStored extends StudioListingRow {
  [key: string]: unknown;
}

export class FakeData implements StudioData {
  members: StudioMembershipRow[] = [];
  jobs = new Map<string, StudioJobRow>();
  listings: FakeListingStored[] = [];
  listingWarnings: Array<{ listingId: string; warning: ProgressiveWarning }> = [];
  audits: StudioAuditEntry[] = [];
  authUsers: Array<{ id: string; email: string }> = [];
  private sequence = 0;

  constructor(private executor: FakeIngestExecutor) {}

  async getMembership(userId: string) {
    return this.members.find((row) => row.user_id === userId) ?? null;
  }
  async listMembers() {
    return [...this.members];
  }
  async upsertMembership(row: StudioMembershipRow) {
    const index = this.members.findIndex((member) => member.user_id === row.user_id);
    if (index >= 0) this.members[index] = row;
    else this.members.push(row);
  }
  async countActiveOwners() {
    return this.members.filter((row) => row.role === "owner" && row.is_active).length;
  }
  async countMembers() {
    return this.members.length;
  }

  async findProjectBySlug(slug: string): Promise<StudioProjectRow | null> {
    const row = this.executor.store.projects.find((project) => project.slug === slug);
    if (!row) return null;
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      public_status: row.public_status,
      is_active: row.is_active,
      main_image_url: (row.main_image_url as string | null) ?? null,
      brochure_url: (row.brochure_url as string | null) ?? null,
      updated_at: null,
    };
  }
  async listProjects(): Promise<StudioProjectRow[]> {
    const slugs = this.executor.store.projects.map((row) => row.slug);
    const rows = await Promise.all(slugs.map((slug) => this.findProjectBySlug(slug)));
    return rows.filter((row): row is StudioProjectRow => row !== null);
  }

  async getListing(id: string) {
    return this.listings.find((row) => row.id === id) ?? null;
  }
  async findListingBySlug(slug: string) {
    return this.listings.find((row) => row.slug === slug) ?? null;
  }
  async insertListing(row: Record<string, unknown>) {
    this.sequence += 1;
    const id = `listing-${this.sequence}`;
    this.listings.push({
      ...(row as FakeListingStored),
      id,
      updated_at: null,
    });
    return { id };
  }
  async updateListing(id: string, patch: Record<string, unknown>) {
    const index = this.listings.findIndex((row) => row.id === id);
    if (index < 0) throw new Error(`listing not found: ${id}`);
    this.listings[index] = { ...this.listings[index], ...patch, id };
  }
  async listListings() {
    return [...this.listings];
  }
  async insertListingWarnings(listingId: string, warnings: ProgressiveWarning[]) {
    for (const warning of warnings) this.listingWarnings.push({ listingId, warning });
  }

  async createJob(row: StudioJobRow) {
    this.jobs.set(row.id, structuredClone(row));
  }
  async getJob(id: string) {
    const job = this.jobs.get(id);
    return job ? structuredClone(job) : null;
  }
  async updateJob(id: string, patch: Partial<StudioJobRow>) {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`job not found: ${id}`);
    this.jobs.set(id, { ...job, ...structuredClone(patch) });
  }
  async listJobs(limit: number) {
    return [...this.jobs.values()].slice(-limit).reverse();
  }

  async recordAudit(entry: StudioAuditEntry) {
    this.audits.push(entry);
  }

  /** Rows publicly visible under the listings RLS policy. */
  publicListings(): FakeListingStored[] {
    return this.listings.filter((row) => row.publication_status === "published");
  }
}

// ---------------------------------------------------------------------------

/** Mirrors existing-state.ts against the FakeIngestExecutor store. */
export function fakeFetchExisting(executor: FakeIngestExecutor) {
  return async (slug: string): Promise<ExistingProjectState | undefined> => {
    const project = executor.store.projects.find((row) => row.slug === slug);
    if (!project) return undefined;
    const provenanceOf = (metadata: Record<string, unknown> | undefined): FieldProvenanceMap =>
      (metadata?.field_provenance as FieldProvenanceMap | undefined) ?? {};
    const state: ExistingProjectState = {
      project: {
        values: project,
        fieldProvenance: (project.field_provenance as FieldProvenanceMap) ?? {},
      },
      buildings: {},
      units: {},
      prices: {},
      media: {},
    };
    for (const building of executor.store.buildings.filter(
      (row) => row.project_id === project.id,
    )) {
      state.buildings![building.building_code] = {
        values: building as unknown as Record<string, unknown>,
        fieldProvenance: provenanceOf(building.metadata),
      };
    }
    const unitCodeById = new Map<string, string>();
    for (const unit of executor.store.units.filter((row) => row.project_id === project.id)) {
      unitCodeById.set(unit.id, unit.unit_code);
      state.units![unit.unit_code] = {
        values: unit as unknown as Record<string, unknown>,
        fieldProvenance: provenanceOf(unit.metadata),
      };
    }
    for (const price of executor.store.prices) {
      const unitCode = unitCodeById.get(price.unit_id);
      if (!unitCode) continue;
      const key = priceStateKey({
        unit_code: unitCode,
        price_source: price.price_source ?? undefined,
        source_file: price.source_file ?? undefined,
        source_page: price.source_page ?? undefined,
        price_list_date: price.price_list_date ?? undefined,
      });
      state.prices![key] = {
        values: price as unknown as Record<string, unknown>,
        fieldProvenance: provenanceOf(price.metadata),
      };
    }
    for (const media of executor.store.media.filter((row) => row.project_id === project.id)) {
      state.media![mediaStateKey({ media_type: media.media_type, url: media.url })] = {
        values: media as unknown as Record<string, unknown>,
        fieldProvenance: provenanceOf(media.metadata),
      };
    }
    return state;
  };
}

// ---------------------------------------------------------------------------

export interface FakeWorld {
  deps: StudioDeps;
  executor: FakeIngestExecutor;
  storage: FakeStorage;
  data: FakeData;
  /** Mutable test switches. */
  flags: {
    partnerDemo: boolean;
    ownerBootstrapEmail: string | null;
    nowValue: string;
  };
  pdfExtractions: Map<string, PriceListPdfExtraction>;
  archives: Map<string, Array<{ name: string; data: Buffer }>>;
  developers: DependencyCandidate[];
  locations: DependencyCandidate[];
}

export function makeWorld(): FakeWorld {
  const executor = new FakeIngestExecutor();
  const storage = new FakeStorage();
  const data = new FakeData(executor);
  const flags = {
    partnerDemo: false,
    ownerBootstrapEmail: null as string | null,
    nowValue: "2026-07-21T09:00:00.000Z",
  };
  const pdfExtractions = new Map<string, PriceListPdfExtraction>();
  const archives = new Map<string, Array<{ name: string; data: Buffer }>>();
  const developers: DependencyCandidate[] = [];
  const locations: DependencyCandidate[] = [];

  const reader: DependencyReader = {
    findDevelopers: async (q) =>
      developers.filter((row) => row.slug === q.slug || row.name === q.name),
    findLocations: async (q) =>
      locations.filter((row) => row.slug === q.slug || row.name === q.name),
  };

  let authSequence = 0;
  const deps: StudioDeps = {
    data,
    storage,
    ingest: executor,
    authAdmin: {
      async createUser(email) {
        authSequence += 1;
        const user = { id: `auth-${authSequence}`, email };
        data.authUsers.push(user);
        return { id: user.id };
      },
      async findUserIdByEmail(email) {
        return data.authUsers.find((user) => user.email === email)?.id ?? null;
      },
    },
    reader,
    fetchExisting: fakeFetchExisting(executor),
    extractPriceListPdf: async ({ fileName }) =>
      pdfExtractions.get(fileName) ?? {
        priceList: null,
        warnings: [
          {
            entity: "price",
            code: "price_list_extraction_unavailable",
            severity: "warning",
            message: `${fileName} retained (no pdf tool in tests).`,
          },
        ],
      },
    extractArchive: async ({ fileName }) => ({
      entries: archives.get(fileName) ?? [],
      warnings: [],
    }),
    now: () => flags.nowValue,
    partnerDemoActive: () => flags.partnerDemo,
    ownerBootstrapEmail: () => flags.ownerBootstrapEmail,
  };

  return { deps, executor, storage, data, flags, pdfExtractions, archives, developers, locations };
}

export const OWNER: StudioActor = {
  userId: "user-owner",
  email: "owner@example.com",
  role: "owner",
  displayName: "Owner",
};

export const PUBLISHER: StudioActor = {
  userId: "user-publisher",
  email: "publisher@example.com",
  role: "trusted_publisher",
  displayName: "Publisher",
};

export function enroll(world: FakeWorld, actor: StudioActor): void {
  void world.data.upsertMembership({
    user_id: actor.userId,
    role: actor.role,
    display_name: actor.displayName,
    email: actor.email,
    invited_by: null,
    is_active: true,
  });
}

/** Uploads every declared file of a started job (simulating the browser). */
export function uploadAll(
  world: FakeWorld,
  uploads: Array<{ bucket: string; path: string; name: string }>,
  contents: Record<string, Buffer | string> = {},
): void {
  for (const target of uploads) {
    const body = contents[target.name] ?? Buffer.from(`binary:${target.name}`);
    world.storage.put(target.bucket, target.path, body);
  }
}
