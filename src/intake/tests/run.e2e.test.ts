import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runIntake } from "../run";
import { makeZip } from "./zip-writer";

// Fail closed if any database client is ever constructed.
const databaseModuleLoaded = vi.hoisted(() => ({ value: false }));
vi.mock("@supabase/supabase-js", () => {
  databaseModuleLoaded.value = true;
  return {
    createClient: vi.fn(() => {
      throw new Error("no database client may be created during Fast Intake");
    }),
  };
});

const FIXTURE = resolve("src/intake/test-fixtures/sample-project");
const FIXED_NOW = new Date("2026-07-19T00:00:00.000Z");

let base: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "intake-e2e-"));
  databaseModuleLoaded.value = false;
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function copyFixture(name: string): string {
  const dest = join(base, name);
  cpSync(FIXTURE, dest, { recursive: true });
  return dest;
}

function zipFixture(name: string): string {
  const files = [
    ["facts/project-facts.json", 8],
    ["price-list/price-list.json", 8],
    ["brochure/brochure.txt", 0],
    ["images/render-1.jpg", 0],
    ["images/render-1-copy.jpg", 0],
    ["misc/notes.xyz", 0],
  ] as const;
  const zip = makeZip(
    files.map(([rel, method]) => ({
      name: rel,
      data: readFileSync(join(FIXTURE, rel)),
      method,
    })),
  );
  const zipPath = join(base, name);
  writeFileSync(zipPath, zip);
  return zipPath;
}

function run(options: Parameters<typeof runIntake>[0]) {
  return runIntake({
    outRoot: join(base, "out"),
    workspaceRoot: join(base, "ws"),
    now: FIXED_NOW,
    ...options,
  });
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("Fast Intake v1 end-to-end", () => {
  it("turns a directory source into a validated unpublished draft (manifest → payload → ValidateOnly)", async () => {
    const src = copyFixture("sample-project");
    const result = await run({
      projectSlug: "sample-project",
      projectName: "Sample Marina Project",
      sources: [src],
    });

    expect(result.status).toBe("PARTIAL_READY_WITH_WARNINGS");
    expect(result.exitCode).toBe(0);
    expect(result.wrotePayload).toBe(true);

    // All five canonical artifacts exist.
    for (const path of Object.values(result.artifacts)) expect(existsSync(path)).toBe(true);

    const payload = readJson(result.artifacts.payload) as Record<string, unknown>;
    expect(payload.schema_version).toBe("1");
    expect(payload.mode).toBe("create");
    expect((payload.project as Record<string, unknown>).publish).toBe(false);
    expect(result.summary.planned_graph_counts).toMatchObject({
      projects: 1,
      buildings: 2,
      units: 5,
      prices: 4,
      media: 0,
      batches: 1,
    });

    // ValidateOnly boundary succeeded and the fingerprint was verified.
    expect(result.summary.validation.ok).toBe(true);
    expect(result.summary.validation.fingerprint_verified).toBe(true);
    expect(result.summary.validation.marker).toContain("DRAFT_PAYLOAD_VALID|slug=sample-project");

    // Structured extraction fed the graph; unknown + duplicate + unsupported detected.
    expect(result.summary.extracted_fact_counts).toEqual({ buildings: 2, units: 5, prices: 4 });
    expect(result.summary.duplicate_count).toBe(1);
    expect(result.summary.unsupported_files).toEqual(["root-0/misc/notes.xyz"]);

    // Elapsed and target reported (measured, not faked).
    expect(typeof result.summary.elapsed_ms).toBe("number");
    expect(result.summary.target_seconds).toBe(900);
    expect(result.summary.target_met).toBe(true);

    // No database client, no network.
    expect(databaseModuleLoaded.value).toBe(false);
  });

  it("accepts a single ZIP source and extracts the same graph, then cleans the workspace", async () => {
    const zip = zipFixture("sample.zip");
    const result = await run({ projectSlug: "zipped", projectName: "Zipped", sources: [zip] });
    expect(result.status).toBe("PARTIAL_READY_WITH_WARNINGS");
    expect(result.summary.planned_graph_counts).toMatchObject({
      buildings: 2,
      units: 5,
      prices: 4,
    });
    // Temporary extraction workspace was cleaned on success.
    expect(readdirSync(join(base, "ws")).length).toBe(0);
  });

  it("accepts multiple sources (a directory and a ZIP) in one invocation", async () => {
    const dir = copyFixture("dir-source");
    const zip = zipFixture("second.zip");
    const result = await run({ projectSlug: "multi", projectName: "Multi", sources: [dir, zip] });
    expect(result.exitCode).toBe(0);
    // The two roots contribute duplicate structured artifacts; extraction picks one deterministically.
    const manifest = readJson(result.artifacts.source_manifest) as {
      source_roots: unknown[];
      files: unknown[];
    };
    expect(manifest.source_roots).toHaveLength(2);
  });

  it("handles source paths containing spaces", async () => {
    const spaced = copyFixture("Sample Marina Project");
    const result = await run({ projectSlug: "spaced", projectName: "Spaced", sources: [spaced] });
    expect(result.exitCode).toBe(0);
    expect(result.summary.source_file_count).toBe(6);
  });

  it("produces a deterministic, sorted, stable manifest and payload", async () => {
    const src = copyFixture("sample-project");
    const first = await run({ projectSlug: "det", projectName: "Det", sources: [src] });
    const manifest1 = readFileSync(first.artifacts.source_manifest, "utf8");
    const payload1 = readFileSync(first.artifacts.payload, "utf8");

    const second = await run({ projectSlug: "det", projectName: "Det", sources: [src] });
    const manifest2 = readFileSync(second.artifacts.source_manifest, "utf8");
    const payload2 = readFileSync(second.artifacts.payload, "utf8");

    expect(manifest2).toBe(manifest1);
    expect(payload2).toBe(payload1);

    const files = (
      readJson(first.artifacts.source_manifest) as { files: Array<{ logical_path: string }> }
    ).files;
    const paths = files.map((file) => file.logical_path);
    expect([...paths].sort()).toEqual(paths); // sorted by logical path
  });

  it("keeps the fingerprint independent of the absolute source location", async () => {
    const a = copyFixture("location-a");
    const b = copyFixture("location-b/nested/deeper");
    const ra = await run({ projectSlug: "fp", projectName: "FP", sources: [a] });
    const rb = await run({ projectSlug: "fp", projectName: "FP", sources: [b] });
    expect(rb.summary.validation.fingerprint).toBe(ra.summary.validation.fingerprint);
    // The written payload bytes are identical too.
    expect(readFileSync(rb.artifacts.payload, "utf8")).toBe(
      readFileSync(ra.artifacts.payload, "utf8"),
    );
  });

  it("never fabricates and requires no environment credentials or network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const saved = {
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_SERVICE_ROLE_KEY,
      anon: process.env.SUPABASE_ANON_KEY,
    };
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_ANON_KEY;
    try {
      const src = copyFixture("sample-project");
      const result = await run({ projectSlug: "safe", projectName: "Safe", sources: [src] });
      expect(result.exitCode).toBe(0);
      const payload = readJson(result.artifacts.payload) as { project: Record<string, unknown> };
      // Canonical dependency ids remain NULL — never auto-created.
      expect(payload.project.developer_id).toBeNull();
      expect(payload.project.location_id).toBeNull();
      expect(payload.project.publish).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(databaseModuleLoaded.value).toBe(false);
    } finally {
      if (saved.url !== undefined) process.env.SUPABASE_URL = saved.url;
      if (saved.key !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;
      if (saved.anon !== undefined) process.env.SUPABASE_ANON_KEY = saved.anon;
    }
  });

  it("fails closed and preserves a previously valid payload on a failed regeneration", async () => {
    const src = copyFixture("sample-project");
    const good = await run({ projectSlug: "keep", projectName: "Keep", sources: [src] });
    const goodPayload = readFileSync(good.artifacts.payload, "utf8");
    const goodSummary = readFileSync(good.artifacts.intake_summary, "utf8");

    // Second run points at a missing source: it must fail without touching payload.json.
    const bad = await run({
      projectSlug: "keep",
      projectName: "Keep",
      sources: [join(base, "does-not-exist")],
    });
    expect(bad.status).toBe("BLOCKED");
    expect(bad.exitCode).not.toBe(0);
    expect(bad.wrotePayload).toBe(false);
    // Prior valid payload and summary are unchanged; a separate failure record is written.
    expect(readFileSync(good.artifacts.payload, "utf8")).toBe(goodPayload);
    expect(readFileSync(good.artifacts.intake_summary, "utf8")).toBe(goodSummary);
    expect(existsSync(join(base, "out", "keep", "intake", "intake-failure.json"))).toBe(true);
  });

  it("cleans the extraction workspace after a failure", async () => {
    const zip = zipFixture("first.zip");
    const missing = join(base, "missing-dir");
    const result = await run({
      projectSlug: "cleanup",
      projectName: "Cleanup",
      sources: [zip, missing],
    });
    expect(result.status).toBe("BLOCKED");
    // Even though the ZIP root was extracted before the missing source threw,
    // the temporary workspace is removed in the finally path.
    const ws = join(base, "ws");
    if (existsSync(ws)) expect(readdirSync(ws).length).toBe(0);
  });

  it("BLOCKED on a first run writes a BLOCKED summary and no payload", async () => {
    const result = await run({
      projectSlug: "firstfail",
      projectName: "First Fail",
      sources: [join(base, "nope")],
    });
    expect(result.status).toBe("BLOCKED");
    expect(existsSync(result.artifacts.payload)).toBe(false);
    const summary = readJson(result.artifacts.intake_summary) as { status: string };
    expect(summary.status).toBe("BLOCKED");
  });

  it("writes deterministic intake_started_at from the injected clock", async () => {
    const src = copyFixture("sample-project");
    const result = await run({ projectSlug: "clock", projectName: "Clock", sources: [src] });
    const manifest = readJson(result.artifacts.source_manifest) as { intake_started_at: string };
    expect(manifest.intake_started_at).toBe(FIXED_NOW.toISOString());
    expect(statSync(result.artifacts.payload).isFile()).toBe(true);
  });
});
