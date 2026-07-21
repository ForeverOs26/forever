/**
 * FOREVER-STUDIO-001 — static security contract of the Studio migration.
 *
 * The SQL text itself is the artifact under test. This is the only PENDING
 * Studio migration; it is additive over the already-applied progressive
 * migration and has NOT been applied by this task. These assertions pin its
 * security posture verbatim; behavior is exercised by studio.postgres.sql.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { STUDIO_WORKFLOWS } from "../studio-types";

const MIGRATION_PATH = "supabase/migrations/20260721120000_forever_studio_v1.sql";
const sql = readFileSync(resolve(process.cwd(), MIGRATION_PATH), "utf8");
const ddl = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("Forever Studio migration contract", () => {
  it("is marked as the pending Studio migration (progressive already applied)", () => {
    expect(sql).toContain("MIGRATION DRAFT (pending; not applied here)");
    expect(sql).toContain("already-applied progressive");
    expect(sql).toContain("has NOT been applied by this task");
    // It must NOT re-run or schedule the progressive migration.
    expect(ddl).not.toContain("20260718113000");
  });

  it("states the migration truth exactly: additive parts vs the relocation+drop", () => {
    // The header must distinguish the purely additive objects from the one
    // non-additive step, and must NOT claim the whole migration is additive.
    expect(sql).toContain("PURELY ADDITIVE");
    expect(sql).toContain("DATA RELOCATION + COLUMN DROP");
    expect(sql).not.toContain("ADDITIVE MIGRATION");
    // Codex read-only pre-apply check and exact ordering are documented.
    expect(sql).toContain("CODEX PRE-APPLY CHECK (read-only)");
    expect(sql).toContain("Never re-apply");
  });

  it("does not pretend the DOWN comments are a complete automatic rollback", () => {
    expect(sql).toContain("NOT a complete automatic rollback");
    // Contact restoration order is spelled out before any destructive drop.
    expect(sql).toContain("MUST be restored FIRST");
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS contact_name/);
    expect(sql).toContain("ONLY after steps 1-2 above");
  });

  it("creates membership + job + private-contact tables, RLS on, no policies", () => {
    for (const table of ["studio_members", "studio_upload_jobs", "studio_listing_contacts"]) {
      expect(ddl).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
      expect(ddl).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(ddl).toContain(`GRANT ALL ON public.${table} TO service_role`);
    }
    // Internal-only: no RLS policy is created anywhere in this migration.
    expect(ddl).not.toContain("CREATE POLICY");
  });

  it("relocates listing contact data into the private table and drops the public columns", () => {
    expect(ddl).toContain("INSERT INTO public.studio_listing_contacts");
    expect(ddl).toMatch(/ALTER TABLE public\.listings\s+DROP COLUMN IF EXISTS contact_name/);
    expect(ddl).toContain("DROP COLUMN IF EXISTS contact_phone");
    expect(ddl).toContain("DROP COLUMN IF EXISTS contact_email");
  });

  it("preserves upload/audit history: created_by SET NULL, no cascade", () => {
    expect(ddl).toContain("created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL");
    expect(ddl).not.toContain(
      "created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE",
    );
    expect(ddl).toContain("creator_email TEXT");
    expect(ddl).toContain("creator_role TEXT NOT NULL");
  });

  it("enforces a single-winner Owner bootstrap in the database", () => {
    expect(ddl).toContain("studio_members_single_bootstrap_owner");
    expect(ddl).toContain("pg_advisory_xact_lock");
    expect(ddl).toContain("CREATE OR REPLACE FUNCTION public.studio_bootstrap_owner");
  });

  it("provides the atomic and concurrency-safe transaction functions", () => {
    for (const fn of [
      "public.studio_claim_job",
      "public.studio_heartbeat_job",
      "public.studio_fail_job",
      "public.studio_publish_project",
      "public.studio_publish_resale",
    ]) {
      expect(ddl).toContain(`CREATE OR REPLACE FUNCTION ${fn}`);
    }
    // The atomic publish composes the unchanged progressive function.
    expect(ddl).toContain("public.forever_progressive_ingest(p_batch)");
    // Claim is a compare-and-set with stale recovery.
    expect(ddl).toContain("processing_token");
    expect(ddl).toContain("processing_started_at");
  });

  it("never reclaims a terminal (retryable=false) failure", () => {
    // The claim predicate must gate the failed branch on retryable IS TRUE,
    // in agreement with the automatic-resume query.
    expect(ddl).toMatch(/status = 'failed' AND retryable IS TRUE/);
  });

  it("guards the lease heartbeat by the processing token", () => {
    const heartbeat = ddl.slice(ddl.indexOf("studio_heartbeat_job"));
    expect(heartbeat).toContain("processing_token = p_token");
    expect(heartbeat).toContain("status = 'processing'");
  });

  it("every Studio function is service_role only, with search_path pinned", () => {
    expect(ddl).toContain("GRANT EXECUTE ON FUNCTION %s TO service_role");
    expect(ddl).toContain("REVOKE ALL ON FUNCTION %s FROM anon");
    expect(ddl).toContain("REVOKE ALL ON FUNCTION %s FROM authenticated");
    const setSearchPath = (ddl.match(/SET search_path = ''/g) ?? []).length;
    expect(setSearchPath).toBeGreaterThanOrEqual(6);
  });

  it("keeps the workflow vocabulary in lockstep with TypeScript", () => {
    for (const workflow of STUDIO_WORKFLOWS) expect(ddl).toContain(`'${workflow}'`);
  });

  it("adds a PRIVATE studio-uploads bucket and no storage.objects policy", () => {
    expect(ddl).toMatch(/\('studio-uploads', 'studio-uploads', false\)/);
    expect(ddl).toContain("ON CONFLICT (id) DO NOTHING");
    expect(ddl).not.toContain("storage.objects");
  });

  it("adds NO approval, readiness, review-queue, or confirmation objects", () => {
    for (const forbidden of ["approval", "review_queue", "readiness", "confirmation"]) {
      expect(ddl.toLowerCase()).not.toContain(`${forbidden}s`);
      expect(ddl.toLowerCase()).not.toContain(`${forbidden}_`);
    }
  });

  it("leaves the strict lane untouched and re-runs no prior migration", () => {
    expect(ddl).not.toContain("forever_import");
    expect(ddl).not.toContain("forever_execution");
    expect(ddl).not.toMatch(/DROP\s+(POLICY|FUNCTION IF EXISTS public\.forever_progressive)/i);
  });

  it("contains no credential material", () => {
    expect(sql).not.toMatch(/sb_secret_|service_role_key|eyJ[A-Za-z0-9]/);
  });
});
