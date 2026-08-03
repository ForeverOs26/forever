import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const TEMPLATE_PATH = "docs/FOREVER_STUDIO_CONTAINED_R2_JOB_EXACT_ROW_REPAIR.sql";
const RUNBOOK_PATH = "docs/FOREVER_STUDIO_OWNER_RUNBOOK.md";
const template = readFileSync(resolve(process.cwd(), TEMPLATE_PATH), "utf8");
const runbook = readFileSync(resolve(process.cwd(), RUNBOOK_PATH), "utf8");

const updateStatement = template.slice(
  template.indexOf("UPDATE public.studio_upload_jobs AS job"),
  template.indexOf("RETURNING job.* INTO after_row"),
);

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
    // No filename, extension, or complete object key may be committed here.
    expect(template).not.toMatch(/\.(?:jpe?g|png|pdf|zip|docx?|xlsx?)\b/i);
    expect(template).not.toMatch(/studio\/jobs\//);
  });

  it("(26-32, 37) locks one exact row and repeats every invariant on the update", () => {
    expect(template).toMatch(/BEGIN;/);
    expect(template).toMatch(/SET LOCAL lock_timeout = '5s'/);
    expect(template).toMatch(/SET LOCAL statement_timeout = '30s'/);
    expect(template).toMatch(/WHERE id = p\.job_id\s+FOR UPDATE/s);

    expect(updateStatement).toMatch(/SET retryable = true/);
    expect(updateStatement).toMatch(/job\.id = expected_params\.job_id/);
    expect(updateStatement).toMatch(/job\.status = 'failed'/);
    expect(updateStatement).toMatch(/job\.retryable IS FALSE/);
    expect(updateStatement).toMatch(/job\.workflow = expected_params\.expected_workflow/);
    expect(updateStatement).toMatch(/job\.attempt_count = expected_params\.expected_attempt_count/);
    expect(updateStatement).toMatch(
      /job\.facts #>> '\{storage,provider\}' = expected\.required_storage_provider/,
    );
    expect(updateStatement).toMatch(/job\.result_summary IS NULL/);
    expect(updateStatement).toMatch(/job\.project_slug IS NULL/);
    expect(updateStatement).toMatch(/job\.listing_id IS NULL/);
    expect(updateStatement).toMatch(/job\.content_fingerprint IS NULL/);
    expect(updateStatement).toMatch(/job\.processing_token IS NULL/);
    expect(updateStatement).toMatch(/job\.processing_started_at IS NULL/);
    expect(updateStatement).toMatch(
      /jsonb_array_length\(job\.files\) = expected_params\.expected_file_count/,
    );
    expect(updateStatement).toMatch(/expected_params\.expected_error_sha256/);
    expect(updateStatement).toMatch(/expected_params\.expected_facts_sha256/);
    expect(updateStatement).toMatch(/expected_params\.expected_files_sha256/);
    expect(template).toMatch(/update_rows IS DISTINCT FROM 1/);
  });

  /**
   * PART 1 — the repaired row must be Owner-retryable and automatically
   * exhausted in ONE statement inside ONE transaction.
   */
  it("(17, 18) writes retryability and automatic exhaustion atomically", () => {
    const statements = [
      ...template.matchAll(/UPDATE public\.studio_upload_jobs AS job[\s\S]*?RETURNING job\.\*/g),
    ];
    expect(statements).toHaveLength(1);

    const assignment = statements[0][0].match(
      /SET\s+([\s\S]*?)\s+FROM contained_job_repair_params/,
    )?.[1];
    expect(assignment).toMatch(/retryable = true/);
    expect(assignment).toMatch(/facts = job\.facts/);
    expect(assignment).toMatch(/'retry'/);
    expect(assignment).toMatch(/'automatic', expected\.required_automatic_state/);

    // Both halves belong to the same statement: there is no second UPDATE that
    // could commit retryability before the exhausted state.
    expect(template).not.toMatch(
      /UPDATE public\.studio_upload_jobs[\s\S]*?UPDATE public\.studio_upload_jobs/,
    );
    expect(template.match(/\bBEGIN;/g)).toHaveLength(1);
    expect(template).toContain("'exhausted'");
    expect(template).toContain("post_automatic_state_not_exhausted");
    expect(template).toContain("post_automatic_lane_still_eligible");
    expect(template).toContain("public.studio_job_automatic_retry_exhausted(after_row.facts)");
  });

  /**
   * jsonb_set() returns its target UNCHANGED when an earlier path step is
   * missing, which is exactly the legacy `facts` this procedure repairs. Using
   * it here would silently write nothing.
   */
  it("(17) builds the retry state without depending on an existing retry key", () => {
    expect(template).not.toMatch(/jsonb_set\s*\([^)]*retry/);
    expect(template).toContain("COALESCE(job.facts -> 'retry', '{}'::jsonb)");
    expect(template).toContain("retry_facts_not_object");
  });

  it("(19, 20) proves due and active exclusion inside the repair transaction", () => {
    expect(template).toContain("public.studio_list_due_jobs(now(), 100, before_row.created_by)");
    // Measured on both sides of the write, or "unchanged" proves nothing.
    expect(
      template.split("public.studio_count_active_jobs(before_row.created_by)").length - 1,
    ).toBe(2);
    expect(template).toContain("active_before := public.studio_count_active_jobs");
    expect(template).toContain("active_after := public.studio_count_active_jobs");
    expect(template).toContain("active_after IS DISTINCT FROM active_before");
    expect(template).toContain("post_repair_job_is_due");
    expect(template).toContain("post_repair_active_count_changed");
    // The isolation assertions are evaluated before the audit event and before
    // COMMIT, so a row that would be offered to the automatic lane rolls back.
    expect(template.indexOf("post_repair_job_is_due")).toBeLessThan(
      template.indexOf("INSERT INTO public.audit_log"),
    );
  });

  it("(22) never claims the job for the Owner as part of the repair", () => {
    // Naming them in a comment is fine; calling them is not.
    expect(template).not.toMatch(/studio_claim_job\s*\(|studio_request_job_processing\s*\(/);
    expect(template).not.toMatch(/SET\s+status\s*=|attempt_count\s*=\s*attempt_count/);
  });

  /**
   * PART 2 — the exceptional template applies to the contained six-file pilot
   * and to nothing else.
   */
  it("(29-40) requires the exact authorized six-file material multiset", () => {
    expect(template).toMatch(
      /expected_file_count integer NOT NULL CHECK \(expected_file_count = 6\)/,
    );
    expect(template).toContain("required_file_count integer NOT NULL");
    expect(template).toMatch(/INSERT INTO contained_job_repair_shape VALUES \(\s*6,/);
    expect(template).toContain(
      `'{"project_photo": 3, "brochure": 1, "price_list": 1, "developer_profile": 1}'::jsonb`,
    );
    expect(template).toContain("'new_development'");
    expect(template).toContain("'owner_selected'");
    expect(template).toContain("file_count_not_exactly_six");
    expect(template).toContain("material_purpose_multiset_changed");
    expect(template).toContain("material_purpose_source_changed");

    // The multiset is recomputed on the write itself, and an entry with no
    // purpose aggregates under a key the expected multiset does not contain.
    expect(updateStatement).toContain("required_purpose_multiset");
    expect(updateStatement).toContain("required_purpose_source");
    expect(updateStatement).toContain(`COALESCE(file_entry ->> 'materialPurpose', '(absent)')`);
    expect(updateStatement).toMatch(
      /file_entry->>'storageProvider' IS DISTINCT FROM expected\.required_storage_provider/,
    );
    expect(updateStatement).toMatch(
      /jsonb_array_length\(job\.files\) = expected\.required_file_count/,
    );
  });

  it("(33-36) changes only retryable, one facts path, and trigger-owned updated_at", () => {
    expect(template).toContain("to_jsonb(after_row) - 'retryable' - 'facts' - 'updated_at'");
    expect(template).toContain("to_jsonb(before_row) - 'retryable' - 'facts' - 'updated_at'");
    expect(template).toContain("after_row.facts IS DISTINCT FROM expected_facts");
    expect(template).toContain("unrelated_facts_field_changed");
    expect(template).not.toMatch(/INSERT INTO public\.(projects|listings|studio_upload_jobs)/);
  });

  it("(41, 42) rolls back every mismatch and commits only the proven success path", () => {
    for (const reason of [
      "zero_rows",
      "status_changed",
      "retryable_not_false",
      "workflow_changed",
      "workflow_not_authorized_shape",
      "attempt_count_changed",
      "provider_changed",
      "retry_facts_not_object",
      "project_result_present",
      "processing_attempt_active",
      "file_count_not_exactly_six",
      "file_count_changed",
      "manifest_provider_changed",
      "material_purpose_multiset_changed",
      "material_purpose_source_changed",
      "error_evidence_changed",
      "facts_changed",
      "manifest_changed",
      "affected_rows_not_one",
      "post_automatic_state_not_exhausted",
      "post_automatic_lane_still_eligible",
      "unrelated_facts_field_changed",
      "unrelated_field_changed",
      "post_repair_job_is_due",
      "post_repair_active_count_changed",
    ]) {
      expect(template).toContain(`'${reason}'`);
    }
    expect(template).toMatch(/\\if :repair_ok\s+COMMIT;/s);
    expect(template).toMatch(/\\else\s+ROLLBACK;/s);
    expect(template).toContain("contained_job_repair_rolled_back");
    // The audit event is written only on the proven success path.
    expect(template.indexOf("INSERT INTO public.audit_log")).toBeGreaterThan(
      template.indexOf("failure_reason := 'affected_rows_not_one'"),
    );
  });

  it("uses one bounded existing audit event and introduces no fallback or admin feature", () => {
    expect(template).toContain("INSERT INTO public.audit_log");
    expect(template).toContain("studio_contained_r2_job_exact_row_repair");
    expect(template).toMatch(/'retryable', false/);
    expect(template).toMatch(/'retryable', true/);
    expect(template).toMatch(/'automatic_retry', s\.required_automatic_state/);
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

  it("documents the owner-retryable but automatically exhausted end state", () => {
    expect(runbook).toMatch(/OWNER-RETRYABLE BUT AUTOMATICALLY EXHAUSTED/);
    expect(runbook).toMatch(/`retryable=true` alone is unsafe/i);
    expect(runbook).toMatch(/same transaction/i);
    expect(runbook).toMatch(/facts\.retry\.automatic/);
    expect(runbook).toMatch(/studio_list_due_jobs/);
    expect(runbook).toMatch(/studio_count_active_jobs/);
    expect(runbook).toMatch(/cron must not start processing/i);
    expect(runbook).toMatch(/exactly six/i);
    expect(runbook).toMatch(/three project photos/i);
    expect(runbook).toMatch(/no Payment Plan/i);
    expect(runbook).toMatch(/no Project Archive/i);
  });
});
