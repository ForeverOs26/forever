/**
 * FOREVER-STUDIO-LARGE-ARCHIVE-001 — static security contract of the pending
 * large-archive migration. The SQL text itself is the artifact under test;
 * behavior is exercised by studio.postgres.sql through the disposable
 * PostgreSQL harness. The migration is additive, ordered after the current
 * chain, and has NOT been applied by this task.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_PATH = "supabase/migrations/20260724090000_studio_large_archive_v1.sql";
const LAST_PRIOR_MIGRATION = "supabase/migrations/20260723130000_public_projection_privacy.sql";
const sql = readFileSync(resolve(process.cwd(), MIGRATION_PATH), "utf8");
const ddl = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("large-archive migration contract", () => {
  it("is a pending draft ordered after the current chain and purely additive", () => {
    expect(MIGRATION_PATH.localeCompare(LAST_PRIOR_MIGRATION)).toBeGreaterThan(0);
    expect(sql).toContain("MIGRATION DRAFT (pending; not applied here)");
    expect(sql).toContain("PURELY ADDITIVE");
    expect(sql.replace(/\n-- /g, " ")).toContain("has NOT been applied by this task");
    expect(ddl).not.toMatch(/DROP\s+(TABLE|COLUMN|FUNCTION|POLICY)/i);
    expect(ddl).not.toMatch(/ALTER\s+TABLE\s+public\.(projects|listings|studio_upload_jobs)/i);
  });

  it("creates the two internal inventory tables with RLS on and no policies", () => {
    for (const table of ["studio_archives", "studio_archive_entries"]) {
      expect(ddl).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
      expect(ddl).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(ddl).toContain(`GRANT ALL ON public.${table} TO service_role`);
      expect(ddl).toContain(`REVOKE ALL ON public.${table} FROM anon`);
      expect(ddl).toContain(`REVOKE ALL ON public.${table} FROM authenticated`);
    }
    expect(ddl).not.toContain("CREATE POLICY");
  });

  it("keeps job/audit history semantics: cascades from the job row only", () => {
    expect(ddl).toContain(
      "job_id UUID NOT NULL REFERENCES public.studio_upload_jobs(id) ON DELETE CASCADE",
    );
    expect(ddl).toContain(
      "archive_id UUID NOT NULL REFERENCES public.studio_archives(id) ON DELETE CASCADE",
    );
  });

  it("makes retries idempotent and settlement pending-only in the schema itself", () => {
    expect(ddl).toContain("UNIQUE (archive_id, entry_index)");
    expect(ddl).toContain("ON CONFLICT (archive_id, entry_index) DO NOTHING");
    expect(ddl).toMatch(/AND state = 'pending'/);
  });

  it("guards every processing-phase function by the live job claim", () => {
    for (const fn of [
      "studio_release_job",
      "studio_update_archive_claimed",
      "studio_index_archive_entries",
      "studio_settle_archive_entry",
    ]) {
      const body = ddl.slice(
        ddl.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}`),
        ddl.indexOf("$$;", ddl.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}`)),
      );
      expect(body, fn).toContain("processing_token = p_token");
      expect(body, fn).toContain("status = 'processing'");
    }
  });

  it("release preserves readiness so a released slice resumes promptly", () => {
    const release = ddl.slice(ddl.indexOf("studio_release_job"));
    expect(release).toContain("SET status = 'received'");
    expect(release).toContain("processing_token = NULL");
    expect(release).not.toContain("processing_requested_at = NULL");
  });

  it("keeps every new function service-role only with a pinned search_path", () => {
    for (const fn of [
      "studio_release_job",
      "studio_update_archive_claimed",
      "studio_index_archive_entries",
      "studio_settle_archive_entry",
      "studio_job_archive_entry_counts",
    ]) {
      expect(sql).toContain(fn);
    }
    expect(ddl).toContain("GRANT EXECUTE ON FUNCTION %s TO service_role");
    expect(ddl).toContain("REVOKE ALL ON FUNCTION %s FROM anon");
    expect(ddl).toContain("REVOKE ALL ON FUNCTION %s FROM authenticated");
    const pinned = (ddl.match(/SET search_path = ''/g) ?? []).length;
    expect(pinned).toBeGreaterThanOrEqual(5);
  });

  it("documents privacy: filenames and entry paths never leave the internal tables", () => {
    expect(sql).toContain("PRIVATE original filename");
    expect(sql).toContain("PRIVATE raw entry path");
    expect(sql).toContain("neutral");
  });

  it("adds NO approval, readiness gate, review-queue, or confirmation objects", () => {
    for (const forbidden of ["approval", "review_queue", "confirmation"]) {
      expect(ddl.toLowerCase()).not.toContain(`${forbidden}s`);
      expect(ddl.toLowerCase()).not.toContain(`${forbidden}_`);
    }
  });

  it("contains no credential material and no storage policies", () => {
    expect(sql).not.toMatch(/sb_secret_|service_role_key|eyJ[A-Za-z0-9]/);
    expect(ddl).not.toContain("storage.objects");
  });

  it("enforces the TRUTHFUL archive lifecycle — the ambiguous states are gone", () => {
    expect(ddl).toContain("'uploaded_unverified'");
    expect(ddl).toContain("'byte_verifying'");
    expect(ddl).toContain("'byte_verified'");
    expect(ddl).toContain("'processing_entries'");
    // The retired ambiguous values must not be accepted by the CHECK.
    expect(ddl).not.toMatch(/'uploaded'/);
    expect(ddl).not.toMatch(/'verifying'/);
    expect(ddl).not.toMatch(/'indexed'/);
  });

  it("carries the resume fingerprint, the exact archive hash, and the evidence manifest", () => {
    expect(ddl).toMatch(/upload_fingerprint TEXT NOT NULL CHECK/);
    expect(ddl).toMatch(/archive_sha256 TEXT CHECK/);
    expect(ddl).toContain("idx_studio_archives_job_fingerprint");
    expect(ddl).toMatch(/evidence JSONB/);
    // Both new mutable fields are writable ONLY through the claim-checked
    // whitelists (fingerprint is insert-time and deliberately NOT patchable).
    const patch = ddl.slice(ddl.indexOf("studio_update_archive_claimed"));
    expect(patch).toContain("archive_sha256 = COALESCE(p_patch->>'archive_sha256'");
    expect(patch).not.toContain("upload_fingerprint = COALESCE");
    const settle = ddl.slice(ddl.indexOf("studio_settle_archive_entry"));
    expect(settle).toContain("evidence = p_outcome->'evidence'");
    // The digest-of-part-digests is never labelled as the file hash.
    expect(sql).toContain("NOT the file's SHA-256");
  });
});
