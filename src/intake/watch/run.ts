/**
 * TG-WATCH-001A — one universal watcher run for one registered channel.
 *
 *   channel registry (committed config) + offline channel export (transport)
 *   → Owner-approved channel-identity binding (fail-closed first run)
 *   → normalized snapshot (fail-closed adapter)
 *   → content-addressed, size-bounded, integrity-verified quarantine
 *   → append-only history ledger (posts, edits, excluded events)
 *   → SHA-256 duplicate detection (in-channel and cross-channel)
 *   → per-channel cursor state
 *   → Owner-review run report (JSON + Markdown), recommendations only
 *
 * Strictly local and read-only toward the source: no Telegram session, no
 * network request, no database client, no SIP/Fast Intake execution, no
 * import, no publication. One watch-root lock serializes runs because the
 * duplicate index is shared across channels.
 *
 * RUNTIME ROOT POLICY: watcher runtime data (quarantine, ledgers, state,
 * index, reports, locks, temp files) lives OUTSIDE the repository working
 * tree — default `<home>/forever-watch`, overridable with --out-root. The
 * only committed watch file is the channel registry. A runtime root that is
 * a filesystem root, inside the repository, containing the repository, a
 * symlink, or overlapping the export source is rejected before any write.
 *
 * Crash model (simpler than Fast Intake's journal, and sufficient because
 * every write is either content-addressed or a whole-document atomic
 * replace): media blobs are staged temp+rename and verified by re-hash;
 * ledger, object index, state, and reports are single atomic JSON/Markdown
 * writes, committed in dependency order (media → ledger → index → state →
 * report). A crash between steps leaves at worst an unreferenced staging/
 * orphan blob (cleaned on the next locked run) or a cursor older than the
 * ledger; re-running the same export is idempotent and converges to the
 * identical final state.
 */

import { existsSync, lstatSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { atomicWriteFile, atomicWriteJson } from "../fs-utils";
import { IntakePathError, isFilesystemRoot, isSamePath, isStrictlyInside } from "../paths";
import { acquireProjectLock, releaseProjectLock } from "../txn";
import { readChannelExport, WatchExportError } from "./export-adapter";
import { channelKey, loadChannelRegistry, resolveChannel, WatchRegistryError } from "./registry";
import { buildRunReport, renderRunReportMarkdown } from "./review";
import {
  cleanStaleTempObjects,
  DEFAULT_MAX_ATTACHMENT_BYTES,
  loadLedger,
  loadObjectIndex,
  loadState,
  mergeSnapshot,
  WatchStoreError,
} from "./store";
import { WATCH_SCHEMA_VERSION, type ChannelState, type WatchRunReport } from "./types";

/** The repository this module lives in; runtime data may never live inside it. */
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Default runtime root: outside the repository, portable, not machine-specific. */
export function defaultWatchRoot(): string {
  return join(homedir(), "forever-watch");
}

export const DEFAULT_REGISTRY_PATH = "forever-data/watch/channel-registry.json";
export const OBJECT_INDEX_FILENAME = "object-index.json";

export class WatchLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatchLockError";
  }
}

/** Channel-identity binding failures (first-run binding, later mismatch). */
export class WatchBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatchBindingError";
  }
}

export interface RunWatchOptions {
  /** Public channel reference, e.g. `@coralinakamala`. Must be registered and active. */
  channel: string;
  /** Directory containing the channel's Telegram Desktop JSON export (`result.json`). */
  exportDir: string;
  registryPath?: string;
  /** Runtime root; default `<home>/forever-watch`. Never inside the repository. */
  outRoot?: string;
  /** Per-attachment size ceiling in bytes; default DEFAULT_MAX_ATTACHMENT_BYTES. */
  maxAttachmentBytes?: number;
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

function rejectSymlink(path: string, code: string): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new IntakePathError(`${code}: ${path}`);
  }
}

function assertWatchBoundaries(outRoot: string, exportDir: string): void {
  // Runtime data never lives inside the repository working tree (even
  // gitignored), and the runtime root must not swallow the repository.
  if (isSamePath(outRoot, REPOSITORY_ROOT) || isStrictlyInside(outRoot, REPOSITORY_ROOT)) {
    throw new IntakePathError(
      `watch_out_root_inside_repository: ${outRoot} — pass an --out-root outside the repository (default: <home>/forever-watch)`,
    );
  }
  if (isStrictlyInside(REPOSITORY_ROOT, outRoot)) {
    if (isFilesystemRoot(outRoot)) {
      throw new IntakePathError(
        `watch_out_root_is_filesystem_root; watch_out_root_contains_repository: ${outRoot}`,
      );
    }
    throw new IntakePathError(`watch_out_root_contains_repository: ${outRoot}`);
  }
  if (isFilesystemRoot(outRoot)) {
    throw new IntakePathError("watch_out_root_is_filesystem_root");
  }
  // The roots themselves must not be links (junctions/reparse points appear
  // as symlinks to lstat); pass the real directories instead.
  rejectSymlink(outRoot, "watch_out_root_symlink");
  if (!existsSync(exportDir)) {
    throw new WatchExportError(`watch_export_dir_missing: ${exportDir}`);
  }
  rejectSymlink(exportDir, "watch_export_dir_symlink");
  if (
    isSamePath(outRoot, exportDir) ||
    isStrictlyInside(exportDir, outRoot) ||
    isStrictlyInside(outRoot, exportDir)
  ) {
    // The quarantine may never overlap the source snapshot tree.
    throw new IntakePathError("watch_export_out_root_overlap");
  }
}

/**
 * A managed directory we are about to write through must be a real directory
 * (not a symlink/junction planted to redirect writes) and must really resolve
 * inside the runtime root.
 */
function assertTrustedManagedDir(dir: string, outRoot: string): void {
  const stats = lstatSync(dir);
  if (stats.isSymbolicLink()) {
    throw new IntakePathError(`watch_managed_dir_symlink: ${dir}`);
  }
  if (!stats.isDirectory()) {
    throw new IntakePathError(`watch_managed_dir_not_directory: ${dir}`);
  }
  if (!isSamePath(dir, outRoot) && !isStrictlyInside(dir, outRoot)) {
    throw new IntakePathError(`watch_managed_dir_escapes_root: ${dir}`);
  }
}

export async function runWatch(options: RunWatchOptions): Promise<RunWatchResult> {
  const runAtIso = (options.runAt ?? new Date()).toISOString();
  const outRoot = resolve(options.outRoot ?? defaultWatchRoot());
  const registryPath = resolve(options.registryPath ?? DEFAULT_REGISTRY_PATH);
  const exportDir = resolve(options.exportDir);
  const maxAttachmentBytes = options.maxAttachmentBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES;

  let lockAcquired = false;
  try {
    if (!Number.isSafeInteger(maxAttachmentBytes) || maxAttachmentBytes <= 0) {
      throw new WatchStoreError("watch_max_attachment_bytes_invalid");
    }
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
    mkdirSync(mediaDir, { recursive: true });
    mkdirSync(reviewDir, { recursive: true });
    for (const dir of [outRoot, join(outRoot, "channels"), channelDir, mediaDir, reviewDir]) {
      assertTrustedManagedDir(dir, outRoot);
    }

    // One lock at the watch root: the cross-channel object index is shared, so
    // two concurrent runs (even for different channels) must never interleave.
    if (!acquireProjectLock(outRoot)) {
      throw new WatchLockError("watch_locked: another watcher run is active");
    }
    lockAcquired = true;

    // Remove staging residue from a crashed earlier run before merging.
    cleanStaleTempObjects(mediaDir);

    const snapshot = readChannelExport(exportDir);

    // Channel identity must be PROVEN, never assumed from the CLI flag or the
    // export's display name. The registry carries the Owner-approved numeric
    // binding; an unbound entry fails closed and tells the Owner exactly what
    // this export claims so they can verify and bind it explicitly.
    if (entry.telegram_channel_id === null) {
      throw new WatchBindingError(
        `watch_channel_unbound: ${entry.channel} has no telegram_channel_id binding in the registry. ` +
          `This export claims channel id ${snapshot.channel_id} (display name "${snapshot.channel_name}"). ` +
          `Verify this export really is ${entry.channel} (open the channel in Telegram Desktop and export it yourself), ` +
          `then set "telegram_channel_id": ${snapshot.channel_id} for ${entry.channel} in the registry and re-run. Nothing was ingested.`,
      );
    }
    if (snapshot.channel_id !== entry.telegram_channel_id) {
      throw new WatchBindingError(
        `watch_channel_binding_mismatch: registry binds ${entry.channel} to channel id ${entry.telegram_channel_id}, but this export claims ${snapshot.channel_id}. Nothing was ingested.`,
      );
    }

    const previousState = loadState(artifacts.state, entry.channel);
    if (previousState && previousState.channel_id !== snapshot.channel_id) {
      // Continuity pin: catches a registry edit that silently re-bound this
      // channel directory's history to a different channel.
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
      maxAttachmentBytes,
    });

    // Registry stays authoritative for routing metadata on every run.
    const mergedLedger = {
      ...merge.ledger,
      developer_slug: entry.developer_slug,
      project_slug: entry.project_slug,
    };

    const report = buildRunReport({
      entry,
      channelKey: key,
      snapshot,
      ledger: mergedLedger,
      changes: merge.changes,
      unchangedCount: merge.unchangedCount,
      storedObjectCount: merge.storedObjectCount,
      previousLastProcessedMessageId: previousState?.last_processed_message_id ?? 0,
      runAt: runAtIso,
    });

    const channelObjects = new Set<string>();
    for (const message of mergedLedger.messages) {
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
      message_count: mergedLedger.messages.length,
      stored_object_count: channelObjects.size,
      last_run_at: runAtIso,
      last_snapshot_sha256: snapshot.snapshot_sha256,
    };

    // Commit order: history first, then the shared index, then the cursor,
    // then the review artifacts. Each write is atomic on its own; the cursor
    // is durably behind (never ahead of) the recorded history.
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
              : error instanceof WatchBindingError
                ? 6
                : 1;
    return { exitCode, report: null, artifacts: null, error: message };
  } finally {
    if (lockAcquired) releaseProjectLock(outRoot);
  }
}
