/**
 * Package Factory — source adapters.
 *
 * One adapter per source kind. Every adapter is independent: it either yields
 * artifacts/references or reports a failure, and a failure never prevents the
 * other adapters from contributing. That independence is what makes the Factory
 * source-agnostic in practice rather than only in the schema — a run with no
 * Telegram, no Drive and no network is an ordinary run.
 *
 * Server/CLI only: these touch the filesystem and (for Drive/website, and only
 * when the operator opts in) the network.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";

import type { SourceKind, SourceSetEntry } from "../source-set";
import { authorityOf } from "../source-set";
import type { AdapterFailure, ResolvedArtifact, ResolvedReference } from "../types";

import { readZipEntries, ZipError } from "./zip";

/** Files that are never project material. */
export function isJunkFilename(name: string): boolean {
  const base = name.split("/").pop() ?? name;
  // AppleDouble sidecars, Finder metadata, and other dotfiles.
  return base.startsWith("._") || base === ".DS_Store" || base.startsWith(".");
}

export const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
export const MAX_ARTIFACTS_PER_SOURCE = 3000;

export interface AdapterContext {
  /** Network adapters stay inert unless the operator opts in explicitly. */
  allowNetwork: boolean;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface AdapterOutput {
  artifacts: Array<Omit<ResolvedArtifact, "sha256" | "repostOf" | "documentClass">>;
  references: ResolvedReference[];
  skipped: Array<{ ref: string; reason: string }>;
  failures: AdapterFailure[];
  existingRecordSlugs: string[];
}

function emptyOutput(): AdapterOutput {
  return { artifacts: [], references: [], skipped: [], failures: [], existingRecordSlugs: [] };
}

function failure(kind: SourceKind, ref: string, code: string, message: string): AdapterFailure {
  return { kind, ref, code, message };
}

/** Logical, forward-slash, root-relative path. */
function logical(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join("/");
}

// ---------------------------------------------------------------------------
// Filename evidence: "… V.2. - Updated 17.07.26.pdf"
// ---------------------------------------------------------------------------

const REVISION_PATTERN = /\bV\.?\s?(\d{1,2})\b/i;
const DATE_PATTERNS: ReadonlyArray<RegExp> = [
  // 17.07.2026 / 17-07-26 / 17_07_2026
  /\b(\d{2})[.\-_](\d{2})[.\-_](\d{2}(?:\d{2})?)\b/,
];

/**
 * The in-document effective date as The Title (and most developers) publish it:
 * inside the filename. Two-digit years are read as 20xx. Returns null rather
 * than guessing when the fragment is not a plausible date.
 */
export function effectiveDateFromFilename(name: string): string | null {
  for (const pattern of DATE_PATTERNS) {
    const match = pattern.exec(name);
    if (!match) continue;
    const day = Number(match[1]);
    const month = Number(match[2]);
    const yearRaw = match[3];
    const year = yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw);
    if (day < 1 || day > 31 || month < 1 || month > 12) continue;
    if (year < 2000 || year > 2100) continue;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

export function revisionFromFilename(name: string): string | null {
  const match = REVISION_PATTERN.exec(name);
  return match ? `V${match[1]}` : null;
}

// ---------------------------------------------------------------------------
// local_folder / official_document / uploaded_archive
// ---------------------------------------------------------------------------

async function listFilesRecursively(root: string): Promise<string[]> {
  const files: string[] = [];
  const queue: string[] = [root];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        queue.push(absolute);
        continue;
      }
      if (entry.isFile()) files.push(absolute);
    }
  }
  return files.sort();
}

async function readLocalFolder(entry: SourceSetEntry): Promise<AdapterOutput> {
  const output = emptyOutput();
  const root = resolve(entry.location!);
  let files: string[];
  try {
    const info = await stat(root);
    if (!info.isDirectory()) {
      output.failures.push(
        failure(entry.type, basename(root), "source_not_a_directory", "The path is not a folder."),
      );
      return output;
    }
    files = await listFilesRecursively(root);
  } catch {
    output.failures.push(
      failure(entry.type, basename(root), "source_unreadable", "The folder could not be read."),
    );
    return output;
  }

  for (const absolute of files.slice(0, MAX_ARTIFACTS_PER_SOURCE)) {
    const path = logical(root, absolute);
    if (isJunkFilename(path)) {
      output.skipped.push({ ref: basename(path), reason: "junk_file" });
      continue;
    }
    const info = await stat(absolute);
    if (info.size > MAX_ARTIFACT_BYTES) {
      output.skipped.push({ ref: basename(path), reason: "file_too_large" });
      continue;
    }
    const name = basename(path);
    output.artifacts.push({
      ref: name,
      logicalPath: path,
      kind: entry.type,
      authority: authorityOf(entry),
      privateLocator: absolute,
      bytes: await readFile(absolute),
      publishedAt: entry.published_at ?? null,
      effectiveDate: entry.effective_date ?? effectiveDateFromFilename(name),
      revision: entry.revision ?? revisionFromFilename(name),
    });
  }
  if (files.length > MAX_ARTIFACTS_PER_SOURCE) {
    output.skipped.push({ ref: basename(root), reason: "source_file_limit" });
  }
  return output;
}

async function readOfficialDocument(entry: SourceSetEntry): Promise<AdapterOutput> {
  const output = emptyOutput();
  const path = resolve(entry.location!);
  const name = basename(path);
  try {
    const info = await stat(path);
    if (!info.isFile()) {
      output.failures.push(
        failure(entry.type, name, "source_not_a_file", "The path is not a file."),
      );
      return output;
    }
    if (info.size > MAX_ARTIFACT_BYTES) {
      output.skipped.push({ ref: name, reason: "file_too_large" });
      return output;
    }
  } catch {
    output.failures.push(
      failure(entry.type, name, "source_unreadable", "The document could not be read."),
    );
    return output;
  }
  output.artifacts.push({
    ref: name,
    logicalPath: name,
    kind: entry.type,
    authority: authorityOf(entry),
    privateLocator: path,
    bytes: await readFile(path),
    publishedAt: entry.published_at ?? null,
    effectiveDate: entry.effective_date ?? effectiveDateFromFilename(name),
    revision: entry.revision ?? revisionFromFilename(name),
  });
  return output;
}

async function readUploadedArchive(entry: SourceSetEntry): Promise<AdapterOutput> {
  const output = emptyOutput();
  const path = resolve(entry.location!);
  const archiveName = basename(path);
  let buffer: Buffer;
  try {
    buffer = await readFile(path);
  } catch {
    output.failures.push(
      failure(entry.type, archiveName, "source_unreadable", "The archive could not be read."),
    );
    return output;
  }
  let entries;
  try {
    entries = readZipEntries(buffer);
  } catch (error) {
    const zipError = error as ZipError;
    output.failures.push(
      failure(
        entry.type,
        archiveName,
        zipError.code ?? "archive_unreadable",
        zipError.message ?? "The archive could not be opened.",
      ),
    );
    return output;
  }
  for (const item of entries.slice(0, MAX_ARTIFACTS_PER_SOURCE)) {
    if (isJunkFilename(item.path)) {
      output.skipped.push({ ref: basename(item.path), reason: "junk_file" });
      continue;
    }
    const name = basename(item.path);
    output.artifacts.push({
      ref: name,
      logicalPath: item.path,
      kind: entry.type,
      authority: authorityOf(entry),
      privateLocator: `${path}!${item.path}`,
      bytes: item.bytes,
      publishedAt: entry.published_at ?? null,
      effectiveDate: entry.effective_date ?? effectiveDateFromFilename(name),
      revision: entry.revision ?? revisionFromFilename(name),
    });
  }
  return output;
}

// ---------------------------------------------------------------------------
// telegram_channel — lean local archive only
// ---------------------------------------------------------------------------

/**
 * Read the lean local Telegram archive.
 *
 * Reads ONLY `<archive_root>/downloads/<channel-or-slug>/<messageId>/<file>`
 * and the accompanying `registry/current_price_sources.json` when present. It
 * never contacts Telegram, never restores the deleted full mirror, and never
 * records an invite token: the channel username alone is the reference.
 */
function normalizeChannelKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Read the lean archive's registry, or null when it has none. */
async function readArchiveRegistry(archiveRoot: string): Promise<unknown | null> {
  try {
    return JSON.parse(
      await readFile(join(archiveRoot, "registry", "current_price_sources.json"), "utf8"),
    ) as unknown;
  } catch {
    return null;
  }
}

interface ArchiveProjectEntry {
  slug?: string;
  official_channel?: string;
  availability_overrides?: { messages?: ArchiveAvailabilityMessage[] };
}

function archiveProjectsMatching(registry: unknown, channel: string): ArchiveProjectEntry[] {
  const key = normalizeChannelKey(channel);
  const projects = ((registry as { projects?: unknown[] })?.projects ??
    []) as ArchiveProjectEntry[];
  return projects.filter((project) => {
    const channelKey = normalizeChannelKey(project.official_channel ?? "");
    // Match on the recorded channel URL first: it is the authoritative link
    // between a channel username and the archive's project slug.
    if (channelKey && channelKey.includes(key)) return true;
    const slugKey = normalizeChannelKey(project.slug ?? "");
    return Boolean(slugKey) && (slugKey === key || slugKey.includes(key) || key.includes(slugKey));
  });
}

/** The archive folder name the registry associates with a channel username. */
async function archiveSlugForChannel(archiveRoot: string, channel: string): Promise<string | null> {
  const registry = await readArchiveRegistry(archiveRoot);
  if (!registry) return null;
  const matches = archiveProjectsMatching(registry, channel);
  // Exactly one match, or nothing: an ambiguous mapping must not be guessed.
  return matches.length === 1 ? (matches[0].slug ?? null) : null;
}

/** One availability message recorded by the lean archive's own registry. */
interface ArchiveAvailabilityMessage {
  message_id?: number;
  date_utc?: string;
  units_marked_sold?: string[];
  explicit_sold?: boolean;
  excerpt?: string;
}

/**
 * Availability notes carried by short channel messages ("SOLD D620").
 *
 * These have no document attachment, so the archive records them in
 * `registry/current_price_sources.json` rather than under `downloads/`. Each one
 * becomes a dated text artifact, which is exactly what the reconciler needs: a
 * statement with an effective date that can override an older schedule.
 *
 * Only messages the archive marked `explicit_sold` are read. A caption that
 * merely mentions a unit is not a statement that it was sold.
 */
async function readTelegramAvailabilityNotes(
  entry: SourceSetEntry,
  archiveRoot: string,
): Promise<AdapterOutput["artifacts"]> {
  const artifacts: AdapterOutput["artifacts"] = [];
  const registry = await readArchiveRegistry(archiveRoot);
  // No registry is an ordinary state, not a failure.
  if (!registry) return artifacts;

  const channelKey = normalizeChannelKey(entry.channel!);
  for (const project of archiveProjectsMatching(registry, entry.channel!)) {
    for (const message of project.availability_overrides?.messages ?? []) {
      if (!message.explicit_sold) continue;
      const units = (message.units_marked_sold ?? []).filter(Boolean);
      if (units.length === 0) continue;
      const date = (message.date_utc ?? "").slice(0, 10) || null;
      // The note carries the statement only — never the permalink, never the
      // channel invite, never anything that could reach a public field.
      const text = `SOLD ${units.join(" ")}`;
      const ref = `availability-note-${message.message_id ?? units.join("-")}.txt`;
      artifacts.push({
        ref,
        logicalPath: `updates/${ref}`,
        kind: entry.type,
        authority: authorityOf(entry),
        privateLocator: `${archiveRoot}#${project.slug ?? channelKey}/${message.message_id ?? ""}`,
        bytes: Buffer.from(text, "utf8"),
        publishedAt: date,
        effectiveDate: date,
        revision: null,
      });
    }
  }
  return artifacts;
}

async function readTelegramChannel(entry: SourceSetEntry): Promise<AdapterOutput> {
  const output = emptyOutput();
  const channel = entry.channel!;
  const archiveRoot = entry.archive_root ? resolve(entry.archive_root) : null;
  output.references.push({
    ref: channel,
    kind: entry.type,
    authority: authorityOf(entry),
    privateLocator: archiveRoot ?? channel,
    publishedAt: entry.published_at ?? null,
    note: null,
  });
  if (!archiveRoot) return output;

  output.artifacts.push(...(await readTelegramAvailabilityNotes(entry, archiveRoot)));

  const downloads = join(archiveRoot, "downloads");
  let projectDirectories: string[];
  try {
    projectDirectories = (await readdir(downloads, { withFileTypes: true }))
      .filter((item) => item.isDirectory())
      .map((item) => item.name);
  } catch {
    output.failures.push(
      failure(
        entry.type,
        channel,
        "telegram_archive_absent",
        "The lean Telegram archive is not present locally; Telegram contributed nothing.",
      ),
    );
    return output;
  }

  // Match the channel to its archive folder.
  //
  // The archive is keyed by project slug and the source set by channel
  // username, and the two are frequently unrelated strings ("coralinakamala" vs
  // "the-title-coralina"). The archive's own registry records the mapping, so
  // that is consulted FIRST; string similarity is only a fallback for an
  // archive with no registry.
  const key = normalizeChannelKey(channel);
  const mapped = await archiveSlugForChannel(archiveRoot, channel);
  const match =
    (mapped ? projectDirectories.find((name) => name === mapped) : undefined) ??
    projectDirectories.find((name) => normalizeChannelKey(name) === key) ??
    projectDirectories.find((name) => {
      const normalized = normalizeChannelKey(name);
      return key.includes(normalized) || normalized.includes(key);
    });
  if (!match) {
    output.failures.push(
      failure(
        entry.type,
        channel,
        "telegram_channel_not_archived",
        "No lean archive folder matches this channel; Telegram contributed nothing.",
      ),
    );
    return output;
  }

  const channelRoot = join(downloads, match);
  const files = await listFilesRecursively(channelRoot);
  for (const absolute of files.slice(0, MAX_ARTIFACTS_PER_SOURCE)) {
    const path = logical(channelRoot, absolute);
    if (isJunkFilename(path)) {
      output.skipped.push({ ref: basename(path), reason: "junk_file" });
      continue;
    }
    const info = await stat(absolute);
    if (info.size > MAX_ARTIFACT_BYTES) {
      output.skipped.push({ ref: basename(path), reason: "file_too_large" });
      continue;
    }
    const name = basename(path);
    output.artifacts.push({
      ref: name,
      logicalPath: path,
      kind: entry.type,
      authority: authorityOf(entry),
      privateLocator: absolute,
      publishedAt: entry.published_at ?? null,
      bytes: await readFile(absolute),
      effectiveDate: entry.effective_date ?? effectiveDateFromFilename(name),
      revision: entry.revision ?? revisionFromFilename(name),
    });
  }
  return output;
}

// ---------------------------------------------------------------------------
// google_drive_folder — read-only public listing
// ---------------------------------------------------------------------------

const DRIVE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

export const DRIVE_MAX_DEPTH = 4;

interface DriveEntry {
  id: string;
  name: string;
  isFolder: boolean;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

/** Parse Drive's server-rendered public folder listing. */
export function parseDriveFolderHtml(html: string): DriveEntry[] {
  const entries: DriveEntry[] = [];
  const blocks = html.split('<div class="flip-entry" id="entry-');
  for (const block of blocks.slice(1)) {
    const id = /^([^"]+)"/.exec(block)?.[1];
    const name = /class="flip-entry-title">([\s\S]*?)<\/div>/.exec(block)?.[1];
    const ariaType = /aria-label="([^"]*)"/.exec(block)?.[1] ?? "";
    if (!id || !name) continue;
    entries.push({ id, name: decodeEntities(name.trim()), isFolder: /^folder$/i.test(ariaType) });
  }
  return entries;
}

/** Media/document extensions worth downloading from a dossier. */
const DRIVE_WANTED = /\.(jpe?g|png|webp|gif|pdf|docx?|xlsx?|csv|txt)$/i;

async function readGoogleDriveFolder(
  entry: SourceSetEntry,
  context: AdapterContext,
): Promise<AdapterOutput> {
  const output = emptyOutput();
  const folderId = entry.folder_id!;
  output.references.push({
    ref: `drive:${folderId.slice(0, 8)}…`,
    kind: entry.type,
    authority: authorityOf(entry),
    privateLocator: folderId,
    publishedAt: entry.published_at ?? null,
    note: null,
  });
  if (!context.allowNetwork) {
    output.failures.push(
      failure(
        entry.type,
        `drive:${folderId.slice(0, 8)}…`,
        "network_not_enabled",
        "Google Drive was listed but --allow-network was not given; Drive contributed nothing.",
      ),
    );
    return output;
  }

  const doFetch = context.fetchImpl ?? fetch;
  const listFolder = async (id: string): Promise<DriveEntry[]> => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await doFetch(
          `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(id)}#list`,
          { headers: { "User-Agent": DRIVE_USER_AGENT } },
        );
        if (!response.ok) throw new Error(`status ${response.status}`);
        return parseDriveFolderHtml(await response.text());
      } catch (error) {
        if (attempt === 2) throw error;
        await new Promise((done) => setTimeout(done, 600 * (attempt + 1)));
      }
    }
    return [];
  };

  interface Node {
    id: string;
    path: string;
    depth: number;
  }
  const queue: Node[] = [{ id: folderId, path: "", depth: 0 }];
  const seen = new Set<string>();
  const files: Array<{ id: string; name: string; path: string }> = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    if (seen.has(node.id) || node.depth > DRIVE_MAX_DEPTH) continue;
    seen.add(node.id);
    let listing: DriveEntry[];
    try {
      listing = await listFolder(node.id);
    } catch {
      output.failures.push(
        failure(
          entry.type,
          node.path || `drive:${folderId.slice(0, 8)}…`,
          "drive_folder_unreadable",
          "One Drive folder could not be listed; the rest of the dossier was still read.",
        ),
      );
      continue;
    }
    for (const item of listing) {
      const path = node.path ? `${node.path}/${item.name}` : item.name;
      if (item.isFolder) {
        queue.push({ id: item.id, path, depth: node.depth + 1 });
        continue;
      }
      if (isJunkFilename(item.name)) {
        output.skipped.push({ ref: item.name, reason: "junk_file" });
        continue;
      }
      if (!DRIVE_WANTED.test(item.name)) {
        output.skipped.push({ ref: item.name, reason: "unsupported_drive_type" });
        continue;
      }
      files.push({ id: item.id, name: item.name, path });
    }
  }

  for (const file of files.slice(0, MAX_ARTIFACTS_PER_SOURCE)) {
    try {
      const response = await doFetch(
        `https://drive.google.com/uc?export=download&id=${encodeURIComponent(file.id)}`,
        { headers: { "User-Agent": DRIVE_USER_AGENT }, redirect: "follow" },
      );
      if (!response.ok) throw new Error(`status ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_ARTIFACT_BYTES) {
        output.skipped.push({ ref: file.name, reason: "file_too_large" });
        continue;
      }
      // Drive answers an interstitial HTML page for files it will not serve
      // directly. Never let that page become "project material".
      if (bytes.subarray(0, 15).toString("ascii").trim().toLowerCase().startsWith("<!doctype")) {
        output.skipped.push({ ref: file.name, reason: "drive_interstitial" });
        continue;
      }
      output.artifacts.push({
        ref: file.name,
        logicalPath: file.path,
        kind: entry.type,
        authority: authorityOf(entry),
        privateLocator: `drive:${file.id}`,
        bytes,
        publishedAt: entry.published_at ?? null,
        effectiveDate: entry.effective_date ?? effectiveDateFromFilename(file.name),
        revision: entry.revision ?? revisionFromFilename(file.name),
      });
    } catch {
      output.failures.push(
        failure(
          entry.type,
          file.name,
          "drive_file_unreadable",
          "One Drive file could not be downloaded; the rest of the dossier was still read.",
        ),
      );
    }
  }
  return output;
}

// ---------------------------------------------------------------------------
// official_website / existing_forever_record — references, not bytes
// ---------------------------------------------------------------------------

function readOfficialWebsite(entry: SourceSetEntry): AdapterOutput {
  const output = emptyOutput();
  let host: string;
  try {
    host = new URL(entry.url!).host;
  } catch {
    output.failures.push(
      failure(entry.type, "official_website", "source_url_invalid", "The URL could not be parsed."),
    );
    return output;
  }
  // Recorded as provenance only. A marketing page is not an official document,
  // and nothing here may become a published fact.
  output.references.push({
    ref: host,
    kind: entry.type,
    authority: authorityOf(entry),
    privateLocator: entry.url!,
    publishedAt: entry.published_at ?? null,
    note: "recorded as provenance; no fact is extracted from a website",
  });
  return output;
}

function readExistingForeverRecord(entry: SourceSetEntry): AdapterOutput {
  const output = emptyOutput();
  output.existingRecordSlugs.push(entry.slug!);
  output.references.push({
    ref: entry.slug!,
    kind: entry.type,
    authority: authorityOf(entry),
    privateLocator: entry.slug!,
    publishedAt: null,
    note: null,
  });
  return output;
}

// ---------------------------------------------------------------------------

/** Run one source-set entry through its adapter. Never throws. */
export async function runAdapter(
  entry: SourceSetEntry,
  context: AdapterContext,
): Promise<AdapterOutput> {
  try {
    switch (entry.type) {
      case "local_folder":
        return await readLocalFolder(entry);
      case "official_document":
        return await readOfficialDocument(entry);
      case "uploaded_archive":
        return await readUploadedArchive(entry);
      case "telegram_channel":
        return await readTelegramChannel(entry);
      case "google_drive_folder":
        return await readGoogleDriveFolder(entry, context);
      case "official_website":
        return readOfficialWebsite(entry);
      case "existing_forever_record":
        return readExistingForeverRecord(entry);
    }
  } catch (error) {
    const output = emptyOutput();
    output.failures.push(
      failure(
        entry.type,
        entry.type,
        "adapter_failed",
        error instanceof Error ? error.message : "The adapter failed.",
      ),
    );
    return output;
  }
}
