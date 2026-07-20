import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runWatch } from "../run";
import type { ChannelLedger, WatchRunReport } from "../types";

const FIXTURES = resolve("src/intake/watch/test-fixtures");
const REGISTRY = join(FIXTURES, "test-registry.json");
const RUN_1 = join(FIXTURES, "export-run-1");
const POSIX = process.platform !== "win32";

const RUN_AT_1 = new Date("2026-07-10T12:00:00.000Z");
const RUN_AT_2 = new Date("2026-07-11T12:00:00.000Z");
const RUN_AT_3 = new Date("2026-07-12T12:00:00.000Z");

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "watch-integrity-"));
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

async function watch(outRoot: string, exportDir: string, runAt: Date, maxBytes?: number) {
  return runWatch({
    channel: "@synthetictitle",
    exportDir,
    registryPath: REGISTRY,
    outRoot,
    maxAttachmentBytes: maxBytes,
    runAt,
  });
}

/** Write a minimal single-channel export (id 1000000001 = @synthetictitle). */
function writeExport(messages: unknown[]): string {
  const dir = join(base, `export-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, "files"), { recursive: true });
  writeFileSync(
    join(dir, "result.json"),
    JSON.stringify({
      name: "Synthetic Title Channel",
      type: "public_channel",
      id: 1000000001,
      messages,
    }),
    "utf8",
  );
  return dir;
}

const textMessage = (id: number, text: string): Record<string, unknown> => ({
  id,
  type: "message",
  date: `2026-07-0${(id % 8) + 1}T10:00:00`,
  text,
});

const PRICE_PDF_SHA = createHash("sha256")
  .update(readFileSync(join(RUN_1, "files", "price-list-july.pdf")))
  .digest("hex");

describe("content-addressed object verification", () => {
  it("fails closed when an existing object was substituted with different bytes", async () => {
    const outRoot = join(base, "watch");
    await watch(outRoot, RUN_1, RUN_AT_1);
    const objectPath = join(outRoot, "channels", "synthetictitle", "media", `${PRICE_PDF_SHA}.pdf`);
    // Same length, different content — a filename is never proof of content.
    const original = readFileSync(objectPath);
    writeFileSync(objectPath, Buffer.from("X".repeat(original.length)));

    const result = await watch(outRoot, RUN_1, RUN_AT_2);
    expect(result.exitCode).toBe(5);
    expect(result.error).toContain("watch_store_object_integrity");
  });

  it("fails closed when an existing object was corrupted by truncation or growth", async () => {
    const outRoot = join(base, "watch");
    await watch(outRoot, RUN_1, RUN_AT_1);
    const objectPath = join(outRoot, "channels", "synthetictitle", "media", `${PRICE_PDF_SHA}.pdf`);
    writeFileSync(objectPath, Buffer.concat([readFileSync(objectPath), Buffer.from("JUNK")]));

    const result = await watch(outRoot, RUN_1, RUN_AT_2);
    expect(result.exitCode).toBe(5);
    expect(result.error).toContain("watch_store_object_integrity");
  });

  it("fails closed when the object slot is a directory", async () => {
    const outRoot = join(base, "watch");
    await watch(outRoot, RUN_1, RUN_AT_1);
    const objectPath = join(outRoot, "channels", "synthetictitle", "media", `${PRICE_PDF_SHA}.pdf`);
    rmSync(objectPath);
    mkdirSync(objectPath);

    const result = await watch(outRoot, RUN_1, RUN_AT_2);
    expect(result.exitCode).toBe(5);
    expect(result.error).toContain("not_regular_file");
  });

  it.runIf(POSIX)("fails closed when the object slot is a symlink", async () => {
    const outRoot = join(base, "watch");
    await watch(outRoot, RUN_1, RUN_AT_1);
    const objectPath = join(outRoot, "channels", "synthetictitle", "media", `${PRICE_PDF_SHA}.pdf`);
    const elsewhere = join(base, "elsewhere.pdf");
    writeFileSync(elsewhere, readFileSync(join(RUN_1, "files", "price-list-july.pdf")));
    rmSync(objectPath);
    symlinkSync(elsewhere, objectPath);

    const result = await watch(outRoot, RUN_1, RUN_AT_2);
    expect(result.exitCode).toBe(5);
    expect(result.error).toContain("symlink");
  });
});

describe("bounded attachment handling", () => {
  it("skips oversized attachments honestly and stores nothing partial", async () => {
    const outRoot = join(base, "watch");
    // 50-byte ceiling: the 29-byte photo fits; the 72/80-byte PDFs do not.
    const result = await watch(outRoot, RUN_1, RUN_AT_1, 50);
    expect(result.exitCode).toBe(0);
    const report = result.report as WatchRunReport;
    expect(report.counts.attachments_oversized).toBe(3);
    expect(report.counts.attachments_stored).toBe(1);
    expect(report.warnings.join(" ")).toContain("size limit");

    const mediaDir = join(outRoot, "channels", "synthetictitle", "media");
    const objects = readdirSync(mediaDir).filter((name) => !name.startsWith("."));
    expect(objects).toHaveLength(1);

    const ledger = readJson<ChannelLedger>(
      join(outRoot, "channels", "synthetictitle", "channel-ledger.json"),
    );
    const message101 = ledger.messages.find((message) => message.message_id === 101);
    const attachment = message101?.versions[0].attachments[0];
    expect(attachment?.presence).toBe("oversized");
    expect(attachment?.sha256).toBeNull();
    expect(attachment?.stored_object).toBeNull();
    expect(attachment?.byte_size).toBe(72);
  });

  it("quarantines previously oversized attachments once the Owner raises the limit", async () => {
    const outRoot = join(base, "watch");
    await watch(outRoot, RUN_1, RUN_AT_1, 50);
    const result = await watch(outRoot, RUN_1, RUN_AT_2);
    expect(result.exitCode).toBe(0);
    const report = result.report as WatchRunReport;
    // The three formerly-oversized attachments now hash and store; their
    // messages appear as edited versions (content-bearing state changed).
    expect(report.counts.edited_messages).toBe(3);
    expect(report.counts.attachments_oversized).toBe(0);

    const ledger = readJson<ChannelLedger>(
      join(outRoot, "channels", "synthetictitle", "channel-ledger.json"),
    );
    const message101 = ledger.messages.find((message) => message.message_id === 101);
    expect(message101?.versions).toHaveLength(2);
    expect(message101?.versions[0].attachments[0].presence).toBe("oversized");
    expect(message101?.versions[1].attachments[0].presence).toBe("present");
    expect(message101?.versions[1].attachments[0].sha256).toBe(PRICE_PDF_SHA);
  });

  it("reports a declared-size mismatch while hashing the actual bytes", async () => {
    const outRoot = join(base, "watch");
    const dir = writeExport([
      {
        ...textMessage(1, "Brochure attached"),
        file: "files/doc.pdf",
        file_name: "Doc Brochure.pdf",
        file_size: 999,
        mime_type: "application/pdf",
      },
    ]);
    writeFileSync(join(dir, "files", "doc.pdf"), "%PDF-1.4 tiny synthetic doc");

    const result = await watch(outRoot, dir, RUN_AT_1);
    expect(result.exitCode).toBe(0);
    const report = result.report as WatchRunReport;
    expect(report.counts.attachments_size_mismatch).toBe(1);
    expect(report.warnings.join(" ")).toContain("declared size");
    const attachment = report.items[0].attachments[0];
    expect(attachment.presence).toBe("present");
    expect(attachment.size_check).toBe("declared_mismatch");
    expect(attachment.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("cleans stale temp staging files from a crashed earlier run", async () => {
    const outRoot = join(base, "watch");
    const mediaDir = join(outRoot, "channels", "synthetictitle", "media");
    mkdirSync(mediaDir, { recursive: true });
    writeFileSync(join(mediaDir, ".tmp-crashed-run"), "partial bytes");

    const result = await watch(outRoot, RUN_1, RUN_AT_1);
    expect(result.exitCode).toBe(0);
    const leftovers = readdirSync(mediaDir).filter((name) => name.startsWith(".tmp-"));
    expect(leftovers).toEqual([]);
  });
});

describe("runtime-root policy", () => {
  it("rejects a runtime root inside the repository working tree, before creating anything", async () => {
    const insideRepo = resolve("forever-data", "watch-runtime-test");
    const result = await runWatch({
      channel: "@synthetictitle",
      exportDir: RUN_1,
      registryPath: REGISTRY,
      outRoot: insideRepo,
      runAt: RUN_AT_1,
    });
    expect(result.exitCode).toBe(5);
    expect(result.error).toContain("watch_out_root_inside_repository");
    expect(readdirSync(resolve("forever-data")).includes("watch-runtime-test")).toBe(false);
  });

  it("rejects a runtime root that contains the repository", async () => {
    const result = await runWatch({
      channel: "@synthetictitle",
      exportDir: RUN_1,
      registryPath: REGISTRY,
      outRoot: resolve(".."),
      runAt: RUN_AT_1,
    });
    expect(result.exitCode).toBe(5);
    expect(result.error).toContain("watch_out_root_contains_repository");
  });

  it.runIf(POSIX)("rejects a symlinked runtime root and a symlinked export directory", async () => {
    const realOut = join(base, "real-out");
    mkdirSync(realOut);
    const linkOut = join(base, "link-out");
    symlinkSync(realOut, linkOut);
    const viaLinkedRoot = await watch(linkOut, RUN_1, RUN_AT_1);
    expect(viaLinkedRoot.exitCode).toBe(5);
    expect(viaLinkedRoot.error).toContain("watch_out_root_symlink");

    const linkExport = join(base, "link-export");
    symlinkSync(RUN_1, linkExport);
    const viaLinkedExport = await watch(join(base, "watch"), linkExport, RUN_AT_1);
    expect(viaLinkedExport.exitCode).toBe(5);
    expect(viaLinkedExport.error).toContain("watch_export_dir_symlink");
  });

  it.runIf(POSIX)("rejects a managed directory replaced by a symlink", async () => {
    const outRoot = join(base, "watch");
    await watch(outRoot, RUN_1, RUN_AT_1);
    const mediaDir = join(outRoot, "channels", "synthetictitle", "media");
    const hijack = join(base, "hijack-target");
    mkdirSync(hijack);
    rmSync(mediaDir, { recursive: true, force: true });
    symlinkSync(hijack, mediaDir);

    const result = await watch(outRoot, RUN_1, RUN_AT_2);
    expect(result.exitCode).toBe(5);
    expect(result.error).toContain("watch_managed_dir_symlink");
  });
});

describe("cursor durability and deletion awareness", () => {
  it("advances the cursor only past durably recorded events, including excluded ones", async () => {
    const outRoot = join(base, "watch");
    const dir = writeExport([
      textMessage(5, "Ordinary post"),
      { id: 9, type: "future_kind", date: "2026-07-02T10:00:00" },
    ]);
    const result = await watch(outRoot, dir, RUN_AT_1);
    expect(result.exitCode).toBe(0);
    const report = result.report as WatchRunReport;
    expect(report.snapshot.unsupported_message_ids).toEqual([9]);
    expect(report.cursor.new_last_processed_message_id).toBe(9);

    const ledger = readJson<ChannelLedger>(
      join(outRoot, "channels", "synthetictitle", "channel-ledger.json"),
    );
    expect(ledger.excluded_messages).toEqual([
      {
        message_id: 9,
        kind: "unsupported_type",
        raw_type: "future_kind",
        first_recorded_at_run: RUN_AT_1.toISOString(),
      },
    ]);
  });

  it("surfaces previously recorded messages missing from the snapshot span as possibly deleted", async () => {
    const outRoot = join(base, "watch");
    const first = writeExport([
      textMessage(1, "one"),
      textMessage(2, "two"),
      textMessage(3, "three"),
    ]);
    await watch(outRoot, first, RUN_AT_1);

    const second = writeExport([
      textMessage(1, "one"),
      textMessage(3, "three"),
      textMessage(4, "four"),
    ]);
    const result = await watch(outRoot, second, RUN_AT_2);
    expect(result.exitCode).toBe(0);
    const report = result.report as WatchRunReport;
    expect(report.possibly_deleted_message_ids).toEqual([2]);
    expect(report.warnings.join(" ")).toContain("no longer present");

    // The ledger never deletes: message 2 keeps its full history.
    const ledger = readJson<ChannelLedger>(
      join(outRoot, "channels", "synthetictitle", "channel-ledger.json"),
    );
    expect(ledger.messages.map((message) => message.message_id)).toEqual([1, 2, 3, 4]);

    // A later narrower export around the gap keeps reporting honestly.
    const third = writeExport([textMessage(3, "three"), textMessage(4, "four")]);
    const again = await watch(outRoot, third, RUN_AT_3);
    expect(again.report?.possibly_deleted_message_ids).toEqual([]);
  });
});
