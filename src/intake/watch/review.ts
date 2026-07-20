/**
 * TG-WATCH-001A — Owner-review output.
 *
 * Builds one deterministic run report (canonical JSON plus a human-readable
 * Markdown rendering) describing what the run found: new posts, edited posts,
 * quarantined attachments, duplicates, and review buckets — with RECOMMENDED
 * next actions only. The watcher never runs SIP extraction, Fast Intake,
 * import, or publication itself; every recommendation is a separately
 * authorized Owner command.
 *
 * Portability rule: no absolute Owner-machine path appears in any artifact.
 * Stored objects are referenced relative to the watch root.
 */

import type { MergedAttachment, MergedMessage } from "./store";
import {
  WATCH_BUCKETS,
  WATCH_SCHEMA_VERSION,
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
    const path = attachment?.stored_object
      ? objectPath(input.channelKey, attachment.stored_object)
      : null;
    const target = slug ? `--project ${slug}` : "--project <owner-assigns-project>";
    return path
      ? `Owner review: candidate canonical price table. If approved, run SIP extraction separately: npm run sip:price-list -- ${target} --pdf "<watch-root>/${path}" (path relative to the watch root).`
      : "Owner review: candidate canonical price table referenced, but its file was not exported; re-export this channel with files included.";
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
  if (input.attachments.length === 0) {
    return "Informational post archived. No action required.";
  }
  return "Unclassified attachment quarantined. Owner review required before any use.";
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
    bucket: attachment.bucket,
    bucket_from_text_hint: attachment.bucket_from_text_hint,
    duplicate_in_channel: attachment.duplicateInChannel,
    duplicate_of_channels: attachment.duplicateOfChannels,
  };
}

export function buildRunReport(input: {
  entry: ChannelRegistryEntry;
  channelKey: string;
  snapshot: ChannelSnapshot;
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
  if (input.snapshot.unsupported_message_ids.length > 0) {
    warnings.push(
      `${input.snapshot.unsupported_message_ids.length} message(s) had an unrecognized type and were skipped without interpretation: ids ${input.snapshot.unsupported_message_ids.join(", ")}.`,
    );
  }

  const maxSeen = input.snapshot.posts.reduce(
    (max, post) => Math.max(max, post.message_id),
    input.previousLastProcessedMessageId,
  );

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
      skipped_service_message_count: input.snapshot.skipped_service_message_count,
      unsupported_message_ids: input.snapshot.unsupported_message_ids,
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
      bucket_counts: bucketCounts,
    },
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
    `- Not exported: ${report.counts.attachments_not_exported} · Missing on disk: ${report.counts.attachments_missing_on_disk}`,
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
