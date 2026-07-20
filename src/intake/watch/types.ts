/**
 * TG-WATCH-001A — transport-independent Telegram source-watcher core types.
 *
 * The watcher is a local, read-only, owner-run preparation tool. It consumes a
 * NORMALIZED channel snapshot (produced today by the offline Telegram Desktop
 * export adapter, later by a separately approved live transport), quarantines
 * attachments content-addressed by SHA-256, preserves full message and edit
 * history in a per-channel ledger, and produces Owner-review output.
 *
 * It never authenticates to Telegram, never makes a network request, never
 * touches the Forever database, never runs SIP extraction or Fast Intake, and
 * never imports or publishes anything. Every downstream step remains a
 * separately authorized Owner action. See docs/TG_WATCH_001A_WATCHER_CORE.md.
 */

export const WATCH_SCHEMA_VERSION = "1" as const;

/** Public Telegram channel reference, e.g. `@coralinakamala` (same rule as sip:package). */
export const TELEGRAM_PUBLIC_CHANNEL_PATTERN = /^@[A-Za-z][A-Za-z0-9_]{4,31}$/;

// ---------------------------------------------------------------------------
// Channel registry — one configuration for many channels; never one agent per
// channel. Maps each channel to its developer and (optionally) project slug.
// ---------------------------------------------------------------------------

export type ChannelStatus = "active" | "paused";

export interface ChannelRegistryEntry {
  /** Public channel reference exactly as on Telegram, e.g. `@coralinakamala`. */
  channel: string;
  developer_slug: string;
  developer_name: string;
  /** Project slug for a per-project channel; null for a developer-wide channel. */
  project_slug: string | null;
  project_name: string | null;
  /**
   * Owner-approved binding to the channel's stable numeric Telegram id.
   * `null` means UNBOUND: the watcher fails closed on the first run, reports
   * the id the export claims, and the Owner binds it here after verifying.
   * A display name or CLI flag alone never proves channel identity.
   */
  telegram_channel_id: number | null;
  status: ChannelStatus;
  notes?: string;
}

export interface ChannelRegistry {
  watch_schema_version: typeof WATCH_SCHEMA_VERSION;
  channels: ChannelRegistryEntry[];
}

// ---------------------------------------------------------------------------
// Normalized transport contract. ANY transport (offline export adapter now, a
// separately gated live reader later) must reduce to this shape; everything
// downstream — quarantine, ledger, dedupe, classification, review — is
// transport-independent.
// ---------------------------------------------------------------------------

export type AttachmentPresence =
  /** The attachment file exists in the snapshot and can be quarantined. */
  | "present"
  /** The export deliberately omitted the file (size/type export settings). */
  | "not_exported"
  /** The snapshot references a file that is absent on disk. */
  | "missing_on_disk"
  /** The file exceeds the configured attachment size limit; not quarantined. */
  | "oversized";

export interface NormalizedAttachment {
  kind: "file" | "photo";
  /** Original filename as published; DATA ONLY — never used as a filesystem path. */
  original_filename: string | null;
  mime_type: string | null;
  media_type: string | null;
  presence: Exclude<AttachmentPresence, "oversized">;
  /** Resolved absolute path inside the snapshot root; only when presence is "present". */
  absolute_path: string | null;
  declared_byte_size: number | null;
}

export interface NormalizedPost {
  /** Channel-unique Telegram message id (ascending). */
  message_id: number;
  /** Post timestamp exactly as recorded by the transport; data only. */
  posted_at: string;
  /** Last-edit timestamp as recorded by the transport, when present. */
  edited_at: string | null;
  /** Plain text flattened from the transport's text representation. */
  text: string;
  attachments: NormalizedAttachment[];
}

/**
 * A source event the watcher recognizes but deliberately does not interpret:
 * a Telegram service message, or a message type this version does not know.
 * Excluded events carry a durable identity so the cursor may only advance
 * past events that are recorded, never past events that were silently lost.
 */
export interface ExcludedMessage {
  message_id: number;
  kind: "service" | "unsupported_type";
  raw_type: string;
}

export interface ChannelSnapshot {
  /** Channel display name as recorded by the transport; data only, never identity. */
  channel_name: string;
  channel_type: "public_channel";
  channel_id: number;
  /** Ascending by message_id; ids are unique across posts and excluded events. */
  posts: NormalizedPost[];
  /** Service and unrecognized messages, ascending by message_id. */
  excluded_messages: ExcludedMessage[];
  /** SHA-256 + byte size of the raw transport document (result.json). */
  snapshot_sha256: string;
  snapshot_byte_size: number;
}

// ---------------------------------------------------------------------------
// Deterministic routing classification. Routing only — a bucket is never a
// fact about a document's content (same philosophy as src/intake/classify.ts).
// ---------------------------------------------------------------------------

export const WATCH_BUCKETS = [
  "price_table",
  "visual_master_plan",
  "construction_media",
  "document",
  "manual_review_required",
  "other",
] as const;

export type WatchBucket = (typeof WATCH_BUCKETS)[number];

export interface AttachmentClassification {
  /** Category from the shared intake classifier applied to the original filename. */
  intake_category: string;
  bucket: WatchBucket;
  /** True when the bucket came from deterministic message-caption keywords. */
  from_text_hint: boolean;
}

// ---------------------------------------------------------------------------
// Per-channel quarantine ledger — the full preserved history. Rewritten
// atomically as one canonical JSON document; versions are append-only.
// ---------------------------------------------------------------------------

export interface LedgerAttachment {
  kind: "file" | "photo";
  original_filename: string | null;
  mime_type: string | null;
  media_type: string | null;
  presence: AttachmentPresence;
  /** SHA-256 of the quarantined bytes; null unless the bytes were hashed. */
  sha256: string | null;
  /** Actual observed byte size (never the transport's declared size). */
  byte_size: number | null;
  /** Content-addressed object name inside the channel `media/` store. */
  stored_object: string | null;
  /** "declared_mismatch" when the transport's declared size differed from actual bytes. */
  size_check: "ok" | "declared_mismatch" | null;
  intake_category: string | null;
  bucket: WatchBucket | null;
  bucket_from_text_hint: boolean;
}

export interface LedgerMessageVersion {
  /** SHA-256 over the canonical JSON of the version's content-bearing fields. */
  version_hash: string;
  posted_at: string;
  edited_at: string | null;
  text: string;
  text_hints: string[];
  attachments: LedgerAttachment[];
  /** run_at of the run that first recorded this version. */
  recorded_at_run: string;
}

export interface LedgerMessage {
  message_id: number;
  first_recorded_at_run: string;
  /** Append-only, oldest first. The last element is the latest known version. */
  versions: LedgerMessageVersion[];
}

/** Durable record of a recognized-but-uninterpreted source event. */
export interface LedgerExcludedMessage {
  message_id: number;
  kind: "service" | "unsupported_type";
  raw_type: string;
  first_recorded_at_run: string;
}

export interface ChannelLedger {
  watch_schema_version: typeof WATCH_SCHEMA_VERSION;
  channel: string;
  channel_key: string;
  developer_slug: string;
  project_slug: string | null;
  messages: LedgerMessage[];
  excluded_messages: LedgerExcludedMessage[];
}

// ---------------------------------------------------------------------------
// Per-channel cursor state.
// ---------------------------------------------------------------------------

export interface ChannelState {
  watch_schema_version: typeof WATCH_SCHEMA_VERSION;
  channel: string;
  /** Numeric Telegram channel id confirmed by the registry binding; continuity pin. */
  channel_id: number;
  /**
   * Advances only past events that are durably processed (ledger message
   * version) or durably recorded as excluded (ledger excluded_messages).
   */
  last_processed_message_id: number;
  message_count: number;
  stored_object_count: number;
  last_run_at: string;
  last_snapshot_sha256: string;
}

// ---------------------------------------------------------------------------
// Cross-channel duplicate index — one system-wide SHA-256 sighting index.
// ---------------------------------------------------------------------------

export interface ObjectSighting {
  channel: string;
  channel_key: string;
  message_id: number;
  original_filename: string | null;
  posted_at: string;
}

export interface ObjectIndexEntry {
  byte_size: number;
  extension: string | null;
  sightings: ObjectSighting[];
}

export interface ObjectIndex {
  watch_schema_version: typeof WATCH_SCHEMA_VERSION;
  objects: Record<string, ObjectIndexEntry>;
}

// ---------------------------------------------------------------------------
// Owner-review run report. Recommendations only; the watcher executes nothing.
// ---------------------------------------------------------------------------

export interface ReviewAttachment {
  original_filename: string | null;
  sha256: string | null;
  byte_size: number | null;
  stored_object: string | null;
  presence: AttachmentPresence;
  size_check: "ok" | "declared_mismatch" | null;
  bucket: WatchBucket | null;
  bucket_from_text_hint: boolean;
  /** True when these bytes were already quarantined before this run. */
  duplicate_in_channel: boolean;
  /** Other registry channels that already carried byte-identical content. */
  duplicate_of_channels: string[];
}

export interface ReviewMessageItem {
  message_id: number;
  change: "new" | "edited";
  posted_at: string;
  edited_at: string | null;
  /** Single-line excerpt of the message text (full text lives in the ledger). */
  text_excerpt: string;
  text_hints: string[];
  buckets: WatchBucket[];
  attachments: ReviewAttachment[];
  recommended_action: string;
}

export interface WatchRunReport {
  watch_schema_version: typeof WATCH_SCHEMA_VERSION;
  channel: string;
  channel_key: string;
  developer_slug: string;
  developer_name: string;
  project_slug: string | null;
  project_name: string | null;
  run_at: string;
  snapshot: {
    sha256: string;
    byte_size: number;
    message_count: number;
    skipped_service_message_count: number;
    unsupported_message_ids: number[];
  };
  cursor: {
    previous_last_processed_message_id: number;
    new_last_processed_message_id: number;
  };
  counts: {
    new_messages: number;
    edited_messages: number;
    unchanged_messages: number;
    attachments_stored: number;
    attachments_duplicate_in_channel: number;
    attachments_duplicate_cross_channel: number;
    attachments_not_exported: number;
    attachments_missing_on_disk: number;
    attachments_oversized: number;
    attachments_size_mismatch: number;
    bucket_counts: Record<WatchBucket, number>;
  };
  /**
   * Ledger message ids inside this snapshot's id span that the snapshot no
   * longer contains — candidate deletions (or a narrower export range).
   * Reported for Owner awareness; the ledger never deletes history.
   */
  possibly_deleted_message_ids: number[];
  items: ReviewMessageItem[];
  warnings: string[];
  /** Owner-review boundary: the watcher prepared and recommended ONLY. */
  no_extraction_statement: string;
  no_import_statement: string;
  no_publication_statement: string;
}
