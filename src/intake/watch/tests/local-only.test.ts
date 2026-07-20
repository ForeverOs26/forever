import cp from "node:child_process";
import dns from "node:dns";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runWatch } from "../run";

// A database client may never be constructed by the watcher.
const databaseModuleLoaded = vi.hoisted(() => ({ value: false }));
vi.mock("@supabase/supabase-js", () => {
  databaseModuleLoaded.value = true;
  return {
    createClient: vi.fn(() => {
      throw new Error("no database client");
    }),
  };
});

const FIXTURES = resolve("src/intake/watch/test-fixtures");

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "watch-local-"));
  databaseModuleLoaded.value = false;
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("the Telegram watcher is strictly local and credential-free", () => {
  it("succeeds while every network, process, and credential path is stubbed to throw", async () => {
    const throwing = (label: string) =>
      vi.fn(() => {
        throw new Error(`forbidden: ${label}`);
      });

    const netSpies = [
      vi.spyOn(globalThis, "fetch").mockImplementation(throwing("fetch") as never),
      vi.spyOn(http, "request").mockImplementation(throwing("http.request") as never),
      vi.spyOn(http, "get").mockImplementation(throwing("http.get") as never),
      vi.spyOn(https, "request").mockImplementation(throwing("https.request") as never),
      vi.spyOn(https, "get").mockImplementation(throwing("https.get") as never),
      vi.spyOn(dns, "lookup").mockImplementation(throwing("dns.lookup") as never),
      vi.spyOn(dns.promises, "lookup").mockImplementation(throwing("dns.promises.lookup") as never),
    ];
    const procSpies = [
      vi.spyOn(cp, "spawn").mockImplementation(throwing("spawn") as never),
      vi.spyOn(cp, "spawnSync").mockImplementation(throwing("spawnSync") as never),
      vi.spyOn(cp, "exec").mockImplementation(throwing("exec") as never),
      vi.spyOn(cp, "execSync").mockImplementation(throwing("execSync") as never),
      vi.spyOn(cp, "execFile").mockImplementation(throwing("execFile") as never),
      vi.spyOn(cp, "execFileSync").mockImplementation(throwing("execFileSync") as never),
    ];

    const savedEnv: Record<string, string | undefined> = {};
    for (const key of [
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_ANON_KEY",
      "TELEGRAM_API_ID",
      "TELEGRAM_API_HASH",
      "TELEGRAM_SESSION",
    ]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }

    try {
      const result = await runWatch({
        channel: "@synthetictitle",
        exportDir: join(FIXTURES, "export-run-1"),
        registryPath: join(FIXTURES, "test-registry.json"),
        outRoot: join(base, "watch"),
        runAt: new Date("2026-07-10T12:00:00.000Z"),
      });

      expect(result.exitCode).toBe(0);
      expect(result.report?.counts.new_messages).toBe(6);
      expect(databaseModuleLoaded.value).toBe(false);
      for (const spy of [...netSpies, ...procSpies]) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value !== undefined) process.env[key] = value;
      }
    }
  });
});
