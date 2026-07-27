/**
 * Package Factory — the Official Source Set contract (`forever-source-set.v1`).
 *
 * The Owner describes WHERE the official material is; the Factory decides what
 * it means. This is deliberately the smallest robust shape that still supports
 * one source, many sources, creating a project and updating one.
 *
 * The rule that shapes the whole schema: **no source type is mandatory**.
 * Telegram in particular is one optional member of a union — a project whose
 * developer has no channel, or whose material is a single PDF on disk, is an
 * ordinary case and not a degraded one.
 *
 * `location` / `folder_id` / `channel` values are PRIVATE. They are read at
 * generation time and never copied into a public projection; the builder emits
 * basenames and content hashes only.
 *
 * Pure validation: no filesystem, no network, no credential.
 */

export const SOURCE_SET_SCHEMA_VERSION = "forever-source-set.v1" as const;

/** Every source kind the resolver can enumerate. None is required. */
export const SOURCE_KINDS = [
  "local_folder",
  "uploaded_archive",
  "official_document",
  "google_drive_folder",
  "telegram_channel",
  "official_website",
  "existing_forever_record",
] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * How much weight the resolver may give a source when two of them disagree.
 * All Owner-supplied material is authorized (see forever-direct-publish/trust);
 * authority is about *precedence*, never about permission.
 */
export const SOURCE_AUTHORITIES = [
  "developer_official",
  "developer_official_telegram",
  "developer_official_drive",
  "owner_supplied",
  "existing_forever_record",
] as const;

export type SourceAuthority = (typeof SOURCE_AUTHORITIES)[number];

export interface SourceSetEntry {
  type: SourceKind;
  /** Local path for local_folder | uploaded_archive | official_document. */
  location?: string;
  /** Google Drive folder id for google_drive_folder. */
  folder_id?: string;
  /** Public channel username for telegram_channel (never an invite token). */
  channel?: string;
  /** Root of the lean local Telegram archive. Never the deleted full mirror. */
  archive_root?: string;
  /** URL for official_website. */
  url?: string;
  /** Existing Forever slug for existing_forever_record. */
  slug?: string;
  /** When the source distributed the material (ISO date). */
  published_at?: string;
  /** What the document itself states as effective (ISO date). */
  effective_date?: string;
  /** Official version/revision label, e.g. "V2". */
  revision?: string;
  authority?: SourceAuthority;
  /** Free-text operator note; never published. */
  note?: string;
}

export interface ProjectHint {
  name?: string;
  developer?: string;
  area?: string;
  existing_slug?: string;
  aliases?: string[];
}

export interface SourceSet {
  schema_version: typeof SOURCE_SET_SCHEMA_VERSION;
  project_hint?: ProjectHint;
  sources: SourceSetEntry[];
}

export class SourceSetError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SourceSetError";
    this.code = code;
  }
}

const ENTRY_KEYS = new Set([
  "type",
  "location",
  "folder_id",
  "channel",
  "archive_root",
  "url",
  "slug",
  "published_at",
  "effective_date",
  "revision",
  "authority",
  "note",
]);

const HINT_KEYS = new Set(["name", "developer", "area", "existing_slug", "aliases"]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Which locator field each kind needs. Absence of the field is an exception. */
const REQUIRED_LOCATOR: Record<SourceKind, keyof SourceSetEntry> = {
  local_folder: "location",
  uploaded_archive: "location",
  official_document: "location",
  google_drive_folder: "folder_id",
  telegram_channel: "channel",
  official_website: "url",
  existing_forever_record: "slug",
};

/** Default precedence authority per kind when the Owner does not state one. */
export const DEFAULT_AUTHORITY: Record<SourceKind, SourceAuthority> = {
  local_folder: "owner_supplied",
  uploaded_archive: "owner_supplied",
  official_document: "developer_official",
  google_drive_folder: "developer_official_drive",
  telegram_channel: "developer_official_telegram",
  official_website: "developer_official",
  existing_forever_record: "existing_forever_record",
};

function requireString(value: unknown, code: string, message: string): string {
  if (typeof value !== "string" || !value.trim()) throw new SourceSetError(code, message);
  return value.trim();
}

function validateEntry(raw: unknown, index: number): SourceSetEntry {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SourceSetError("source_malformed", `sources[${index}] is not an object.`);
  }
  const entry = raw as Record<string, unknown>;
  for (const key of Object.keys(entry)) {
    if (!ENTRY_KEYS.has(key)) {
      throw new SourceSetError(
        "source_key_unknown",
        `sources[${index}] has unknown key "${key}". A typo must be an exception, never silence.`,
      );
    }
  }

  const type = requireString(
    entry.type,
    "source_type_missing",
    `sources[${index}] has no "type".`,
  ) as SourceKind;
  if (!(SOURCE_KINDS as readonly string[]).includes(type)) {
    throw new SourceSetError(
      "source_type_unsupported",
      `sources[${index}] type "${type}" is not supported. Use one of: ${SOURCE_KINDS.join(", ")}.`,
    );
  }

  const locator = REQUIRED_LOCATOR[type];
  requireString(
    entry[locator],
    "source_locator_missing",
    `sources[${index}] of type "${type}" needs "${String(locator)}".`,
  );

  for (const dateKey of ["published_at", "effective_date"] as const) {
    const value = entry[dateKey];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" || !ISO_DATE.test(value)) {
      throw new SourceSetError(
        "source_date_invalid",
        `sources[${index}].${dateKey} must be an ISO date (YYYY-MM-DD).`,
      );
    }
  }

  if (entry.authority !== undefined) {
    if (
      typeof entry.authority !== "string" ||
      !(SOURCE_AUTHORITIES as readonly string[]).includes(entry.authority)
    ) {
      throw new SourceSetError(
        "source_authority_unsupported",
        `sources[${index}].authority must be one of: ${SOURCE_AUTHORITIES.join(", ")}.`,
      );
    }
  }

  return { ...(entry as unknown as SourceSetEntry), type };
}

function validateHint(raw: unknown): ProjectHint {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new SourceSetError("project_hint_malformed", "project_hint is not an object.");
  }
  const hint = raw as Record<string, unknown>;
  for (const key of Object.keys(hint)) {
    if (!HINT_KEYS.has(key)) {
      throw new SourceSetError(
        "project_hint_key_unknown",
        `project_hint has unknown key "${key}".`,
      );
    }
  }
  if (hint.aliases !== undefined) {
    if (!Array.isArray(hint.aliases) || hint.aliases.some((a) => typeof a !== "string")) {
      throw new SourceSetError(
        "project_hint_aliases_malformed",
        "project_hint.aliases must be an array of strings.",
      );
    }
  }
  return hint as ProjectHint;
}

/**
 * Validate one source set.
 *
 * The only structural requirement is at least one Owner-authorized source.
 * Which KIND it is, is never checked — that is the source-agnostic rule.
 */
export function parseSourceSet(raw: unknown): SourceSet {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SourceSetError("source_set_malformed", "The source set is not a JSON object.");
  }
  const value = raw as Record<string, unknown>;
  if (value.schema_version !== SOURCE_SET_SCHEMA_VERSION) {
    throw new SourceSetError(
      "schema_version_unsupported",
      `schema_version must be "${SOURCE_SET_SCHEMA_VERSION}".`,
    );
  }
  if (!Array.isArray(value.sources) || value.sources.length === 0) {
    throw new SourceSetError(
      "sources_missing",
      "A source set needs at least one official Owner-authorized source.",
    );
  }
  const sources = value.sources.map((entry, index) => validateEntry(entry, index));
  return {
    schema_version: SOURCE_SET_SCHEMA_VERSION,
    project_hint: validateHint(value.project_hint),
    sources,
  };
}

/** Authority for an entry, defaulted by kind when the Owner did not state one. */
export function authorityOf(entry: SourceSetEntry): SourceAuthority {
  return entry.authority ?? DEFAULT_AUTHORITY[entry.type];
}
