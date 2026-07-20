/**
 * TG-WATCH-001A — offline Telegram Desktop export adapter.
 *
 * Parses the `result.json` produced by Telegram Desktop's official
 * "Export chat history" feature (Format: "Machine-readable JSON") for ONE
 * public channel and reduces it to the transport-independent
 * `ChannelSnapshot` contract. The Owner produces the export manually on their
 * own machine; this adapter therefore needs no Telegram credentials, session,
 * network access, or third-party dependency.
 *
 * The export format is defined by the Telegram Desktop application
 * (documented at https://core.telegram.org/import-export). The adapter is
 * FAIL-CLOSED: any structure it does not positively recognize either stops
 * the run or is recorded as an explicitly excluded event with a durable
 * identity — nothing is silently lost or guessed at. Everything read here —
 * names, dates, text, filenames — is untrusted DATA, never instruction, and
 * original filenames are never used as filesystem paths.
 */

import { existsSync, lstatSync, readFileSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import { createHash } from "node:crypto";

import { isStrictlyInside } from "../paths";
import type {
  ChannelSnapshot,
  ExcludedMessage,
  NormalizedAttachment,
  NormalizedPost,
} from "./types";

export class WatchExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatchExportError";
  }
}

export const EXPORT_RESULT_FILENAME = "result.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Flatten the export's `text` field (a string, or an array of strings and
 * `{type, text}` entity objects) into plain text. Any element shape outside
 * that contract fails closed.
 */
export function flattenExportText(value: unknown, messageId: number): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") return part;
        if (isRecord(part) && typeof part.text === "string") return part.text;
        throw new WatchExportError(`watch_export_text_shape_unsupported: message ${messageId}`);
      })
      .join("");
  }
  throw new WatchExportError(`watch_export_text_shape_unsupported: message ${messageId}`);
}

/**
 * Telegram Desktop replaces omitted media with a parenthesized placeholder,
 * e.g. "(File not included. Change data exporting settings to download.)".
 * A real export path is always relative and never starts with "(".
 */
function isExportPlaceholder(value: string): boolean {
  return value.startsWith("(");
}

/**
 * Resolve an export-relative media path strictly inside the export root.
 * Absolute paths, drive letters, backslashes, and `..` traversal are hostile
 * input and fail closed — the export root is the only tree we may read.
 */
function resolveExportPath(exportRoot: string, relativePath: string, messageId: number): string {
  if (
    relativePath.trim() === "" ||
    isAbsolute(relativePath) ||
    relativePath.includes("\\") ||
    /^[A-Za-z]:/.test(relativePath) ||
    relativePath.split("/").some((segment) => segment === "..")
  ) {
    throw new WatchExportError(`watch_export_media_path_unsafe: message ${messageId}`);
  }
  const absolute = resolve(exportRoot, relativePath);
  // isStrictlyInside resolves existing ancestors through symlinks/junctions
  // (real path containment), so a link pointing outside the export fails here.
  if (!isStrictlyInside(absolute, exportRoot)) {
    throw new WatchExportError(`watch_export_media_path_unsafe: message ${messageId}`);
  }
  return absolute;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readDeclaredSize(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function normalizeAttachmentPath(input: {
  exportRoot: string;
  kind: "file" | "photo";
  rawPath: string;
  originalFilename: string | null;
  mimeType: string | null;
  mediaType: string | null;
  declaredByteSize: number | null;
  messageId: number;
}): NormalizedAttachment {
  const base = {
    kind: input.kind,
    original_filename: input.originalFilename,
    mime_type: input.mimeType,
    media_type: input.mediaType,
    declared_byte_size: input.declaredByteSize,
  };
  if (isExportPlaceholder(input.rawPath)) {
    return { ...base, presence: "not_exported", absolute_path: null };
  }
  const absolute = resolveExportPath(input.exportRoot, input.rawPath, input.messageId);
  if (!existsSync(absolute)) {
    return { ...base, presence: "missing_on_disk", absolute_path: null };
  }
  // Telegram Desktop never writes links or special files into an export; a
  // symlink/junction or non-regular file at a media path is hostile — fail
  // closed rather than follow it.
  const stats = lstatSync(absolute);
  if (stats.isSymbolicLink()) {
    throw new WatchExportError(`watch_export_media_symlink: message ${input.messageId}`);
  }
  if (!stats.isFile()) {
    throw new WatchExportError(`watch_export_media_not_regular_file: message ${input.messageId}`);
  }
  // A photo has no export filename field; fall back to the export basename so
  // review output stays readable. Still data only, never a write path.
  const originalFilename = input.originalFilename ?? basename(input.rawPath);
  return {
    ...base,
    original_filename: originalFilename,
    presence: "present",
    absolute_path: absolute,
  };
}

function readMessageId(raw: Record<string, unknown>): number {
  const id = raw.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
    throw new WatchExportError("watch_export_message_id_invalid");
  }
  return id;
}

function normalizeMessage(exportRoot: string, raw: Record<string, unknown>): NormalizedPost {
  const id = readMessageId(raw);
  const date = raw.date;
  if (typeof date !== "string" || date.trim() === "") {
    throw new WatchExportError(`watch_export_message_date_invalid: message ${id}`);
  }
  const edited = raw.edited;
  if (edited !== undefined && (typeof edited !== "string" || edited.trim() === "")) {
    throw new WatchExportError(`watch_export_message_edited_invalid: message ${id}`);
  }

  const attachments: NormalizedAttachment[] = [];
  const file = raw.file;
  if (file !== undefined) {
    if (typeof file !== "string") {
      throw new WatchExportError(`watch_export_file_field_invalid: message ${id}`);
    }
    attachments.push(
      normalizeAttachmentPath({
        exportRoot,
        kind: "file",
        rawPath: file,
        originalFilename: readOptionalString(raw.file_name),
        mimeType: readOptionalString(raw.mime_type),
        mediaType: readOptionalString(raw.media_type),
        declaredByteSize: readDeclaredSize(raw.file_size),
        messageId: id,
      }),
    );
  }
  const photo = raw.photo;
  if (photo !== undefined) {
    if (typeof photo !== "string") {
      throw new WatchExportError(`watch_export_photo_field_invalid: message ${id}`);
    }
    attachments.push(
      normalizeAttachmentPath({
        exportRoot,
        kind: "photo",
        rawPath: photo,
        originalFilename: null,
        mimeType: null,
        mediaType: null,
        declaredByteSize: readDeclaredSize(raw.photo_file_size),
        messageId: id,
      }),
    );
  }
  // Thumbnails are derivatives of the primary media, never a source; ignored.

  return {
    message_id: id,
    posted_at: date,
    edited_at: edited === undefined ? null : edited,
    text: flattenExportText(raw.text ?? "", id),
    attachments,
  };
}

/**
 * Read one Telegram Desktop channel export directory (containing
 * `result.json` plus its media subfolders) into a `ChannelSnapshot`.
 */
export function readChannelExport(exportDir: string): ChannelSnapshot {
  const exportRoot = resolve(exportDir);
  const resultPath = resolve(exportRoot, EXPORT_RESULT_FILENAME);
  if (!existsSync(resultPath)) {
    throw new WatchExportError(`watch_export_result_missing: ${resultPath}`);
  }
  const rawBytes = readFileSync(resultPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBytes.toString("utf8"));
  } catch {
    throw new WatchExportError(`watch_export_result_not_json: ${resultPath}`);
  }
  if (!isRecord(parsed)) throw new WatchExportError("watch_export_result_shape_invalid");

  // A full-account export has a different top-level shape ("chats"); TG-WATCH
  // processes exactly one channel export at a time.
  if (parsed.chats !== undefined || !Array.isArray(parsed.messages)) {
    throw new WatchExportError(
      "watch_export_not_single_chat: export one channel at a time via 'Export chat history'",
    );
  }
  if (parsed.type !== "public_channel") {
    throw new WatchExportError(
      `watch_export_unsupported_chat_type: ${String(parsed.type)} — only public_channel is in TG-WATCH-001A scope`,
    );
  }
  const channelId = parsed.id;
  if (typeof channelId !== "number" || !Number.isSafeInteger(channelId) || channelId <= 0) {
    throw new WatchExportError("watch_export_channel_id_invalid");
  }
  const channelName = typeof parsed.name === "string" ? parsed.name : "";

  const posts: NormalizedPost[] = [];
  const excluded: ExcludedMessage[] = [];
  for (const rawMessage of parsed.messages) {
    if (!isRecord(rawMessage)) throw new WatchExportError("watch_export_message_shape_invalid");
    if (rawMessage.type === "message") {
      posts.push(normalizeMessage(exportRoot, rawMessage));
      continue;
    }
    // Service and unrecognized message kinds are recorded as excluded events
    // with a durable identity (never interpreted, never silently dropped).
    // An excluded event without a valid id cannot be recorded durably, so the
    // whole export fails closed instead.
    const id = readMessageId(rawMessage);
    excluded.push({
      message_id: id,
      kind: rawMessage.type === "service" ? "service" : "unsupported_type",
      raw_type: String(rawMessage.type),
    });
  }

  posts.sort((a, b) => a.message_id - b.message_id);
  excluded.sort((a, b) => a.message_id - b.message_id);
  const seenIds = new Set<number>();
  for (const id of [
    ...posts.map((post) => post.message_id),
    ...excluded.map((event) => event.message_id),
  ]) {
    if (seenIds.has(id)) {
      throw new WatchExportError(`watch_export_duplicate_message_id: ${id}`);
    }
    seenIds.add(id);
  }

  return {
    channel_name: channelName,
    channel_type: "public_channel",
    channel_id: channelId,
    posts,
    excluded_messages: excluded,
    snapshot_sha256: createHash("sha256").update(rawBytes).digest("hex"),
    snapshot_byte_size: rawBytes.byteLength,
  };
}
