/**
 * Source packages read from anywhere on disk (Phase 4).
 *
 * These tests deliberately build packages in a temporary directory that is not
 * part of the repository and is not in Git, which is the whole point: a new
 * project needs no branch, no pull request and no committed payload.
 */

import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ProgressiveBatch } from "@/features/forever-ingestion/batch-types";
import { fingerprintBatch } from "@/features/forever-ingestion/build-batch";
import { syntheticJpeg } from "@/features/forever-studio/tests/media-truth-fixtures";

import { PAYLOAD_CANDIDATE_PATHS, readSourcePackage, SourcePackageError } from "../source-package";

const created: string[] = [];

afterEach(async () => {
  while (created.length) {
    await rm(created.pop()!, { recursive: true, force: true });
  }
});

async function tempPackage(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "forever-direct-pkg-"));
  created.push(dir);
  return dir;
}

function readyBatch(slug = "demo-project"): ProgressiveBatch {
  const body = {
    schema_version: "1" as const,
    mode: "create" as const,
    project: { slug, name: "Demo Project" },
    units: [{ unit_code: "A1" }],
  };
  return { ...body, batch_fingerprint: fingerprintBatch(body) } as ProgressiveBatch;
}

describe("readSourcePackage", () => {
  it("reads a payload plus media from an arbitrary folder outside Git", async () => {
    const dir = await tempPackage();
    await mkdir(join(dir, "progressive"), { recursive: true });
    await writeFile(join(dir, "progressive", "payload.json"), JSON.stringify(readyBatch()));
    await mkdir(join(dir, "photos"), { recursive: true });
    await writeFile(join(dir, "photos", "render.jpg"), syntheticJpeg(false, 1, 1));
    await writeFile(
      join(dir, "source-manifest.json"),
      JSON.stringify({ project_slug: "demo-project" }),
    );

    const pkg = await readSourcePackage(dir);

    expect(pkg.batch.project.slug).toBe("demo-project");
    expect(pkg.media.map((item) => item.path)).toEqual(["photos/render.jpg"]);
    expect(pkg.manifest).toEqual({ project_slug: "demo-project" });
    // The reference is the folder name, never an absolute local path.
    expect(pkg.ref).not.toContain(dir);
  });

  it("accepts a flat payload.json as well as the progressive/ layout", async () => {
    const dir = await tempPackage();
    await writeFile(join(dir, "payload.json"), JSON.stringify(readyBatch("flat-project")));
    const pkg = await readSourcePackage(dir);
    expect(pkg.batch.project.slug).toBe("flat-project");
    expect(PAYLOAD_CANDIDATE_PATHS.length).toBeGreaterThan(1);
  });

  it("never treats the payload or manifest as publishable media", async () => {
    const dir = await tempPackage();
    await mkdir(join(dir, "progressive"), { recursive: true });
    await writeFile(join(dir, "progressive", "payload.json"), JSON.stringify(readyBatch()));
    await writeFile(join(dir, "source-manifest.json"), JSON.stringify({}));
    const pkg = await readSourcePackage(dir);
    expect(pkg.media).toHaveLength(0);
  });

  it("reports a missing payload with a safe code", async () => {
    const dir = await tempPackage();
    await expect(readSourcePackage(dir)).rejects.toThrowError(SourcePackageError);
    await expect(readSourcePackage(dir)).rejects.toMatchObject({ code: "package_payload_missing" });
  });

  it("reports invalid JSON without leaking the file contents", async () => {
    const dir = await tempPackage();
    await writeFile(join(dir, "payload.json"), "{ not json");
    await expect(readSourcePackage(dir)).rejects.toMatchObject({ code: "package_payload_invalid" });
  });

  it("refuses a payload that is not a ready fingerprinted batch", async () => {
    const dir = await tempPackage();
    await writeFile(
      join(dir, "payload.json"),
      JSON.stringify({ schema_version: "1", mode: "create", project: { slug: "x" } }),
    );
    await expect(readSourcePackage(dir)).rejects.toMatchObject({
      code: "package_fingerprint_missing",
    });
  });

  it("refuses an unsupported schema version through the shared ingest boundary", async () => {
    const dir = await tempPackage();
    await writeFile(
      join(dir, "payload.json"),
      JSON.stringify({ schema_version: "2", mode: "create", project: { slug: "x" } }),
    );
    await expect(readSourcePackage(dir)).rejects.toThrowError(/schema_version_unsupported/);
  });

  it("reports a directory that does not exist", async () => {
    await expect(
      readSourcePackage(join(tmpdir(), "definitely-not-here-forever")),
    ).rejects.toMatchObject({ code: "package_not_found" });
  });
});
