/**
 * Forever Project Template — the canonical package layout.
 *
 * A {@link ProjectLayout} describes the module structure a conforming project
 * package follows: which directories and modules it is organized into, and which
 * {@link ProjectComponentKind} lives in each. It is the generalization of the
 * concrete `coralina-integration/` folder tree — identity, data, sources,
 * adapters, integration, validation — lifted into a reusable map.
 *
 * The layout is a pure descriptor. It is *not* a filesystem: RC4.2 never reads a
 * directory, stats a file, or resolves a real path. `root` is a path *template*
 * (it contains `{slug}`) so a caller can render it for a project, but RC4.2 only
 * ever stores the string. The helpers walk the declared node tree, never disk.
 */

import type { ProjectComponentKind } from "./component";

/** Whether a layout node is a leaf module or a grouping directory. */
export type ProjectLayoutNodeKind = "module" | "directory";

/** One node in a package's module tree. */
export interface ProjectLayoutNode {
  /** Path relative to the package root, e.g. `sources` or `validation/references`. */
  path: string;
  kind: ProjectLayoutNodeKind;
  /** The component that lives at this node, when it is a component-bearing module. */
  component?: ProjectComponentKind;
  /** Nested nodes, when this node is a directory. */
  children?: ProjectLayoutNode[];
  /** Free-text description of the node's responsibility. */
  description?: string;
}

/** The canonical module structure of a package: a root path template and its nodes. */
export interface ProjectLayout {
  /** Path template for the package root; contains `{slug}`, e.g. `src/features/{slug}-integration`. */
  root: string;
  /** The ordered top-level nodes of the package. */
  nodes: ProjectLayoutNode[];
}

/** Options accepted by {@link projectLayoutNode}. */
export interface ProjectLayoutNodeOptions {
  component?: ProjectComponentKind;
  children?: ProjectLayoutNode[];
  description?: string;
}

/**
 * Build a {@link ProjectLayoutNode}; optional facts are attached only when
 * supplied so an absent fact stays absent (anti-fabrication).
 */
export function projectLayoutNode(
  path: string,
  kind: ProjectLayoutNodeKind,
  options: ProjectLayoutNodeOptions = {},
): ProjectLayoutNode {
  const node: ProjectLayoutNode = { path, kind };
  if (options.component !== undefined) node.component = options.component;
  if (options.children !== undefined) node.children = options.children;
  if (options.description !== undefined) node.description = options.description;
  return node;
}

/** Build a {@link ProjectLayout} from a root path template and its top-level nodes. */
export function projectLayout(root: string, nodes: ProjectLayoutNode[]): ProjectLayout {
  return { root, nodes };
}

/**
 * Every node of a layout, flattened depth-first in declared order.
 *
 * Pure and non-mutating: it reads the declared tree and returns a fresh list,
 * never touching disk and never mutating the input.
 */
export function flattenProjectLayout(layout: ProjectLayout): ProjectLayoutNode[] {
  const out: ProjectLayoutNode[] = [];
  const walk = (nodes: readonly ProjectLayoutNode[] | undefined): void => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      out.push(node);
      if (node.children !== undefined) walk(node.children);
    }
  };
  walk(layout.nodes);
  return out;
}

/** The distinct component kinds a layout places, in first-seen depth-first order. */
export function projectLayoutComponents(layout: ProjectLayout): ProjectComponentKind[] {
  const seen = new Set<ProjectComponentKind>();
  const components: ProjectComponentKind[] = [];
  for (const node of flattenProjectLayout(layout)) {
    if (node.component !== undefined && !seen.has(node.component)) {
      seen.add(node.component);
      components.push(node.component);
    }
  }
  return components;
}

/** The node at a given relative path, or `undefined`. Searches the whole tree. */
export function findProjectLayoutNode(
  layout: ProjectLayout,
  path: string,
): ProjectLayoutNode | undefined {
  return flattenProjectLayout(layout).find((node) => node.path === path);
}

/** Render a layout root for a concrete slug by substituting `{slug}`. */
export function renderProjectLayoutRoot(layout: ProjectLayout, slug: string): string {
  return layout.root.split("{slug}").join(slug);
}
