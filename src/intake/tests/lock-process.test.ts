import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireProjectLock, LOCK_DIRNAME, releaseProjectLock } from "../txn";

let base: string;
let child: ChildProcessWithoutNullStreams | null;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "intake-lock-process-"));
  child = null;
});

async function terminate(process: ChildProcessWithoutNullStreams): Promise<void> {
  if (process.exitCode !== null) return;
  const exited = new Promise<void>((resolveExit) => process.once("exit", () => resolveExit()));
  await Promise.race([
    exited,
    new Promise<never>((_resolve, rejectExit) =>
      setTimeout(() => rejectExit(new Error("lock child did not terminate")), 10_000),
    ),
  ]);
}

afterEach(async () => {
  if (child && child.exitCode === null) {
    await terminate(child);
  }
  rmSync(base, { recursive: true, force: true });
}, 20_000);

function waitForReady(process: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(
      () => rejectReady(new Error("lock child did not become ready")),
      20_000,
    );
    let output = "";
    process.stdout.setEncoding("utf8");
    process.stdout.on("data", (chunk: string) => {
      output += chunk;
      const line = output.split(/\r?\n/).find((item) => item.startsWith("LOCK_CHILD|"));
      if (line) {
        clearTimeout(timeout);
        resolveReady(line);
      }
    });
    process.once("error", (error) => {
      clearTimeout(timeout);
      rejectReady(error);
    });
    process.once("exit", (code) => {
      if (!output.includes("LOCK_CHILD|")) {
        clearTimeout(timeout);
        rejectReady(new Error(`lock child exited early (${code})`));
      }
    });
  });
}

describe("Fast Intake real-process Windows lock behavior", () => {
  it("blocks a same-slug loser, permits another slug, and reclaims the dead child pid", async () => {
    const projectA = join(base, "slug-a");
    const projectB = join(base, "slug-b");
    mkdirSync(projectA, { recursive: true });
    mkdirSync(projectB, { recursive: true });

    child = spawn(
      process.execPath,
      [resolve("src/intake/tests/lock-child.mjs"), projectA, "3000"],
      {
        cwd: resolve("."),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const ready = await waitForReady(child);
    expect(ready).toContain("acquired=true");
    expect(acquireProjectLock(projectA)).toBe(false);

    expect(acquireProjectLock(projectB)).toBe(true);
    releaseProjectLock(projectB);
    expect(existsSync(join(projectB, LOCK_DIRNAME))).toBe(false);

    await terminate(child);
    expect(existsSync(join(projectA, LOCK_DIRNAME))).toBe(true);
    expect(acquireProjectLock(projectA)).toBe(true);
    releaseProjectLock(projectA);
    expect(existsSync(join(projectA, LOCK_DIRNAME))).toBe(false);
  }, 30_000);
});
