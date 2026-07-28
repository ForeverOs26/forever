import { describe, expect, it } from "vitest";

import {
  classifyCrashedProject,
  classifyResume,
  JOURNAL_SCHEMA_VERSION,
  parseJournal,
  serialiseJournalRecord,
  type JournalRecord,
} from "../journal";
import { buildBackfillManifest } from "../plan";
import {
  GENERATED_AT,
  GENERATOR_COMMIT,
  IDS,
  POLICY,
  snapshot,
  standardEvidence,
} from "./fixtures";

const manifest = buildBackfillManifest({
  snapshot: snapshot(),
  evidenceBySlug: standardEvidence(),
  policy: POLICY,
  generatorCommit: GENERATOR_COMMIT,
  generatedAt: GENERATED_AT,
  acknowledgements: [],
});
const RUN = manifest.digests.idempotency_key;

function started(projectId: string, runId = RUN): JournalRecord {
  return {
    record: "project_started",
    at: "2026-07-28T12:00:00.000Z",
    run_id: runId,
    project_id: projectId,
    slug: "x",
    project_plan_digest: "d",
    planned_updates: 1,
    planned_exceptions: 0,
    role_digest_before: "b",
    role_digest_expected_after: "a",
  };
}

function committed(projectId: string, runId = RUN): JournalRecord {
  return {
    record: "project_committed",
    at: "2026-07-28T12:00:01.000Z",
    run_id: runId,
    project_id: projectId,
    slug: "x",
    project_plan_digest: "d",
    rows_updated: 1,
    rpc_applied: 1,
    role_digest_observed_after: "a",
    business_invariant_digest: "i",
    verified: true,
    recovered_from_crash: false,
  };
}

describe("parseJournal", () => {
  it("round-trips a record", () => {
    const line = serialiseJournalRecord(committed(IDS.coralina));
    expect(line.endsWith("\n")).toBe(true);
    expect(parseJournal([line])).toHaveLength(1);
  });

  it("ignores blank lines but throws on a malformed one", () => {
    expect(parseJournal(["", "  "])).toEqual([]);
    // A journal that cannot be read in full cannot be resumed from: the line
    // that was dropped is exactly the one describing the project in flight.
    expect(() => parseJournal(["{not json"])).toThrowError(/not valid JSON/);
    expect(() => parseJournal(['{"record":"something_else"}'])).toThrowError(/unknown record type/);
  });
});

describe("classifyResume", () => {
  it("marks every project never_attempted for an empty journal", () => {
    const plan = classifyResume([], RUN, manifest);
    expect(plan.foreignRunId).toBe(false);
    expect([...plan.perProject.values()].every((state) => state === "never_attempted")).toBe(true);
  });

  it("distinguishes committed, skipped, failed and never attempted", () => {
    const plan = classifyResume(
      [
        started(IDS.coralina),
        committed(IDS.coralina),
        {
          record: "project_skipped",
          at: "t",
          run_id: RUN,
          project_id: IDS.sierra,
          slug: "s",
          reason: "already_applied_idempotent",
        },
        {
          record: "project_failed",
          at: "t",
          run_id: RUN,
          project_id: IDS.kirara,
          slug: "k",
          project_plan_digest: "d",
          error_code: "transaction_aborted",
          error_message_redacted: "…",
          rolled_back: true,
        },
      ],
      RUN,
      manifest,
    );
    expect(plan.perProject.get(IDS.coralina)).toBe("committed");
    expect(plan.perProject.get(IDS.sierra)).toBe("skipped");
    expect(plan.perProject.get(IDS.kirara)).toBe("failed");
    expect(plan.perProject.get(IDS.seeded)).toBe("never_attempted");
  });

  it("does not let a dry run pass for a commit", () => {
    // REGRESSION. The dry-run branch used to append `project_committed` with
    // rows_updated: 0, and this classifier reads the record name. The prescribed
    // sequence is a dry run followed by the real execute against the same
    // journal — so the real run skipped every project as "already applied" and
    // wrote nothing, while the journal, which is the release record, asserted
    // that rows had been applied that were never written.
    const plan = classifyResume(
      [
        started(IDS.coralina),
        {
          record: "project_dry_run",
          at: "2026-07-28T12:00:01.000Z",
          run_id: RUN,
          project_id: IDS.coralina,
          slug: "coralina",
          project_plan_digest: "d",
          rows_updated: 0,
          rpc_applied: 43,
          role_digest_observed_after: "b",
          business_invariant_digest: "i",
          verified: true,
        },
      ],
      RUN,
      manifest,
    );
    expect(plan.perProject.get(IDS.coralina)).toBe("dry_run_only");
    expect(plan.perProject.get(IDS.coralina)).not.toBe("committed");
  });

  it("detects a started project with no outcome as crashed", () => {
    const plan = classifyResume([started(IDS.coralina)], RUN, manifest);
    expect(plan.perProject.get(IDS.coralina)).toBe("crashed_mid_project");
  });

  it("refuses a journal from a different run", () => {
    // The run_id folds in the target ref, so a journal from the same plan
    // pointed at another database is foreign too.
    const plan = classifyResume([started(IDS.coralina, "someone-elses-run")], RUN, manifest);
    expect(plan.foreignRunId).toBe(true);
  });

  it("names the schema version it writes", () => {
    expect(JOURNAL_SCHEMA_VERSION).toBe("forever-semantic-media-backfill-journal.v1");
  });
});

describe("classifyCrashedProject", () => {
  it("recognises a commit that landed before the append", () => {
    // The tempting assumption is "the transaction was open, so it rolled back".
    // The process can also die AFTER the COMMIT and BEFORE the append.
    expect(classifyCrashedProject("after", "before", "after")).toBe("committed");
  });

  it("recognises a genuine rollback", () => {
    expect(classifyCrashedProject("before", "before", "after")).toBe("rolled_back");
  });

  it("refuses to guess when the state is neither", () => {
    // A single transaction cannot produce this, so something else wrote to the
    // table. There is no safe automatic repair.
    expect(classifyCrashedProject("something else", "before", "after")).toBe(
      "partial_irrecoverable",
    );
  });
});
