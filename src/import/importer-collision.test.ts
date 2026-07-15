import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { importProject } from "./importer";
import { parseImportInvocation } from "./cli-args";
import { FakeCollisionReader, targetProject } from "./test-fixtures/collision-fixtures";

const readerFactoryCalled = vi.hoisted(() => ({ value: false }));

vi.mock("./collision-reader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./collision-reader")>();
  return {
    ...actual,
    createCollisionInspectionReader: vi.fn(() => {
      readerFactoryCalled.value = true;
      throw new Error("read-only reader must not be created in hermetic tests");
    }),
  };
});

const FIXTURE_ROOT = resolve(process.cwd(), "src/import/test-fixtures");
const FIXTURE_SLUG = "modeva-currency";

async function fixtureFingerprint() {
  const dryRun = await importProject({
    projectSlug: FIXTURE_SLUG,
    dryRun: true,
    projectsRoot: FIXTURE_ROOT,
  });
  return dryRun.planFingerprint!;
}

function inspectionOptions(
  fingerprint: Awaited<ReturnType<typeof fixtureFingerprint>>,
  reader: FakeCollisionReader,
  overrides: Record<string, unknown> = {},
) {
  return {
    projectSlug: FIXTURE_SLUG,
    projectsRoot: FIXTURE_ROOT,
    inspectCollisions: true,
    target: "local",
    expectedPlanHash: fingerprint.hash,
    expectedOperationCounts: fingerprint.operationCounts,
    confirmation: `${fingerprint.projectSlug}:${fingerprint.shortHash}`,
    targetIdentity: { projectId: "forever-local" },
    collisionReader: reader,
    ...overrides,
  };
}

describe("RC5.5B importer collision integration", () => {
  beforeEach(() => {
    readerFactoryCalled.value = false;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("performs no reader or database read during dry-run", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const reader = new FakeCollisionReader({ projects: [] });

    const summary = await importProject({
      projectSlug: FIXTURE_SLUG,
      dryRun: true,
      projectsRoot: FIXTURE_ROOT,
      collisionReader: reader,
    });

    expect(summary.status).toBe("dry_run_completed");
    expect(reader.calls).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(readerFactoryCalled.value).toBe(false);
  });

  it("does not inspect collisions without the explicit flag (stays execute-disabled)", async () => {
    const fingerprint = await fixtureFingerprint();
    const reader = new FakeCollisionReader({ projects: [] });

    await expect(
      importProject({
        projectSlug: FIXTURE_SLUG,
        projectsRoot: FIXTURE_ROOT,
        target: "local",
        expectedPlanHash: fingerprint.hash,
        expectedOperationCounts: fingerprint.operationCounts,
        confirmation: `${fingerprint.projectSlug}:${fingerprint.shortHash}`,
        targetIdentity: { projectId: "forever-local" },
        collisionReader: reader,
      }),
    ).rejects.toThrow("execute mode is not enabled yet");
    expect(reader.calls).toEqual([]);
  });

  it("invokes the read-only reader after a successful local preflight", async () => {
    const fingerprint = await fixtureFingerprint();
    const reader = new FakeCollisionReader({ projects: [] });

    const summary = await importProject(inspectionOptions(fingerprint, reader));

    expect(summary.status).toBe("collision_inspected");
    expect(reader.calls).toContain("readProjectRows");
    expect(summary.collisionReport?.status).not.toBe("blocked");
    expect(summary.collisionReport?.executeEnabled).toBe(false);
    expect(summary.collisionReport?.writesPerformed).toBe(0);
    expect(readerFactoryCalled.value).toBe(false);
  });

  it("stops before the reader when target, hash, or confirmation is missing", async () => {
    const fingerprint = await fixtureFingerprint();
    const reader = new FakeCollisionReader({ projects: [] });

    await expect(
      importProject(inspectionOptions(fingerprint, reader, { target: undefined })),
    ).rejects.toThrow(/target_missing|preflight/);
    expect(reader.calls).toEqual([]);
  });

  it("blocks an invalid local identity before any read", async () => {
    const fingerprint = await fixtureFingerprint();
    const reader = new FakeCollisionReader({ projects: [] });

    await expect(
      importProject(
        inspectionOptions(fingerprint, reader, { targetIdentity: { projectId: "remote" } }),
      ),
    ).rejects.toThrow("local_identity_invalid");
    expect(reader.calls).toEqual([]);
  });

  it("keeps staging blocked before any read", async () => {
    const fingerprint = await fixtureFingerprint();
    const reader = new FakeCollisionReader({ projects: [] });

    await expect(
      importProject(inspectionOptions(fingerprint, reader, { target: "staging" })),
    ).rejects.toThrow("staging_unconfigured");
    expect(reader.calls).toEqual([]);
  });

  it("keeps production blocked before any read", async () => {
    const fingerprint = await fixtureFingerprint();
    const reader = new FakeCollisionReader({ projects: [] });

    await expect(
      importProject(inspectionOptions(fingerprint, reader, { target: "production" })),
    ).rejects.toThrow("production_blocked");
    expect(reader.calls).toEqual([]);
  });

  it("returns a blocked summary when the report has blocking findings", async () => {
    const fingerprint = await fixtureFingerprint();
    const reader = new FakeCollisionReader({
      projects: [targetProject({ slug: FIXTURE_SLUG }), targetProject({ slug: FIXTURE_SLUG })],
    });

    const summary = await importProject(inspectionOptions(fingerprint, reader));
    expect(summary.status).toBe("collision_blocked");
    expect(summary.collisionReport?.status).toBe("blocked");
    expect(summary.collisionReport?.writesPerformed).toBe(0);
  });

  it("never enters write execution after a successful inspection", async () => {
    const fingerprint = await fixtureFingerprint();
    const reader = new FakeCollisionReader({ projects: [] });

    const summary = await importProject(inspectionOptions(fingerprint, reader));
    expect(summary.status).toBe("collision_inspected");
    expect(summary.collisionReport).toBeDefined();
  });
});

describe("RC5.5B CLI mode combinations", () => {
  it("rejects --dry-run combined with --inspect-collisions", () => {
    const result = parseImportInvocation(["coralina", "--dry-run", "--inspect-collisions"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("mutually exclusive");
  });

  it("requires target, hash, and confirmation for collision inspection", () => {
    const result = parseImportInvocation(["coralina", "--inspect-collisions", "--target=local"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Collision inspection requires");
  });

  it("does not infer collision inspection from the absence of --dry-run", () => {
    const result = parseImportInvocation([
      "coralina",
      "--target=local",
      "--plan-hash=" + "a".repeat(64),
      "--confirm=coralina:aaaaaaaaaaaa",
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.options.inspectCollisions).toBe(false);
  });

  it("accepts a well-formed collision-inspection invocation", () => {
    const result = parseImportInvocation([
      "coralina",
      "--inspect-collisions",
      "--target=local",
      "--plan-hash=" + "a".repeat(64),
      "--confirm=coralina:aaaaaaaaaaaa",
      "--target-project-id=forever-local",
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.inspectCollisions).toBe(true);
      expect(result.options.targetIdentity).toEqual({ projectId: "forever-local" });
    }
  });
});
