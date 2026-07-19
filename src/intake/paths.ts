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

import { existsSync, realpathSync, rmSync } from "node:fs";
import { basename, dirname, isAbsolute, parse, relative, resolve } from "node:path";

export class IntakePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntakePathError";
  }
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** Resolve existing ancestors through symlinks/junctions, including for a not-yet-created child. */
function boundaryPath(path: string): string {
  const absolute = resolve(path);
  let cursor = absolute;
  const missing: string[] = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    missing.unshift(basename(cursor));
    cursor = parent;
  }
  const realAncestor = existsSync(cursor) ? realpathSync.native(cursor) : cursor;
  return resolve(realAncestor, ...missing);
}

function pathKey(path: string): string {
  const canonical = boundaryPath(path);
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

/** True when `child` resolves strictly inside `parent` (never equal). */
export function isStrictlyInside(child: string, parent: string): boolean {
  const canonicalParent = boundaryPath(parent);
  const canonicalChild = boundaryPath(child);
  const rel = relative(canonicalParent, canonicalChild);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** True when two paths resolve to the same location. */
export function isSamePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
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
  const resolved = boundaryPath(p);
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

  if (!isStrictlyInside(projectDir, outRoot)) {
    throw new IntakePathError(`intake_project_dir_escapes_out_root: ${projectDir}`);
  }
  if (isFilesystemRoot(outRoot) || isFilesystemRoot(workspaceDir) || isFilesystemRoot(projectDir)) {
    throw new IntakePathError("intake_managed_dir_is_filesystem_root");
  }
  if (
    isSamePath(projectDir, workspaceDir) ||
    isStrictlyInside(projectDir, workspaceDir) ||
    isStrictlyInside(workspaceDir, projectDir)
  ) {
    throw new IntakePathError("intake_output_workspace_overlap");
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
  const lexicalTarget = resolve(target);
  const canonicalTarget = boundaryPath(target);
  if (isFilesystemRoot(canonicalTarget)) {
    throw new IntakePathError(`intake_refuse_remove_root: ${canonicalTarget}`);
  }
  for (const bad of forbidden) {
    if (isSamePath(canonicalTarget, bad)) {
      throw new IntakePathError(`intake_refuse_remove_protected: ${canonicalTarget}`);
    }
  }
  const contained = allowedParents.some((parent) => isStrictlyInside(canonicalTarget, parent));
  if (!contained) {
    throw new IntakePathError(`intake_refuse_remove_outside_managed_tree: ${canonicalTarget}`);
  }
  rmSync(lexicalTarget, { recursive: true, force: true });
}
