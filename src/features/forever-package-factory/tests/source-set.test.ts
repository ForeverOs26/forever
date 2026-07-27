/**
 * The Official Source Set contract.
 *
 * The rule under test throughout: no source type is mandatory, and Telegram in
 * particular is never required by the schema.
 */

import { describe, expect, it } from "vitest";

import {
  authorityOf,
  parseSourceSet,
  SOURCE_KINDS,
  SOURCE_SET_SCHEMA_VERSION,
  SourceSetError,
} from "../source-set";

function set(sources: unknown[], extra: Record<string, unknown> = {}) {
  return { schema_version: SOURCE_SET_SCHEMA_VERSION, sources, ...extra };
}

describe("forever-source-set.v1", () => {
  it("accepts a set containing ONLY a local folder", () => {
    const parsed = parseSourceSet(set([{ type: "local_folder", location: "C:\\project" }]));
    expect(parsed.sources).toHaveLength(1);
  });

  it("accepts a set containing ONLY an uploaded archive", () => {
    expect(
      parseSourceSet(set([{ type: "uploaded_archive", location: "C:\\dossier.zip" }])).sources,
    ).toHaveLength(1);
  });

  it("accepts a set containing ONLY one official document", () => {
    expect(
      parseSourceSet(set([{ type: "official_document", location: "C:\\price.pdf" }])).sources,
    ).toHaveLength(1);
  });

  it("accepts Drive with no Telegram, and Telegram with no Drive", () => {
    expect(
      parseSourceSet(set([{ type: "google_drive_folder", folder_id: "abc" }])).sources,
    ).toHaveLength(1);
    expect(
      parseSourceSet(set([{ type: "telegram_channel", channel: "example" }])).sources,
    ).toHaveLength(1);
  });

  it("never requires Telegram: every kind is independently sufficient", () => {
    const locator: Record<string, Record<string, string>> = {
      local_folder: { location: "C:\\x" },
      uploaded_archive: { location: "C:\\x.zip" },
      official_document: { location: "C:\\x.pdf" },
      google_drive_folder: { folder_id: "x" },
      telegram_channel: { channel: "x" },
      official_website: { url: "https://example.com" },
      existing_forever_record: { slug: "x" },
    };
    for (const kind of SOURCE_KINDS) {
      expect(parseSourceSet(set([{ type: kind, ...locator[kind] }])).sources).toHaveLength(1);
    }
  });

  it("requires at least one source", () => {
    expect(() => parseSourceSet(set([]))).toThrowError(
      expect.objectContaining({ code: "sources_missing" }),
    );
  });

  it("rejects an unknown source type rather than ignoring it", () => {
    expect(() => parseSourceSet(set([{ type: "carrier_pigeon", location: "x" }]))).toThrowError(
      expect.objectContaining({ code: "source_type_unsupported" }),
    );
  });

  it("rejects a typo'd key instead of silently dropping it", () => {
    expect(() =>
      parseSourceSet(set([{ type: "local_folder", locaton: "C:\\project" }])),
    ).toThrowError(expect.objectContaining({ code: "source_key_unknown" }));
  });

  it("requires the locator its kind needs", () => {
    expect(() => parseSourceSet(set([{ type: "google_drive_folder" }]))).toThrowError(
      expect.objectContaining({ code: "source_locator_missing" }),
    );
  });

  it("validates dates and keeps publication separate from effective", () => {
    expect(() =>
      parseSourceSet(
        set([{ type: "official_document", location: "x", effective_date: "17.07.26" }]),
      ),
    ).toThrowError(expect.objectContaining({ code: "source_date_invalid" }));

    const parsed = parseSourceSet(
      set([
        {
          type: "official_document",
          location: "x",
          published_at: "2026-07-20",
          effective_date: "2026-07-17",
        },
      ]),
    );
    expect(parsed.sources[0].published_at).toBe("2026-07-20");
    expect(parsed.sources[0].effective_date).toBe("2026-07-17");
  });

  it("rejects a wrong schema version", () => {
    expect(() =>
      parseSourceSet({ schema_version: "forever-source-set.v2", sources: [] }),
    ).toThrowError(SourceSetError);
  });

  it("defaults an authority per kind and honours an explicit one", () => {
    expect(authorityOf({ type: "telegram_channel", channel: "x" })).toBe(
      "developer_official_telegram",
    );
    expect(
      authorityOf({ type: "local_folder", location: "x", authority: "developer_official" }),
    ).toBe("developer_official");
  });

  it("validates the project hint's shape", () => {
    expect(() =>
      parseSourceSet(
        set([{ type: "local_folder", location: "x" }], {
          project_hint: { nam: "typo" },
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "project_hint_key_unknown" }));
    expect(() =>
      parseSourceSet(
        set([{ type: "local_folder", location: "x" }], {
          project_hint: { aliases: "not-an-array" },
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "project_hint_aliases_malformed" }));
  });
});
