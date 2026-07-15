import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import {
  parseLockPayload,
  serializeLockPayload,
  type AcquireOptions,
  type AcquireResult,
  type LockRecord,
  type LockState,
  type LockStore,
  type LockStoreHealth,
  type OwnerInfo,
} from "./run-lock";

/**
 * Durable, cross-process atomic run lock for Continue Forever.
 *
 * The running claim is an atomically created per-run lock **directory**
 * (`mkdir` is an OS atomic exclusive-create): exactly one concurrent process
 * can create it, so exactly one may execute a given run id. The loser observes
 * `EEXIST` and, without ever executing, reports already-running (a live owner)
 * or stale (an owner on another host or a dead pid — never reclaimed on elapsed
 * time alone). Terminal outcomes are stored in a versioned JSON file written
 * atomically via a temporary file plus rename, so a crash mid-write can never
 * truncate or erase the previous durable state.
 *
 * No database, service, or external lock server is introduced; only the local
 * filesystem's atomic primitives are used.
 */

interface OwnerFile extends OwnerInfo {
  readonly runId: string;
  readonly taskPacketId: string;
  readonly stampedAt: string;
}

function sanitizeRunId(runId: string): string {
  return runId.replace(/[^A-Za-z0-9._-]/g, "_");
}

/** Is a same-host pid still alive? `kill(pid, 0)` probes without signalling. */
function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but is owned by another user → alive.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class AtomicFileLockStore implements LockStore {
  private readonly runsDir: string;
  private readonly host = hostname();
  private terminal = new Map<string, LockRecord>();
  private healthState: LockStoreHealth = { ok: true };

  constructor(private readonly terminalFilePath: string) {
    this.runsDir = `${terminalFilePath}.runs`;
    if (!existsSync(terminalFilePath)) return;
    let raw: string;
    try {
      raw = readFileSync(terminalFilePath, "utf8");
    } catch {
      this.healthState = { ok: false, reason: "Lock file is unreadable.", path: terminalFilePath };
      return;
    }
    const parsed = parseLockPayload(raw);
    if (!parsed.ok) {
      this.healthState = { ok: false, reason: parsed.reason, path: terminalFilePath };
      return;
    }
    for (const record of parsed.records) this.terminal.set(record.runId, record);
  }

  health(): LockStoreHealth {
    return this.healthState;
  }

  private lockDirFor(runId: string): string {
    return join(this.runsDir, `${sanitizeRunId(runId)}.lock`);
  }

  private ownerFileFor(runId: string): string {
    return join(this.lockDirFor(runId), "owner.json");
  }

  private writeOwner(options: AcquireOptions): void {
    const owner: OwnerFile = {
      pid: process.pid,
      host: this.host,
      runId: options.runId,
      taskPacketId: options.taskPacketId,
      stampedAt: options.now,
    };
    writeFileSync(this.ownerFileFor(options.runId), JSON.stringify(owner), "utf8");
  }

  private readOwner(runId: string): OwnerFile | null {
    try {
      const parsed = JSON.parse(readFileSync(this.ownerFileFor(runId), "utf8")) as OwnerFile;
      if (typeof parsed.pid !== "number" || typeof parsed.host !== "string") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /** Attempt the atomic directory claim. Returns true iff this call created it. */
  private tryClaimDir(runId: string): boolean {
    mkdirSync(this.runsDir, { recursive: true });
    try {
      mkdirSync(this.lockDirFor(runId)); // atomic exclusive create; throws EEXIST if held
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  }

  private runningRecord(
    runId: string,
    owner: OwnerFile | null,
    options: AcquireOptions,
  ): LockRecord {
    return {
      runId,
      taskPacketId: owner?.taskPacketId ?? options.taskPacketId,
      state: "running",
      stampedAt: owner?.stampedAt ?? options.now,
      artifact: null,
      owner: owner ? { pid: owner.pid, host: owner.host } : null,
    };
  }

  acquire(options: AcquireOptions): AcquireResult {
    const { runId } = options;

    const terminal = this.terminal.get(runId);
    if (terminal) {
      if (terminal.state === "succeeded" || terminal.state === "handed_off") {
        return { outcome: "replay", record: terminal };
      }
      if (terminal.state === "failed" && !options.retry) {
        return { outcome: "failed_locked", record: terminal };
      }
      // A failed terminal with explicit retry falls through to a fresh claim.
    }

    if (this.tryClaimDir(runId)) {
      this.writeOwner(options);
      return { outcome: "acquired" };
    }

    // The claim directory already exists: someone else holds the run.
    const owner = this.readOwner(runId);
    if (!owner) {
      // A sibling just created the directory and is mid-write of its owner file:
      // it is definitively a fresh, live claim, never a stale one.
      return { outcome: "already_running", record: this.runningRecord(runId, null, options) };
    }

    const uncertain = owner.host !== this.host;
    const dead = owner.host === this.host && !isPidAlive(owner.pid);
    if (uncertain || dead) {
      if (options.recover) {
        rmSync(this.lockDirFor(runId), { recursive: true, force: true });
        if (this.tryClaimDir(runId)) {
          this.writeOwner(options);
          const why = uncertain
            ? `on another host (${owner.host})`
            : `held by dead pid ${owner.pid}`;
          return { outcome: "acquired", note: `Owner-recovered a stale run claim ${why}.` };
        }
        // Another process re-claimed during recovery: it is now live.
        return {
          outcome: "already_running",
          record: this.runningRecord(runId, this.readOwner(runId), options),
        };
      }
      const why = uncertain
        ? `owner is on another host (${owner.host}); ownership is uncertain`
        : `owner pid ${owner.pid} on this host is not alive`;
      return {
        outcome: "stale",
        record: this.runningRecord(runId, owner, options),
        note: `Stale running claim: ${why}. Elapsed time alone never authorizes reclaim; explicit Owner recovery is required.`,
      };
    }

    return { outcome: "already_running", record: this.runningRecord(runId, owner, options) };
  }

  finalize(
    runId: string,
    taskPacketId: string,
    state: Exclude<LockState, "running">,
    now: string,
    artifact: LockRecord["artifact"],
  ): void {
    this.terminal.set(runId, { runId, taskPacketId, state, stampedAt: now, artifact });
    this.flushTerminal();
    this.releaseClaim(runId);
  }

  release(runId: string): void {
    this.releaseClaim(runId);
  }

  private releaseClaim(runId: string): void {
    rmSync(this.lockDirFor(runId), { recursive: true, force: true });
  }

  /** Atomic durable write: temp file + rename, so a crash never truncates state. */
  private flushTerminal(): void {
    mkdirSync(dirname(this.terminalFilePath), { recursive: true });
    const tmp = `${this.terminalFilePath}.tmp.${process.pid}`;
    writeFileSync(tmp, serializeLockPayload([...this.terminal.values()]), "utf8");
    renameSync(tmp, this.terminalFilePath);
  }
}
