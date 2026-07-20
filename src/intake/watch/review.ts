/**
 * TG-WATCH-001A — Owner-review output.
 *
 * Builds one deterministic run report (canonical JSON plus a human-readable
 * Markdown rendering) describing what the run found: new posts, edited posts,
 * quarantined attachments, duplicates, oversized files, candidate deletions,
 * and review buckets — with RECOMMENDED next actions only. The watcher never
 * runs SIP extraction, Fast Intake, import, or publication itself; every
 * recommendation is a separately authorized Owner command.
 *
 * Portability rule: no absolute Owner-machine path appears in any artifact.
 * Stored objects are referenced relative to the watch root.
 */

import type { MergedAttachment, MergedMessage } from "./store";
import {
  WATCH_BUCKETS,
  WATCH_SCHEMA_VERSION,
  type ChannelLedger,
  type ChannelRegistryEntry,
  type ChannelSnapshot,
  type ReviewAttachment,
  type ReviewMessageItem,
  type WatchBucket,
  type WatchRunReport,
} from "./types";

export const NO_EXTRACTION_STATEMENT =
  "This run quarantined and classified sources for review only. No SIP extraction, Fast Intake run, or content interpretation was performed.";
export const NO_IMPORT_STATEMENT =
  "No database connection, database client, import, or lead creation occurred. Any import remains a separately authorized Owner action.";
export const NO_PUBLICATION_STATEMENT =
  "Nothing was published. Coralina remains unpublished; publication remains a separate Owner decision.";

const BUCKET_PRIORITY: readonly WatchBucket[] = [
  "price_table",
  "visual_master_plan",
  "document",
  "construction_media",
  "manual_review_required",
  "other",
];

/** Collapse whitespace and cut a single-line review excerpt. */
export function textExcerpt(text: string, maxLength = 200): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= maxLength ? collapsed : `${collapsed.slice(0, maxLength - 1)}…`;
}

function objectPath(channelKey: string, storedObject: string): string {
  return `channels/${channelKey}/media/${storedObject}`;
}

/** Deterministic recommendation for one reviewed message. Recommendation only. */
export function recommendedAction(input: {
  buckets: WatchBucket[];
  entry: ChannelRegistryEntry;
  channelKey: string;
  attachments: MergedAttachment[];
}): string {
  const primary = BUCKET_PRIORITY.find((bucket) => input.buckets.includes(bucket)) ?? null;
  const slug = input.entry.project_slug;
  const firstIn = (bucket: WatchBucket): MergedAttachment | undefined =>
    input.attachments.find(
      (attachment) => attachment.bucket === bucket && attachment.stored_object !== null,
    );
  if (primary === "price_table") {
    const attachment = firstIn("price_table");
    if (!attachment?.stored_object) {
      return "Owner review: candidate canonical price table referenced, but its bytes are not quarantined (not exported or oversized); re-export this channel with files included or adjust --max-attachment-mb.";
    }
    if (!attachment.stored_object.endsWith(".pdf")) {
      return "Owner review: candidate price table in a non-PDF format. SIP-001A extraction supports qualified text PDFs only; handle this source manually.";
    }
    const path = objectPath(input.channelKey, attachment.stored_object);
    const target = slug ? `--project ${slug}` : "--project <owner-assigns-project>";
    return `Owner review: candidate canonical price table. If approved, run SIP extraction separately: npm run sip:price-list -- ${target} --pdf "<watch-root>/${path}" (path relative to the watch root).`;
  }
  if (primary === "visual_master_plan") {
    return "Owner review: candidate visual Master Plan companion. If a reviewed price table exists for the same update, pair it via npm run sip:package (visual registration only; no spatial interpretation).";
  }
  if (primary === "document") {
    return slug
      ? `Archived for review. If relevant, the Owner may copy it into forever-data/projects/${slug}/source/ for a later Fast Intake run.`
      : "Archived for review. Owner assigns the destination project before any Fast Intake use.";
  }
  if (primary === "construction_media") {
    return "Construction media archived with provenance. No action required.";
  }
  if (primary === "manual_review_required") {
    return "Owner review required: media without a deterministic filename or caption signal. Classify manually before any use; the watcher does not guess content.";
  }
  if (input.attachments.length === 0) {
    return "Informational post archived. No action required.";
  }
  return "Unclassified attachment quarantined (archives stay unopened; extraction only via Fast Intake's hardened boundary after Owner review).";
}

function toReviewAttachment(channelKey: string, attachment: MergedAttachment): ReviewAttachment {
  return {
    original_filename: attachment.original_filename,
    sha256: attachment.sha256,
    byte_size: attachment.byte_size,
    stored_object: attachment.stored_object
      ? objectPath(channelKey, attachment.stored_object)
      : null,
    presence: attachment.presence,
    size_check: attachment.size_check,
    bucket: attachment.bucket,
    bucket_from_text_hint: attachment.bucket_from_text_hint,
    duplicate_in_channel: attachment.duplicateInChannel,
    duplicate_of_channels: attachment.duplicateOfChannels,
  };
}

/**
 * Ledger message ids inside the snapshot's contiguous id span that the
 * snapshot no longer contains. These are candidate deletions (or a narrower
 * export range) — surfaced for Owner awareness; the ledger keeps everything.
 */
export function possiblyDeletedMessageIds(
  ledger: ChannelLedger,
  snapshot: ChannelSnapshot,
): number[] {
  const snapshotIds = new Set<number>([
    ...snapshot.posts.map((post) => post.message_id),
    ...snapshot.excluded_messages.map((event) => event.message_id),
  ]);
  if (snapshotIds.size === 0) return [];
  let min = Number.MAX_SAFE_INTEGER;
  let max = 0;
  for (const id of snapshotIds) {
    if (id < min) min = id;
    if (id > max) max = id;
  }
  const known = [
    ...ledger.messages.map((message) => message.message_id),
    ...ledger.excluded_messages.map((event) => event.message_id),
  ];
  return known.filter((id) => id >= min && id <= max && !snapshotIds.has(id)).sort((a, b) => a - b);
}

export function buildRunReport(input: {
  entry: ChannelRegistryEntry;
  channelKey: string;
  snapshot: ChannelSnapshot;
  /** The post-merge ledger (used for candidate-deletion detection). */
  ledger: ChannelLedger;
  changes: MergedMessage[];
  unchangedCount: number;
  storedObjectCount: number;
  previousLastProcessedMessageId: number;
  runAt: string;
}): WatchRunReport {
  const bucketCounts = Object.fromEntries(WATCH_BUCKETS.map((bucket) => [bucket, 0])) as Record<
    WatchBucket,
    number
  >;
  let duplicateInChannel = 0;
  let duplicateCrossChannel = 0;
  let notExported = 0;
  let missingOnDisk = 0;
  let oversized = 0;
  let sizeMismatch = 0;

  const items: ReviewMessageItem[] = input.changes.map((change) => {
    const buckets: WatchBucket[] = [];
    for (const attachment of change.attachments) {
      if (attachment.bucket && !buckets.includes(attachment.bucket)) {
        buckets.push(attachment.bucket);
      }
      if (attachment.bucket) bucketCounts[attachment.bucket] += 1;
      if (attachment.duplicateInChannel) duplicateInChannel += 1;
      if (attachment.duplicateOfChannels.length > 0) duplicateCrossChannel += 1;
      if (attachment.presence === "not_exported") notExported += 1;
      if (attachment.presence === "missing_on_disk") missingOnDisk += 1;
      if (attachment.presence === "oversized") oversized += 1;
      if (attachment.size_check === "declared_mismatch") sizeMismatch += 1;
    }
    buckets.sort((a, b) => BUCKET_PRIORITY.indexOf(a) - BUCKET_PRIORITY.indexOf(b));
    return {
      message_id: change.message.message_id,
      change: change.change,
      posted_at: change.version.posted_at,
      edited_at: change.version.edited_at,
      text_excerpt: textExcerpt(change.version.text),
      text_hints: change.version.text_hints,
      buckets,
      attachments: change.attachments.map((attachment) =>
        toReviewAttachment(input.channelKey, attachment),
      ),
      recommended_action: recommendedAction({
        buckets,
        entry: input.entry,
        channelKey: input.channelKey,
        attachments: change.attachments,
      }),
    };
  });

  const serviceCount = input.snapshot.excluded_messages.filter(
    (event) => event.kind === "service",
  ).length;
  const unsupportedIds = input.snapshot.excluded_messages
    .filter((event) => event.kind === "unsupported_type")
    .map((event) => event.message_id);
  const possiblyDeleted = possiblyDeletedMessageIds(input.ledger, input.snapshot);

  const warnings: string[] = [];
  if (missingOnDisk > 0) {
    warnings.push(
      `${missingOnDisk} attachment(s) were referenced by the export but missing on disk; re-export with files included if they are needed.`,
    );
  }
  if (notExported > 0) {
    warnings.push(
      `${notExported} attachment(s) were not included in the export (export settings); their bytes are not quarantined yet.`,
    );
  }
  if (oversized > 0) {
    warnings.push(
      `${oversized} attachment(s) exceeded the configured size limit and were NOT quarantined; re-run with a larger --max-attachment-mb after Owner review.`,
    );
  }
  if (sizeMismatch > 0) {
    warnings.push(
      `${sizeMismatch} attachment(s) had a declared size that did not match their actual bytes; the actual bytes were hashed and stored, but treat the export metadata with care.`,
    );
  }
  if (unsupportedIds.length > 0) {
    warnings.push(
      `${unsupportedIds.length} message(s) had an unrecognized type and were recorded as excluded events without interpretation: ids ${unsupportedIds.join(", ")}.`,
    );
  }
  if (possiblyDeleted.length > 0) {
    warnings.push(
      `${possiblyDeleted.length} previously recorded message(s) inside this export's id range are no longer present (deleted on Telegram, or a narrower export): ids ${possiblyDeleted.join(", ")}. The ledger keeps their full history.`,
    );
  }

  // The cursor may advance only past durably recorded events: processed posts
  // (ledger versions) and excluded events (ledger excluded_messages).
  const maxSeen = [
    ...input.snapshot.posts.map((post) => post.message_id),
    ...input.snapshot.excluded_messages.map((event) => event.message_id),
  ].reduce((max, id) => Math.max(max, id), input.previousLastProcessedMessageId);

  const newMessages = items.filter((item) => item.change === "new").length;
  return {
    watch_schema_version: WATCH_SCHEMA_VERSION,
    channel: input.entry.channel,
    channel_key: input.channelKey,
    developer_slug: input.entry.developer_slug,
    developer_name: input.entry.developer_name,
    project_slug: input.entry.project_slug,
    project_name: input.entry.project_name,
    run_at: input.runAt,
    snapshot: {
      sha256: input.snapshot.snapshot_sha256,
      byte_size: input.snapshot.snapshot_byte_size,
      message_count: input.snapshot.posts.length,
      skipped_service_message_count: serviceCount,
      unsupported_message_ids: unsupportedIds,
    },
    cursor: {
      previous_last_processed_message_id: input.previousLastProcessedMessageId,
      new_last_processed_message_id: maxSeen,
    },
    counts: {
      new_messages: newMessages,
      edited_messages: items.length - newMessages,
      unchanged_messages: input.unchangedCount,
      attachments_stored: input.storedObjectCount,
      attachments_duplicate_in_channel: duplicateInChannel,
      attachments_duplicate_cross_channel: duplicateCrossChannel,
      attachments_not_exported: notExported,
      attachments_missing_on_disk: missingOnDisk,
      attachments_oversized: oversized,
      attachments_size_mismatch: sizeMismatch,
      bucket_counts: bucketCounts,
    },
    possibly_deleted_message_ids: possiblyDeleted,
    items,
    warnings,
    no_extraction_statement: NO_EXTRACTION_STATEMENT,
    no_import_statement: NO_IMPORT_STATEMENT,
    no_publication_statement: NO_PUBLICATION_STATEMENT,
  };
}

/** Render the run report as Owner-readable Markdown. Same data, no additions. */
export function renderRunReportMarkdown(report: WatchRunReport): string {
  const lines: string[] = [];
  lines.push(`# Telegram Watch Review — ${report.channel}`);
  lines.push("");
  lines.push(
    `Developer: ${report.developer_name} (${report.developer_slug}) · Project: ${
      report.project_name ? `${report.project_name} (${report.project_slug})` : "not assigned"
    }`,
  );
  lines.push(`Run: ${report.run_at} · Snapshot SHA-256: ${report.snapshot.sha256}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- New posts: ${report.counts.new_messages}`);
  lines.push(`- Edited posts: ${report.counts.edited_messages}`);
  lines.push(`- Unchanged posts seen: ${report.counts.unchanged_messages}`);
  lines.push(`- New files quarantined: ${report.counts.attachments_stored}`);
  lines.push(
    `- Duplicates — in channel: ${report.counts.attachments_duplicate_in_channel}, cross-channel: ${report.counts.attachments_duplicate_cross_channel}`,
  );
  lines.push(
    `- Not exported: ${report.counts.attachments_not_exported} · Missing on disk: ${report.counts.attachments_missing_on_disk} · Oversized: ${report.counts.attachments_oversized}`,
  );
  const buckets = Object.entries(report.counts.bucket_counts)
    .filter(([, count]) => count > 0)
    .map(([bucket, count]) => `${bucket}=${count}`)
    .join(", ");
  lines.push(`- Buckets: ${buckets || "(none)"}`);
  lines.push(
    `- Cursor: ${report.cursor.previous_last_processed_message_id} → ${report.cursor.new_last_processed_message_id}`,
  );
  lines.push("");
  if (report.warnings.length > 0) {
    lines.push("## Warnings");
    lines.push("");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
    lines.push("");
  }
  lines.push("## Items for review");
  lines.push("");
  if (report.items.length === 0) {
    lines.push("No new or edited posts in this run.");
  }
  for (const item of report.items) {
    lines.push(
      `### Message ${item.message_id} — ${item.change} (${item.posted_at}${item.edited_at ? `, edited ${item.edited_at}` : ""})`,
    );
    lines.push("");
    if (item.text_excerpt) lines.push(`> ${item.text_excerpt}`);
    if (item.text_hints.length > 0) lines.push(`Text hints: ${item.text_hints.join(", ")}`);
    for (const attachment of item.attachments) {
      const name = attachment.original_filename ?? "(no filename)";
      const details = [
        attachment.bucket ?? "unclassified",
        attachment.presence,
        attachment.sha256 ? `sha256 ${attachment.sha256.slice(0, 12)}…` : null,
        attachment.size_check === "declared_mismatch" ? "declared-size-mismatch" : null,
        attachment.duplicate_in_channel ? "duplicate-in-channel" : null,
        attachment.duplicate_of_channels.length > 0
          ? `also in ${attachment.duplicate_of_channels.join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ");
      lines.push(`- ${name} — ${details}`);
      if (attachment.stored_object) lines.push(`  - stored: ${attachment.stored_object}`);
    }
    lines.push("");
    lines.push(`Recommended: ${item.recommended_action}`);
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push(report.no_extraction_statement);
  lines.push("");
  lines.push(report.no_import_statement);
  lines.push("");
  lines.push(report.no_publication_statement);
  lines.push("");
  return lines.join("\n");
}
