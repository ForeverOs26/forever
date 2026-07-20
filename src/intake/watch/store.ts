/**
 * TG-WATCH-001A — per-channel quarantine store, history ledger, and the
 * system-wide duplicate index.
 *
 * Layout under the watch root (default `forever-data/watch`, gitignored
 * except the committed channel registry):
 *
 *   channels/<channel_key>/media/<sha256><ext>   content-addressed quarantine
 *   channels/<channel_key>/channel-ledger.json   full message + edit history
 *   channels/<channel_key>/state.json            cursor / channel-id pin
 *   channels/<channel_key>/review/…              Owner-review run reports
 *   object-index.json                            SHA-256 sightings across channels
 *
 * Media objects are stored under their own SHA-256 — a published filename is
 * DATA in the ledger and never becomes a filesystem path, which removes the
 * malicious-filename and path-collision surface entirely. Blob writes go
 * through a temp file + rename and are verified by re-hash, so a crash can at
 * worst leave an unreferenced temp/orphan object, never a corrupt referenced
 * one. The ledger is append-only history: an edited post appends a new
 * version; nothing is overwritten or deleted.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { extname, join } from "node:path";

import { toCanonicalJson } from "../fs-utils";
import { fingerprintSourceFile } from "../sip/source-integrity";
import { classifyAttachment, textHints } from "./classify";
import {
  WATCH_SCHEMA_VERSION,
  type ChannelLedger,
  type ChannelRegistryEntry,
  type ChannelSnapshot,
  type ChannelState,
  type LedgerAttachment,
  type LedgerMessage,
  type LedgerMessageVersion,
  type NormalizedPost,
  type ObjectIndex,
  type ObjectSighting,
} from "./types";

export class WatchStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatchStoreError";
  }
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_EXTENSION_PATTERN = /^\.[a-z0-9]{1,10}$/;

/**
 * Derive a safe storage extension from the PUBLISHED filename. Anything that
 * does not match the strict allowlist is dropped — the object is then stored
 * with no extension. Never trusts the filename beyond this.
 */
export function safeStorageExtension(originalFilename: string | null): string | null {
  if (!originalFilename) return null;
  const extension = extname(originalFilename).toLowerCase();
  return SAFE_EXTENSION_PATTERN.test(extension) ? extension : null;
}

export function storedObjectName(sha256: string, extension: string | null): string {
  if (!SHA256_PATTERN.test(sha256)) throw new WatchStoreError("watch_store_sha256_invalid");
  return `${sha256}${extension ?? ""}`;
}

/**
 * Quarantine one attachment file content-addressed. Idempotent: an existing
 * object with the same hash is trusted (its name IS its content hash) and the
 * copy is skipped. Returns whether new bytes were written this call.
 */
export function quarantineObject(input: {
  mediaDir: string;
  sourceAbsolutePath: string;
  extension: string | null;
}): { sha256: string; byteSize: number; storedObject: string; newlyStored: boolean } {
  const source = fingerprintSourceFile(input.sourceAbsolutePath);
  const storedObject = storedObjectName(source.sha256, input.extension);
  const targetPath = join(input.mediaDir, storedObject);
  if (existsSync(targetPath)) {
    return {
      sha256: source.sha256,
      byteSize: source.byte_size,
      storedObject,
      newlyStored: false,
    };
  }
  mkdirSync(input.mediaDir, { recursive: true });
  const tempPath = join(
    input.mediaDir,
    `.tmp-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
  );
  try {
    copyFileSync(input.sourceAbsolutePath, tempPath);
    const copied = fingerprintSourceFile(tempPath);
    // Fail closed if the source changed between fingerprint and copy.
    if (copied.sha256 !== source.sha256 || copied.byte_size !== source.byte_size) {
      throw new WatchStoreError("watch_store_source_changed_during_copy");
    }
    renameSync(tempPath, targetPath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
  return { sha256: source.sha256, byteSize: source.byte_size, storedObject, newlyStored: true };
}

/** Hash the content-bearing fields of one message version (storage-layout free). */
export function versionHash(version: {
  posted_at: string;
  edited_at: string | null;
  text: string;
  attachments: LedgerAttachment[];
}): string {
  const hashable = {
    posted_at: version.posted_at,
    edited_at: version.edited_at,
    text: version.text,
    attachments: version.attachments.map((attachment) => ({
      kind: attachment.kind,
      original_filename: attachment.original_filename,
      mime_type: attachment.mime_type,
      media_type: attachment.media_type,
      presence: attachment.presence,
      sha256: attachment.sha256,
      byte_size: attachment.byte_size,
    })),
  };
  return createHash("sha256").update(toCanonicalJson(hashable)).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonFile(path: string, code: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new WatchStoreError(`${code}_unreadable: ${path}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new WatchStoreError(`${code}_not_json: ${path}`);
  }
}

/** Load the channel ledger, or an empty one. A malformed ledger fails closed. */
export function loadLedger(path: string, entry: ChannelRegistryEntry, key: string): ChannelLedger {
  if (!existsSync(path)) {
    return {
      watch_schema_version: WATCH_SCHEMA_VERSION,
      channel: entry.channel,
      channel_key: key,
      developer_slug: entry.developer_slug,
      project_slug: entry.project_slug,
      messages: [],
    };
  }
  const parsed = readJsonFile(path, "watch_ledger");
  if (
    !isRecord(parsed) ||
    parsed.watch_schema_version !== WATCH_SCHEMA_VERSION ||
    parsed.channel !== entry.channel ||
    parsed.channel_key !== key ||
    !Array.isArray(parsed.messages)
  ) {
    throw new WatchStoreError(`watch_ledger_invalid: ${path}`);
  }
  return parsed as unknown as ChannelLedger;
}

/** Load channel state, or null on first run. A malformed state fails closed. */
export function loadState(path: string, channel: string): ChannelState | null {
  if (!existsSync(path)) return null;
  const parsed = readJsonFile(path, "watch_state");
  if (
    !isRecord(parsed) ||
    parsed.watch_schema_version !== WATCH_SCHEMA_VERSION ||
    parsed.channel !== channel ||
    typeof parsed.channel_id !== "number" ||
    typeof parsed.last_processed_message_id !== "number"
  ) {
    throw new WatchStoreError(`watch_state_invalid: ${path}`);
  }
  return parsed as unknown as ChannelState;
}

/** Load the cross-channel object index, or an empty one. */
export function loadObjectIndex(path: string): ObjectIndex {
  if (!existsSync(path)) {
    return { watch_schema_version: WATCH_SCHEMA_VERSION, objects: {} };
  }
  const parsed = readJsonFile(path, "watch_object_index");
  if (
    !isRecord(parsed) ||
    parsed.watch_schema_version !== WATCH_SCHEMA_VERSION ||
    !isRecord(parsed.objects)
  ) {
    throw new WatchStoreError(`watch_object_index_invalid: ${path}`);
  }
  return parsed as unknown as ObjectIndex;
}

export interface MergedAttachment extends LedgerAttachment {
  /** True when the object already existed in this channel before this run. */
  duplicateInChannel: boolean;
  /** Registry channels (other than this one) that already carried these bytes. */
  duplicateOfChannels: string[];
}

export interface MergedMessage {
  change: "new" | "edited";
  message: LedgerMessage;
  version: LedgerMessageVersion;
  attachments: MergedAttachment[];
}

export interface MergeResult {
  ledger: ChannelLedger;
  objectIndex: ObjectIndex;
  changes: MergedMessage[];
  unchangedCount: number;
  storedObjectCount: number;
}

function sightingSeen(entrySightings: ObjectSighting[], candidate: ObjectSighting): boolean {
  return entrySightings.some(
    (sighting) =>
      sighting.channel_key === candidate.channel_key &&
      sighting.message_id === candidate.message_id &&
      sighting.original_filename === candidate.original_filename,
  );
}

function sortSightings(sightings: ObjectSighting[]): ObjectSighting[] {
  return [...sightings].sort((a, b) => {
    if (a.channel_key !== b.channel_key) return a.channel_key < b.channel_key ? -1 : 1;
    if (a.message_id !== b.message_id) return a.message_id - b.message_id;
    return String(a.original_filename) < String(b.original_filename) ? -1 : 1;
  });
}

/**
 * Merge a normalized channel snapshot into the ledger and object index.
 * Pure over its inputs except for quarantining attachment bytes into
 * `mediaDir`. Deterministic and idempotent: re-merging the same snapshot
 * yields byte-identical ledger and index and reports zero changes.
 *
 * Messages present in the ledger but absent from the snapshot (for example a
 * narrower export date range) are preserved untouched — history is never
 * discarded because a later snapshot did not include it.
 */
export function mergeSnapshot(input: {
  snapshot: ChannelSnapshot;
  ledger: ChannelLedger;
  objectIndex: ObjectIndex;
  mediaDir: string;
  runAt: string;
}): MergeResult {
  const byId = new Map<number, LedgerMessage>(
    input.ledger.messages.map((message) => [message.message_id, message]),
  );
  // Objects already quarantined for this channel before this run.
  const preexistingChannelObjects = new Set<string>();
  for (const message of input.ledger.messages) {
    for (const version of message.versions) {
      for (const attachment of version.attachments) {
        if (attachment.sha256) preexistingChannelObjects.add(attachment.sha256);
      }
    }
  }

  const objects: ObjectIndex["objects"] = { ...input.objectIndex.objects };
  const changes: MergedMessage[] = [];
  let unchangedCount = 0;
  let storedObjectCount = 0;

  for (const post of input.snapshot.posts) {
    const hints = textHints(post.text);
    const merged: MergedAttachment[] = post.attachments.map((attachment) => {
      const classification = classifyAttachment(attachment, hints);
      if (attachment.presence !== "present" || attachment.absolute_path === null) {
        return {
          kind: attachment.kind,
          original_filename: attachment.original_filename,
          mime_type: attachment.mime_type,
          media_type: attachment.media_type,
          presence: attachment.presence,
          sha256: null,
          byte_size: null,
          stored_object: null,
          intake_category: classification.intake_category,
          bucket: classification.bucket,
          bucket_from_text_hint: classification.from_text_hint,
          duplicateInChannel: false,
          duplicateOfChannels: [],
        };
      }
      const stored = quarantineObject({
        mediaDir: input.mediaDir,
        sourceAbsolutePath: attachment.absolute_path,
        extension: safeStorageExtension(attachment.original_filename),
      });
      if (stored.newlyStored) storedObjectCount += 1;

      const existingEntry = objects[stored.sha256];
      const otherChannels = existingEntry
        ? [
            ...new Set(
              existingEntry.sightings
                .filter((sighting) => sighting.channel_key !== input.ledger.channel_key)
                .map((sighting) => sighting.channel),
            ),
          ].sort()
        : [];
      const sighting: ObjectSighting = {
        channel: input.ledger.channel,
        channel_key: input.ledger.channel_key,
        message_id: post.message_id,
        original_filename: attachment.original_filename,
        posted_at: post.posted_at,
      };
      if (!existingEntry) {
        objects[stored.sha256] = {
          byte_size: stored.byteSize,
          extension: safeStorageExtension(attachment.original_filename),
          sightings: [sighting],
        };
      } else if (!sightingSeen(existingEntry.sightings, sighting)) {
        objects[stored.sha256] = {
          ...existingEntry,
          sightings: sortSightings([...existingEntry.sightings, sighting]),
        };
      }

      return {
        kind: attachment.kind,
        original_filename: attachment.original_filename,
        mime_type: attachment.mime_type,
        media_type: attachment.media_type,
        presence: attachment.presence,
        sha256: stored.sha256,
        byte_size: stored.byteSize,
        stored_object: stored.storedObject,
        intake_category: classification.intake_category,
        bucket: classification.bucket,
        bucket_from_text_hint: classification.from_text_hint,
        duplicateInChannel: preexistingChannelObjects.has(stored.sha256),
        duplicateOfChannels: otherChannels,
      };
    });

    for (const attachment of merged) {
      if (attachment.sha256) preexistingChannelObjects.add(attachment.sha256);
    }

    const ledgerAttachments: LedgerAttachment[] = merged.map(
      ({ duplicateInChannel: _dc, duplicateOfChannels: _do, ...ledgerFields }) => ledgerFields,
    );
    const versionCore = {
      posted_at: post.posted_at,
      edited_at: post.edited_at,
      text: post.text,
      attachments: ledgerAttachments,
    };
    const hash = versionHash(versionCore);

    const existing = byId.get(post.message_id);
    if (!existing) {
      const version: LedgerMessageVersion = {
        version_hash: hash,
        ...versionCore,
        text_hints: hints,
        recorded_at_run: input.runAt,
      };
      const message: LedgerMessage = {
        message_id: post.message_id,
        first_recorded_at_run: input.runAt,
        versions: [version],
      };
      byId.set(post.message_id, message);
      changes.push({ change: "new", message, version, attachments: merged });
      continue;
    }
    const latest = existing.versions[existing.versions.length - 1];
    if (latest && latest.version_hash === hash) {
      unchangedCount += 1;
      continue;
    }
    // Edited post (or an attachment now exported that previously was not):
    // append a new version; earlier versions and their objects are preserved.
    const version: LedgerMessageVersion = {
      version_hash: hash,
      ...versionCore,
      text_hints: hints,
      recorded_at_run: input.runAt,
    };
    const message: LedgerMessage = { ...existing, versions: [...existing.versions, version] };
    byId.set(post.message_id, message);
    changes.push({ change: "edited", message, version, attachments: merged });
  }

  const messages = [...byId.values()].sort((a, b) => a.message_id - b.message_id);
  const sortedObjects: ObjectIndex["objects"] = {};
  for (const sha of Object.keys(objects).sort()) sortedObjects[sha] = objects[sha];

  return {
    ledger: { ...input.ledger, messages },
    objectIndex: { watch_schema_version: WATCH_SCHEMA_VERSION, objects: sortedObjects },
    changes,
    unchangedCount,
    storedObjectCount,
  };
}
