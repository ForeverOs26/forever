/**
 * Forever Studio — production dependency assembly.
 *
 * The ONLY Studio module that touches the service-role client. It is loaded
 * exclusively via dynamic import inside server-function handlers, never from
 * code that ships to the browser (asserted by the bundle-boundary tests).
 *
 * The service-role credential comes from the server process environment
 * (SUPABASE_SERVICE_ROLE_KEY) exactly like the existing owner tooling. It
 * never appears in source, output, or the client bundle.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
import {
  assertSafeEntryName,
  DEFAULT_ZIP_LIMITS,
  readZipEntries,
  readZipEntryData,
} from "@/intake/zip";

import type {
  PriceListPdfExtraction,
  StudioAuditEntry,
  StudioData,
  StudioDeps,
  StudioJobRow,
  StudioListingRow,
  StudioMembershipRow,
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
const LISTING_COLUMNS =
  "id,slug,title,publication_status,project_id,price,currency,photos,updated_at,field_provenance";

function createStudioData(): StudioData {
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
    async countMembers() {
      const result = await admin
        .from("studio_members")
        .select("user_id", { count: "exact", head: true });
      if (result.error) throw new Error(`studio_members count failed: ${result.error.message}`);
      return result.count ?? 0;
    },

    async findProjectBySlug(slug) {
      const result = await admin
        .from("projects")
        .select(PROJECT_COLUMNS)
        .eq("slug", slug)
        .maybeSingle();
      return must(result, "projects read failed") as StudioProjectRow | null;
    },
    async listProjects() {
      const result = await admin
        .from("projects")
        .select(PROJECT_COLUMNS)
        .order("updated_at", { ascending: false })
        .limit(200);
      return (must(result, "projects list failed") ?? []) as StudioProjectRow[];
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
    async insertListing(row) {
      const result = await admin.from("listings").insert(row).select("id").single();
      return must(result, "listings insert failed") as { id: string };
    },
    async updateListing(id, patch) {
      const result = await admin.from("listings").update(patch).eq("id", id);
      must(result, "listings update failed");
    },
    async listListings() {
      const result = await admin
        .from("listings")
        .select(LISTING_COLUMNS)
        .order("updated_at", { ascending: false })
        .limit(200);
      return (must(result, "listings list failed") ?? []) as StudioListingRow[];
    },
    async insertListingWarnings(listingId, warnings: ProgressiveWarning[]) {
      if (!warnings.length) return;
      const rows = warnings.map((warning) => ({
        listing_id: listingId,
        entity: warning.entity,
        field: warning.field ?? null,
        code: warning.code,
        severity: warning.severity,
        message: warning.message,
        payload: warning.payload ?? {},
      }));
      const result = await admin.from("ingestion_warnings").insert(rows);
      must(result, "ingestion_warnings insert failed");
    },

    async createJob(row: StudioJobRow) {
      const result = await admin.from("studio_upload_jobs").insert(row);
      must(result, "studio_upload_jobs insert failed");
    },
    async getJob(id) {
      const result = await admin.from("studio_upload_jobs").select("*").eq("id", id).maybeSingle();
      return must(result, "studio_upload_jobs read failed") as StudioJobRow | null;
    },
    async updateJob(id, patch) {
      const result = await admin.from("studio_upload_jobs").update(patch).eq("id", id);
      must(result, "studio_upload_jobs update failed");
    },
    async listJobs(limit) {
      const result = await admin
        .from("studio_upload_jobs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      return (must(result, "studio_upload_jobs list failed") ?? []) as StudioJobRow[];
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

function createStudioStorage(): StudioStorage {
  return {
    async createSignedUpload(bucket, path) {
      const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(path);
      if (error || !data) {
        throw new Error(`signed upload creation failed (${bucket}/${path}): ${error?.message}`);
      }
      return { token: data.token };
    },
    async listNames(bucket, prefix) {
      const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
      if (error) throw new Error(`storage list failed (${bucket}/${prefix}): ${error.message}`);
      return new Set((data ?? []).map((item) => item.name));
    },
    async download(bucket, path) {
      const { data, error } = await admin.storage.from(bucket).download(path);
      if (error || !data) return null;
      return Buffer.from(await data.arrayBuffer());
    },
    async upload(bucket, path, data, contentType) {
      const { error } = await admin.storage
        .from(bucket)
        .upload(path, data, { upsert: true, ...(contentType ? { contentType } : {}) });
      if (error) throw new Error(`storage upload failed (${bucket}/${path}): ${error.message}`);
    },
    publicUrl(bucket, path) {
      return admin.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    },
  };
}

// ---------------------------------------------------------------------------
// Dependency reader (compact server-side equivalent of the CLI reader; the
// CLI ingest-client stays owner-tooling-only and is not imported here)
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
// SIP price-list PDF extraction (best effort; failure = warning + retention)
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

  const { preflightPdftotext } = await import("@/intake/sip/pdf-tool");
  const preflight = preflightPdftotext();
  if (!preflight.found) {
    return retained(
      "price_list_extraction_unavailable",
      `${input.fileName} was retained: no local pdftotext tool is available on this server. Extract it later with the SIP tooling or upload a reviewed price-list JSON.`,
    );
  }

  const workRoot = mkdtempSync(join(tmpdir(), "forever-studio-sip-"));
  try {
    // Disjoint source / output / workspace directories per intake path rules.
    const sourceDir = join(workRoot, "src");
    mkdirSync(sourceDir, { recursive: true });
    const pdfPath = join(sourceDir, "price-list.pdf");
    writeFileSync(pdfPath, input.buffer);
    const { runSipPriceListExtraction } = await import("@/intake/sip/run");
    const result = runSipPriceListExtraction({
      projectSlug: input.projectSlug,
      pdfPath,
      outRoot: join(workRoot, "out"),
      workspaceRoot: join(workRoot, "ws"),
    });
    if (result.reviewedPriceList) {
      return { priceList: result.reviewedPriceList, warnings };
    }
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
  } catch (error) {
    return retained(
      "price_list_extraction_failed",
      `${input.fileName} could not be extracted (${error instanceof Error ? error.message : String(error)}); the source file was retained.`,
    );
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// In-memory bounded archive expansion (path-safe, limit-guarded)
// ---------------------------------------------------------------------------

async function extractArchive(input: { fileName: string; buffer: Buffer }): Promise<{
  entries: Array<{ name: string; data: Buffer }>;
  warnings: ProgressiveWarning[];
}> {
  const warnings: ProgressiveWarning[] = [];
  if (!input.fileName.toLowerCase().endsWith(".zip")) {
    warnings.push({
      entity: "document",
      code: "archive_format_unsupported",
      severity: "warning",
      message: `${input.fileName} is not a ZIP archive; the file was retained unexpanded.`,
      payload: { file: input.fileName },
    });
    return { entries: [], warnings };
  }
  try {
    const entries: Array<{ name: string; data: Buffer }> = [];
    for (const entry of readZipEntries(input.buffer)) {
      if (entry.isDirectory) continue;
      assertSafeEntryName(entry.name, DEFAULT_ZIP_LIMITS.maxPathLength);
      entries.push({ name: entry.name, data: readZipEntryData(input.buffer, entry) });
    }
    return { entries, warnings };
  } catch (error) {
    warnings.push({
      entity: "document",
      code: "archive_unreadable",
      severity: "warning",
      message: `${input.fileName} could not be expanded (${error instanceof Error ? error.message : String(error)}); the archive was retained.`,
      payload: { file: input.fileName },
    });
    return { entries: [], warnings };
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
        if (error || !created?.user) {
          throw new Error(`auth user creation failed: ${error?.message}`);
        }
        return { id: created.user.id };
      },
      async findUserIdByEmail(email) {
        // Membership rows carry the invited email; auth-side lookup only
        // needs to cover re-invites of already-known members.
        const existing = await data.listMembers();
        return existing.find((row) => row.email?.toLowerCase() === email)?.user_id ?? null;
      },
    },
    reader: createStudioDependencyReader(),
    fetchExisting: (slug) => fetchExistingProjectState(admin, slug),
    extractPriceListPdf,
    extractArchive,
    now: () => new Date().toISOString(),
    partnerDemoActive: () => process.env.VITE_PARTNER_DEMO === "true",
    ownerBootstrapEmail: () => process.env.STUDIO_OWNER_EMAIL ?? null,
  };
}
