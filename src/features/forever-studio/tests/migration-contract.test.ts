/**
 * FOREVER-STUDIO-001 — static security contract of the Studio migration.
 *
 * Mirrors the progressive-ingestion migration-contract approach: the SQL
 * text itself is the artifact under test. The migration is a committed
 * DRAFT — it has NOT been applied to any linked or production database —
 * and these assertions pin its security posture verbatim.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { STUDIO_WORKFLOWS } from "../studio-types";

const MIGRATION_PATH = "supabase/migrations/20260721120000_forever_studio_v1.sql";
const sql = readFileSync(resolve(process.cwd(), MIGRATION_PATH), "utf8");
// Executable statements only — the explanatory header/comments may mention
// objects (policies, the RPC) precisely to state that they are NOT touched.
const ddl = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("Forever Studio migration contract", () => {
  it("is explicitly marked as an unapplied draft", () => {
    expect(sql).toContain("FINAL MIGRATION DRAFT (not applied)");
    expect(sql).toContain("has NOT been applied");
  });

  it("creates the membership table with RLS on and zero policies", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.studio_members");
    expect(sql).toContain("ALTER TABLE public.studio_members ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("GRANT ALL ON public.studio_members TO service_role");
    // Internal-only pattern: no policy may exist anywhere in this migration,
    // so neither anon nor authenticated can ever read or write these tables.
    expect(sql).not.toContain("CREATE POLICY");
  });

  it("creates the job table with RLS on, service-role-only, and a retry-friendly shape", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.studio_upload_jobs");
    expect(sql).toContain("ALTER TABLE public.studio_upload_jobs ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("GRANT ALL ON public.studio_upload_jobs TO service_role");
    expect(sql).toContain("attempt_count INTEGER NOT NULL DEFAULT 0");
    for (const status of ["received", "processing", "published", "failed"]) {
      expect(sql).toContain(`'${status}'`);
    }
  });

  it("pins the two-role model with no default role and no self-registration path", () => {
    expect(sql).toContain("role TEXT NOT NULL CHECK (role IN ('owner', 'trusted_publisher'))");
    expect(sql).not.toMatch(/role TEXT[^,]*DEFAULT/);
    expect(sql).not.toContain("GRANT INSERT");
    expect(sql).not.toMatch(/GRANT .* TO (anon|authenticated)/);
  });

  it("keeps the workflow vocabulary in lockstep with the TypeScript contract", () => {
    for (const workflow of STUDIO_WORKFLOWS) {
      expect(sql).toContain(`'${workflow}'`);
    }
  });

  it("adds a PRIVATE studio-uploads bucket and no new storage read policies", () => {
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

  it("leaves the progressive RPC and the strict lane untouched", () => {
    expect(ddl).not.toContain("forever_progressive_ingest");
    expect(ddl).not.toContain("forever_import");
    expect(ddl).not.toContain("forever_execution");
    expect(ddl).not.toMatch(/DROP\s+(TABLE|POLICY|FUNCTION)/i);
  });

  it("contains no credential material", () => {
    expect(sql).not.toMatch(/sb_secret_|service_role_key|eyJ[A-Za-z0-9]/);
  });
});
