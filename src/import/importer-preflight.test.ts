import { beforeEach, describe, expect, it, vi } from "vitest";

import { importProject } from "./importer";

const databaseModuleLoaded = vi.hoisted(() => ({ value: false }));

vi.mock("./database", () => {
  databaseModuleLoaded.value = true;
  return {
    createDatabaseLayer: vi.fn(() => {
      throw new Error("database layer must not be created");
    }),
  };
});

describe("RC5.5A importer integration", () => {
  beforeEach(() => {
    databaseModuleLoaded.value = false;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("keeps Coralina dry-run ready with a stable 405-operation receipt", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const first = await importProject({ projectSlug: "coralina", dryRun: true });
    const second = await importProject({ projectSlug: "coralina", dryRun: true });

    expect(first).toMatchObject({
      status: "dry_run_completed",
      ready: true,
      operations: 405,
      buildings: 8,
      units: 198,
      prices: 198,
      receipt: { executeEnabled: false },
    });
    expect(first.planFingerprint?.hash).toBe(second.planFingerprint?.hash);
    expect(first.receipt?.planSha256).toBe(first.planFingerprint?.hash);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(databaseModuleLoaded.value).toBe(false);
  });

  it("ends at the existing execute-disabled error after a valid local preflight", async () => {
    const dryRun = await importProject({ projectSlug: "coralina", dryRun: true });
    const fingerprint = dryRun.planFingerprint!;

    await expect(
      importProject({
        projectSlug: "coralina",
        target: "local",
        expectedPlanHash: fingerprint.hash,
        expectedOperationCounts: fingerprint.operationCounts,
        confirmation: `${fingerprint.projectSlug}:${fingerprint.shortHash}`,
        targetIdentity: { projectId: "forever-local" },
      }),
    ).rejects.toThrow("execute mode is not enabled yet");
    expect(databaseModuleLoaded.value).toBe(false);
  });

  it("stops an invalid preflight before the execute-disabled boundary", async () => {
    const error = await importProject({
      projectSlug: "coralina",
      target: "production",
      expectedPlanHash: "a".repeat(64),
      confirmation: "coralina:aaaaaaaaaaaa",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("production_blocked");
    expect((error as Error).message).not.toContain("execute mode is not enabled yet");
    expect(databaseModuleLoaded.value).toBe(false);
  });
});
