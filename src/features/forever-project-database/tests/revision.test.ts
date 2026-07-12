import { describe, expect, it } from "vitest";

import {
  PROJECT_CHANGE_KINDS,
  describeProjectRevision,
  isKnownProjectChangeKind,
  projectChange,
  projectChangeKindApplies,
} from "..";
import { makeValue } from "./fixtures";

describe("described changes", () => {
  it("declares the five change kinds and guards them", () => {
    expect(PROJECT_CHANGE_KINDS).toEqual(["added", "updated", "removed", "unchanged", "rejected"]);
    for (const kind of PROJECT_CHANGE_KINDS) expect(isKnownProjectChangeKind(kind)).toBe(true);
    expect(isKnownProjectChangeKind("merged")).toBe(false);
    expect(isKnownProjectChangeKind(undefined)).toBe(false);
  });

  it("only added, updated, and removed describe applying movements", () => {
    expect(projectChangeKindApplies("added")).toBe(true);
    expect(projectChangeKindApplies("updated")).toBe(true);
    expect(projectChangeKindApplies("removed")).toBe(true);
    expect(projectChangeKindApplies("unchanged")).toBe(false);
    expect(projectChangeKindApplies("rejected")).toBe(false);
  });

  it("builds changes attaching only what was supplied", () => {
    const bare = projectChange("unchanged", "pricing.basePrice");
    expect(bare).toEqual({ kind: "unchanged", path: "pricing.basePrice" });
    const full = projectChange("updated", "pricing.basePrice", {
      fieldId: "pfld_coralina-pricing-baseprice",
      before: makeValue(),
      after: makeValue({ rawValue: "THB 4,700,000" }),
      factId: "xfact_coralina-price-1br-v1-1-0",
      note: "price list revision",
    });
    expect(full.kind).toBe("updated");
    expect(full.before?.rawValue).toBe("THB 4,590,000");
    expect(full.after?.rawValue).toBe("THB 4,700,000");
  });
});

describe("describeProjectRevision", () => {
  it("derives the version-addressed id and project id deterministically", () => {
    const revision = describeProjectRevision({ projectSlug: "coralina", number: 2 });
    expect(revision.id).toBe("prev_coralina-r2");
    expect(revision.projectId).toBe("proj_coralina");
    expect(revision.number).toBe(2);
    expect(revision.changes).toEqual([]);
    expect("createdAt" in revision).toBe(false);
    expect("basedOn" in revision).toBe(false);
  });

  it("attaches optional observations only when supplied — no fabricated timestamps", () => {
    const revision = describeProjectRevision({
      projectSlug: "coralina",
      number: 2,
      basedOn: "prev_coralina-r1",
      createdAt: "2026-07-12T00:00:00.000Z",
      author: "intake",
      reason: "settle batch",
    });
    expect(revision.basedOn).toBe("prev_coralina-r1");
    expect(revision.createdAt).toBe("2026-07-12T00:00:00.000Z");
    expect(revision.author).toBe("intake");
    expect(revision.reason).toBe("settle batch");
  });

  it("is pure and never aliases the caller's changes", () => {
    const changes = [projectChange("added", "pricing.basePrice", { after: makeValue() })];
    const revision = describeProjectRevision({ projectSlug: "coralina", number: 1, changes });
    expect(revision.changes).toEqual(changes);
    expect(revision.changes).not.toBe(changes);
    revision.changes.pop();
    expect(changes).toHaveLength(1);
    expect(
      describeProjectRevision({ projectSlug: "coralina", number: 1, changes }).changes,
    ).toEqual(changes);
  });
});
