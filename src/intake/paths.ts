/**
 * Fast Intake v1 — path-safety and destructive-operation guards.
 *
 * Every user-controlled path (project slug, source, --out-root, --workspace) is
 * validated so that:
 *  - the slug cannot escape the output root;
 *  - the workspace cannot equal or contain a source, and no source can live
 *    inside the workspace;
 *  - source and canonical output cannot overlap;
 *  - directory removal is confined to a managed parent and can never target a
 *    filesystem/drive root, the repository root, a source, the output root, or
 *    the workspace root itself.
 */

import { rmSync } from "node:fs";
import { isAbsolute, parse, relative, resolve } from "node:path";

export class IntakePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntakePathError";
  }
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** True when `child` resolves strictly inside `parent` (never equal). */
export function isStrictlyInside(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** True when two paths resolve to the same location. */
export function isSamePath(a: string, b: string): boolean {
  return resolve(a) === resolve(b);
}

/** A slug that is a single safe path segment; it can never escape the out-root. */
export function assertSafeSlug(slug: string): void {
  if (!SLUG_PATTERN.test(slug)) {
    throw new IntakePathError(`intake_slug_invalid: ${slug}`);
  }
  if (slug.includes("/") || slug.includes("\\") || slug.includes("..")) {
    throw new IntakePathError(`intake_slug_unsafe: ${slug}`);
  }
}

/** True when `p` resolves to a filesystem root or drive root (e.g. `/`, `C:\`). */
export function isFilesystemRoot(p: string): boolean {
  const resolved = resolve(p);
  return parse(resolved).root === resolved;
}

/**
 * Validate the relationships between the source roots, the output project
 * directory, and the extraction workspace. Fails closed (throws) on any unsafe
 * overlap so extraction and cleanup can never escape their approved trees.
 */
export function assertPathBoundaries(input: {
  outRoot: string;
  projectDir: string;
  workspaceDir: string;
  sources: string[];
}): void {
  const outRoot = resolve(input.outRoot);
  const projectDir = resolve(input.projectDir);
  const workspaceDir = resolve(input.workspaceDir);

  if (!isStrictlyInside(projectDir, outRoot) && projectDir !== outRoot) {
    throw new IntakePathError(`intake_project_dir_escapes_out_root: ${projectDir}`);
  }
  if (isFilesystemRoot(workspaceDir) || isFilesystemRoot(projectDir)) {
    throw new IntakePathError("intake_managed_dir_is_filesystem_root");
  }

  for (const source of input.sources) {
    const src = resolve(source);
    if (isSamePath(src, workspaceDir) || isStrictlyInside(workspaceDir, src)) {
      throw new IntakePathError(`intake_workspace_contains_or_equals_source: ${source}`);
    }
    if (isStrictlyInside(src, workspaceDir)) {
      throw new IntakePathError(`intake_source_inside_workspace: ${source}`);
    }
    if (
      isSamePath(src, projectDir) ||
      isStrictlyInside(src, projectDir) ||
      isStrictlyInside(projectDir, src)
    ) {
      throw new IntakePathError(`intake_source_output_overlap: ${source}`);
    }
  }
}

/**
 * Remove a directory tree ONLY when it resolves strictly inside one of the
 * allowed parents and is not itself a forbidden path. This is the single choke
 * point for destructive cleanup — an arbitrary resolved path is never removed.
 */
export function removeManagedDir(
  target: string,
  allowedParents: string[],
  forbidden: string[] = [],
): void {
  const resolved = resolve(target);
  if (isFilesystemRoot(resolved)) {
    throw new IntakePathError(`intake_refuse_remove_root: ${resolved}`);
  }
  for (const bad of forbidden) {
    if (isSamePath(resolved, bad)) {
      throw new IntakePathError(`intake_refuse_remove_protected: ${resolved}`);
    }
  }
  const contained = allowedParents.some((parent) => isStrictlyInside(resolved, parent));
  if (!contained) {
    throw new IntakePathError(`intake_refuse_remove_outside_managed_tree: ${resolved}`);
  }
  rmSync(resolved, { recursive: true, force: true });
}
