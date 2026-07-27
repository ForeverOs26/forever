import { afterEach, describe, expect, it, vi } from "vitest";

import {
  inspectPlanCollisions,
  type CollisionFinding,
  type CollisionInspectionReport,
} from "./collision-inspector";
import { assertReadOnlyReader } from "./collision-reader";
import { logCollisionReport } from "./logger";
import {
  baseInput,
  buildingOperation,
  coralinaHermeticOperations,
  developerRow,
  FakeCollisionReader,
  type FakeReaderConfig,
  locationRow,
  priceOperation,
  projectOperation,
  targetBuilding,
  targetPrice,
  targetProject,
  targetUnit,
  unitOperation,
} from "./test-fixtures/collision-fixtures";
import type { ImportOperation } from "./types";

const bA = buildingOperation("A");
const uA1 = unitOperation("A-1", { buildingCode: "A" });
const pA1 = priceOperation("A-1", { buildingCode: "A" });
const EXACT_OPS: ImportOperation[] = [projectOperation(), bA, uA1, pA1];

function matchingConfig(): FakeReaderConfig {
  return {
    projects: [targetProject()],
    buildings: [targetBuilding(bA)],
    units: [targetUnit(uA1)],
    priceHistory: [targetPrice(pA1)],
  };
}

function reader(overrides: Partial<FakeReaderConfig> = {}) {
  return new FakeCollisionReader({ ...matchingConfig(), ...overrides });
}

function findingFor(
  report: CollisionInspectionReport,
  entity: string,
): CollisionFinding | undefined {
  return report.findings.find((finding) => finding.entity === entity);
}

describe("RC5.5B collision inspector — persistence comparison", () => {
  it("reports a full-field exact match across all entities", async () => {
    const report = await inspectPlanCollisions(baseInput(EXACT_OPS, reader()));
    expect(report.countsByClassification.exact_match).toBe(4);
    expect(report.status).toBe("clean");
  });

  it("does not treat numeric-string vs number as a difference", async () => {
    const report = await inspectPlanCollisions(
      baseInput(
        EXACT_OPS,
        reader({ units: [targetUnit(uA1, { size_sqm: "45.00", base_price_thb: "5000000.00" })] }),
      ),
    );
    expect(findingFor(report, "unit")?.classification).toBe("exact_match");
  });

  it("ignores volatile fields the inspector never selects", async () => {
    const report = await inspectPlanCollisions(
      baseInput(
        EXACT_OPS,
        reader({
          projects: [
            targetProject({
              updated_at: "2020-01-01T00:00:00Z",
              last_data_review_at: "2020-01-01",
            } as never),
          ],
        }),
      ),
    );
    expect(findingFor(report, "project")?.classification).toBe("exact_match");
  });

  it("detects changes across stable project fields", async () => {
    const report = await inspectPlanCollisions(
      baseInput(
        EXACT_OPS,
        reader({
          projects: [
            targetProject({
              developer_id: "dev-other",
              address: "Different address",
              is_active: false,
              sales_status: "Sold Out",
            }),
          ],
        }),
      ),
    );
    const project = findingFor(report, "project");
    expect(project?.classification).toBe("update_required");
    expect(project?.changedFields).toEqual([
      "address",
      "developer_id",
      "is_active",
      "sales_status",
    ]);
  });

  it("detects changes across stable building fields", async () => {
    const report = await inspectPlanCollisions(
      baseInput(
        EXACT_OPS,
        reader({ buildings: [targetBuilding(bA, { units_count: 99, building_type: "tower" })] }),
      ),
    );
    const building = findingFor(report, "building");
    expect(building?.classification).toBe("update_required");
    expect(building?.changedFields).toEqual(["building_type", "units_count"]);
  });

  it("detects changes across stable unit fields including unit_status and metadata", async () => {
    const report = await inspectPlanCollisions(
      baseInput(
        EXACT_OPS,
        reader({
          units: [
            targetUnit(uA1, {
              unit_status: "reserved",
              price_per_sqm: 1,
              metadata: { source_type_code: "changed" },
            }),
          ],
        }),
      ),
    );
    const unit = findingFor(report, "unit");
    expect(unit?.classification).toBe("update_required");
    expect(unit?.changedFields).toEqual(["metadata", "price_per_sqm", "unit_status"]);
  });

  it("detects changes across stable price-history fields", async () => {
    const report = await inspectPlanCollisions(
      baseInput(
        EXACT_OPS,
        reader({
          priceHistory: [targetPrice(pA1, { currency: "USD", recorded_at: "2030-01-01" })],
        }),
      ),
    );
    const price = findingFor(report, "unit_price_history");
    expect(price?.classification).toBe("update_required");
    expect(price?.changedFields).toEqual(["currency", "recorded_at"]);
  });

  it("compares JSON metadata independent of key insertion order", async () => {
    const report = await inspectPlanCollisions(
      baseInput(
        EXACT_OPS,
        reader({
          buildings: [
            targetBuilding(bA, {
              metadata: { building_code: "A", source: "price_list_extraction" },
            }),
          ],
        }),
      ),
    );
    expect(findingFor(report, "building")?.classification).toBe("exact_match");
  });
});

describe("RC5.5B collision inspector — dependency resolution", () => {
  it("blocks the project when the developer dependency is missing", async () => {
    const report = await inspectPlanCollisions(baseInput(EXACT_OPS, reader({ developers: [] })));
    const project = findingFor(report, "project");
    expect(project?.classification).toBe("inspection_error");
    expect(project?.detail).toContain("developer");
    expect(report.status).toBe("blocked");
  });

  it("blocks the project when the location dependency is duplicated", async () => {
    const report = await inspectPlanCollisions(
      baseInput(EXACT_OPS, reader({ locations: [locationRow(), locationRow({ id: "loc-2" })] })),
    );
    const project = findingFor(report, "project");
    expect(project?.classification).toBe("inspection_error");
    expect(project?.detail).toContain("location");
  });

  it("blocks when a dependency row is malformed (missing id)", async () => {
    const report = await inspectPlanCollisions(
      baseInput(EXACT_OPS, reader({ developers: [developerRow({ id: "" })] })),
    );
    expect(findingFor(report, "project")?.classification).toBe("inspection_error");
  });

  it("resolves developer/location and matches when identities line up", async () => {
    const activeReader = reader();
    const report = await inspectPlanCollisions(baseInput(EXACT_OPS, activeReader));
    expect(activeReader.calls).toContain("readDeveloperRows");
    expect(activeReader.calls).toContain("readLocationRows");
    expect(findingFor(report, "project")?.classification).toBe("exact_match");
  });
});

describe("RC5.5B collision inspector — strict row validation", () => {
  it("blocks a null building_code row instead of dropping it to absent", async () => {
    const report = await inspectPlanCollisions(
      baseInput(EXACT_OPS, reader({ buildings: [targetBuilding(bA, { building_code: null })] })),
    );
    const building = findingFor(report, "building");
    expect(building?.classification).toBe("inspection_error");
    expect(building?.classification).not.toBe("absent");
  });

  it("blocks a null unit_code row instead of dropping it to absent", async () => {
    const report = await inspectPlanCollisions(
      baseInput(EXACT_OPS, reader({ units: [targetUnit(uA1, { unit_code: null })] })),
    );
    expect(findingFor(report, "unit")?.classification).toBe("inspection_error");
  });

  it("blocks a building row missing its id", async () => {
    const report = await inspectPlanCollisions(
      baseInput(EXACT_OPS, reader({ buildings: [targetBuilding(bA, { id: "" })] })),
    );
    expect(findingFor(report, "building")?.classification).toBe("inspection_error");
  });

  it("blocks a unit row whose project_id is wrong", async () => {
    const report = await inspectPlanCollisions(
      baseInput(EXACT_OPS, reader({ units: [targetUnit(uA1, { project_id: "other-project" })] })),
    );
    expect(findingFor(report, "unit")?.classification).toBe("inspection_error");
  });

  it("blocks a price-history row tied to another unit", async () => {
    const report = await inspectPlanCollisions(
      baseInput(
        EXACT_OPS,
        reader({ priceHistory: [targetPrice(pA1, { unit_id: "unit-foreign" })] }),
      ),
    );
    expect(findingFor(report, "unit_price_history")?.classification).toBe("inspection_error");
  });

  it("blocks a malformed numeric field", async () => {
    const report = await inspectPlanCollisions(
      baseInput(EXACT_OPS, reader({ units: [targetUnit(uA1, { size_sqm: "not-a-number" })] })),
    );
    expect(findingFor(report, "unit")?.classification).toBe("inspection_error");
  });

  it("blocks a project row whose slug differs from the requested slug", async () => {
    const report = await inspectPlanCollisions(
      baseInput(EXACT_OPS, reader({ projects: [targetProject({ slug: "not-coralina" })] })),
    );
    expect(findingFor(report, "project")?.classification).toBe("inspection_error");
  });
});

describe("RC5.5B collision inspector — classifications", () => {
  it("reports an absent project but still verifies both prerequisites", async () => {
    const emptyReader = new FakeCollisionReader({ projects: [] });
    const report = await inspectPlanCollisions(baseInput(EXACT_OPS, emptyReader));
    expect(report.countsByClassification.absent).toBe(4);
    expect(report.status).toBe("changes_detected");
    expect(report.prerequisitesStatus).toBe("ready");
    expect(report.projectAnchorStatus).toBe("absent_prerequisites_ready");
    expect(emptyReader.calls).toEqual([
      "readProjectRows",
      "readDeveloperRows",
      "readLocationRows",
    ]);
  });

  it("distinguishes an absent project with missing prerequisites", async () => {
    const emptyReader = new FakeCollisionReader({ projects: [], developers: [], locations: [] });
    const report = await inspectPlanCollisions(baseInput(EXACT_OPS, emptyReader));
    expect(report.status).toBe("blocked");
    expect(report.prerequisitesStatus).toBe("missing");
    expect(report.projectAnchorStatus).toBe("absent_prerequisites_missing");
    expect(report.dependencies.map((item) => item.classification)).toEqual(["absent", "absent"]);
  });

  it("classifies duplicate and null-slug dependencies independently", async () => {
    const report = await inspectPlanCollisions(
      baseInput(
        EXACT_OPS,
        new FakeCollisionReader({
          projects: [],
          developers: [developerRow(), developerRow({ id: "dev-2" })],
          locations: [locationRow({ slug: null })],
        }),
      ),
    );
    expect(report.prerequisitesStatus).toBe("blocked");
    expect(report.dependencies).toEqual([
      expect.objectContaining({ dependency: "developer", classification: "ambiguous" }),
      expect.objectContaining({ dependency: "location", classification: "invalid_or_null_natural_key" }),
    ]);
  });

  it("blocks on multiple target rows for a unique unit natural key", async () => {
    const report = await inspectPlanCollisions(
      baseInput(
        EXACT_OPS,
        reader({
          units: [targetUnit(uA1, { id: "unit-A-1a" }), targetUnit(uA1, { id: "unit-A-1b" })],
        }),
      ),
    );
    const unit = findingFor(report, "unit");
    expect(unit?.classification).toBe("duplicate_target_rows");
    expect(unit?.targetRowCount).toBe(2);
    expect(report.status).toBe("blocked");
  });

  it("blocks on a parent building identity conflict", async () => {
    const bB = buildingOperation("B");
    const operations: ImportOperation[] = [projectOperation(), bA, bB, uA1];
    const conflictReader = new FakeCollisionReader({
      projects: [targetProject()],
      buildings: [targetBuilding(bA), targetBuilding(bB)],
      units: [targetUnit(uA1, { building_id: "building-B" })],
    });
    const report = await inspectPlanCollisions(baseInput(operations, conflictReader));
    expect(findingFor(report, "unit")?.classification).toBe("identity_conflict");
    expect(report.status).toBe("blocked");
  });

  it("produces a sanitized structured inspection failure when a read query throws", async () => {
    const report = await inspectPlanCollisions(
      baseInput(
        EXACT_OPS,
        reader({ throwOn: { unit: "connect http://secret.supabase.co apikey=sb_secret_leak" } }),
      ),
    );
    const unit = findingFor(report, "unit");
    expect(unit?.classification).toBe("inspection_error");
    expect(unit?.detail).toBe("unit_read_failed");
    expect(JSON.stringify(report)).not.toContain("http");
    expect(JSON.stringify(report)).not.toContain("sb_secret");
    expect(report.status).toBe("blocked");
  });

  it("produces the same report regardless of target-row return order", async () => {
    const bB = buildingOperation("B");
    const uB1 = unitOperation("B-1", { buildingCode: "B" });
    const pB1 = priceOperation("B-1", { buildingCode: "B" });
    const operations: ImportOperation[] = [projectOperation(), bA, bB, uA1, uB1, pA1, pB1];
    const buildings = [targetBuilding(bA), targetBuilding(bB)];
    const units = [targetUnit(uA1), targetUnit(uB1)];
    const prices = [targetPrice(pA1), targetPrice(pB1)];

    const ordered = await inspectPlanCollisions(
      baseInput(
        operations,
        new FakeCollisionReader({
          projects: [targetProject()],
          buildings,
          units,
          priceHistory: prices,
        }),
      ),
    );
    const shuffled = await inspectPlanCollisions(
      baseInput(
        operations,
        new FakeCollisionReader({
          projects: [targetProject()],
          buildings: [...buildings].reverse(),
          units: [...units].reverse(),
          priceHistory: [...prices].reverse(),
        }),
      ),
    );
    expect(shuffled.findings).toEqual(ordered.findings);
    expect(shuffled.status).toBe("clean");
  });
});

describe("RC5.5B collision inspector — operation-set coverage", () => {
  it("rejects an unsupported developer operation before any read", async () => {
    const emptyReader = new FakeCollisionReader({ projects: [targetProject()] });
    const developerOp: ImportOperation = {
      entity: "developer",
      action: "upsert",
      naturalKey: "rhom-bho-property",
      payload: { slug: "rhom-bho-property" },
    };
    const report = await inspectPlanCollisions(
      baseInput([projectOperation(), developerOp], emptyReader),
    );
    expect(report.status).toBe("blocked");
    expect(report.operationSetError).toContain("developer");
    expect(emptyReader.calls).toEqual([]);
  });

  it("rejects an unsupported location operation before any read", async () => {
    const emptyReader = new FakeCollisionReader({ projects: [targetProject()] });
    const locationOp: ImportOperation = {
      entity: "location",
      action: "upsert",
      naturalKey: "kamala",
      payload: { slug: "kamala" },
    };
    const report = await inspectPlanCollisions(
      baseInput([projectOperation(), locationOp], emptyReader),
    );
    expect(report.status).toBe("blocked");
    expect(emptyReader.calls).toEqual([]);
  });

  it("rejects two project operations", async () => {
    const emptyReader = new FakeCollisionReader({ projects: [targetProject()] });
    const report = await inspectPlanCollisions(
      baseInput([projectOperation(), projectOperation()], emptyReader),
    );
    expect(report.status).toBe("blocked");
    expect(report.operationSetError).toContain("one project operation");
    expect(emptyReader.calls).toEqual([]);
  });

  it("rejects duplicate operation natural keys", async () => {
    const emptyReader = new FakeCollisionReader({ projects: [targetProject()] });
    const report = await inspectPlanCollisions(
      baseInput([projectOperation(), buildingOperation("A"), buildingOperation("A")], emptyReader),
    );
    expect(report.status).toBe("blocked");
    expect(report.operationSetError).toContain("Duplicate");
    expect(emptyReader.calls).toEqual([]);
  });

  it("rejects an operation-count mismatch", async () => {
    const emptyReader = new FakeCollisionReader({ projects: [targetProject()] });
    const input = baseInput([projectOperation()], emptyReader);
    input.operationCounts = { ...input.operationCounts, operations: 99 };
    const report = await inspectPlanCollisions(input);
    expect(report.status).toBe("blocked");
    expect(report.operationSetError).toContain("does not equal");
    expect(emptyReader.calls).toEqual([]);
  });

  it("rejects a malformed entity payload", async () => {
    const emptyReader = new FakeCollisionReader({ projects: [targetProject()] });
    const brokenBuilding: ImportOperation = {
      entity: "building",
      action: "upsert",
      naturalKey: "coralina:A",
      payload: { name: "no code" } as never,
    };
    const report = await inspectPlanCollisions(
      baseInput([projectOperation(), brokenBuilding], emptyReader),
    );
    expect(report.status).toBe("blocked");
    expect(emptyReader.calls).toEqual([]);
  });

  it("holds the operation/finding/count invariant on a valid plan", async () => {
    const operations = coralinaHermeticOperations();
    const input = baseInput(operations, new FakeCollisionReader({ projects: [] }));
    const report = await inspectPlanCollisions(input);
    expect(report.totalInspectedOperations).toBe(report.findings.length);
    expect(report.findings.length).toBe(operations.length);
    expect(operations.length).toBe(input.operationCounts.operations);
    expect(operations.length).toBe(405);
  });
});

describe("RC5.5B collision inspector — bounded reads and invariants", () => {
  it("reads buildings and units bounded to the planned natural keys", async () => {
    const activeReader = reader();
    await inspectPlanCollisions(baseInput(EXACT_OPS, activeReader));
    const buildingCall = activeReader.callLog.find((c) => c.method === "readBuildingRows");
    const unitCall = activeReader.callLog.find((c) => c.method === "readUnitRows");
    expect(buildingCall?.keys).toEqual(["A"]);
    expect(unitCall?.keys).toEqual(["A-1"]);
    expect(buildingCall?.projectId).toBe("project-1");
  });

  it("always reports executeEnabled false and writesPerformed zero", async () => {
    for (const projects of [[], [targetProject()], [targetProject(), targetProject()]]) {
      const report = await inspectPlanCollisions(
        baseInput(EXACT_OPS, new FakeCollisionReader({ projects, buildings: [], units: [] })),
      );
      expect(report.executeEnabled).toBe(false);
      expect(report.writesPerformed).toBe(0);
      expect(report.readOnlyConfirmed).toBe(true);
    }
  });

  it("includes the approved plan hash, source version, target, and counts", async () => {
    const report = await inspectPlanCollisions(baseInput(EXACT_OPS, reader()));
    expect(report.planHash).toBe("a".repeat(64));
    expect(report.shortPlanHash).toBe("a".repeat(12));
    expect(report.sourceVersion).toBe("2.0.0");
    expect(report.approvedTarget).toBe("local");
    expect(report.targetIdentity.projectId).toBe("forever-local");
    expect(report.schemaVersion).toBe("1");
  });

  it("exposes no mutation method through the read-only interface", () => {
    const activeReader = new FakeCollisionReader();
    expect(() => assertReadOnlyReader(activeReader)).not.toThrow();
    for (const method of ["insert", "upsert", "update", "delete", "rpc"]) {
      expect((activeReader as unknown as Record<string, unknown>)[method]).toBeUndefined();
    }
  });

  it("rejects a reader that exposes a mutation method", async () => {
    const activeReader = new FakeCollisionReader({ projects: [targetProject()] });
    (activeReader as unknown as Record<string, unknown>).upsert = () => undefined;
    await expect(
      inspectPlanCollisions(baseInput([projectOperation()], activeReader)),
    ).rejects.toThrow(/must not expose mutation method/);
  });

  it("inspects the hermetic Coralina-shaped 405-operation plan deterministically", async () => {
    const operations = coralinaHermeticOperations();
    expect(operations.filter((op) => op.entity === "project")).toHaveLength(1);
    expect(operations.filter((op) => op.entity === "building")).toHaveLength(8);
    expect(operations.filter((op) => op.entity === "unit")).toHaveLength(198);
    expect(operations.filter((op) => op.entity === "unit_price_history")).toHaveLength(198);

    const emptyReader = new FakeCollisionReader({ projects: [] });
    const report = await inspectPlanCollisions(baseInput(operations, emptyReader));
    expect(report.totalInspectedOperations).toBe(405);
    expect(report.countsByClassification.absent).toBe(405);
    expect(emptyReader.calls).toEqual([
      "readProjectRows",
      "readDeveloperRows",
      "readLocationRows",
    ]);
  });
});

describe("RC5.5B collision inspector — strict dependency identity", () => {
  it.each([
    ["developer wrong slug", { developers: [developerRow({ slug: "wrong" })] }, "developer"],
    ["developer null slug", { developers: [developerRow({ slug: null })] }, "developer"],
    ["developer empty slug", { developers: [developerRow({ slug: "" })] }, "developer"],
    ["developer missing id", { developers: [developerRow({ id: "" })] }, "developer"],
    [
      "developer duplicate",
      { developers: [developerRow(), developerRow({ id: "d2" })] },
      "developer",
    ],
    ["developer missing row", { developers: [] }, "developer"],
    ["location wrong slug", { locations: [locationRow({ slug: "wrong" })] }, "location"],
    ["location null slug", { locations: [locationRow({ slug: null })] }, "location"],
    ["location empty slug", { locations: [locationRow({ slug: "" })] }, "location"],
    ["location missing id", { locations: [locationRow({ id: "" })] }, "location"],
    ["location duplicate", { locations: [locationRow(), locationRow({ id: "l2" })] }, "location"],
    ["location missing row", { locations: [] }, "location"],
  ])("blocks the project on %s", async (_label, overrides, label) => {
    const report = await inspectPlanCollisions(baseInput(EXACT_OPS, reader(overrides)));
    const project = findingFor(report, "project");
    expect(project?.classification).toBe("inspection_error");
    expect(project?.detail).toContain(label);
    expect(report.status).toBe("blocked");
  });

  it("matches the project when both dependency slugs line up exactly", async () => {
    const report = await inspectPlanCollisions(baseInput(EXACT_OPS, reader()));
    expect(findingFor(report, "project")?.classification).toBe("exact_match");
  });
});

describe("RC5.5B collision inspector — natural-key contract", () => {
  const project = projectOperation();

  function build(
    overrides: Partial<import("./types").ImportOperation>,
  ): import("./types").ImportOperation {
    return { ...buildingOperation("A"), ...overrides } as import("./types").ImportOperation;
  }

  it("rejects an empty natural key before any read", async () => {
    const r = new FakeCollisionReader({ projects: [targetProject()] });
    const report = await inspectPlanCollisions(baseInput([project, build({ naturalKey: "" })], r));
    expect(report.status).toBe("blocked");
    expect(r.calls).toEqual([]);
  });

  it("rejects a project natural key that is not the manifest slug", async () => {
    const r = new FakeCollisionReader({ projects: [targetProject()] });
    const badProject: import("./types").ImportOperation = {
      entity: "project",
      action: "upsert",
      naturalKey: "wrong-slug",
      payload: { slug: "coralina" },
    };
    const report = await inspectPlanCollisions(baseInput([badProject], r));
    expect(report.status).toBe("blocked");
    expect(report.operationSetError).toContain("Project natural key");
    expect(r.calls).toEqual([]);
  });

  it("rejects a building natural key that does not match slug:buildingCode", async () => {
    const r = new FakeCollisionReader({ projects: [targetProject()] });
    const report = await inspectPlanCollisions(
      baseInput([project, build({ naturalKey: "coralina:WRONG" })], r),
    );
    expect(report.status).toBe("blocked");
    expect(report.operationSetError).toContain("Building natural key");
    expect(r.calls).toEqual([]);
  });

  it("rejects a unit natural key that does not match slug:unitNumber", async () => {
    const r = new FakeCollisionReader({ projects: [targetProject()] });
    const badUnit = {
      ...unitOperation("A-1", { buildingCode: "A" }),
      naturalKey: "coralina:WRONG",
    };
    const report = await inspectPlanCollisions(baseInput([project, badUnit], r));
    expect(report.status).toBe("blocked");
    expect(report.operationSetError).toContain("Unit natural key");
    expect(r.calls).toEqual([]);
  });

  it("rejects a price-history natural key that disagrees with its payload", async () => {
    const r = new FakeCollisionReader({ projects: [targetProject()] });
    const badPrice = {
      ...priceOperation("A-1", { buildingCode: "A" }),
      naturalKey: "coralina:A-1:tampered",
    };
    const report = await inspectPlanCollisions(baseInput([project, badPrice], r));
    expect(report.status).toBe("blocked");
    expect(report.operationSetError).toContain("Price-history natural key");
    expect(r.calls).toEqual([]);
  });

  it("rejects a per-entity operation-count mismatch", async () => {
    const r = new FakeCollisionReader({ projects: [targetProject()] });
    const input = baseInput([project, buildingOperation("A")], r);
    input.operationCounts = { ...input.operationCounts, buildings: 5 };
    const report = await inspectPlanCollisions(input);
    expect(report.status).toBe("blocked");
    expect(report.operationSetError).toContain("operationCounts.buildings");
    expect(r.calls).toEqual([]);
  });

  it("blocks two price-history operations that share one persistence key (differ only by sourceRow)", async () => {
    const r = new FakeCollisionReader({ projects: [targetProject()] });
    const p1 = priceOperation("A-1", { buildingCode: "A", sourceRow: 1 });
    const p2 = priceOperation("A-1", { buildingCode: "A", sourceRow: 2 });
    // Distinct planner natural keys, identical database persistence key.
    expect(p1.naturalKey).not.toBe(p2.naturalKey);
    const report = await inspectPlanCollisions(baseInput([project, p1, p2], r));
    expect(report.status).toBe("blocked");
    expect(report.operationSetError).toContain("persistence key");
    expect(r.calls).toEqual([]);
  });
});

describe("RC5.5B collision inspector — deterministic sanitized diagnostics", () => {
  afterEach(() => vi.restoreAllMocks());

  it("produces a byte-equivalent report regardless of malformed target-row order", async () => {
    const bB = buildingOperation("B");
    const operations = [projectOperation(), bA, bB];
    const rowsForward = [
      targetBuilding(bA, { id: "" }),
      targetBuilding(bB, { project_id: "other" }),
    ];
    const forward = await inspectPlanCollisions(
      baseInput(operations, reader({ buildings: rowsForward })),
    );
    const reversed = await inspectPlanCollisions(
      baseInput(operations, reader({ buildings: [...rowsForward].reverse() })),
    );
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
    expect(forward.status).toBe("blocked");
  });

  it("collects, dedupes, and sorts several diagnostics for one natural key", async () => {
    const report = await inspectPlanCollisions(
      baseInput(
        [projectOperation(), bA],
        reader({
          buildings: [
            targetBuilding(bA, { id: "" }), // missing_id
            targetBuilding(bA, { project_id: "other" }), // wrong_project
            targetBuilding(bA, { id: "" }), // duplicate of missing_id
          ],
        }),
      ),
    );
    const building = findingFor(report, "building");
    expect(building?.classification).toBe("inspection_error");
    expect(building?.detail).toBe("missing_id,wrong_project");
  });

  it("keeps blocking findings stable regardless of target-row order", async () => {
    const operations = [projectOperation(), bA];
    const rows = [targetBuilding(bA, { id: "" }), targetBuilding(bA, { project_id: "x" })];
    const a = await inspectPlanCollisions(baseInput(operations, reader({ buildings: rows })));
    const b = await inspectPlanCollisions(
      baseInput(operations, reader({ buildings: [...rows].reverse() })),
    );
    expect(b.blockingFindings).toEqual(a.blockingFindings);
  });

  it("never leaks a raw provider error into the report or the logger", async () => {
    const secret = "http://leak.supabase.co apikey=sb_secret_value";
    const report = await inspectPlanCollisions(
      baseInput(EXACT_OPS, reader({ throwOn: { building: secret } })),
    );
    expect(JSON.stringify(report)).not.toContain("leak");
    expect(JSON.stringify(report)).not.toContain("sb_secret");

    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.join(" "));
    });
    logCollisionReport(report);
    const output = lines.join("\n");
    expect(output).not.toContain("leak");
    expect(output).not.toContain("sb_secret");
    expect(output).toContain("building_read_failed");
  });
});

describe("RC5.5B collision inspector — malformed price-history rows fail closed", () => {
  it("blocks (never absent) when the only row for the persistence key is malformed", async () => {
    const report = await inspectPlanCollisions(
      baseInput(EXACT_OPS, reader({ priceHistory: [targetPrice(pA1, { id: "" })] })),
    );
    const price = findingFor(report, "unit_price_history");
    expect(price?.classification).toBe("inspection_error");
    expect(price?.classification).not.toBe("absent");
    expect(price?.detail).toBe("missing_id");
    expect(report.status).toBe("blocked");
  });

  it("blocks (never exact_match) when a valid and a malformed row share one persistence key", async () => {
    const report = await inspectPlanCollisions(
      baseInput(
        EXACT_OPS,
        reader({ priceHistory: [targetPrice(pA1), targetPrice(pA1, { id: "" })] }),
      ),
    );
    const price = findingFor(report, "unit_price_history");
    expect(price?.classification).toBe("inspection_error");
    expect(price?.classification).not.toBe("exact_match");
    expect(report.status).toBe("blocked");
  });

  it("produces deterministic sorted diagnostics for multiple malformed rows on one key", async () => {
    const report = await inspectPlanCollisions(
      baseInput(
        EXACT_OPS,
        reader({
          priceHistory: [
            targetPrice(pA1, { id: "" }),
            targetPrice(pA1, { id: "price-x", price: "not-a-number" }),
          ],
        }),
      ),
    );
    const price = findingFor(report, "unit_price_history");
    expect(price?.classification).toBe("inspection_error");
    expect(price?.detail).toBe("invalid_shape:price,missing_id");
  });

  it("does not change the report when a malformed row is duplicated", async () => {
    const single = await inspectPlanCollisions(
      baseInput(EXACT_OPS, reader({ priceHistory: [targetPrice(pA1, { id: "" })] })),
    );
    const doubled = await inspectPlanCollisions(
      baseInput(
        EXACT_OPS,
        reader({ priceHistory: [targetPrice(pA1, { id: "" }), targetPrice(pA1, { id: "" })] }),
      ),
    );
    expect(JSON.stringify(doubled)).toBe(JSON.stringify(single));
  });

  it("produces a byte-equivalent report when valid and malformed row order is reversed", async () => {
    const rows = [targetPrice(pA1), targetPrice(pA1, { id: "" })];
    const forward = await inspectPlanCollisions(
      baseInput(EXACT_OPS, reader({ priceHistory: rows })),
    );
    const reversed = await inspectPlanCollisions(
      baseInput(EXACT_OPS, reader({ priceHistory: [...rows].reverse() })),
    );
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });

  it("blocks when a malformed row's persistence key cannot be established (not provably unrelated)", async () => {
    // Missing price_source: the row belongs to the operation's unit but its
    // persistence identity cannot be derived, so it may collide with anything.
    const report = await inspectPlanCollisions(
      baseInput(
        EXACT_OPS,
        reader({
          priceHistory: [targetPrice(pA1), targetPrice(pA1, { id: "", price_source: null })],
        }),
      ),
    );
    const price = findingFor(report, "unit_price_history");
    expect(price?.classification).toBe("inspection_error");
    expect(price?.detail).toBe("missing_id,missing_price_source,persistence_key_unresolvable");
  });

  it("keeps a malformed row with a different, establishable key from affecting an unrelated operation", async () => {
    // Same unit, valid key fields, but a different source_file: provably a
    // different persistence identity, so the inspected operation stays clean.
    const report = await inspectPlanCollisions(
      baseInput(
        EXACT_OPS,
        reader({
          priceHistory: [
            targetPrice(pA1),
            targetPrice(pA1, { id: "", source_file: "other-list.pdf" }),
          ],
        }),
      ),
    );
    expect(findingFor(report, "unit_price_history")?.classification).toBe("exact_match");
  });

  it("emits only stable sanitized diagnostic codes and performs zero mutation calls", async () => {
    const activeReader = reader({ priceHistory: [targetPrice(pA1, { id: "" })] });
    const report = await inspectPlanCollisions(baseInput(EXACT_OPS, activeReader));
    const price = findingFor(report, "unit_price_history");
    expect(price?.detail).toMatch(/^[a-z0-9_:,.-]+$/);
    expect(JSON.stringify(report)).not.toContain("http");
    // The reader interface exposes read methods only; every call made was a read.
    const readMethods = new Set([
      "readProjectRows",
      "readDeveloperRows",
      "readLocationRows",
      "readBuildingRows",
      "readUnitRows",
      "readPriceHistoryRows",
    ]);
    expect(activeReader.calls.every((call) => readMethods.has(call))).toBe(true);
  });
});
