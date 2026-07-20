import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  cpSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireProjectLock, releaseProjectLock } from "../../txn";
import { runStamp, runWatch } from "../run";
import type { ChannelLedger, ChannelState, ObjectIndex, WatchRunReport } from "../types";

const FIXTURES = resolve("src/intake/watch/test-fixtures");
const REGISTRY = join(FIXTURES, "test-registry.json");
const RUN_1 = join(FIXTURES, "export-run-1");
const RUN_2 = join(FIXTURES, "export-run-2");
const OTHER = join(FIXTURES, "export-other-channel");

const RUN_AT_1 = new Date("2026-07-10T12:00:00.000Z");
const RUN_AT_2 = new Date("2026-07-11T12:00:00.000Z");

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "watch-run-"));
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeRegistry(entries: Array<Record<string, unknown>>): string {
  const path = join(base, `registry-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, JSON.stringify({ watch_schema_version: "1", channels: entries }), "utf8");
  return path;
}

async function watch(
  outRoot: string,
  exportDir: string,
  channel: string,
  runAt: Date,
  registryPath = REGISTRY,
) {
  return runWatch({ channel, exportDir, registryPath, outRoot, runAt });
}

describe("runWatch end-to-end on the synthetic channel export", () => {
  it("quarantines, classifies, deduplicates, and reports the first run", async () => {
    const outRoot = join(base, "watch");
    const result = await watch(outRoot, RUN_1, "@synthetictitle", RUN_AT_1);
    expect(result.error).toBeNull();
    expect(result.exitCode).toBe(0);
    const report = result.report as WatchRunReport;

    expect(report.channel).toBe("@synthetictitle");
    expect(report.project_slug).toBe("synthetic-project");
    expect(report.counts.new_messages).toBe(6);
    expect(report.counts.edited_messages).toBe(0);
    expect(report.counts.unchanged_messages).toBe(0);
    // price list + photo + master plan stored; the repost is a byte-duplicate.
    expect(report.counts.attachments_stored).toBe(3);
    expect(report.counts.attachments_duplicate_in_channel).toBe(1);
    expect(report.counts.attachments_not_exported).toBe(1);
    expect(report.counts.attachments_oversized).toBe(0);
    expect(report.counts.attachments_size_mismatch).toBe(0);
    expect(report.counts.bucket_counts.price_table).toBe(2);
    expect(report.counts.bucket_counts.visual_master_plan).toBe(1);
    expect(report.counts.bucket_counts.construction_media).toBe(1);
    expect(report.counts.bucket_counts.document).toBe(1);
    expect(report.counts.bucket_counts.manual_review_required).toBe(0);
    expect(report.snapshot.skipped_service_message_count).toBe(1);
    expect(report.possibly_deleted_message_ids).toEqual([]);
    expect(report.cursor).toEqual({
      previous_last_processed_message_id: 0,
      new_last_processed_message_id: 107,
    });

    // The price-table item recommends a SEPARATE owner-run SIP command.
    const priceItem = report.items.find((item) => item.message_id === 101);
    expect(priceItem?.buckets).toContain("price_table");
    expect(priceItem?.recommended_action).toContain("sip:price-list");
    expect(priceItem?.recommended_action).toContain("--project synthetic-project");

    // Quarantine is content-addressed: exactly three objects on disk.
    const mediaDir = join(outRoot, "channels", "synthetictitle", "media");
    expect(readdirSync(mediaDir).filter((name) => !name.startsWith(".")).length).toBe(3);

    const state = readJson<ChannelState>(join(outRoot, "channels", "synthetictitle", "state.json"));
    expect(state.last_processed_message_id).toBe(107);
    expect(state.channel_id).toBe(1000000001);

    const ledger = readJson<ChannelLedger>(
      join(outRoot, "channels", "synthetictitle", "channel-ledger.json"),
    );
    expect(ledger.messages).toHaveLength(6);
    expect(ledger.messages.every((message) => message.versions.length === 1)).toBe(true);
    // The service message is durably recorded as an excluded event.
    expect(ledger.excluded_messages).toEqual([
      {
        message_id: 103,
        kind: "service",
        raw_type: "service",
        first_recorded_at_run: RUN_AT_1.toISOString(),
      },
    ]);

    const reportPath = join(
      outRoot,
      "channels",
      "synthetictitle",
      "review",
      `run-${runStamp(RUN_AT_1.toISOString())}.json`,
    );
    expect(existsSync(reportPath)).toBe(true);
    expect(existsSync(join(outRoot, "channels", "synthetictitle", "review", "LATEST.md"))).toBe(
      true,
    );
  });

  it("is idempotent: re-processing the same export reports zero changes and rewrites identical artifacts", async () => {
    const outRoot = join(base, "watch");
    await watch(outRoot, RUN_1, "@synthetictitle", RUN_AT_1);
    const ledgerPath = join(outRoot, "channels", "synthetictitle", "channel-ledger.json");
    const indexPath = join(outRoot, "object-index.json");
    const before = {
      ledger: readFileSync(ledgerPath, "utf8"),
      index: readFileSync(indexPath, "utf8"),
    };

    const again = await watch(outRoot, RUN_1, "@synthetictitle", RUN_AT_2);
    expect(again.exitCode).toBe(0);
    expect(again.report?.counts.new_messages).toBe(0);
    expect(again.report?.counts.edited_messages).toBe(0);
    expect(again.report?.counts.unchanged_messages).toBe(6);
    expect(again.report?.counts.attachments_stored).toBe(0);
    expect(readFileSync(ledgerPath, "utf8")).toBe(before.ledger);
    expect(readFileSync(indexPath, "utf8")).toBe(before.index);
  });

  it("detects edits as appended versions and new posts after the cursor", async () => {
    const outRoot = join(base, "watch");
    await watch(outRoot, RUN_1, "@synthetictitle", RUN_AT_1);
    const result = await watch(outRoot, RUN_2, "@synthetictitle", RUN_AT_2);
    expect(result.exitCode).toBe(0);
    const report = result.report as WatchRunReport;

    expect(report.counts.new_messages).toBe(1);
    expect(report.counts.edited_messages).toBe(1);
    expect(report.counts.unchanged_messages).toBe(5);
    expect(report.cursor).toEqual({
      previous_last_processed_message_id: 107,
      new_last_processed_message_id: 108,
    });
    const edited = report.items.find((item) => item.change === "edited");
    expect(edited?.message_id).toBe(101);
    expect(edited?.edited_at).toBe("2026-07-06T09:00:00");
    const added = report.items.find((item) => item.change === "new");
    expect(added?.message_id).toBe(108);

    // History preserved: message 101 keeps both versions, oldest first.
    const ledger = readJson<ChannelLedger>(
      join(outRoot, "channels", "synthetictitle", "channel-ledger.json"),
    );
    const message101 = ledger.messages.find((message) => message.message_id === 101);
    expect(message101?.versions).toHaveLength(2);
    expect(message101?.versions[0].text).toBe("Updated price list for July");
    expect(message101?.versions[1].text).toBe("Updated price list for July (v2, corrected)");
    expect(message101?.versions[0].recorded_at_run).toBe(RUN_AT_1.toISOString());
    expect(message101?.versions[1].recorded_at_run).toBe(RUN_AT_2.toISOString());

    // One genuinely new object (price-list v2) joined the quarantine.
    const mediaDir = join(outRoot, "channels", "synthetictitle", "media");
    expect(readdirSync(mediaDir).filter((name) => !name.startsWith(".")).length).toBe(4);
  });

  it("detects cross-channel byte duplicates through the shared object index", async () => {
    const outRoot = join(base, "watch");
    await watch(outRoot, RUN_1, "@synthetictitle", RUN_AT_1);
    const result = await watch(outRoot, OTHER, "@syntheticother", RUN_AT_2);
    expect(result.exitCode).toBe(0);
    const report = result.report as WatchRunReport;

    expect(report.project_slug).toBeNull();
    expect(report.counts.attachments_duplicate_cross_channel).toBe(1);
    const item = report.items[0];
    expect(item.attachments[0].duplicate_of_channels).toEqual(["@synthetictitle"]);

    const index = readJson<ObjectIndex>(join(outRoot, "object-index.json"));
    const sharedSha = item.attachments[0].sha256 as string;
    const sightings = index.objects[sharedSha].sightings;
    expect(new Set(sightings.map((sighting) => sighting.channel))).toEqual(
      new Set(["@synthetictitle", "@syntheticother"]),
    );
  });

  it("is deterministic and portable: two fresh runs produce byte-identical artifacts without absolute paths", async () => {
    const outA = join(base, "watch-a");
    const outB = join(base, "watch-b");
    await watch(outA, RUN_1, "@synthetictitle", RUN_AT_1);
    await watch(outB, RUN_1, "@synthetictitle", RUN_AT_1);

    const relative = [
      join("channels", "synthetictitle", "channel-ledger.json"),
      join("channels", "synthetictitle", "state.json"),
      join("channels", "synthetictitle", "review", `run-${runStamp(RUN_AT_1.toISOString())}.json`),
      join("channels", "synthetictitle", "review", "LATEST.md"),
      "object-index.json",
    ];
    for (const artifact of relative) {
      const a = readFileSync(join(outA, artifact), "utf8");
      const b = readFileSync(join(outB, artifact), "utf8");
      expect(a).toBe(b);
      // Portability: no Owner-machine absolute path may appear in any artifact.
      expect(a).not.toContain(outA);
      expect(a).not.toContain(outB);
      expect(a).not.toContain(tmpdir());
    }
  });
});

describe("channel-identity binding", () => {
  const unboundEntry = {
    channel: "@synthetictitle",
    developer_slug: "the-title",
    developer_name: "The Title",
    project_slug: "synthetic-project",
    project_name: "Synthetic Project",
    telegram_channel_id: null,
    status: "active",
  };

  it("fails closed on the first run of an unbound channel and reports the claimed identity", async () => {
    const outRoot = join(base, "watch");
    const registry = writeRegistry([unboundEntry]);
    const result = await watch(outRoot, RUN_1, "@synthetictitle", RUN_AT_1, registry);
    expect(result.exitCode).toBe(6);
    expect(result.error).toContain("watch_channel_unbound");
    expect(result.error).toContain("1000000001");
    expect(result.error).toContain("Synthetic Title Channel");
    // Nothing was ingested.
    expect(existsSync(join(outRoot, "channels", "synthetictitle", "channel-ledger.json"))).toBe(
      false,
    );
  });

  it("rejects an export whose channel id contradicts the registry binding", async () => {
    const outRoot = join(base, "watch");
    const result = await watch(outRoot, OTHER, "@synthetictitle", RUN_AT_1);
    expect(result.exitCode).toBe(6);
    expect(result.error).toContain("watch_channel_binding_mismatch");
    expect(existsSync(join(outRoot, "channels", "synthetictitle", "channel-ledger.json"))).toBe(
      false,
    );
  });

  it("pins channel identity in state: a silently re-bound registry still fails closed", async () => {
    const outRoot = join(base, "watch");
    const registryV1 = writeRegistry([{ ...unboundEntry, telegram_channel_id: 1000000001 }]);
    const first = await watch(outRoot, RUN_1, "@synthetictitle", RUN_AT_1, registryV1);
    expect(first.exitCode).toBe(0);

    // The registry is later edited to bind the SAME channel name to a
    // different numeric id; the export matches the new binding, but the
    // channel directory's recorded history does not.
    const registryV2 = writeRegistry([{ ...unboundEntry, telegram_channel_id: 1000000002 }]);
    const second = await watch(outRoot, OTHER, "@synthetictitle", RUN_AT_2, registryV2);
    expect(second.exitCode).toBe(5);
    expect(second.error).toContain("watch_channel_id_mismatch");

    // Nothing was merged: ledger still has only the six original messages.
    const ledger = readJson<ChannelLedger>(
      join(outRoot, "channels", "synthetictitle", "channel-ledger.json"),
    );
    expect(ledger.messages).toHaveLength(6);
  });
});

describe("runWatch fail-closed boundaries", () => {
  it("refuses paused and unregistered channels", async () => {
    const outRoot = join(base, "watch");
    const paused = await watch(outRoot, RUN_1, "@pausedchannel", RUN_AT_1);
    expect(paused.exitCode).toBe(2);
    expect(paused.error).toContain("watch_channel_paused");
    const unknown = await watch(outRoot, RUN_1, "@notregistered", RUN_AT_1);
    expect(unknown.exitCode).toBe(2);
  });

  it("refuses an export directory overlapping the watch root", async () => {
    const outRoot = join(base, "watch");
    const nestedExport = join(outRoot, "nested-export");
    mkdirSync(outRoot, { recursive: true });
    cpSync(RUN_1, nestedExport, { recursive: true });
    const result = await watch(outRoot, nestedExport, "@synthetictitle", RUN_AT_1);
    expect(result.exitCode).toBe(5);
    expect(result.error).toContain("watch_export_out_root_overlap");
  });

  it("refuses to run while another watcher holds the watch-root lock", async () => {
    const outRoot = join(base, "watch");
    mkdirSync(outRoot, { recursive: true });
    expect(acquireProjectLock(outRoot)).toBe(true);
    try {
      const result = await watch(outRoot, RUN_1, "@synthetictitle", RUN_AT_1);
      expect(result.exitCode).toBe(4);
      expect(result.error).toContain("watch_locked");
    } finally {
      releaseProjectLock(outRoot);
    }
  });

  it("reports a missing export directory as an export error", async () => {
    const outRoot = join(base, "watch");
    const result = await watch(outRoot, join(base, "no-such-export"), "@synthetictitle", RUN_AT_1);
    expect(result.exitCode).toBe(3);
    expect(result.error).toContain("watch_export_dir_missing");
  });

  it("rejects an invalid attachment size limit", async () => {
    const result = await runWatch({
      channel: "@synthetictitle",
      exportDir: RUN_1,
      registryPath: REGISTRY,
      outRoot: join(base, "watch"),
      maxAttachmentBytes: 0,
      runAt: RUN_AT_1,
    });
    expect(result.exitCode).toBe(5);
    expect(result.error).toContain("watch_max_attachment_bytes_invalid");
  });
});
