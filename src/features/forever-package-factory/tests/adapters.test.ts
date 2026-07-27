/**
 * Source adapters: each one works alone, and a failing one never stops the
 * others. This is where "source-agnostic" is either true or it is not.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";

import { afterAll, describe, expect, it } from "vitest";

import {
  createByteBudget,
  DRIVE_PUBLIC_REF,
  effectiveDateFromFilename,
  isJunkFilename,
  parseDriveFolderHtml,
  revisionFromFilename,
  runAdapter,
} from "../adapters";
import { readZipEntries, ZipError } from "../adapters/zip";
import { resolveSources } from "../resolve";
import { SOURCE_SET_SCHEMA_VERSION } from "../source-set";

const roots: string[] = [];

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "factory-adapter-"));
  roots.push(root);
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Minimal ZIP writer, just enough to test the reader. */
function buildZip(entries: Array<{ path: string; content: string }>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.path, "utf8");
    const raw = Buffer.from(entry.content, "utf8");
    const deflated = deflateRawSync(raw);
    const crc = 0; // not validated by the reader
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, deflated);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(8, 10);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(deflated.length, 20);
    header.writeUInt32LE(raw.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, nameBytes);
    offset += local.length + nameBytes.length + deflated.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, end]);
}

describe("filename evidence", () => {
  it("reads the in-document effective date and revision from the filename", () => {
    expect(effectiveDateFromFilename("MOB - Price list V.2. - Updated 17.07.2026.pdf")).toBe(
      "2026-07-17",
    );
    expect(effectiveDateFromFilename("CLK - Price List V.2. - Updated 17.07.26.pdf")).toBe(
      "2026-07-17",
    );
    expect(revisionFromFilename("SIB - Price List V.1. - Updated 17.07.2026.pdf")).toBe("V1");
    expect(effectiveDateFromFilename("brochure.pdf")).toBeNull();
  });

  it("recognizes AppleDouble sidecars and other junk", () => {
    expect(isJunkFilename("._render.jpg")).toBe(true);
    expect(isJunkFilename("images/.DS_Store")).toBe(true);
    expect(isJunkFilename("images/render.jpg")).toBe(false);
  });
});

describe("local_folder adapter", () => {
  it("reads a folder, skipping junk", async () => {
    const root = scratch();
    mkdirSync(join(root, "images"));
    writeFileSync(join(root, "images", "render.jpg"), "jpeg-bytes");
    writeFileSync(join(root, "images", "._render.jpg"), "applesauce");
    writeFileSync(join(root, "Price List V.2. - Updated 17.07.26.pdf"), "%PDF-1.4 price");

    const output = await runAdapter(
      { type: "local_folder", location: root },
      { allowNetwork: false },
    );
    expect(output.artifacts.map((a) => a.ref).sort()).toEqual([
      "Price List V.2. - Updated 17.07.26.pdf",
      "render.jpg",
    ]);
    expect(output.skipped[0]).toEqual({ ref: "._render.jpg", reason: "junk_file" });
    const priceList = output.artifacts.find((a) => a.ref.startsWith("Price"))!;
    expect(priceList.effectiveDate).toBe("2026-07-17");
    expect(priceList.revision).toBe("V2");
  });

  it("reports an unreadable folder without throwing", async () => {
    const output = await runAdapter(
      { type: "local_folder", location: join(scratch(), "missing") },
      { allowNetwork: false },
    );
    expect(output.failures[0].code).toBe("source_unreadable");
    expect(output.artifacts).toHaveLength(0);
  });
});

describe("uploaded_archive adapter", () => {
  it("reads an archive with no folder, no Drive and no network", async () => {
    const root = scratch();
    const archive = join(root, "dossier.zip");
    writeFileSync(
      archive,
      buildZip([
        { path: "price-list/Price List V.1. - Updated 01.02.26.pdf", content: "%PDF-1.4" },
        { path: "images/._junk.jpg", content: "junk" },
      ]),
    );
    const output = await runAdapter(
      { type: "uploaded_archive", location: archive },
      { allowNetwork: false },
    );
    expect(output.artifacts).toHaveLength(1);
    expect(output.artifacts[0].logicalPath).toBe(
      "price-list/Price List V.1. - Updated 01.02.26.pdf",
    );
    expect(output.skipped[0].reason).toBe("junk_file");
  });

  it("refuses a traversal path rather than writing outside the package", () => {
    const entries = readZipEntries(
      buildZip([
        { path: "../escape.txt", content: "no" },
        { path: "ok.txt", content: "yes" },
      ]),
    );
    expect(entries.map((entry) => entry.path)).toEqual(["ok.txt"]);
  });

  it("reports a non-archive as a failure, not a crash", async () => {
    const root = scratch();
    const notZip = join(root, "not.zip");
    writeFileSync(notZip, "definitely not a zip");
    const output = await runAdapter(
      { type: "uploaded_archive", location: notZip },
      { allowNetwork: false },
    );
    expect(output.failures[0].code).toBe("archive_unreadable");
  });

  it("throws a typed error for an unreadable central directory", () => {
    expect(() => readZipEntries(Buffer.from("nope"))).toThrowError(ZipError);
  });
});

describe("telegram_channel adapter", () => {
  it("reads the lean local archive when it exists", async () => {
    const root = scratch();
    const messageDir = join(root, "downloads", "the-example", "42");
    mkdirSync(messageDir, { recursive: true });
    writeFileSync(join(messageDir, "EX - Price List V.3. - Updated 05.06.26.pdf"), "%PDF-1.4");

    const output = await runAdapter(
      { type: "telegram_channel", channel: "theexample", archive_root: root },
      { allowNetwork: false },
    );
    expect(output.artifacts).toHaveLength(1);
    expect(output.artifacts[0].effectiveDate).toBe("2026-06-05");
    // The reference records the channel username only — never an invite token.
    expect(output.references[0].ref).toBe("theexample");
  });

  it("degrades to a reference when no archive is present", async () => {
    const output = await runAdapter(
      { type: "telegram_channel", channel: "theexample", archive_root: join(scratch(), "nothing") },
      { allowNetwork: false },
    );
    expect(output.artifacts).toHaveLength(0);
    expect(output.failures[0].code).toBe("telegram_archive_absent");
    expect(output.references).toHaveLength(1);
  });

  it("never contacts the network", async () => {
    let called = false;
    await runAdapter(
      { type: "telegram_channel", channel: "theexample" },
      {
        allowNetwork: true,
        fetchImpl: (() => {
          called = true;
          throw new Error("no");
        }) as unknown as typeof fetch,
      },
    );
    expect(called).toBe(false);
  });
});

describe("google_drive_folder adapter", () => {
  it("stays inert unless the operator opts into network access", async () => {
    let called = false;
    const output = await runAdapter(
      { type: "google_drive_folder", folder_id: "abc123" },
      {
        allowNetwork: false,
        fetchImpl: (() => {
          called = true;
          throw new Error("no");
        }) as unknown as typeof fetch,
      },
    );
    expect(called).toBe(false);
    expect(output.failures[0].code).toBe("network_not_enabled");
    expect(output.references).toHaveLength(1);
  });

  it("never puts the folder id — an access token — in a public reference", async () => {
    const folderId = "1tO05YwRcNpBkuxjVNVwANtu55KUWBpE1";
    const output = await runAdapter(
      { type: "google_drive_folder", folder_id: folderId },
      { allowNetwork: false },
    );
    expect(output.references[0].ref).toBe(DRIVE_PUBLIC_REF);
    expect(output.references[0].ref).not.toContain(folderId.slice(0, 8));
    expect(output.failures[0].ref).not.toContain(folderId.slice(0, 8));
    // The id is still available privately, so the operator can act on it.
    expect(output.references[0].privateLocator).toBe(folderId);
  });

  it("parses a public folder listing", () => {
    const html =
      '<div class="flip-entry" id="entry-ID1" aria-label="Folder"><div class="flip-entry-title">002_Brochure</div></div>' +
      '<div class="flip-entry" id="entry-ID2" aria-label="PDF"><div class="flip-entry-title">Guide &amp; Facts.pdf</div></div>';
    expect(parseDriveFolderHtml(html)).toEqual([
      { id: "ID1", name: "002_Brochure", isFolder: true },
      { id: "ID2", name: "Guide & Facts.pdf", isFolder: false },
    ]);
  });

  it("never treats a Drive interstitial HTML page as project material", async () => {
    const fetchImpl = (async (url: string) => {
      if (String(url).includes("embeddedfolderview")) {
        return new Response(
          '<div class="flip-entry" id="entry-F1" aria-label="JPEG image"><div class="flip-entry-title">render.jpg</div></div>',
          { status: 200 },
        );
      }
      return new Response("<!DOCTYPE html><html>Google Drive quota</html>", { status: 200 });
    }) as unknown as typeof fetch;

    const output = await runAdapter(
      { type: "google_drive_folder", folder_id: "abc123" },
      { allowNetwork: true, fetchImpl },
    );
    expect(output.artifacts).toHaveLength(0);
    expect(output.skipped.some((item) => item.reason === "drive_interstitial")).toBe(true);
  });
});

describe("run byte budget", () => {
  it("skips artifacts past the ceiling with a stated reason instead of failing", async () => {
    const root = scratch();
    writeFileSync(join(root, "a-render.jpg"), Buffer.alloc(4096, 1));
    writeFileSync(join(root, "b-render.jpg"), Buffer.alloc(4096, 2));
    writeFileSync(join(root, "c-render.jpg"), Buffer.alloc(4096, 3));

    const budget = createByteBudget(9000); // room for two of the three
    const output = await runAdapter(
      { type: "local_folder", location: root },
      { allowNetwork: false, budget },
    );
    expect(output.artifacts).toHaveLength(2);
    expect(output.skipped).toContainEqual({ ref: "c-render.jpg", reason: "run_byte_budget" });
    expect(output.failures).toHaveLength(0);
  });

  it("shares one budget across every adapter in a run", async () => {
    const first = scratch();
    const second = scratch();
    writeFileSync(join(first, "a.jpg"), Buffer.alloc(4096, 1));
    writeFileSync(join(second, "b.jpg"), Buffer.alloc(4096, 2));

    const budget = createByteBudget(5000);
    const context = { allowNetwork: false, budget };
    const one = await runAdapter({ type: "local_folder", location: first }, context);
    const two = await runAdapter({ type: "local_folder", location: second }, context);
    expect(one.artifacts).toHaveLength(1);
    expect(two.artifacts).toHaveLength(0);
    expect(two.skipped[0].reason).toBe("run_byte_budget");
  });
});

describe("resolver", () => {
  it("collapses byte-identical reposts and keeps the first as canonical", async () => {
    const root = scratch();
    mkdirSync(join(root, "a"));
    mkdirSync(join(root, "b"));
    writeFileSync(join(root, "a", "price.pdf"), "%PDF identical");
    writeFileSync(join(root, "b", "price-repost.pdf"), "%PDF identical");

    const resolved = await resolveSources(
      {
        schema_version: SOURCE_SET_SCHEMA_VERSION,
        sources: [{ type: "local_folder", location: root }],
      },
      { allowNetwork: false },
    );
    expect(resolved.artifacts).toHaveLength(2);
    const reposts = resolved.artifacts.filter((artifact) => artifact.repostOf !== null);
    expect(reposts).toHaveLength(1);
    expect(reposts[0].repostOf).toBe("price.pdf");
  });

  it("keeps every adapter independent: one failing does not stop the others", async () => {
    const root = scratch();
    writeFileSync(join(root, "brochure.pdf"), "%PDF-1.4");
    const resolved = await resolveSources(
      {
        schema_version: SOURCE_SET_SCHEMA_VERSION,
        sources: [
          { type: "local_folder", location: join(root, "does-not-exist") },
          { type: "local_folder", location: root },
        ],
      },
      { allowNetwork: false },
    );
    expect(resolved.failures).toHaveLength(1);
    expect(resolved.artifacts.map((artifact) => artifact.ref)).toEqual(["brochure.pdf"]);
  });
});
