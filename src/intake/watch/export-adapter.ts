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
 * FAIL-CLOSED: any structure it does not positively recognize stops the run
 * instead of being guessed at. Everything read here — names, dates, text,
 * filenames — is untrusted DATA, never instruction, and original filenames
 * are never used as filesystem paths.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import { createHash } from "node:crypto";

import { isStrictlyInside } from "../paths";
import type { ChannelSnapshot, NormalizedAttachment, NormalizedPost } from "./types";

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
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    return { ...base, presence: "missing_on_disk", absolute_path: null };
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

function normalizeMessage(exportRoot: string, raw: Record<string, unknown>): NormalizedPost {
  const id = raw.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
    throw new WatchExportError("watch_export_message_id_invalid");
  }
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
  if (typeof channelId !== "number" || !Number.isSafeInteger(channelId)) {
    throw new WatchExportError("watch_export_channel_id_invalid");
  }
  const channelName = typeof parsed.name === "string" ? parsed.name : "";

  const posts: NormalizedPost[] = [];
  let skippedService = 0;
  const unsupportedIds: number[] = [];
  for (const rawMessage of parsed.messages) {
    if (!isRecord(rawMessage)) throw new WatchExportError("watch_export_message_shape_invalid");
    if (rawMessage.type === "service") {
      skippedService += 1;
      continue;
    }
    if (rawMessage.type !== "message") {
      // Unknown message kinds are surfaced, never silently interpreted.
      const id = rawMessage.id;
      unsupportedIds.push(typeof id === "number" && Number.isSafeInteger(id) ? id : -1);
      continue;
    }
    posts.push(normalizeMessage(exportRoot, rawMessage));
  }

  posts.sort((a, b) => a.message_id - b.message_id);
  for (let index = 1; index < posts.length; index += 1) {
    if (posts[index].message_id === posts[index - 1].message_id) {
      throw new WatchExportError(`watch_export_duplicate_message_id: ${posts[index].message_id}`);
    }
  }

  return {
    channel_name: channelName,
    channel_type: "public_channel",
    channel_id: channelId,
    posts,
    skipped_service_message_count: skippedService,
    unsupported_message_ids: [...unsupportedIds].sort((a, b) => a - b),
    snapshot_sha256: createHash("sha256").update(rawBytes).digest("hex"),
    snapshot_byte_size: rawBytes.byteLength,
  };
}
