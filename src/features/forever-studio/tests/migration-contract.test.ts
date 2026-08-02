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
const CORRECTION_PATH =
  "supabase/migrations/20260722120000_studio_independent_review_corrections.sql";
const correction = readFileSync(resolve(process.cwd(), CORRECTION_PATH), "utf8");
const RESUME_PRINCIPAL_PATH =
  "supabase/migrations/20260722130000_studio_resume_principal_authorization.sql";
const resumePrincipal = readFileSync(resolve(process.cwd(), RESUME_PRINCIPAL_PATH), "utf8");
const DURABLE_RESUME_PATH =
  "supabase/migrations/20260722140000_studio_durable_resume_eligibility.sql";
const durableResume = readFileSync(resolve(process.cwd(), DURABLE_RESUME_PATH), "utf8");
const AUTOMATIC_RETRY_PATH =
  "supabase/migrations/20260803090000_studio_automatic_retry_eligibility.sql";
const automaticRetry = readFileSync(resolve(process.cwd(), AUTOMATIC_RETRY_PATH), "utf8");
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

describe("independent-review corrective migration contract", () => {
  it("is a later additive migration and leaves pristine received jobs unmarked", () => {
    expect(
      CORRECTION_PATH.localeCompare(
        "supabase/migrations/20260722110000_studio_object_ownership_backfill.sql",
      ),
    ).toBeGreaterThan(0);
    expect(correction).toContain("ADD COLUMN IF NOT EXISTS processing_requested_at TIMESTAMPTZ");
    expect(correction).toMatch(/status IN \('processing', 'published', 'failed'\)/);
    expect(correction).not.toMatch(/status IN \([^)]*'received'/);
    expect(correction).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
  });

  it("requires readiness for ordinary claims and marks readiness with the first claim", () => {
    expect(correction).toContain("AND processing_requested_at IS NOT NULL");
    expect(correction).toContain("CREATE OR REPLACE FUNCTION public.studio_request_job_processing");
    expect(correction).toContain(
      "processing_requested_at = COALESCE(processing_requested_at, now())",
    );
    expect(correction).toContain(
      "SELECT * FROM public.studio_claim_job(p_job_id, p_token, p_stale_seconds)",
    );
  });

  it("uses current active membership for publish authorization, never the role snapshot", () => {
    for (const name of ["studio_publish_project", "studio_publish_resale"]) {
      const body = correction.slice(
        correction.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`),
        correction.indexOf("$$;", correction.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`)),
      );
      expect(body).toContain("FROM public.studio_members");
      expect(body).toContain("is_active");
      expect(body).toContain("v_actor_role = 'trusted_publisher'");
      expect(body).not.toContain("creator_role");
    }
  });

  it("edits resale facts, provenance, contact, and warnings in one locked transaction", () => {
    const body = correction.slice(correction.indexOf("public.studio_update_resale"));
    expect(body).toContain("FROM public.listings");
    expect(body).toContain("FOR UPDATE");
    expect(body).toContain("field_provenance=v_provenance");
    expect(body).toContain("public.studio_listing_contacts");
    expect(body).toContain("public.ingestion_warnings");
    expect(body).toContain("WHERE NOT EXISTS");
    expect(body).toContain("studio_resale_edit_injected_failure");
  });

  it("keeps every corrected RPC service-role-only and contains no credentials", () => {
    for (const name of [
      "studio_claim_job",
      "studio_request_job_processing",
      "studio_publish_project",
      "studio_publish_resale",
      "studio_update_resale",
    ]) {
      expect(correction).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}`));
      expect(correction).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}`));
    }
    expect(correction).not.toMatch(/sb_secret_|service_role_key|eyJ[A-Za-z0-9]/);
  });
});

describe("resume-principal authorization migration contract", () => {
  it("is later than the independent-review migration and stays additive", () => {
    expect(RESUME_PRINCIPAL_PATH.localeCompare(CORRECTION_PATH)).toBeGreaterThan(0);
    expect(resumePrincipal).not.toMatch(/DROP\s+(TABLE|COLUMN|FUNCTION)/i);
  });

  it("authorizes claims from current active membership without creator_role", () => {
    const claim = resumePrincipal.slice(
      resumePrincipal.indexOf("CREATE OR REPLACE FUNCTION public.studio_claim_job"),
      resumePrincipal.indexOf("$$;", resumePrincipal.indexOf("public.studio_claim_job")),
    );
    expect(claim).toContain("FROM public.studio_members");
    expect(claim).toContain("user_id = v_created_by AND is_active");
    expect(claim).toContain("studio_membership_required");
    expect(claim.indexOf("FROM public.studio_members")).toBeLessThan(
      claim.indexOf("UPDATE public.studio_upload_jobs"),
    );
    expect(claim).not.toContain("creator_role");
  });

  it("keeps claim functions service-role-only and contains no credentials", () => {
    for (const name of ["studio_claim_job", "studio_request_job_processing"]) {
      expect(resumePrincipal).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}`));
      expect(resumePrincipal).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}`));
    }
    expect(resumePrincipal).not.toMatch(/sb_secret_|service_role_key|eyJ[A-Za-z0-9]/);
  });
});

describe("durable-resume eligibility migration contract", () => {
  it("is a later additive migration with no write statement", () => {
    expect(DURABLE_RESUME_PATH.localeCompare(RESUME_PRINCIPAL_PATH)).toBeGreaterThan(0);
    expect(durableResume).not.toMatch(/DROP\s+(TABLE|COLUMN|FUNCTION)/i);
    const functions = durableResume.slice(durableResume.indexOf("CREATE OR REPLACE FUNCTION"));
    expect(functions).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b\s+(?:INTO\s+|FROM\s+)?public\./i);
  });

  it("counts independently and filters active source plus actor before LIMIT", () => {
    const count = durableResume.slice(
      durableResume.indexOf("public.studio_count_active_jobs"),
      durableResume.indexOf("public.studio_list_due_jobs"),
    );
    const due = durableResume.slice(durableResume.indexOf("public.studio_list_due_jobs"));
    for (const body of [count, due]) {
      expect(body).toContain("INNER JOIN public.studio_members");
      expect(body).toContain("source.is_active IS TRUE");
      expect(body).toContain("p_created_by IS NULL OR job.created_by = p_created_by");
      expect(body).not.toContain("creator_role");
    }
    expect(due.indexOf("source.is_active IS TRUE")).toBeLessThan(due.indexOf("LIMIT"));
    expect(due.indexOf("p_created_by IS NULL OR job.created_by = p_created_by")).toBeLessThan(
      due.indexOf("LIMIT"),
    );
  });

  it("keeps both eligibility functions service-role-only and credential-free", () => {
    for (const name of ["studio_count_active_jobs", "studio_list_due_jobs"]) {
      expect(durableResume).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}`));
      expect(durableResume).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}`));
    }
    expect(durableResume).not.toMatch(/sb_secret_|service_role_key|eyJ[A-Za-z0-9]/);
  });
});

describe("automatic-retry eligibility migration contract", () => {
  it("is a later additive migration that touches no schema and no row", () => {
    expect(AUTOMATIC_RETRY_PATH.localeCompare(DURABLE_RESUME_PATH)).toBeGreaterThan(0);
    expect(automaticRetry).not.toMatch(/DROP\s+(TABLE|COLUMN|FUNCTION|POLICY|INDEX)/i);
    expect(automaticRetry).not.toMatch(/CREATE\s+(TABLE|INDEX|POLICY)/i);
    expect(automaticRetry).not.toMatch(/ALTER\s+TABLE/i);
    const functions = automaticRetry.slice(automaticRetry.indexOf("CREATE OR REPLACE FUNCTION"));
    // No backfill, no data movement, no RLS or membership change.
    expect(functions).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b\s+(?:INTO\s+|FROM\s+)?public\./i);
    expect(automaticRetry).not.toMatch(/ROW LEVEL SECURITY|CREATE POLICY|studio_members\s+SET/i);
    expect(automaticRetry).toMatch(/^BEGIN;$/m);
    expect(automaticRetry).toMatch(/^COMMIT;$/m);
  });

  /** The executable body of one function, with prose comments excluded. */
  function body(name: string): string {
    const start = automaticRetry.indexOf(`FUNCTION public.${name}`);
    const open = automaticRetry.indexOf("AS $$", start);
    return automaticRetry.slice(open, automaticRetry.indexOf("$$;", open));
  }

  it("excludes automatically exhausted jobs BEFORE ordering, limiting and counting", () => {
    const predicate = "NOT public.studio_job_automatic_retry_exhausted(job.facts)";
    const count = body("studio_count_active_jobs");
    const due = body("studio_list_due_jobs");

    // Both surfaces ask the SAME question, so "due" and "counted" cannot drift.
    for (const body of [count, due]) {
      expect(body).toContain(predicate);
      // The pre-existing eligibility rules are carried forward verbatim.
      expect(body).toContain("INNER JOIN public.studio_members");
      expect(body).toContain("source.is_active IS TRUE");
      expect(body).toContain("p_created_by IS NULL OR job.created_by = p_created_by");
    }
    // THE FINDING: filtering after the limit cannot rescue a row the database
    // never returned, so the predicate must precede ORDER BY and LIMIT.
    expect(due.indexOf(predicate)).toBeLessThan(due.indexOf("ORDER BY"));
    expect(due.indexOf(predicate)).toBeLessThan(due.indexOf("LIMIT"));
    // The count query has neither, and must not acquire one.
    expect(count).not.toContain("LIMIT");
  });

  it("reads a closed state and never re-derives the application's threshold", () => {
    const helper = body("studio_job_automatic_retry_exhausted");
    // Exactly the literal `automaticRetryState` compares against, defaulted the
    // same way for an absent key.
    expect(helper).toContain(
      "COALESCE(p_facts -> 'retry' ->> 'automatic', 'eligible') = 'exhausted'",
    );
    // A numeric limit here would be a second copy of STUDIO_AUTOMATIC_RETRY_LIMIT.
    expect(helper).not.toMatch(/automaticFailures/);
    expect(helper).not.toMatch(/[<>]=?\s*\d/);
    const declaration = automaticRetry.slice(
      automaticRetry.indexOf("FUNCTION public.studio_job_automatic_retry_exhausted"),
      automaticRetry.indexOf("AS $$", automaticRetry.indexOf("FUNCTION public.studio_job_auto")),
    );
    expect(declaration).toContain("IMMUTABLE");
    expect(declaration).toContain("SET search_path = ''");
  });

  it("leaves retryable — the Owner's admission gate — completely alone", () => {
    // The whole point of the three-state split: `retryable` still means "any
    // lane may claim this", so an exhausted job stays claimable by a person.
    expect(automaticRetry).not.toMatch(/SET\s+retryable/i);
    expect(automaticRetry).not.toMatch(/FUNCTION public\.studio_claim_job/);
    expect(automaticRetry).not.toMatch(/FUNCTION public\.studio_request_job_processing/);
    expect(automaticRetry).not.toMatch(/FUNCTION public\.studio_fail_job/);
    // Both queries still honour it exactly as before.
    expect(automaticRetry).toContain("job.status = 'failed' AND job.retryable IS TRUE");
  });

  it("keeps every function service-role-only and credential-free", () => {
    for (const name of [
      "studio_job_automatic_retry_exhausted",
      "studio_count_active_jobs",
      "studio_list_due_jobs",
    ]) {
      expect(automaticRetry).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}`));
      expect(automaticRetry).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}`));
      expect(automaticRetry).toMatch(new RegExp(`FROM PUBLIC, anon, authenticated`));
    }
    expect(automaticRetry).not.toMatch(/TO (anon|authenticated|PUBLIC)\b/);
    expect(automaticRetry).not.toMatch(/sb_secret_|service_role_key|eyJ[A-Za-z0-9]/);
    // No production identifier, job id or Owner id in the migration text.
    expect(automaticRetry).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
  });
});
