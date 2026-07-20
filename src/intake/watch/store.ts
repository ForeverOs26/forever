/**
 * TG-WATCH-001A — per-channel quarantine store, history ledger, and the
 * system-wide duplicate index.
 *
 * Layout under the watch root (an OUT-OF-REPOSITORY runtime root; the
 * committed registry is the only in-repository watch file):
 *
 *   channels/<channel_key>/media/<sha256><ext>   content-addressed quarantine
 *   channels/<channel_key>/channel-ledger.json   full message + edit history
 *   channels/<channel_key>/state.json            cursor / channel-id pin
 *   channels/<channel_key>/review/…              Owner-review run reports
 *   object-index.json                            SHA-256 sightings across channels
 *
 * Media objects are stored under their own SHA-256 — a published filename is
 * DATA in the ledger and never becomes a filesystem path, which removes the
 * malicious-filename and path-collision surface entirely.
 *
 * Integrity rules:
 *  - every file is hashed by STREAMING (never fully in memory) with a
 *    configurable byte limit enforced during the read;
 *  - sources and stored objects must be regular files, never symlinks,
 *    junctions, directories, or devices (lstat, no link following);
 *  - an existing object named by SHA-256 is accepted as a duplicate ONLY
 *    after its actual bytes re-verify against the expected hash and size —
 *    corruption or substitution fails the run closed;
 *  - a new object is staged to a temp file while re-hashing the copied
 *    bytes; a source mutated during the copy fails closed; the rename into
 *    the content-addressed name is atomic.
 *
 * The ledger is append-only history: an edited post appends a new version;
 * excluded (service/unrecognized) events are recorded durably so the cursor
 * never advances past anything unrecorded; nothing is overwritten or deleted.
 */

import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { extname, join } from "node:path";

import { toCanonicalJson } from "../fs-utils";
import { classifyAttachment, textHints } from "./classify";
import {
  WATCH_SCHEMA_VERSION,
  type ChannelLedger,
  type ChannelRegistryEntry,
  type ChannelSnapshot,
  type ChannelState,
  type LedgerAttachment,
  type LedgerExcludedMessage,
  type LedgerMessage,
  type LedgerMessageVersion,
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
const READ_CHUNK_BYTES = 1024 * 1024;

/** Default per-attachment size limit: 512 MiB (ordinary construction videos fit). */
export const DEFAULT_MAX_ATTACHMENT_BYTES = 512 * 1024 * 1024;

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

/** lstat that fails closed on links and non-regular files. Returns byte size. */
function assertRegularFile(path: string, code: string): number {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink()) throw new WatchStoreError(`${code}_symlink: ${path}`);
  if (!stats.isFile()) throw new WatchStoreError(`${code}_not_regular_file: ${path}`);
  return stats.size;
}

export interface BoundedFingerprint {
  sha256: string;
  byte_size: number;
}

/**
 * Streaming SHA-256 of a regular file with a hard byte ceiling enforced
 * DURING the read — never loads the file into memory, never reads past the
 * limit. Fails closed if the file is a link/non-regular, or if it does not
 * end exactly at its observed size (mutation while reading).
 */
export function fingerprintFileBounded(
  path: string,
  maxBytes: number,
  code = "watch_store_source",
): { ok: true; fingerprint: BoundedFingerprint } | { ok: false; observedByteSize: number } {
  const initialSize = assertRegularFile(path, code);
  if (initialSize > maxBytes) return { ok: false, observedByteSize: initialSize };
  const hash = createHash("sha256");
  const fd = openSync(path, "r");
  let byteSize = 0;
  try {
    const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    for (;;) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead <= 0) break;
      byteSize += bytesRead;
      if (byteSize > maxBytes) {
        // The file grew past the limit while being read.
        throw new WatchStoreError(`${code}_changed_during_read: ${path}`);
      }
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(fd);
  }
  if (byteSize !== initialSize) {
    throw new WatchStoreError(`${code}_changed_during_read: ${path}`);
  }
  return { ok: true, fingerprint: { sha256: hash.digest("hex"), byte_size: byteSize } };
}

/**
 * Verify that an existing content-addressed object actually contains the
 * bytes its name claims. A filename is never proof of content: corruption,
 * substitution, truncation, links, and non-regular files all fail closed.
 */
export function verifyStoredObject(path: string, expected: BoundedFingerprint): void {
  let actual: BoundedFingerprint;
  try {
    const result = fingerprintFileBounded(path, expected.byte_size, "watch_store_object");
    if (!result.ok) {
      throw new WatchStoreError(
        `watch_store_object_integrity: ${path} is larger than the expected ${expected.byte_size} bytes`,
      );
    }
    actual = result.fingerprint;
  } catch (error) {
    if (error instanceof WatchStoreError) throw error;
    throw new WatchStoreError(`watch_store_object_unreadable: ${path}`);
  }
  if (actual.sha256 !== expected.sha256 || actual.byte_size !== expected.byte_size) {
    throw new WatchStoreError(
      `watch_store_object_integrity: ${path} does not match its content-addressed name`,
    );
  }
}

/** Copy a regular file in chunks while re-hashing exactly the bytes written. */
function copyAndHash(sourcePath: string, targetPath: string, maxBytes: number): BoundedFingerprint {
  const hash = createHash("sha256");
  const sourceFd = openSync(sourcePath, "r");
  let targetFd: number | null = null;
  let byteSize = 0;
  try {
    targetFd = openSync(targetPath, "wx");
    const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    for (;;) {
      const bytesRead = readSync(sourceFd, buffer, 0, buffer.length, null);
      if (bytesRead <= 0) break;
      byteSize += bytesRead;
      if (byteSize > maxBytes) {
        throw new WatchStoreError(`watch_store_source_changed_during_copy: ${sourcePath}`);
      }
      hash.update(buffer.subarray(0, bytesRead));
      writeSync(targetFd, buffer, 0, bytesRead);
    }
  } finally {
    closeSync(sourceFd);
    if (targetFd !== null) closeSync(targetFd);
  }
  return { sha256: hash.digest("hex"), byte_size: byteSize };
}

export type QuarantineResult =
  | {
      status: "stored";
      sha256: string;
      byteSize: number;
      storedObject: string;
      newlyStored: boolean;
    }
  | { status: "oversized"; observedByteSize: number };

/**
 * Quarantine one attachment file content-addressed, within the byte limit.
 * Idempotent and verified: an existing object is accepted as a duplicate only
 * after its bytes re-verify; a new object is staged, re-hashed, and renamed
 * atomically. Partial staging files are always cleaned up on failure.
 */
export function quarantineObject(input: {
  mediaDir: string;
  sourceAbsolutePath: string;
  extension: string | null;
  maxBytes: number;
}): QuarantineResult {
  const sourceResult = fingerprintFileBounded(input.sourceAbsolutePath, input.maxBytes);
  if (!sourceResult.ok) {
    return { status: "oversized", observedByteSize: sourceResult.observedByteSize };
  }
  const source = sourceResult.fingerprint;
  const storedObject = storedObjectName(source.sha256, input.extension);
  const targetPath = join(input.mediaDir, storedObject);
  if (existsSync(targetPath)) {
    verifyStoredObject(targetPath, source);
    return {
      status: "stored",
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
    const copied = copyAndHash(input.sourceAbsolutePath, tempPath, input.maxBytes);
    // Fail closed if the source changed between the fingerprint and the copy.
    if (copied.sha256 !== source.sha256 || copied.byte_size !== source.byte_size) {
      throw new WatchStoreError(
        `watch_store_source_changed_during_copy: ${input.sourceAbsolutePath}`,
      );
    }
    renameSync(tempPath, targetPath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
  return {
    status: "stored",
    sha256: source.sha256,
    byteSize: source.byte_size,
    storedObject,
    newlyStored: true,
  };
}

/**
 * Remove stale `.tmp-*` staging residue left by a crashed run. Only plain
 * `.tmp-*` names directly inside the media directory are touched.
 */
export function cleanStaleTempObjects(mediaDir: string): void {
  if (!existsSync(mediaDir)) return;
  for (const name of readdirSync(mediaDir)) {
    if (name.startsWith(".tmp-")) rmSync(join(mediaDir, name), { force: true });
  }
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

function validLedgerMessage(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.message_id === "number" &&
    Number.isSafeInteger(value.message_id) &&
    Array.isArray(value.versions) &&
    value.versions.length > 0 &&
    value.versions.every(
      (version) =>
        isRecord(version) &&
        typeof version.version_hash === "string" &&
        Array.isArray(version.attachments),
    )
  );
}

function validLedgerExcluded(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.message_id === "number" &&
    Number.isSafeInteger(value.message_id) &&
    (value.kind === "service" || value.kind === "unsupported_type") &&
    typeof value.raw_type === "string"
  );
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
      excluded_messages: [],
    };
  }
  const parsed = readJsonFile(path, "watch_ledger");
  if (
    !isRecord(parsed) ||
    parsed.watch_schema_version !== WATCH_SCHEMA_VERSION ||
    parsed.channel !== entry.channel ||
    parsed.channel_key !== key ||
    !Array.isArray(parsed.messages) ||
    !parsed.messages.every(validLedgerMessage) ||
    !Array.isArray(parsed.excluded_messages) ||
    !parsed.excluded_messages.every(validLedgerExcluded)
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
 * narrower export date range, or a deletion on Telegram's side) are preserved
 * untouched — history is never discarded because a later snapshot did not
 * include it. Candidate deletions are surfaced by the review report.
 */
export function mergeSnapshot(input: {
  snapshot: ChannelSnapshot;
  ledger: ChannelLedger;
  objectIndex: ObjectIndex;
  mediaDir: string;
  runAt: string;
  maxAttachmentBytes: number;
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
      const base = {
        kind: attachment.kind,
        original_filename: attachment.original_filename,
        mime_type: attachment.mime_type,
        media_type: attachment.media_type,
        intake_category: classification.intake_category,
        bucket: classification.bucket,
        bucket_from_text_hint: classification.from_text_hint,
        duplicateInChannel: false,
        duplicateOfChannels: [] as string[],
      };
      if (attachment.presence !== "present" || attachment.absolute_path === null) {
        return {
          ...base,
          presence: attachment.presence,
          sha256: null,
          byte_size: null,
          stored_object: null,
          size_check: null,
        };
      }
      const stored = quarantineObject({
        mediaDir: input.mediaDir,
        sourceAbsolutePath: attachment.absolute_path,
        extension: safeStorageExtension(attachment.original_filename),
        maxBytes: input.maxAttachmentBytes,
      });
      if (stored.status === "oversized") {
        // The bytes exceed the configured limit: recorded honestly, not
        // quarantined, never partially written to disk.
        return {
          ...base,
          presence: "oversized" as const,
          sha256: null,
          byte_size: stored.observedByteSize,
          stored_object: null,
          size_check: null,
        };
      }
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
        ...base,
        presence: "present" as const,
        sha256: stored.sha256,
        byte_size: stored.byteSize,
        stored_object: stored.storedObject,
        size_check:
          attachment.declared_byte_size !== null &&
          attachment.declared_byte_size !== stored.byteSize
            ? ("declared_mismatch" as const)
            : ("ok" as const),
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
    // Edited post (or an attachment now exported/within-limit that previously
    // was not): append a new version; earlier versions and their objects are
    // preserved.
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

  // Excluded events are recorded durably (append-only, first sighting wins)
  // so the cursor may advance past them without losing anything silently.
  const excludedById = new Map<number, LedgerExcludedMessage>(
    input.ledger.excluded_messages.map((event) => [event.message_id, event]),
  );
  for (const event of input.snapshot.excluded_messages) {
    if (!excludedById.has(event.message_id)) {
      excludedById.set(event.message_id, { ...event, first_recorded_at_run: input.runAt });
    }
  }

  const messages = [...byId.values()].sort((a, b) => a.message_id - b.message_id);
  const excludedMessages = [...excludedById.values()].sort((a, b) => a.message_id - b.message_id);
  const sortedObjects: ObjectIndex["objects"] = {};
  for (const sha of Object.keys(objects).sort()) sortedObjects[sha] = objects[sha];

  return {
    ledger: { ...input.ledger, messages, excluded_messages: excludedMessages },
    objectIndex: { watch_schema_version: WATCH_SCHEMA_VERSION, objects: sortedObjects },
    changes,
    unchangedCount,
    storedObjectCount,
  };
}
