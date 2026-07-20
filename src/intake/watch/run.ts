/**
 * TG-WATCH-001A — one universal watcher run for one registered channel.
 *
 *   channel registry (config) + offline channel export (transport)
 *   → normalized snapshot (fail-closed adapter)
 *   → content-addressed quarantine + append-only history ledger
 *   → SHA-256 duplicate detection (in-channel and cross-channel)
 *   → per-channel cursor state
 *   → Owner-review run report (JSON + Markdown), recommendations only
 *
 * Strictly local and read-only toward the source: no Telegram session, no
 * network request, no database client, no SIP/Fast Intake execution, no
 * import, no publication. One watch-root lock serializes runs because the
 * duplicate index is shared across channels.
 *
 * Crash model (simpler than Fast Intake's journal, and sufficient because
 * every write is either content-addressed or a whole-document atomic
 * replace): media blobs are written temp+rename and verified by re-hash;
 * ledger, object index, state, and reports are single atomic JSON/Markdown
 * writes, committed in dependency order (media → ledger → index → state →
 * report). A crash between steps leaves at worst an unreferenced blob or a
 * cursor older than the ledger; re-running the same export is idempotent and
 * converges to the identical final state.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { atomicWriteFile, atomicWriteJson } from "../fs-utils";
import { isFilesystemRoot, isSamePath, isStrictlyInside, IntakePathError } from "../paths";
import { acquireProjectLock, releaseProjectLock } from "../txn";
import { readChannelExport, WatchExportError } from "./export-adapter";
import { channelKey, loadChannelRegistry, resolveChannel, WatchRegistryError } from "./registry";
import { buildRunReport, renderRunReportMarkdown } from "./review";
import { loadLedger, loadObjectIndex, loadState, mergeSnapshot, WatchStoreError } from "./store";
import { WATCH_SCHEMA_VERSION, type ChannelState, type WatchRunReport } from "./types";

export const DEFAULT_WATCH_ROOT = "forever-data/watch";
export const DEFAULT_REGISTRY_PATH = "forever-data/watch/channel-registry.json";
export const OBJECT_INDEX_FILENAME = "object-index.json";

export class WatchLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatchLockError";
  }
}

export interface RunWatchOptions {
  /** Public channel reference, e.g. `@coralinakamala`. Must be registered and active. */
  channel: string;
  /** Directory containing the channel's Telegram Desktop JSON export (`result.json`). */
  exportDir: string;
  registryPath?: string;
  outRoot?: string;
  /** Injected wall-clock for deterministic artifacts in tests and repeat proofs. */
  runAt?: Date;
}

export interface WatchRunArtifacts {
  ledger: string;
  state: string;
  object_index: string;
  report: string;
  report_markdown: string;
}

export interface RunWatchResult {
  exitCode: number;
  report: WatchRunReport | null;
  artifacts: WatchRunArtifacts | null;
  error: string | null;
}

/** Windows-safe filename stamp derived from the run timestamp. */
export function runStamp(runAtIso: string): string {
  return runAtIso.replace(/:/g, "-").replace(/\.\d{3}Z$/, "Z");
}

function assertWatchBoundaries(outRoot: string, exportDir: string): void {
  if (isFilesystemRoot(outRoot)) {
    throw new IntakePathError("watch_out_root_is_filesystem_root");
  }
  if (!existsSync(exportDir)) {
    throw new WatchExportError(`watch_export_dir_missing: ${exportDir}`);
  }
  if (
    isSamePath(outRoot, exportDir) ||
    isStrictlyInside(exportDir, outRoot) ||
    isStrictlyInside(outRoot, exportDir)
  ) {
    // The quarantine may never overlap the source snapshot tree.
    throw new IntakePathError("watch_export_out_root_overlap");
  }
}

export async function runWatch(options: RunWatchOptions): Promise<RunWatchResult> {
  const runAtIso = (options.runAt ?? new Date()).toISOString();
  const outRoot = resolve(options.outRoot ?? DEFAULT_WATCH_ROOT);
  const registryPath = resolve(options.registryPath ?? DEFAULT_REGISTRY_PATH);
  const exportDir = resolve(options.exportDir);

  let lockAcquired = false;
  try {
    const registry = loadChannelRegistry(registryPath);
    const entry = resolveChannel(registry, options.channel);
    const key = channelKey(entry.channel);
    const channelDir = join(outRoot, "channels", key);
    const mediaDir = join(channelDir, "media");
    const reviewDir = join(channelDir, "review");
    const artifacts: WatchRunArtifacts = {
      ledger: join(channelDir, "channel-ledger.json"),
      state: join(channelDir, "state.json"),
      object_index: join(outRoot, OBJECT_INDEX_FILENAME),
      report: join(reviewDir, `run-${runStamp(runAtIso)}.json`),
      report_markdown: join(reviewDir, "LATEST.md"),
    };

    assertWatchBoundaries(outRoot, exportDir);
    mkdirSync(channelDir, { recursive: true });

    // One lock at the watch root: the cross-channel object index is shared, so
    // two concurrent runs (even for different channels) must never interleave.
    if (!acquireProjectLock(outRoot)) {
      throw new WatchLockError("watch_locked: another watcher run is active");
    }
    lockAcquired = true;

    const snapshot = readChannelExport(exportDir);
    const previousState = loadState(artifacts.state, entry.channel);
    if (previousState && previousState.channel_id !== snapshot.channel_id) {
      // The export belongs to a different channel than this directory's
      // history — almost certainly the wrong export folder. Never merge it.
      throw new WatchStoreError(
        `watch_channel_id_mismatch: state has ${previousState.channel_id}, export has ${snapshot.channel_id}`,
      );
    }

    const ledger = loadLedger(artifacts.ledger, entry, key);
    const objectIndex = loadObjectIndex(artifacts.object_index);
    const merge = mergeSnapshot({
      snapshot,
      ledger,
      objectIndex,
      mediaDir,
      runAt: runAtIso,
    });

    const report = buildRunReport({
      entry,
      channelKey: key,
      snapshot,
      changes: merge.changes,
      unchangedCount: merge.unchangedCount,
      storedObjectCount: merge.storedObjectCount,
      previousLastProcessedMessageId: previousState?.last_processed_message_id ?? 0,
      runAt: runAtIso,
    });

    const channelObjects = new Set<string>();
    for (const message of merge.ledger.messages) {
      for (const version of message.versions) {
        for (const attachment of version.attachments) {
          if (attachment.sha256) channelObjects.add(attachment.sha256);
        }
      }
    }
    const state: ChannelState = {
      watch_schema_version: WATCH_SCHEMA_VERSION,
      channel: entry.channel,
      channel_id: snapshot.channel_id,
      last_processed_message_id: report.cursor.new_last_processed_message_id,
      message_count: merge.ledger.messages.length,
      stored_object_count: channelObjects.size,
      last_run_at: runAtIso,
      last_snapshot_sha256: snapshot.snapshot_sha256,
    };

    // Registry stays authoritative for routing metadata on every run.
    const mergedLedger = {
      ...merge.ledger,
      developer_slug: entry.developer_slug,
      project_slug: entry.project_slug,
    };

    // Commit order: history first, then the shared index, then the cursor,
    // then the review artifacts. Each write is atomic on its own.
    atomicWriteJson(artifacts.ledger, mergedLedger);
    atomicWriteJson(artifacts.object_index, merge.objectIndex);
    atomicWriteJson(artifacts.state, state);
    atomicWriteJson(artifacts.report, report);
    atomicWriteFile(artifacts.report_markdown, renderRunReportMarkdown(report));

    return { exitCode: 0, report, artifacts, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const exitCode =
      error instanceof WatchRegistryError
        ? 2
        : error instanceof WatchExportError
          ? 3
          : error instanceof WatchLockError
            ? 4
            : error instanceof WatchStoreError || error instanceof IntakePathError
              ? 5
              : 1;
    return { exitCode, report: null, artifacts: null, error: message };
  } finally {
    if (lockAcquired) releaseProjectLock(outRoot);
  }
}
