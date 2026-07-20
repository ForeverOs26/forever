import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { flattenExportText, readChannelExport, WatchExportError } from "../export-adapter";

const RUN_1 = resolve("src/intake/watch/test-fixtures/export-run-1");

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
    expect(snapshot.skipped_service_message_count).toBe(1);
    expect(snapshot.unsupported_message_ids).toEqual([]);
    expect(snapshot.snapshot_sha256).toMatch(/^[a-f0-9]{64}$/);

    const priceList = snapshot.posts[0];
    expect(priceList.attachments).toHaveLength(1);
    expect(priceList.attachments[0]).toMatchObject({
      kind: "file",
      original_filename: "Synthetic Price List 01.07.2026.pdf",
      mime_type: "application/pdf",
      presence: "present",
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

  it("marks referenced-but-absent files as missing_on_disk instead of guessing", () => {
    const dir = writeExport([message(1, { file: "files/ghost.pdf", file_name: "Ghost.pdf" })]);
    const snapshot = readChannelExport(dir);
    expect(snapshot.posts[0].attachments[0].presence).toBe("missing_on_disk");
    expect(snapshot.posts[0].attachments[0].absolute_path).toBeNull();
  });

  it("rejects duplicate message ids and invalid ids/dates", () => {
    expect(() => readChannelExport(writeExport([message(7), message(7)]))).toThrow(
      /duplicate_message_id/,
    );
    expect(() => readChannelExport(writeExport([message(0)]))).toThrow(/message_id_invalid/);
    expect(() => readChannelExport(writeExport([{ id: 1, type: "message", text: "x" }]))).toThrow(
      /message_date_invalid/,
    );
  });

  it("skips unknown message types without interpreting them", () => {
    const dir = writeExport([message(1), { id: 2, type: "call", date: "2026-07-01T10:00:00" }]);
    const snapshot = readChannelExport(dir);
    expect(snapshot.posts.map((post) => post.message_id)).toEqual([1]);
    expect(snapshot.unsupported_message_ids).toEqual([2]);
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
