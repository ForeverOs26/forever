import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertPathBoundaries,
  assertSafeSlug,
  IntakePathError,
  isFilesystemRoot,
  isStrictlyInside,
  removeManagedDir,
} from "../paths";

describe("Fast Intake path safety", () => {
  it("isStrictlyInside is strict (never equal)", () => {
    expect(isStrictlyInside("/a/b/c", "/a/b")).toBe(true);
    expect(isStrictlyInside("/a/b", "/a/b")).toBe(false);
    expect(isStrictlyInside("/a/b", "/a/b/c")).toBe(false);
    expect(isStrictlyInside("/a/x", "/a/b")).toBe(false);
  });

  it("isFilesystemRoot detects roots", () => {
    expect(isFilesystemRoot("/")).toBe(true);
    expect(isFilesystemRoot("/home/user")).toBe(false);
  });

  it("assertSafeSlug rejects traversal and separators", () => {
    expect(() => assertSafeSlug("ok-slug")).not.toThrow();
    expect(() => assertSafeSlug("../evil")).toThrow(IntakePathError);
    expect(() => assertSafeSlug("a/b")).toThrow(IntakePathError);
    expect(() => assertSafeSlug("a\\b")).toThrow(IntakePathError);
    expect(() => assertSafeSlug("UPPER")).toThrow(IntakePathError);
  });

  it("assertPathBoundaries rejects unsafe overlaps", () => {
    const boundaries = (over: Record<string, unknown>) =>
      assertPathBoundaries({
        outRoot: "/data/out",
        projectDir: "/data/out/slug",
        workspaceDir: "/data/ws/slug-1",
        sources: ["/inputs/dossier"],
        ...over,
      });
    expect(() => boundaries({})).not.toThrow();
    // workspace contains a source
    expect(() => boundaries({ sources: ["/data/ws/slug-1/inner"] })).toThrow(IntakePathError);
    // source contains the workspace
    expect(() => boundaries({ workspaceDir: "/inputs/dossier/ws" })).toThrow(IntakePathError);
    // source equals workspace
    expect(() => boundaries({ sources: ["/data/ws/slug-1"] })).toThrow(IntakePathError);
    // source / output overlap
    expect(() => boundaries({ sources: ["/data/out/slug/sub"] })).toThrow(IntakePathError);
  });
});

describe("Fast Intake removeManagedDir guards", () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "intake-rm-"));
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("removes a directory strictly inside a managed parent", () => {
    const target = join(base, "managed", "child");
    mkdirSync(target, { recursive: true });
    removeManagedDir(target, [join(base, "managed")]);
    expect(existsSync(target)).toBe(false);
  });

  it("refuses to remove a filesystem root", () => {
    expect(() => removeManagedDir("/", ["/"])).toThrow(IntakePathError);
  });

  it("refuses to remove a protected path", () => {
    const protectedDir = join(base, "keep");
    mkdirSync(protectedDir, { recursive: true });
    expect(() => removeManagedDir(protectedDir, [base], [protectedDir])).toThrow(IntakePathError);
    expect(existsSync(protectedDir)).toBe(true);
  });

  it("refuses to remove a path outside the managed tree", () => {
    const outside = join(base, "outside");
    mkdirSync(outside, { recursive: true });
    expect(() => removeManagedDir(outside, [join(base, "managed")])).toThrow(IntakePathError);
    expect(existsSync(outside)).toBe(true);
  });

  it("refuses to remove the managed parent itself (not strictly inside)", () => {
    const parent = join(base, "managed");
    mkdirSync(parent, { recursive: true });
    expect(() => removeManagedDir(parent, [parent])).toThrow(IntakePathError);
    expect(existsSync(parent)).toBe(true);
  });
});
