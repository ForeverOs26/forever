/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — write-action safety.
 *
 * The registry itself, plus a static pin on every Studio write site that must
 * participate. A mutation that stops registering is a mutation an automatic
 * reload could interrupt, so the wiring is asserted at source level rather than
 * left to be noticed later.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  beginConsequentialAction,
  hasUnprovenConsequentialAction,
  markConsequentialActionUnreconciled,
  openConsequentialActions,
  reconcileConsequentialAction,
  resetConsequentialActionsForTest,
  runStudioWriteAction,
  STALE_ASSET_CONSEQUENTIAL_ACTIONS,
  studioWriteRejectionIsServerProven,
  unreconciledConsequentialActions,
} from "./write-safety";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

beforeEach(() => {
  resetConsequentialActionsForTest();
});

describe("consequential action registry", () => {
  it("starts clear", () => {
    expect(hasUnprovenConsequentialAction()).toBe(false);
    expect(openConsequentialActions()).toEqual([]);
  });

  it("reports an open action and clears on release", () => {
    const release = beginConsequentialAction("publication");
    expect(hasUnprovenConsequentialAction()).toBe(true);
    expect(openConsequentialActions()).toEqual(["publication"]);
    release();
    expect(hasUnprovenConsequentialAction()).toBe(false);
  });

  it("is safe to release more than once", () => {
    const release = beginConsequentialAction("upload_start");
    release();
    release();
    expect(hasUnprovenConsequentialAction()).toBe(false);
  });

  it("counts concurrent actions of the same kind", () => {
    const first = beginConsequentialAction("member_change");
    const second = beginConsequentialAction("member_change");
    first();
    expect(hasUnprovenConsequentialAction()).toBe(true);
    second();
    expect(hasUnprovenConsequentialAction()).toBe(false);
  });

  it("keeps a closed vocabulary of exactly the audited write kinds", () => {
    expect([...STALE_ASSET_CONSEQUENTIAL_ACTIONS].sort()).toEqual([
      "job_processing",
      "member_change",
      "owner_retry_observe",
      "owner_retry_submit",
      "password_update",
      "project_amenities",
      "project_facts",
      "project_hero",
      "publication",
      "resale_facts",
      "resume_pending",
      "upload_confirm",
      "upload_start",
    ]);
  });
});

// ---------------------------------------------------------------------------
// The canonical boundary (independent-review P1-3)
// ---------------------------------------------------------------------------

describe("runStudioWriteAction — the canonical Studio write boundary", () => {
  it("registers SYNCHRONOUSLY, before the operation can dispatch", async () => {
    let openAtDispatch: string[] = [];
    await runStudioWriteAction("publication", async () => {
      openAtDispatch = openConsequentialActions();
      return "ok";
    });
    expect(openAtDispatch).toEqual(["publication"]);
  });

  it("releases on resolve and returns the value unchanged", async () => {
    await expect(runStudioWriteAction("project_facts", async () => 42)).resolves.toBe(42);
    expect(hasUnprovenConsequentialAction()).toBe(false);
  });

  it("releases on a SERVER-PROVEN rejection and rethrows unchanged", async () => {
    const refusal = new Error("not allowed");
    refusal.name = "studio_membership_required";
    await expect(
      runStudioWriteAction("member_change", async () => {
        throw refusal;
      }),
    ).rejects.toBe(refusal);
    expect(hasUnprovenConsequentialAction()).toBe(false);
    expect(unreconciledConsequentialActions()).toEqual([]);
  });

  it("a LOST response stays unsafe until a read-only path reconciles it", async () => {
    await expect(
      runStudioWriteAction("publication", async () => {
        throw new TypeError("Failed to fetch");
      }),
    ).rejects.toBeInstanceOf(TypeError);
    // The browser stopped waiting; the server may already have applied it.
    expect(hasUnprovenConsequentialAction()).toBe(true);
    expect(unreconciledConsequentialActions()).toEqual(["publication"]);
    reconcileConsequentialAction("publication");
    expect(hasUnprovenConsequentialAction()).toBe(false);
  });

  it("an ABORT is a lost response, not proof of anything", async () => {
    const aborted = new Error("aborted");
    aborted.name = "AbortError";
    await expect(
      runStudioWriteAction("job_processing", async () => {
        throw aborted;
      }),
    ).rejects.toBe(aborted);
    expect(unreconciledConsequentialActions()).toEqual(["job_processing"]);
  });

  it("a bare Error is a lost response", async () => {
    await expect(
      runStudioWriteAction("resume_pending", async () => {
        throw new Error("boom");
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(unreconciledConsequentialActions()).toEqual(["resume_pending"]);
  });

  it("classifies server-assigned names as proven and transport failures as unknown", () => {
    const named = new Error("x");
    named.name = "job_already_published";
    expect(studioWriteRejectionIsServerProven(named)).toBe(true);
    expect(studioWriteRejectionIsServerProven(new TypeError("Failed to fetch"))).toBe(false);
    expect(studioWriteRejectionIsServerProven(new Error("boom"))).toBe(false);
    expect(studioWriteRejectionIsServerProven("a string")).toBe(false);
    expect(studioWriteRejectionIsServerProven(null)).toBe(false);
  });

  it("two concurrent writes stay unsafe until BOTH settle", async () => {
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const first = runStudioWriteAction(
      "publication",
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    const second = runStudioWriteAction(
      "project_hero",
      () =>
        new Promise<void>((resolve) => {
          releaseSecond = resolve;
        }),
    );
    expect(openConsequentialActions()).toEqual(["project_hero", "publication"]);
    releaseFirst();
    await first;
    expect(hasUnprovenConsequentialAction()).toBe(true);
    releaseSecond();
    await second;
    expect(hasUnprovenConsequentialAction()).toBe(false);
  });

  it("nested writes are reference-counted", async () => {
    await runStudioWriteAction("upload_start", async () => {
      await runStudioWriteAction("upload_start", async () => {
        expect(hasUnprovenConsequentialAction()).toBe(true);
      });
      // The inner write settled; the outer one has not.
      expect(hasUnprovenConsequentialAction()).toBe(true);
    });
    expect(hasUnprovenConsequentialAction()).toBe(false);
  });

  it("an unreconciled action is cleared by nothing except reconciliation", () => {
    markConsequentialActionUnreconciled("upload_confirm");
    expect(hasUnprovenConsequentialAction()).toBe(true);
    // Opening and closing an unrelated action changes nothing.
    beginConsequentialAction("publication")();
    expect(hasUnprovenConsequentialAction()).toBe(true);
    reconcileConsequentialAction("upload_confirm");
    expect(hasUnprovenConsequentialAction()).toBe(false);
  });
});

describe("every Studio write site participates", () => {
  it("Owner Retry registers submission AND observation, and releases on every terminal path", () => {
    const dashboard = read("src/features/forever-studio/components/StudioDashboard.tsx");
    expect(dashboard).toContain('beginConsequentialAction("owner_retry_submit")');
    expect(dashboard).toContain('beginConsequentialAction("owner_retry_observe")');
    // clearOwnerRetryTimers is the single funnel every terminal path uses.
    expect(dashboard).toContain("timers.releaseSubmit?.();");
    expect(dashboard).toContain("timers.releaseObserve?.();");
  });

  it("the Owner Retry absolute deadline and lock are untouched", () => {
    const dashboard = read("src/features/forever-studio/components/StudioDashboard.tsx");
    const observation = read("src/features/forever-studio/components/manual-retry-observation.ts");
    // The one absolute deadline, still armed before the mutation is sent.
    expect(dashboard).toContain("STUDIO_OWNER_RETRY_OBSERVATION.totalTimeoutMs");
    expect(dashboard).toContain("retryLocksRef.current.add(job.id)");
    // The timeout state still refuses to resubmit.
    expect(dashboard).toContain("markOwnerRetryTimeout");
    expect(observation).toContain("totalTimeoutMs: 14 * 60 * 1_000");
  });

  it("both publication mutations run through the canonical boundary", () => {
    const dashboard = read("src/features/forever-studio/components/StudioDashboard.tsx");
    const matches = dashboard.match(/runStudioWriteAction\("publication"/g) ?? [];
    expect(matches).toHaveLength(2);
  });

  it("the uploader registers for the whole job run and always releases", () => {
    const uploader = read("src/features/forever-studio/components/StudioUploader.tsx");
    expect(uploader).toContain('beginConsequentialAction("upload_start")');
    expect(uploader).toContain("releaseUpload();");
    expect(uploader).toMatch(/} finally \{\s*releaseUpload\(\);/);
  });

  it("both membership mutations run through the canonical boundary", () => {
    const members = read("src/features/forever-studio/components/StudioMembers.tsx");
    const matches = members.match(/runStudioWriteAction\("member_change"/g) ?? [];
    expect(matches).toHaveLength(2);
  });

  it("the password update registers and always releases", () => {
    const reset = read("src/features/forever-studio/components/StudioResetPassword.tsx");
    expect(reset).toContain('beginConsequentialAction("password_update")');
    expect(reset).toMatch(/} finally \{\s*releasePasswordUpdate\(\);/);
  });
});

describe("recovery never resubmits anything", () => {
  it("the recovery machine contains no mutation, retry, upload or publication call", () => {
    const recovery = read("src/lib/stale-asset/stale-asset-recovery.ts");
    const capture = read("src/lib/stale-asset/global-capture.ts");
    for (const source of [recovery, capture]) {
      for (const forbidden of [
        "studioProcessJob",
        "studioStartJob",
        "studioSetProjectPublication",
        "studioSetListingPublication",
        "studioInviteMember",
        "studioSetMemberActive",
        "updateUser",
        "mutateAsync",
        "supabase",
      ]) {
        expect(source).not.toContain(forbidden);
      }
    }
  });

  it("the only network call the recovery path makes is the build probe", () => {
    const identity = read("src/lib/stale-asset/build-identity.ts");
    expect(identity).toContain("FOREVER_BUILD_ENDPOINT");
    expect(identity).toContain('cache: "no-store"');
    expect(identity).toContain('credentials: "omit"');
    // No method is specified, so it is a GET; and no body is ever sent.
    expect(identity).not.toContain('method: "POST"');
    expect(identity).not.toContain("body:");
  });
});
