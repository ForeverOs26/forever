import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const TEMPLATE_PATH = "docs/FOREVER_STUDIO_CONTAINED_R2_JOB_EXACT_ROW_REPAIR.sql";
const RUNBOOK_PATH = "docs/FOREVER_STUDIO_OWNER_RUNBOOK.md";
const template = readFileSync(resolve(process.cwd(), TEMPLATE_PATH), "utf8");
const runbook = readFileSync(resolve(process.cwd(), RUNBOOK_PATH), "utf8");

describe("contained failed R2 job exact-row repair template", () => {
  it("(38, 39) requires runtime parameters and contains no credential or fixed job id", () => {
    expect(template).toMatch(/\\if :\{\?job_id\}/);
    expect(template).toContain(":'job_id'::uuid");
    for (const parameter of [
      "expected_workflow",
      "expected_attempt_count",
      "expected_file_count",
      "expected_error_code",
      "expected_error_sha256",
      "expected_facts_sha256",
      "expected_files_sha256",
      "operator_actor_id",
      "approved_at",
    ]) {
      expect(template).toContain(`\\if :{?${parameter}}`);
    }
    expect(template).not.toMatch(
      /sb_secret_|service.role|eyJ[A-Za-z0-9_-]+\.|R2_SECRET|ACCESS_KEY|postgres(?:ql)?:\/\//i,
    );
    expect(template).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    );
  });

  it("(26-32, 37) locks one exact row and repeats every invariant on the update", () => {
    expect(template).toMatch(/BEGIN;/);
    expect(template).toMatch(/SET LOCAL lock_timeout = '5s'/);
    expect(template).toMatch(/SET LOCAL statement_timeout = '30s'/);
    expect(template).toMatch(/WHERE id = p\.job_id\s+FOR UPDATE/s);

    const update = template.slice(
      template.indexOf("UPDATE public.studio_upload_jobs AS job"),
      template.indexOf("RETURNING job.* INTO after_row"),
    );
    expect(update).toMatch(/SET retryable = true/);
    expect(update).toMatch(/job\.id = expected\.job_id/);
    expect(update).toMatch(/job\.status = 'failed'/);
    expect(update).toMatch(/job\.retryable IS FALSE/);
    expect(update).toMatch(/job\.workflow = expected\.expected_workflow/);
    expect(update).toMatch(/job\.attempt_count = expected\.expected_attempt_count/);
    expect(update).toMatch(/job\.facts #>> '\{storage,provider\}' = 'r2'/);
    expect(update).toMatch(/job\.result_summary IS NULL/);
    expect(update).toMatch(/job\.project_slug IS NULL/);
    expect(update).toMatch(/job\.listing_id IS NULL/);
    expect(update).toMatch(/job\.processing_token IS NULL/);
    expect(update).toMatch(/jsonb_array_length\(job\.files\) = expected\.expected_file_count/);
    expect(update).toMatch(/file_entry->>'storageProvider' IS DISTINCT FROM 'r2'/);
    expect(update).toMatch(/expected_error_sha256/);
    expect(update).toMatch(/expected_facts_sha256/);
    expect(update).toMatch(/expected_files_sha256/);
    expect(template).toMatch(/update_rows IS DISTINCT FROM 1/);
  });

  it("(33-36) changes only retryable and trigger-owned updated_at", () => {
    const assignments = [
      ...template.matchAll(/UPDATE public\.studio_upload_jobs AS job[\s\S]*?RETURNING job\.\*/g),
    ];
    expect(assignments).toHaveLength(1);
    const assignment = assignments[0][0].match(
      /SET\s+([\s\S]*?)\s+FROM contained_job_repair_params/,
    )?.[1];
    expect(assignment?.trim()).toBe("retryable = true");
    expect(template).toContain("to_jsonb(after_row) - 'retryable' - 'updated_at'");
    expect(template).toContain("to_jsonb(before_row) - 'retryable' - 'updated_at'");
    expect(template).not.toMatch(/INSERT INTO public\.(projects|listings|studio_upload_jobs)/);
  });

  it("rolls back every mismatch and commits only the proven success path", () => {
    for (const reason of [
      "zero_rows",
      "status_changed",
      "retryable_not_false",
      "workflow_changed",
      "attempt_count_changed",
      "provider_changed",
      "project_result_present",
      "processing_attempt_active",
      "file_count_changed",
      "manifest_provider_changed",
      "error_evidence_changed",
      "facts_changed",
      "manifest_changed",
      "affected_rows_not_one",
      "unrelated_field_changed",
    ]) {
      expect(template).toContain(`'${reason}'`);
    }
    expect(template).toMatch(/\\if :repair_ok\s+COMMIT;/s);
    expect(template).toMatch(/\\else\s+ROLLBACK;/s);
    expect(template).toContain("contained_job_repair_rolled_back");
  });

  it("uses one bounded existing audit event and introduces no fallback or admin feature", () => {
    expect(template).toContain("INSERT INTO public.audit_log");
    expect(template).toContain("studio_contained_r2_job_exact_row_repair");
    expect(template).toContain("jsonb_build_object('retryable', false)");
    expect(template).toContain("jsonb_build_object('retryable', true)");
    expect(template).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i);
    expect(template).not.toMatch(/storage\.objects|supabase/i);
  });
});

describe("Owner runbook exceptional recovery boundary", () => {
  it("requires separate authorization, complete preflight, postchecks, and one Retry", () => {
    expect(runbook).toMatch(/separate explicit Owner\s+authorization/i);
    expect(runbook).toMatch(/PR #134 is merged/i);
    expect(runbook).toMatch(/applied \*\*exactly once\*\*/i);
    expect(runbook).toMatch(/traffic is 100%/i);
    expect(runbook).toMatch(/Every private R2 object/i);
    expect(runbook).toMatch(/Supabase Storage counts and bytes are unchanged/i);
    expect(runbook).toMatch(/Required read-only post-commit checks/i);
    expect(runbook).toMatch(/Retry processing exactly once/i);
    expect(runbook).toMatch(/Do not reselect or re-upload files/i);
    expect(runbook).toMatch(/No re-upload is required/i);
  });
});
