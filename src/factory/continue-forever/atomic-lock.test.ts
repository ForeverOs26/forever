import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AtomicFileLockStore } from "./atomic-lock";
import { parseLockPayload, serializeLockPayload } from "./run-lock";
import type { ConnectorArtifact } from "../execution-connector";

type ConnectorArtifactRef = ConnectorArtifact;

const RUN_ID = "FACTORY-A1-003-ATOMIC-abcd1234";
const TASK = "FACTORY-A1-003-ATOMIC";
const T0 = "2026-07-14T00:00:00.000Z";

let dir: string;
let lockFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "continue-lock-"));
  lockFile = join(dir, "continue-forever-locks.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const opts = (over: Record<string, unknown> = {}) => ({
  runId: RUN_ID,
  taskPacketId: TASK,
  now: T0,
  retry: false,
  recover: false,
  ...over,
});

function terminalArtifact(): ConnectorArtifactRef {
  return {
    schemaVersion: "0.1",
    taskPacketId: TASK,
    runId: RUN_ID,
    state: "handed_off",
    adapter: "fake-claude",
    selectionReasons: [],
    capture: {
      providerExecutionId: null,
      startedAt: T0,
      finishedAt: T0,
      exitStatus: 0,
      selectedTier: null,
      selectedModel: null,
      providerModel: null,
      selectedEffort: null,
      resultSummary: "ok",
      patchPath: null,
      worktreePath: null,
      validationInstructions: null,
      failure: null,
      escalationHistory: [],
    },
    handoff: null,
    blocked: null,
    automaticMerge: false,
    ownerReport: "ok",
  };
}

describe("AtomicFileLockStore — single-process lifecycle", () => {
  it("acquires an unheld run and releases it", () => {
    const store = new AtomicFileLockStore(lockFile);
    expect(store.acquire(opts()).outcome).toBe("acquired");
    // A second live claim in the same host+process is already-running.
    expect(new AtomicFileLockStore(lockFile).acquire(opts()).outcome).toBe("already_running");
    store.release(RUN_ID);
    expect(new AtomicFileLockStore(lockFile).acquire(opts()).outcome).toBe("acquired");
  });

  it("replays a finalized run and writes durable state atomically (no temp left)", () => {
    const store = new AtomicFileLockStore(lockFile);
    store.acquire(opts());
    store.finalize(RUN_ID, TASK, "handed_off", T0, terminalArtifact());
    // Durable file is valid and no temp file remains.
    const parsed = parseLockPayload(readFileSync(lockFile, "utf8"));
    expect(parsed.ok).toBe(true);
    expect(existsSync(`${lockFile}.tmp.${process.pid}`)).toBe(false);
    // A fresh store loads it and replays.
    expect(new AtomicFileLockStore(lockFile).acquire(opts()).outcome).toBe("replay");
  });

  it("keeps a failed run locked without retry and re-acquires with retry", () => {
    const store = new AtomicFileLockStore(lockFile);
    store.acquire(opts());
    store.finalize(RUN_ID, TASK, "failed", T0, { ...terminalArtifact(), state: "failed" });
    expect(new AtomicFileLockStore(lockFile).acquire(opts()).outcome).toBe("failed_locked");
    expect(new AtomicFileLockStore(lockFile).acquire(opts({ retry: true })).outcome).toBe(
      "acquired",
    );
  });
});

describe("AtomicFileLockStore — stale never auto-reclaims on time", () => {
  function seedStaleLock(pid: number, host: string, stampedAt: string): void {
    const lockDir = join(`${lockFile}.runs`, `${RUN_ID}.lock`);
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(
      join(lockDir, "owner.json"),
      JSON.stringify({ pid, host, runId: RUN_ID, taskPacketId: TASK, stampedAt }),
      "utf8",
    );
  }

  it("does NOT reclaim a live owner even if the claim is very old (>30m)", () => {
    // Own pid is alive; a far-past timestamp must not authorize reclaim.
    seedStaleLock(process.pid, hostname(), "2000-01-01T00:00:00.000Z");
    expect(new AtomicFileLockStore(lockFile).acquire(opts()).outcome).toBe("already_running");
  });

  it("reports STALE for a dead pid and requires explicit recovery", () => {
    seedStaleLock(2147483646, hostname(), T0); // improbable live pid
    const store = new AtomicFileLockStore(lockFile);
    const stale = store.acquire(opts());
    expect(stale.outcome).toBe("stale");
    // Explicit Owner recovery reclaims it.
    expect(new AtomicFileLockStore(lockFile).acquire(opts({ recover: true })).outcome).toBe(
      "acquired",
    );
  });

  it("reports STALE for an owner on another host (uncertain ownership)", () => {
    seedStaleLock(process.pid, "some-other-host", T0);
    expect(new AtomicFileLockStore(lockFile).acquire(opts()).outcome).toBe("stale");
  });
});

describe("AtomicFileLockStore — corrupt durable terminal state", () => {
  it("reports unhealthy on a malformed terminal file and never overwrites it", () => {
    writeFileSync(lockFile, "{ not json", "utf8");
    const store = new AtomicFileLockStore(lockFile);
    expect(store.health().ok).toBe(false);
    expect(readFileSync(lockFile, "utf8")).toBe("{ not json"); // untouched
  });

  it("loads a valid versioned terminal file", () => {
    writeFileSync(
      lockFile,
      serializeLockPayload([
        { runId: RUN_ID, taskPacketId: TASK, state: "handed_off", stampedAt: T0, artifact: null },
      ]),
      "utf8",
    );
    expect(new AtomicFileLockStore(lockFile).health().ok).toBe(true);
  });
});

describe("AtomicFileLockStore — real cross-process concurrency", () => {
  const jitiBin = join(process.cwd(), "node_modules", ".bin", "jiti");
  const modulePath = join(process.cwd(), "src", "factory", "continue-forever", "atomic-lock.ts");

  function runWorker(workerPath: string, args: string[]): Promise<{ code: number; out: string }> {
    return new Promise((resolveP) => {
      const child = spawn(process.execPath, [jitiBin, workerPath, ...args], { cwd: process.cwd() });
      let out = "";
      child.stdout.on("data", (d) => (out += d.toString()));
      child.stderr.on("data", (d) => (out += d.toString()));
      child.on("close", (code) => resolveP({ code: code ?? -1, out }));
    });
  }

  it("two simultaneous processes on the same run id → exactly one provider-eligible acquire", async () => {
    const barrier = join(dir, "start.barrier");
    const workerPath = join(dir, "worker.ts");
    // The worker waits on a barrier, then races to acquire; the winner holds
    // the lock ~2.5s (so the loser observes it), finalizes, and exits.
    writeFileSync(
      workerPath,
      [
        `import { AtomicFileLockStore } from ${JSON.stringify(modulePath)};`,
        `const [lockFile, barrier] = process.argv.slice(2);`,
        `import { existsSync } from "node:fs";`,
        `function waitBarrier(){ const end = Date.now()+10000; while(!existsSync(barrier)){ if(Date.now()>end) break; } }`,
        `function sleep(ms){ const sab=new Int32Array(new SharedArrayBuffer(4)); Atomics.wait(sab,0,0,ms); }`,
        `waitBarrier();`,
        `const store = new AtomicFileLockStore(lockFile);`,
        `const r = store.acquire({ runId: ${JSON.stringify(RUN_ID)}, taskPacketId: ${JSON.stringify(TASK)}, now: ${JSON.stringify(T0)}, retry:false, recover:false });`,
        `process.stdout.write("OUTCOME:"+r.outcome+"\\n");`,
        `if(r.outcome==="acquired"){ sleep(2500); store.finalize(${JSON.stringify(RUN_ID)}, ${JSON.stringify(TASK)}, "handed_off", ${JSON.stringify(T0)}, { schemaVersion:"0.1", runId:${JSON.stringify(RUN_ID)}, taskPacketId:${JSON.stringify(TASK)}, state:"handed_off", adapter:"x", selectionReasons:[], capture:{ providerExecutionId:null, startedAt:null, finishedAt:null, exitStatus:null, selectedTier:null, selectedModel:null, providerModel:null, selectedEffort:null, resultSummary:"", patchPath:null, worktreePath:null, validationInstructions:null, failure:null, escalationHistory:[] }, handoff:null, blocked:null, automaticMerge:false, ownerReport:"" }); }`,
      ].join("\n"),
      "utf8",
    );

    const a = runWorker(workerPath, [lockFile, barrier]);
    const b = runWorker(workerPath, [lockFile, barrier]);
    // Give both workers time to start and reach the barrier, then release them.
    await new Promise((r) => setTimeout(r, 800));
    writeFileSync(barrier, "go", "utf8");
    const [ra, rb] = await Promise.all([a, b]);

    const outcomes = [ra, rb].map((r) => (r.out.match(/OUTCOME:(\w+)/) ?? [])[1]).sort();
    expect(outcomes).toEqual(["acquired", "already_running"]);

    // Durable terminal state remains valid after the winner finalized.
    const parsed = parseLockPayload(readFileSync(lockFile, "utf8"));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.records).toHaveLength(1);
      expect(parsed.records[0].state).toBe("handed_off");
    }
  }, 30_000);
});
