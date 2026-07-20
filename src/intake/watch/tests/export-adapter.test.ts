import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { flattenExportText, readChannelExport, WatchExportError } from "../export-adapter";

const RUN_1 = resolve("src/intake/watch/test-fixtures/export-run-1");
const POSIX = process.platform !== "win32";

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "watch-export-"));
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function writeExport(messages: unknown[], header: Record<string, unknown> = {}): string {
  const dir = join(base, `export-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "result.json"),
    JSON.stringify({
      name: "Synthetic",
      type: "public_channel",
      id: 42,
      messages,
      ...header,
    }),
    "utf8",
  );
  return dir;
}

const message = (id: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  type: "message",
  date: "2026-07-01T10:00:00",
  text: "hello",
  ...extra,
});

describe("readChannelExport", () => {
  it("normalizes the synthetic fixture export", () => {
    const snapshot = readChannelExport(RUN_1);
    expect(snapshot.channel_type).toBe("public_channel");
    expect(snapshot.channel_id).toBe(1000000001);
    expect(snapshot.posts.map((post) => post.message_id)).toEqual([101, 102, 104, 105, 106, 107]);
    expect(snapshot.excluded_messages).toEqual([
      { message_id: 103, kind: "service", raw_type: "service" },
    ]);
    expect(snapshot.snapshot_sha256).toMatch(/^[a-f0-9]{64}$/);

    const priceList = snapshot.posts[0];
    expect(priceList.attachments).toHaveLength(1);
    expect(priceList.attachments[0]).toMatchObject({
      kind: "file",
      original_filename: "Synthetic Price List 01.07.2026.pdf",
      mime_type: "application/pdf",
      presence: "present",
      declared_byte_size: 72,
    });

    const photo = snapshot.posts[1].attachments[0];
    expect(photo.kind).toBe("photo");
    expect(photo.original_filename).toBe("photo_1@01-07-2026_11-00-00.jpg");
    expect(photo.presence).toBe("present");

    const entityText = snapshot.posts[2];
    expect(entityText.text).toBe(
      "Промоакция июля: скидка на юниты. Подробности: https://example.invalid/promo",
    );

    const placeholder = snapshot.posts[5].attachments[0];
    expect(placeholder.presence).toBe("not_exported");
    expect(placeholder.absolute_path).toBeNull();
    expect(placeholder.original_filename).toBe("Big Brochure.pdf");
  });

  it("rejects non-channel exports and full-account exports", () => {
    const personal = writeExport([], { type: "personal_chat" });
    expect(() => readChannelExport(personal)).toThrow(/unsupported_chat_type/);

    const account = join(base, "account-export");
    mkdirSync(account);
    writeFileSync(join(account, "result.json"), JSON.stringify({ chats: { list: [] } }), "utf8");
    expect(() => readChannelExport(account)).toThrow(/not_single_chat/);
  });

  it("fails closed on missing or malformed result.json", () => {
    const empty = join(base, "empty");
    mkdirSync(empty);
    expect(() => readChannelExport(empty)).toThrow(/result_missing/);
    writeFileSync(join(empty, "result.json"), "{ nope", "utf8");
    expect(() => readChannelExport(empty)).toThrow(/not_json/);
  });

  it("rejects hostile media paths: traversal, absolute, drive letter, backslash", () => {
    for (const hostile of ["../evil.pdf", "/etc/passwd", "C:/evil.pdf", "files\\evil.pdf"]) {
      const dir = writeExport([message(1, { file: hostile, file_name: "evil.pdf" })]);
      expect(() => readChannelExport(dir)).toThrow(/media_path_unsafe/);
    }
  });

  it.runIf(POSIX)("fails closed on a symlinked media file, even one inside the export", () => {
    const dir = writeExport([message(1, { file: "files/link.pdf", file_name: "Link.pdf" })]);
    mkdirSync(join(dir, "files"));
    writeFileSync(join(dir, "files", "real.pdf"), "bytes", "utf8");
    symlinkSync(join(dir, "files", "real.pdf"), join(dir, "files", "link.pdf"));
    expect(() => readChannelExport(dir)).toThrow(/media_symlink/);
  });

  it.runIf(POSIX)("fails closed on a symlinked media path escaping the export root", () => {
    const outside = join(base, "outside.pdf");
    writeFileSync(outside, "outside bytes", "utf8");
    const dir = writeExport([message(1, { file: "files/escape.pdf", file_name: "Escape.pdf" })]);
    mkdirSync(join(dir, "files"));
    symlinkSync(outside, join(dir, "files", "escape.pdf"));
    // Real-path containment rejects it before the lstat symlink check runs.
    expect(() => readChannelExport(dir)).toThrow(/media_path_unsafe|media_symlink/);
  });

  it("fails closed when a media path names a directory", () => {
    const dir = writeExport([message(1, { file: "files", file_name: "Files.pdf" })]);
    mkdirSync(join(dir, "files"));
    expect(() => readChannelExport(dir)).toThrow(/media_not_regular_file/);
  });

  it("marks referenced-but-absent files as missing_on_disk instead of guessing", () => {
    const dir = writeExport([message(1, { file: "files/ghost.pdf", file_name: "Ghost.pdf" })]);
    const snapshot = readChannelExport(dir);
    expect(snapshot.posts[0].attachments[0].presence).toBe("missing_on_disk");
    expect(snapshot.posts[0].attachments[0].absolute_path).toBeNull();
  });

  it("rejects duplicate message ids (including across excluded events) and invalid ids/dates", () => {
    expect(() => readChannelExport(writeExport([message(7), message(7)]))).toThrow(
      /duplicate_message_id/,
    );
    expect(() =>
      readChannelExport(
        writeExport([message(7), { id: 7, type: "call", date: "2026-07-01T10:00:00" }]),
      ),
    ).toThrow(/duplicate_message_id/);
    expect(() => readChannelExport(writeExport([message(0)]))).toThrow(/message_id_invalid/);
    expect(() => readChannelExport(writeExport([{ id: 1, type: "message", text: "x" }]))).toThrow(
      /message_date_invalid/,
    );
  });

  it("records unknown message types as excluded events with a durable identity", () => {
    const dir = writeExport([message(1), { id: 2, type: "call", date: "2026-07-01T10:00:00" }]);
    const snapshot = readChannelExport(dir);
    expect(snapshot.posts.map((post) => post.message_id)).toEqual([1]);
    expect(snapshot.excluded_messages).toEqual([
      { message_id: 2, kind: "unsupported_type", raw_type: "call" },
    ]);
  });

  it("fails closed on an unknown message type without a usable id", () => {
    const dir = writeExport([message(1), { type: "call", date: "2026-07-01T10:00:00" }]);
    expect(() => readChannelExport(dir)).toThrow(/message_id_invalid/);
  });

  it("sorts posts ascending by message id", () => {
    const dir = writeExport([message(9), message(3), message(5)]);
    const snapshot = readChannelExport(dir);
    expect(snapshot.posts.map((post) => post.message_id)).toEqual([3, 5, 9]);
  });
});

describe("flattenExportText", () => {
  it("flattens strings, arrays, and entity objects", () => {
    expect(flattenExportText("plain", 1)).toBe("plain");
    expect(flattenExportText(["a ", { type: "bold", text: "b" }, " c"], 1)).toBe("a b c");
  });

  it("fails closed on unrecognized shapes", () => {
    expect(() => flattenExportText([{ type: "mystery" }], 1)).toThrow(WatchExportError);
    expect(() => flattenExportText(42, 1)).toThrow(WatchExportError);
  });
});
