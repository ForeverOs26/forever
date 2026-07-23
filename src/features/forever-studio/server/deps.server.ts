/**
 * Forever Studio — production dependency assembly.
 *
 * The ONLY Studio module that touches the service-role client. It is loaded
 * exclusively via dynamic import inside server-function handlers, never from
 * code that ships to the browser (asserted by the bundle-boundary tests).
 *
 * Runtime note: the app deploys to Cloudflare Workers (cloudflare-module,
 * nodejs_compat). Node subprocesses and a writable filesystem are NOT
 * available there, so SIP price-list PDF extraction runs only where a
 * subprocess exists (local / self-hosted) and otherwise degrades to private
 * retention + a warning. Node built-ins that only exist off-Worker are
 * imported dynamically inside a try/catch so importing this module never
 * crashes the Worker.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ProgressiveBatch,
  ProgressiveBatchSummary,
  ProgressiveWarning,
} from "@/features/forever-ingestion/batch-types";
import {
  assertProgressiveBatchStructure,
  PROGRESSIVE_INGEST_FUNCTION,
} from "@/features/forever-ingestion/batch-types";
import type {
  DependencyCandidate,
  DependencyReader,
} from "@/features/forever-ingestion/dependency-resolution";
import { fetchExistingProjectState } from "@/features/forever-ingestion/existing-state";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sanitizePriceList } from "@/intake/sanitize";

import { extractStudioArchive } from "./archive";
import type {
  PriceListPdfExtraction,
  StudioAuditEntry,
  StudioData,
  StudioDeps,
  StudioJobRow,
  StudioListingDetailRow,
  StudioListingPublishRow,
  StudioListingRow,
  StudioMembershipRow,
  StudioObjectDigest,
  StudioObjectStat,
  StudioPrivateContact,
  StudioProjectDetailRow,
  StudioProjectRow,
  StudioStorage,
} from "./contracts";

// The generated Database types predate the Studio/progressive tables, so the
// data layer talks to PostgREST through an untyped client and narrows rows
// itself. Regenerating types.ts stays a follow-up once the migrations apply.
const admin = supabaseAdmin as unknown as SupabaseClient;

function must<T>(result: { data: T; error: { message: string } | null }, context: string): T {
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  return result.data;
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

const PROJECT_COLUMNS =
  "id,slug,name,public_status,is_active,main_image_url,brochure_url,updated_at";
const PROJECT_DETAIL_COLUMNS = "*";
const LISTING_COLUMNS =
  "id,slug,title,publication_status,project_id,price,currency,photos,updated_at";
const LISTING_DETAIL_COLUMNS =
  "id,slug,title,publication_status,project_id,project_name_raw,location_id,location_name_raw,property_type,bedrooms,bathrooms,area_sqm,price,currency,availability_status,description,photos,field_provenance,updated_at";

function createStudioData(): StudioData {
  const ownedObjectIds = async (objectType: "project" | "listing", createdBy: string) => {
    const result = await admin
      .from("studio_object_owners")
      .select("object_id")
      .eq("object_type", objectType)
      .eq("created_by", createdBy);
    return (
      (must(result, "studio object owner scope read failed") ?? []) as Array<{
        object_id: string;
      }>
    ).map((row) => row.object_id);
  };

  return {
    async getMembership(userId) {
      const result = await admin
        .from("studio_members")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      return must(result, "studio_members read failed") as StudioMembershipRow | null;
    },
    async listMembers() {
      const result = await admin
        .from("studio_members")
        .select("*")
        .order("created_at", { ascending: true });
      return (must(result, "studio_members list failed") ?? []) as StudioMembershipRow[];
    },
    async upsertMembership(row) {
      const result = await admin.from("studio_members").upsert(row, { onConflict: "user_id" });
      must(result, "studio_members upsert failed");
    },
    async countActiveOwners() {
      const result = await admin
        .from("studio_members")
        .select("user_id", { count: "exact", head: true })
        .eq("role", "owner")
        .eq("is_active", true);
      if (result.error) throw new Error(`studio_members count failed: ${result.error.message}`);
      return result.count ?? 0;
    },
    async bootstrapOwner(userId, email) {
      const { data, error } = await admin.rpc("studio_bootstrap_owner", {
        p_user_id: userId,
        p_email: email,
      });
      if (error) throw new Error(`studio_bootstrap_owner failed: ${error.message}`);
      const rows = (data ?? []) as StudioMembershipRow[];
      return rows.length ? rows[0] : null;
    },

    async findProjectBySlug(slug) {
      const result = await admin
        .from("projects")
        .select(PROJECT_COLUMNS)
        .eq("slug", slug)
        .maybeSingle();
      return must(result, "projects read failed") as StudioProjectRow | null;
    },
    async listProjects(createdBy) {
      let query = admin
        .from("projects")
        .select(PROJECT_COLUMNS)
        .order("updated_at", { ascending: false });
      if (createdBy) {
        const ids = await ownedObjectIds("project", createdBy);
        if (!ids.length) return [];
        query = query.in("id", ids);
      }
      const result = await query.limit(200);
      return (must(result, "projects list failed") ?? []) as StudioProjectRow[];
    },
    async getProjectDetail(slug) {
      const projectResult = await admin
        .from("projects")
        .select(PROJECT_DETAIL_COLUMNS)
        .eq("slug", slug)
        .maybeSingle();
      const project = must(projectResult, "project detail read failed") as
        | (StudioProjectRow & Record<string, unknown>)
        | null;
      if (!project) return null;
      const mediaResult = await admin
        .from("project_media")
        .select("url,media_type,title,sort_order")
        .eq("project_id", project.id)
        .order("sort_order", { ascending: true });
      const media = (must(mediaResult, "project media read failed") ?? []) as Array<{
        url: string;
        media_type: string;
        title: string | null;
        sort_order: number;
      }>;
      return { project, media } satisfies StudioProjectDetailRow;
    },
    async getObjectCreatedBy(objectType, objectId) {
      const result = await admin
        .from("studio_object_owners")
        .select("created_by")
        .eq("object_type", objectType)
        .eq("object_id", objectId)
        .maybeSingle();
      const row = must(result, "studio object owner read failed") as {
        created_by: string | null;
      } | null;
      return row?.created_by ?? null;
    },

    async getListing(id) {
      const result = await admin
        .from("listings")
        .select(LISTING_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      return must(result, "listings read failed") as StudioListingRow | null;
    },
    async findListingBySlug(slug) {
      const result = await admin
        .from("listings")
        .select(LISTING_COLUMNS)
        .eq("slug", slug)
        .maybeSingle();
      return must(result, "listings read failed") as StudioListingRow | null;
    },
    async getListingDetail(id) {
      const listingResult = await admin
        .from("listings")
        .select(LISTING_DETAIL_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      const listing = must(listingResult, "listing detail read failed") as
        | (StudioListingRow & Record<string, unknown>)
        | null;
      if (!listing) return null;
      const contactResult = await admin
        .from("studio_listing_contacts")
        .select("contact_name,contact_phone,contact_email")
        .eq("listing_id", id)
        .maybeSingle();
      const contact = (must(contactResult, "listing contact read failed") ?? {
        contact_name: null,
        contact_phone: null,
        contact_email: null,
      }) as StudioPrivateContact;
      return { ...listing, contact } as StudioListingDetailRow;
    },
    async updateListing(id, patch) {
      const result = await admin.from("listings").update(patch).eq("id", id);
      must(result, "listings update failed");
    },
    async listListings(createdBy) {
      let query = admin
        .from("listings")
        .select(LISTING_COLUMNS)
        .order("updated_at", { ascending: false });
      if (createdBy) {
        const ids = await ownedObjectIds("listing", createdBy);
        if (!ids.length) return [];
        query = query.in("id", ids);
      }
      const result = await query.limit(200);
      return (must(result, "listings list failed") ?? []) as StudioListingRow[];
    },

    async createJob(row: StudioJobRow) {
      const result = await admin.from("studio_upload_jobs").insert(row);
      must(result, "studio_upload_jobs insert failed");
    },
    async getJob(id) {
      const result = await admin.from("studio_upload_jobs").select("*").eq("id", id).maybeSingle();
      return must(result, "studio_upload_jobs read failed") as StudioJobRow | null;
    },
    async updateJobIfClaimed(id, token, patch) {
      // Compare-and-set on the processing claim: a stale worker's update
      // matches zero rows and can never overwrite a newer claim's records.
      const result = await admin
        .from("studio_upload_jobs")
        .update(patch)
        .eq("id", id)
        .eq("status", "processing")
        .eq("processing_token", token)
        .select("id");
      const rows = must(result, "studio_upload_jobs update failed") as Array<{ id: string }> | null;
      return (rows ?? []).length > 0;
    },
    async listJobs(limit, createdBy) {
      let query = admin
        .from("studio_upload_jobs")
        .select("*")
        .order("created_at", { ascending: false });
      if (createdBy) query = query.eq("created_by", createdBy);
      const result = await query.limit(limit);
      return (must(result, "studio_upload_jobs list failed") ?? []) as StudioJobRow[];
    },
    async countActiveJobs(createdBy) {
      const { data, error } = await admin.rpc("studio_count_active_jobs", {
        p_created_by: createdBy ?? null,
      });
      if (error) throw new Error(`studio active jobs count failed: ${error.message}`);
      return Number(data ?? 0);
    },
    async listDueJobs(staleSeconds, limit, createdBy) {
      const staleBefore = new Date(Date.now() - staleSeconds * 1000).toISOString();
      // The service-role-only RPC joins current active membership and applies
      // actor scope before LIMIT, so invalid sources cannot consume the batch.
      const { data, error } = await admin.rpc("studio_list_due_jobs", {
        p_stale_before: staleBefore,
        p_limit: limit,
        p_created_by: createdBy ?? null,
      });
      if (error) throw new Error(`due jobs read failed: ${error.message}`);
      return (data ?? []) as StudioJobRow[];
    },

    async requestJobProcessing(jobId, token, staleSeconds) {
      const { data, error } = await admin.rpc("studio_request_job_processing", {
        p_job_id: jobId,
        p_token: token,
        p_stale_seconds: staleSeconds,
      });
      if (error) throw new Error(`studio_request_job_processing failed: ${error.message}`);
      const rows = (data ?? []) as StudioJobRow[];
      return rows.length ? rows[0] : null;
    },

    async claimJob(jobId, token, staleSeconds) {
      const { data, error } = await admin.rpc("studio_claim_job", {
        p_job_id: jobId,
        p_token: token,
        p_stale_seconds: staleSeconds,
      });
      if (error) throw new Error(`studio_claim_job failed: ${error.message}`);
      const rows = (data ?? []) as StudioJobRow[];
      return rows.length ? rows[0] : null;
    },
    async heartbeatJob(jobId, token) {
      const { data, error } = await admin.rpc("studio_heartbeat_job", {
        p_job_id: jobId,
        p_token: token,
      });
      if (error) throw new Error(`studio_heartbeat_job failed: ${error.message}`);
      return Boolean(data);
    },
    async failJob(input) {
      const { error } = await admin.rpc("studio_fail_job", {
        p_job_id: input.jobId,
        p_token: input.token,
        p_error_code: input.errorCode,
        p_error_message: input.message,
        p_retryable: input.retryable,
      });
      if (error) throw new Error(`studio_fail_job failed: ${error.message}`);
    },
    async publishProject(input) {
      const { data, error } = await admin.rpc("studio_publish_project", {
        p_job_id: input.jobId,
        p_token: input.token,
        p_batch: input.batch,
        p_publish: input.publish,
        p_result: input.result,
      });
      if (error) throw new Error(`studio_publish_project failed: ${error.message}`);
      return data as ProgressiveBatchSummary & { public_status: string; replayed: boolean };
    },
    async publishResale(input) {
      const { data, error } = await admin.rpc("studio_publish_resale", {
        p_job_id: input.jobId,
        p_token: input.token,
        p_listing: input.listing as unknown as Record<string, unknown>,
        p_contact: input.contact as unknown as Record<string, unknown>,
        p_warnings: input.warnings as unknown as Record<string, unknown>[],
        p_result: input.result,
      });
      if (error) throw new Error(`studio_publish_resale failed: ${error.message}`);
      const row = data as { listing_id: string; slug: string; replayed?: boolean };
      return { listingId: row.listing_id, slug: row.slug, replayed: Boolean(row.replayed) };
    },

    async updateResale(input) {
      const { data, error } = await admin.rpc("studio_update_resale", {
        p_listing_id: input.listingId,
        p_actor_id: input.actorId,
        p_fields: input.fields,
        p_contact: input.contact,
        p_supplied_at: input.suppliedAt,
        p_inject_failure: input.injectFailure ?? false,
      });
      if (error) throw new Error(`studio_update_resale failed: ${error.message}`);
      const result = (data ?? {}) as {
        warnings?: ProgressiveWarning[];
        applied_fields?: string[];
      };
      return {
        warnings: result.warnings ?? [],
        appliedFields: result.applied_fields ?? [],
      };
    },

    async recordAudit(entry: StudioAuditEntry) {
      const result = await admin.from("audit_log").insert(entry);
      must(result, "audit_log insert failed");
    },
  };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

async function statObjectImpl(bucket: string, path: string): Promise<StudioObjectStat | null> {
  const idx = path.lastIndexOf("/");
  const folder = idx >= 0 ? path.slice(0, idx) : "";
  const name = idx >= 0 ? path.slice(idx + 1) : path;
  const { data, error } = await admin.storage
    .from(bucket)
    .list(folder, { search: name, limit: 100 });
  if (error) throw new Error(`storage stat failed (${bucket}): ${error.message}`);
  const item = (data ?? []).find((o) => o.name === name);
  if (!item) return null;
  const size = (item.metadata as { size?: number } | null)?.size ?? 0;
  return { size };
}

/**
 * Stream one stored object through SHA-256: exact byte count, full digest,
 * and the leading `headBytes` for magic sniffing — memory stays bounded by
 * the chunk size no matter how large the object is. It uses Storage JS's
 * raw-response stream rather than its Blob-returning convenience method.
 */
async function hashObjectImpl(
  bucket: string,
  path: string,
  headBytes: number,
): Promise<StudioObjectDigest | null> {
  // `download()` buffers through Response.blob(). Storage JS 2.110 exposes
  // the raw response body through asStream(), which remains chunk-bounded.
  const { data, error } = await admin.storage.from(bucket).download(path).asStream();
  if (error || !data) return null;
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256");
  const headChunks: Buffer[] = [];
  let headLength = 0;
  let size = 0;
  const consume = (chunk: Buffer) => {
    hash.update(chunk);
    size += chunk.length;
    if (headLength < headBytes) {
      const take = chunk.subarray(0, Math.min(chunk.length, headBytes - headLength));
      headChunks.push(Buffer.from(take));
      headLength += take.length;
    }
  };
  try {
    const reader = data.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) consume(Buffer.from(value));
    }
  } catch {
    return null;
  }
  return { sha256: hash.digest("hex"), size, head: Buffer.concat(headChunks) };
}

function createStudioStorage(): StudioStorage {
  return {
    async createSignedUpload(bucket, path) {
      const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(path);
      if (error || !data) {
        throw new Error(`signed upload creation failed (${bucket}): ${error?.message}`);
      }
      return { token: data.token };
    },
    async listNames(bucket, prefix) {
      const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
      if (error) throw new Error(`storage list failed (${bucket}): ${error.message}`);
      return new Set((data ?? []).map((item) => item.name));
    },
    statObject: statObjectImpl,
    hashObject: hashObjectImpl,
    async downloadWithin(bucket, path, maxBytes) {
      const stat = await statObjectImpl(bucket, path);
      if (!stat) return null;
      if (stat.size > maxBytes) return null;
      const { data, error } = await admin.storage.from(bucket).download(path);
      if (error || !data) return null;
      return Buffer.from(await data.arrayBuffer());
    },

    async upload(bucket, path, data, contentType) {
      const { error } = await admin.storage
        .from(bucket)
        .upload(path, data, { upsert: true, ...(contentType ? { contentType } : {}) });
      if (error) throw new Error(`storage upload failed (${bucket}): ${error.message}`);
    },
    async remove(bucket, paths) {
      if (!paths.length) return;
      const { error } = await admin.storage.from(bucket).remove(paths);
      if (error) throw new Error(`storage remove failed (${bucket}): ${error.message}`);
    },
    publicUrl(bucket, path) {
      return admin.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    },
  };
}

// ---------------------------------------------------------------------------
// Dependency reader
// ---------------------------------------------------------------------------

function createStudioDependencyReader(): DependencyReader {
  async function query(
    table: "developers" | "locations",
    nameColumn: "name" | "area_name",
    q: { slug: string; name: string },
  ): Promise<DependencyCandidate[]> {
    const [bySlug, byName] = await Promise.all([
      admin.from(table).select(`id,slug,${nameColumn}`).eq("slug", q.slug),
      admin.from(table).select(`id,slug,${nameColumn}`).eq(nameColumn, q.name),
    ]);
    if (bySlug.error) throw new Error(`${table} dependency read failed: ${bySlug.error.message}`);
    if (byName.error) throw new Error(`${table} dependency read failed: ${byName.error.message}`);
    const byId = new Map<string, Record<string, unknown>>();
    for (const row of [...(bySlug.data ?? []), ...(byName.data ?? [])] as Array<
      Record<string, unknown>
    >) {
      byId.set(String(row.id), row);
    }
    return [...byId.values()].map((row) => ({
      id: String(row.id),
      slug: (row.slug as string | null) ?? null,
      name: String(row[nameColumn] ?? ""),
    }));
  }
  return {
    findDevelopers: (q) => query("developers", "name", q),
    findLocations: (q) => query("locations", "area_name", q),
  };
}

// ---------------------------------------------------------------------------
// SIP price-list PDF extraction — subprocess-gated (unavailable on the Worker)
// ---------------------------------------------------------------------------

async function extractPriceListPdf(input: {
  projectSlug: string;
  fileName: string;
  buffer: Buffer;
}): Promise<PriceListPdfExtraction> {
  const warnings: ProgressiveWarning[] = [];
  const retained = (code: string, message: string): PriceListPdfExtraction => {
    warnings.push({
      entity: "price",
      code,
      severity: "warning",
      message,
      payload: { file: input.fileName },
    });
    return { priceList: null, warnings };
  };

  let workRoot: string | undefined;
  let rm: ((p: string, o: { recursive: boolean; force: boolean }) => void) | undefined;
  try {
    const { preflightPdftotext } = await import("@/intake/sip/pdf-tool");
    const preflight = preflightPdftotext();
    if (!preflight.found) {
      return retained(
        "price_list_extraction_unavailable",
        `${input.fileName} was retained privately: automatic price-list extraction is not available on this server. Upload a reviewed price-list JSON, or it can be extracted later with the SIP tooling.`,
      );
    }
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    rm = fs.rmSync;
    workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "forever-studio-sip-"));
    const sourceDir = path.join(workRoot, "src");
    fs.mkdirSync(sourceDir, { recursive: true });
    const pdfPath = path.join(sourceDir, "price-list.pdf");
    fs.writeFileSync(pdfPath, input.buffer);
    const { runSipPriceListExtraction } = await import("@/intake/sip/run");
    const result = runSipPriceListExtraction({
      projectSlug: input.projectSlug,
      pdfPath,
      outRoot: path.join(workRoot, "out"),
      workspaceRoot: path.join(workRoot, "ws"),
    });
    if (result.reviewedPriceList) return { priceList: result.reviewedPriceList, warnings };
    const sanitized = sanitizePriceList(result.candidatePriceList);
    warnings.push(...sanitized.warnings);
    if (sanitized.priceList) {
      warnings.push({
        entity: "price",
        code: "price_list_partially_extracted",
        severity: "info",
        message: `${input.fileName}: the safely extracted rows were used; the source file stays retained for enrichment.`,
        payload: { file: input.fileName },
      });
      return { priceList: sanitized.priceList, warnings };
    }
    return retained(
      "price_list_extraction_empty",
      `${input.fileName} produced no safely usable price rows; the source file was retained.`,
    );
  } catch {
    return retained(
      "price_list_extraction_unavailable",
      `${input.fileName} was retained privately for later extraction.`,
    );
  } finally {
    if (workRoot && rm) {
      try {
        rm(workRoot, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export function createStudioDeps(): StudioDeps {
  const data = createStudioData();
  return {
    data,
    storage: createStudioStorage(),
    ingest: {
      async ingest(batch: ProgressiveBatch): Promise<ProgressiveBatchSummary> {
        assertProgressiveBatchStructure(batch);
        const { data: summary, error } = await admin.rpc(PROGRESSIVE_INGEST_FUNCTION, { batch });
        if (error) throw new Error(`forever_progressive_ingest failed: ${error.message}`);
        return summary as ProgressiveBatchSummary;
      },
    },
    authAdmin: {
      async createUser(email, password) {
        const { data: created, error } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (error || !created?.user)
          throw new Error(`auth user creation failed: ${error?.message}`);
        return { id: created.user.id };
      },
      async findUserIdByEmail(email) {
        const { data: found, error } = await admin.rpc("studio_lookup_auth_user_id", {
          p_email: email,
        });
        if (error) throw new Error(`auth lookup failed: ${error.message}`);
        return (found as string | null) ?? null;
      },
    },
    reader: createStudioDependencyReader(),
    fetchExisting: (slug) => fetchExistingProjectState(admin, slug),
    extractPriceListPdf,
    // Full ZIP safety contract + one-entry-at-a-time expansion (archive.ts).
    extractArchive: (input, onEntry) => extractStudioArchive(input, onEntry),
    now: () => new Date().toISOString(),
    newToken: () => crypto.randomUUID(),
    partnerDemoActive: () => process.env.VITE_PARTNER_DEMO === "true",
    ownerBootstrapEmail: () => process.env.STUDIO_OWNER_EMAIL ?? null,
    ownerBootstrapUserId: () => process.env.STUDIO_OWNER_USER_ID ?? null,
  };
}
