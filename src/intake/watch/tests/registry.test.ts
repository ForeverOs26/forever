import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  channelKey,
  loadChannelRegistry,
  parseChannelRegistry,
  resolveChannel,
  WatchRegistryError,
} from "../registry";

const FIXTURE_REGISTRY = resolve("src/intake/watch/test-fixtures/test-registry.json");

function validEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    channel: "@synthetictitle",
    developer_slug: "the-title",
    developer_name: "The Title",
    project_slug: "synthetic-project",
    project_name: "Synthetic Project",
    telegram_channel_id: 1000000001,
    status: "active",
    ...overrides,
  };
}

function registryWith(...entries: Array<Record<string, unknown>>): Record<string, unknown> {
  return { watch_schema_version: "1", channels: entries };
}

describe("channelKey", () => {
  it("derives a safe lowercase key and maps underscores to hyphens", () => {
    expect(channelKey("@coralinakamala")).toBe("coralinakamala");
    expect(channelKey("@The_Title_Phuket")).toBe("the-title-phuket");
  });

  it("rejects a malformed channel reference", () => {
    for (const bad of ["coralinakamala", "@abc", "@bad name", "@bad/../path", ""]) {
      expect(() => channelKey(bad)).toThrow(WatchRegistryError);
    }
  });
});

describe("parseChannelRegistry", () => {
  it("accepts the committed fixture registry", () => {
    const registry = loadChannelRegistry(FIXTURE_REGISTRY);
    expect(registry.channels).toHaveLength(3);
    expect(registry.channels[0].channel).toBe("@synthetictitle");
    expect(registry.channels[0].telegram_channel_id).toBe(1000000001);
    expect(registry.channels[1].project_slug).toBeNull();
  });

  it("rejects a wrong schema version and an empty channel list", () => {
    expect(() => parseChannelRegistry({ watch_schema_version: "2", channels: [] })).toThrow(
      WatchRegistryError,
    );
    expect(() => parseChannelRegistry(registryWith())).toThrow(WatchRegistryError);
  });

  it("rejects unknown properties at the root and in entries", () => {
    expect(() =>
      parseChannelRegistry({ watch_schema_version: "1", channels: [validEntry()], extra: 1 }),
    ).toThrow(/unknown_property/);
    expect(() =>
      parseChannelRegistry(registryWith(validEntry({ api_credentials: "anything" }))),
    ).toThrow(/unknown_property/);
  });

  it("rejects entries missing a required property", () => {
    const missing = validEntry();
    delete missing.telegram_channel_id;
    expect(() => parseChannelRegistry(registryWith(missing))).toThrow(/missing_property/);
  });

  it("accepts a null (unbound) channel id and rejects invalid or duplicate ids", () => {
    expect(
      parseChannelRegistry(registryWith(validEntry({ telegram_channel_id: null }))).channels[0]
        .telegram_channel_id,
    ).toBeNull();
    for (const bad of ["1000000001", 0, -5, 1.5]) {
      expect(() =>
        parseChannelRegistry(registryWith(validEntry({ telegram_channel_id: bad }))),
      ).toThrow(/telegram_channel_id_invalid/);
    }
    expect(() =>
      parseChannelRegistry(
        registryWith(
          validEntry(),
          validEntry({ channel: "@otherchannel", telegram_channel_id: 1000000001 }),
        ),
      ),
    ).toThrow(/duplicate_telegram_channel_id/);
  });

  it("rejects secret-shaped values anywhere in the committed registry", () => {
    const cases: Array<Record<string, unknown>> = [
      { notes: "bot token 12345678:AAHf3kZaVXQ9rTlWbY2cD4eF6gH8iJ0kLmN" },
      { notes: `sha ${"a".repeat(40)}` },
      { developer_name: "QWxhZGRpbjpvcGVuIHNlc2FtZUFsYWRkaW46b3BlbiBzZXNhbWU" },
      { notes: "call me at +66812345678" },
      { notes: "the api_hash goes here later" },
    ];
    for (const overrides of cases) {
      expect(() => parseChannelRegistry(registryWith(validEntry(overrides)))).toThrow(
        /secret_like_value/,
      );
    }
  });

  it("rejects duplicate channels case-insensitively", () => {
    expect(() =>
      parseChannelRegistry(
        registryWith(
          validEntry(),
          validEntry({ channel: "@SyntheticTitle", telegram_channel_id: 7 }),
        ),
      ),
    ).toThrow(/duplicate_channel/);
  });

  it("rejects channel-key collisions after underscore mapping", () => {
    expect(() =>
      parseChannelRegistry(
        registryWith(
          validEntry({ channel: "@the_title" }),
          validEntry({ channel: "@the-title", telegram_channel_id: 7 }),
        ),
      ),
    ).toThrow(WatchRegistryError);
  });

  it("rejects malformed slugs, statuses, and project names without slugs", () => {
    expect(() =>
      parseChannelRegistry(registryWith(validEntry({ developer_slug: "The Title" }))),
    ).toThrow(/developer_slug/);
    expect(() =>
      parseChannelRegistry(registryWith(validEntry({ project_slug: "../escape" }))),
    ).toThrow(/project_slug/);
    expect(() => parseChannelRegistry(registryWith(validEntry({ status: "live" })))).toThrow(
      /status/,
    );
    expect(() =>
      parseChannelRegistry(
        registryWith(validEntry({ project_slug: null, project_name: "Orphan Name" })),
      ),
    ).toThrow(/project_name_without_slug/);
  });
});

describe("resolveChannel", () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "watch-registry-"));
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("matches case-insensitively and refuses paused or unregistered channels", () => {
    const registry = loadChannelRegistry(FIXTURE_REGISTRY);
    expect(resolveChannel(registry, "@SyntheticTitle").channel).toBe("@synthetictitle");
    expect(() => resolveChannel(registry, "@pausedchannel")).toThrow(/watch_channel_paused/);
    expect(() => resolveChannel(registry, "@notregistered")).toThrow(/not_registered/);
  });

  it("fails closed on unreadable or non-JSON registry files", () => {
    expect(() => loadChannelRegistry(join(base, "missing.json"))).toThrow(/unreadable/);
    const bad = join(base, "bad.json");
    writeFileSync(bad, "not json", "utf8");
    expect(() => loadChannelRegistry(bad)).toThrow(/not_json/);
  });
});
