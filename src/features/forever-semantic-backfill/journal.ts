/**
 * The journal — what actually happened, in a file the run cannot lose
 * (FOREVER-SEMANTIC-MEDIA-BACKFILL-001).
 *
 * A per-project transaction gives atomicity per project and nothing across
 * them. Kill the process between project four and project five and the
 * database is in a state no single record describes: four projects written,
 * eleven not, and no way to tell which without asking. The journal is that
 * record, appended before and after every project, flushed to disk each time.
 *
 * The hard case is the one in the middle: a `project_started` with no matching
 * outcome. The tempting assumption is "it rolled back" — the transaction was
 * open, the connection died, PostgreSQL rolls back. That assumption is wrong
 * often enough to matter: the process can also die AFTER the COMMIT succeeded
 * and BEFORE the append lands. Retrying on that assumption re-applies a write
 * that already succeeded, which for this backfill is harmless, and re-runs the
 * business-invariant assertions against a moved baseline, which is not.
 *
 * So a crashed project is never assumed. Its live role digest is read and
 * compared against the two digests the plan predicted, giving three outcomes —
 * and the third one, "neither", is a state a single transaction cannot produce.
 * That means something else wrote to the table, and the correct action is to
 * stop: exit 12, no repair, no further writes. An automatic repair here would
 * be a second unreviewed write on top of an unexplained one.
 *
 * The journal is never hashed and `at` is informational. Hashing it would make
 * the run's identity depend on its own timing.
 */

import { JOURNAL_SCHEMA_VERSION, type BackfillManifest, type ManifestDigests } from "./types";

export { JOURNAL_SCHEMA_VERSION };

export interface RunOpened {
  record: "run_opened";
  at: string;
  run_id: string;
  schema_version: string;
  project_ref: string;
  mode: "execute" | "dry_run";
  controller_commit: string;
  /** Basename only. An absolute path is private filesystem detail. */
  manifest_basename: string;
  digests: ManifestDigests;
  projects_selected: string[];
}

export interface ProjectStarted {
  record: "project_started";
  at: string;
  run_id: string;
  project_id: string;
  slug: string;
  project_plan_digest: string;
  planned_updates: number;
  planned_exceptions: number;
  role_digest_before: string;
  role_digest_expected_after: string;
}

export interface ProjectCommitted {
  record: "project_committed";
  at: string;
  run_id: string;
  project_id: string;
  slug: string;
  project_plan_digest: string;
  rows_updated: number;
  rpc_applied: number;
  role_digest_observed_after: string;
  business_invariant_digest: string;
  verified: boolean;
  recovered_from_crash: boolean;
}

/**
 * A dry run reached `ROLLBACK` cleanly. It is NOT a commit, and it must never
 * be recorded as one.
 *
 * It was, and the consequence was the worst kind: silent success. The dry-run
 * branch appended `project_committed` with `rows_updated: 0`, `classifyResume`
 * read only the record name, and the resume path skips anything classified
 * `committed`. So the prescribed sequence — dry run, then execute against the
 * same journal — made the real run write nothing and then record
 * `already_applied_idempotent` for every project. The census gate still failed
 * closed, but the journal, which is the release record, asserted that rows had
 * been applied that were never written. `mode: dry_run` did exist on
 * `run_opened`, and `classifyResume` never looked at it; a distinct record is
 * the fix that cannot be forgotten at the one call site that matters.
 */
export interface ProjectDryRun {
  record: "project_dry_run";
  at: string;
  run_id: string;
  project_id: string;
  slug: string;
  project_plan_digest: string;
  /** Always 0. Present so the shape reads honestly next to a real commit. */
  rows_updated: 0;
  rpc_applied: number;
  role_digest_observed_after: string;
  business_invariant_digest: string;
  verified: boolean;
}

export interface ProjectSkipped {
  record: "project_skipped";
  at: string;
  run_id: string;
  project_id: string;
  slug: string;
  reason: "already_applied_idempotent" | "not_selected";
}

export interface ProjectFailed {
  record: "project_failed";
  at: string;
  run_id: string;
  project_id: string;
  slug: string;
  project_plan_digest: string;
  error_code: string;
  error_message_redacted: string;
  rolled_back: boolean;
}

export interface RunClosed {
  record: "run_closed";
  at: string;
  run_id: string;
  projects_committed: number;
  /**
   * Projects that reached ROLLBACK cleanly under `--dry-run`.
   *
   * Counted apart from `projects_committed`, which used to absorb them — so a
   * dry run closed its journal claiming eleven commits for eleven rolled-back
   * projects. The per-project records were correct; only this summary lied, and
   * the summary is the line somebody reads first.
   */
  projects_dry_run_only: number;
  projects_skipped: number;
  projects_failed: number;
  projects_never_attempted: number;
  verification_ran: boolean;
  gate_exit_code: number | null;
}

export type JournalRecord =
  | RunOpened
  | ProjectStarted
  | ProjectCommitted
  | ProjectDryRun
  | ProjectSkipped
  | ProjectFailed
  | RunClosed;

const KNOWN_RECORDS = new Set([
  "run_opened",
  "project_started",
  "project_committed",
  "project_dry_run",
  "project_skipped",
  "project_failed",
  "run_closed",
]);

/**
 * Parse a journal, skipping nothing silently.
 *
 * A malformed line throws. A journal is only useful if it is complete: quietly
 * dropping the one line that could not be parsed is how a crashed project
 * becomes invisible and gets retried against an already-written table.
 */
export function parseJournal(lines: readonly string[]): JournalRecord[] {
  const records: JournalRecord[] = [];
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(
        `Journal line ${index + 1} is not valid JSON. A journal that cannot be read in full ` +
          `cannot be resumed from: a crashed project would look like one that never started.`,
      );
    }
    const entry = parsed as { record?: unknown };
    if (typeof entry.record !== "string" || !KNOWN_RECORDS.has(entry.record)) {
      throw new Error(
        `Journal line ${index + 1} has unknown record type "${String(entry.record)}".`,
      );
    }
    records.push(parsed as JournalRecord);
  });
  return records;
}

export type ProjectResumeState =
  | "never_attempted"
  | "committed"
  /**
   * A dry run rolled back cleanly. Deliberately NOT `committed` and deliberately
   * NOT `never_attempted`: nothing was written, so a real run must still do the
   * work, but the caller may want to say so rather than treat the journal as
   * untouched.
   */
  | "dry_run_only"
  | "skipped"
  | "failed"
  | "crashed_mid_project";

export interface ResumePlan {
  /** True when the journal belongs to a different manifest. Exit 11, no writes. */
  foreignRunId: boolean;
  perProject: Map<string, ProjectResumeState>;
}

/**
 * Classify every project in the manifest against an existing journal.
 *
 * The `run_id` is the manifest's idempotency key, which folds in the target
 * ref. So a journal from a different plan — or from the same plan pointed at a
 * different database — cannot be mistaken for this one's, and resuming from it
 * is refused rather than merged.
 */
export function classifyResume(
  records: readonly JournalRecord[],
  runId: string,
  manifest: BackfillManifest,
): ResumePlan {
  const foreign = records.some(
    (entry) => "run_id" in entry && entry.run_id && entry.run_id !== runId,
  );
  const perProject = new Map<string, ProjectResumeState>();
  for (const project of manifest.projects) perProject.set(project.project_id, "never_attempted");

  if (foreign) return { foreignRunId: true, perProject };

  for (const entry of records) {
    if (entry.record === "project_started") {
      if (perProject.has(entry.project_id)) perProject.set(entry.project_id, "crashed_mid_project");
    } else if (entry.record === "project_committed") {
      perProject.set(entry.project_id, "committed");
    } else if (entry.record === "project_dry_run") {
      // Clears the `crashed_mid_project` its own `project_started` set, and
      // nothing more. A dry run wrote nothing, so the project is still work to
      // do — see ProjectDryRun for what happened when this said "committed".
      perProject.set(entry.project_id, "dry_run_only");
    } else if (entry.record === "project_skipped") {
      perProject.set(entry.project_id, "skipped");
    } else if (entry.record === "project_failed") {
      perProject.set(entry.project_id, "failed");
    }
  }
  return { foreignRunId: false, perProject };
}

/**
 * What a crashed project's live state means.
 *
 * `rolled_back` and `committed` are the two outcomes a single transaction can
 * leave behind. `partial_irrecoverable` is the third, and it is not a variant
 * of the other two: it means the table holds roles that neither the pre-state
 * nor the planned post-state predicts, so something outside this run wrote to
 * it. There is no safe automatic response — a repair would be a second
 * unreviewed write layered on an unexplained one — so the caller stops.
 */
export function classifyCrashedProject(
  liveRoleDigest: string,
  before: string,
  expectedAfter: string,
): "rolled_back" | "committed" | "partial_irrecoverable" {
  if (liveRoleDigest === expectedAfter) return "committed";
  if (liveRoleDigest === before) return "rolled_back";
  return "partial_irrecoverable";
}

/** One line of the journal file, terminated. Never pretty-printed. */
export function serialiseJournalRecord(entry: JournalRecord): string {
  return `${JSON.stringify(entry)}\n`;
}
