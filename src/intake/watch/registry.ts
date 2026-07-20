/**
 * TG-WATCH-001A — channel registry loading and validation.
 *
 * One committed registry maps every watched public channel to its developer
 * and project. The registry is configuration, never evidence: it decides where
 * quarantined material is filed for review, and proves nothing about content.
 * Validation fails closed — a malformed registry stops the run before any
 * filesystem write.
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const status = value.status;
  if (status !== "active" && status !== "paused") {
    throw new WatchRegistryError(`watch_registry_status_invalid: ${channel}`);
  }
  const notes = value.notes;
  if (notes !== undefined && typeof notes !== "string") {
    throw new WatchRegistryError(`watch_registry_notes_invalid: ${channel}`);
  }
  return {
    channel,
    developer_slug: developerSlug,
    developer_name: developerName,
    project_slug: projectSlug,
    project_name: projectName as string | null,
    status,
    ...(notes !== undefined ? { notes } : {}),
  };
}

/** Parse and validate a registry document. Fails closed on any malformation. */
export function parseChannelRegistry(raw: unknown): ChannelRegistry {
  if (!isRecord(raw) || raw.watch_schema_version !== WATCH_SCHEMA_VERSION) {
    throw new WatchRegistryError("watch_registry_schema_version_invalid");
  }
  if (!Array.isArray(raw.channels) || raw.channels.length === 0) {
    throw new WatchRegistryError("watch_registry_channels_invalid");
  }
  const entries = raw.channels.map(validateEntry);
  const seenChannels = new Set<string>();
  const seenKeys = new Set<string>();
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
