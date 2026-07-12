/**
 * Forever Project Template — layout validation.
 *
 * Structural guards over a {@link ProjectLayout}: the root path template must be
 * present, every node must carry a path and a known node kind, node paths must be
 * unique across the whole tree, and every component a node places must be a known
 * component kind. All checks return issues; none throw and none touch disk.
 */

import { isKnownProjectComponentKind } from "../component";
import { flattenProjectLayout, type ProjectLayout, type ProjectLayoutNode } from "../layout";
import { isNonEmptyString } from "../helpers";
import { projectTemplateError } from "../types";
import type { ProjectTemplateIssue } from "../types";

const NODE_KINDS = new Set(["module", "directory"]);

function validateNode(node: ProjectLayoutNode, index: number): ProjectTemplateIssue[] {
  const issues: ProjectTemplateIssue[] = [];
  const base = `layout.nodes.${index}`;
  if (!isNonEmptyString(node.path)) {
    issues.push(
      projectTemplateError("missing_layout_path", "Layout node is missing a path", `${base}.path`),
    );
  }
  if (!NODE_KINDS.has(node.kind)) {
    issues.push(
      projectTemplateError(
        "unknown_layout_node_kind",
        `Layout node "${node.path}" has an unknown kind "${String(node.kind)}"`,
        `${base}.kind`,
      ),
    );
  }
  if (node.component !== undefined && !isKnownProjectComponentKind(node.component)) {
    issues.push(
      projectTemplateError(
        "unknown_layout_component",
        `Layout node "${node.path}" places an unknown component "${String(node.component)}"`,
        `${base}.component`,
      ),
    );
  }
  return issues;
}

/** Validate a whole layout: root, every node, and path uniqueness. */
export function validateProjectLayout(layout: ProjectLayout): ProjectTemplateIssue[] {
  const issues: ProjectTemplateIssue[] = [];
  if (layout === null || typeof layout !== "object") {
    issues.push(
      projectTemplateError("missing_layout", "Layout is missing or not an object", "layout"),
    );
    return issues;
  }
  if (!isNonEmptyString(layout.root)) {
    issues.push(
      projectTemplateError("missing_layout_root", "Layout is missing a root path", "layout.root"),
    );
  }

  const nodes = flattenProjectLayout(layout);
  const seen = new Set<string>();
  nodes.forEach((node, index) => {
    issues.push(...validateNode(node, index));
    if (isNonEmptyString(node.path)) {
      if (seen.has(node.path)) {
        issues.push(
          projectTemplateError(
            "duplicate_layout_path",
            `Layout path "${node.path}" appears more than once`,
            `layout.nodes.${index}.path`,
          ),
        );
      }
      seen.add(node.path);
    }
  });

  return issues;
}
