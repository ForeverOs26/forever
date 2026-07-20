/**
 * TG-WATCH-001A — channel registry loading and validation.
 *
 * One committed registry maps every watched public channel to its developer
 * and project, and carries the Owner-approved binding to the channel's stable
 * numeric Telegram id. The registry is configuration, never evidence: it
 * decides where quarantined material is filed for review, and proves nothing
 * about content. Validation fails closed — a malformed registry, an unknown
 * property, or a secret-shaped value stops the run before any filesystem
 * write. The registry is committed and must never carry credentials, tokens,
 * phone numbers, or any other secret.
 */

import { readFileSync } from "node:fs";

import { assertSafeSlug, IntakePathError } from "../paths";
import {
  TELEGRAM_PUBLIC_CHANNEL_PATTERN,
  WATCH_SCHEMA_VERSION,
  type ChannelRegistry,
  type ChannelRegistryEntry,
} from "./types";

export class WatchRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatchRegistryError";
  }
}

const ROOT_KEYS = ["watch_schema_version", "channels"] as const;
const ENTRY_REQUIRED_KEYS = [
  "channel",
  "developer_slug",
  "developer_name",
  "project_slug",
  "project_name",
  "telegram_channel_id",
  "status",
] as const;
const ENTRY_OPTIONAL_KEYS = ["notes"] as const;

/**
 * Patterns a committed registry value must never contain. These match the
 * SHAPE of common credentials — bot tokens, long hex/base64 secrets, phone
 * numbers — not any specific real value.
 */
const SECRET_LIKE_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "bot_token", pattern: /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/ },
  { label: "long_hex", pattern: /\b[a-fA-F0-9]{40,}\b/ },
  { label: "long_base64", pattern: /[A-Za-z0-9+/]{40,}={0,2}/ },
  { label: "phone_number", pattern: /\+\d{9,15}\b/ },
  { label: "credential_keyword", pattern: /api[_-]?(id|hash)|2fa|password|session\s*string/i },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNoSecretLikeValue(value: string, where: string): void {
  for (const { label, pattern } of SECRET_LIKE_PATTERNS) {
    if (pattern.test(value)) {
      throw new WatchRegistryError(
        `watch_registry_secret_like_value: ${where} matches ${label}; the committed registry must never carry credentials or personal data`,
      );
    }
  }
}

/**
 * Derive the deterministic filesystem key for a channel: lowercase the public
 * username and map underscores to hyphens so the key always satisfies the
 * shared safe-slug rule and can never escape the managed watch root.
 */
export function channelKey(channel: string): string {
  if (!TELEGRAM_PUBLIC_CHANNEL_PATTERN.test(channel)) {
    throw new WatchRegistryError(`watch_channel_reference_invalid: ${channel}`);
  }
  const key = channel.slice(1).toLowerCase().replace(/_/g, "-");
  try {
    assertSafeSlug(key);
  } catch (error) {
    if (error instanceof IntakePathError) {
      throw new WatchRegistryError(`watch_channel_key_unsafe: ${channel}`);
    }
    throw error;
  }
  return key;
}

function validateEntry(value: unknown, index: number): ChannelRegistryEntry {
  if (!isRecord(value)) {
    throw new WatchRegistryError(`watch_registry_entry_invalid: index ${index}`);
  }
  const allowed = new Set<string>([...ENTRY_REQUIRED_KEYS, ...ENTRY_OPTIONAL_KEYS]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new WatchRegistryError(`watch_registry_unknown_property: index ${index} "${key}"`);
    }
  }
  for (const key of ENTRY_REQUIRED_KEYS) {
    if (!(key in value)) {
      throw new WatchRegistryError(`watch_registry_missing_property: index ${index} "${key}"`);
    }
  }
  const channel = value.channel;
  if (typeof channel !== "string" || !TELEGRAM_PUBLIC_CHANNEL_PATTERN.test(channel)) {
    throw new WatchRegistryError(
      `watch_registry_channel_invalid: index ${index} — expected a public @channel reference`,
    );
  }
  const developerSlug = value.developer_slug;
  if (typeof developerSlug !== "string") {
    throw new WatchRegistryError(`watch_registry_developer_slug_invalid: ${channel}`);
  }
  try {
    assertSafeSlug(developerSlug);
  } catch {
    throw new WatchRegistryError(`watch_registry_developer_slug_invalid: ${channel}`);
  }
  const developerName = value.developer_name;
  if (typeof developerName !== "string" || developerName.trim() === "") {
    throw new WatchRegistryError(`watch_registry_developer_name_invalid: ${channel}`);
  }
  const projectSlug = value.project_slug;
  if (projectSlug !== null) {
    if (typeof projectSlug !== "string") {
      throw new WatchRegistryError(`watch_registry_project_slug_invalid: ${channel}`);
    }
    try {
      assertSafeSlug(projectSlug);
    } catch {
      throw new WatchRegistryError(`watch_registry_project_slug_invalid: ${channel}`);
    }
  }
  const projectName = value.project_name;
  if (projectName !== null && (typeof projectName !== "string" || projectName.trim() === "")) {
    throw new WatchRegistryError(`watch_registry_project_name_invalid: ${channel}`);
  }
  if (projectSlug === null && projectName !== null) {
    throw new WatchRegistryError(`watch_registry_project_name_without_slug: ${channel}`);
  }
  const telegramChannelId = value.telegram_channel_id;
  if (
    telegramChannelId !== null &&
    (typeof telegramChannelId !== "number" ||
      !Number.isSafeInteger(telegramChannelId) ||
      telegramChannelId <= 0)
  ) {
    throw new WatchRegistryError(
      `watch_registry_telegram_channel_id_invalid: ${channel} — a positive integer or null (unbound)`,
    );
  }
  const status = value.status;
  if (status !== "active" && status !== "paused") {
    throw new WatchRegistryError(`watch_registry_status_invalid: ${channel}`);
  }
  const notes = value.notes;
  if (notes !== undefined && typeof notes !== "string") {
    throw new WatchRegistryError(`watch_registry_notes_invalid: ${channel}`);
  }
  for (const [key, candidate] of Object.entries(value)) {
    if (typeof candidate === "string") {
      assertNoSecretLikeValue(candidate, `entry ${index} field "${key}"`);
    }
  }
  return {
    channel,
    developer_slug: developerSlug,
    developer_name: developerName,
    project_slug: projectSlug,
    project_name: projectName as string | null,
    telegram_channel_id: telegramChannelId,
    status,
    ...(notes !== undefined ? { notes } : {}),
  };
}

/** Parse and validate a registry document. Fails closed on any malformation. */
export function parseChannelRegistry(raw: unknown): ChannelRegistry {
  if (!isRecord(raw) || raw.watch_schema_version !== WATCH_SCHEMA_VERSION) {
    throw new WatchRegistryError("watch_registry_schema_version_invalid");
  }
  for (const key of Object.keys(raw)) {
    if (!(ROOT_KEYS as readonly string[]).includes(key)) {
      throw new WatchRegistryError(`watch_registry_unknown_property: root "${key}"`);
    }
  }
  if (!Array.isArray(raw.channels) || raw.channels.length === 0) {
    throw new WatchRegistryError("watch_registry_channels_invalid");
  }
  const entries = raw.channels.map(validateEntry);
  const seenChannels = new Set<string>();
  const seenKeys = new Set<string>();
  const seenIds = new Set<number>();
  for (const entry of entries) {
    const lower = entry.channel.toLowerCase();
    if (seenChannels.has(lower)) {
      throw new WatchRegistryError(`watch_registry_duplicate_channel: ${entry.channel}`);
    }
    seenChannels.add(lower);
    const key = channelKey(entry.channel);
    if (seenKeys.has(key)) {
      // Two distinct usernames can collide after underscore→hyphen mapping;
      // refuse rather than share one quarantine directory.
      throw new WatchRegistryError(`watch_registry_channel_key_collision: ${key}`);
    }
    seenKeys.add(key);
    if (entry.telegram_channel_id !== null) {
      if (seenIds.has(entry.telegram_channel_id)) {
        throw new WatchRegistryError(
          `watch_registry_duplicate_telegram_channel_id: ${entry.telegram_channel_id}`,
        );
      }
      seenIds.add(entry.telegram_channel_id);
    }
  }
  return { watch_schema_version: WATCH_SCHEMA_VERSION, channels: entries };
}

export function loadChannelRegistry(path: string): ChannelRegistry {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new WatchRegistryError(`watch_registry_unreadable: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new WatchRegistryError(`watch_registry_not_json: ${path}`);
  }
  return parseChannelRegistry(parsed);
}

/**
 * Resolve one channel for processing. Channel references are matched
 * case-insensitively (Telegram usernames are case-insensitive); a paused or
 * unregistered channel is refused — the watcher never processes an
 * unregistered source.
 */
export function resolveChannel(registry: ChannelRegistry, channel: string): ChannelRegistryEntry {
  if (!TELEGRAM_PUBLIC_CHANNEL_PATTERN.test(channel)) {
    throw new WatchRegistryError(`watch_channel_reference_invalid: ${channel}`);
  }
  const entry = registry.channels.find(
    (candidate) => candidate.channel.toLowerCase() === channel.toLowerCase(),
  );
  if (!entry) {
    throw new WatchRegistryError(
      `watch_channel_not_registered: ${channel} — add it to the channel registry first`,
    );
  }
  if (entry.status !== "active") {
    throw new WatchRegistryError(`watch_channel_paused: ${entry.channel}`);
  }
  return entry;
}
