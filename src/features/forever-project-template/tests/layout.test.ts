import { describe, expect, it } from "vitest";

import {
  findProjectLayoutNode,
  flattenProjectLayout,
  foreverProjectLayout,
  projectLayout,
  projectLayoutComponents,
  projectLayoutNode,
  renderProjectLayoutRoot,
} from "..";

describe("project layout", () => {
  it("builds a node with only the fields supplied", () => {
    const bare = projectLayoutNode("sources", "directory");
    expect(bare).toEqual({ path: "sources", kind: "directory" });
    expect("component" in bare).toBe(false);

    const full = projectLayoutNode("sources", "directory", {
      component: "sources",
      children: [projectLayoutNode("sources/index.ts", "module")],
      description: "verified sources",
    });
    expect(full.component).toBe("sources");
    expect(full.children).toHaveLength(1);
  });

  it("flattens the tree depth-first in declared order", () => {
    const layout = projectLayout("root", [
      projectLayoutNode("a", "directory", { children: [projectLayoutNode("a/b", "module")] }),
      projectLayoutNode("c", "module"),
    ]);
    expect(flattenProjectLayout(layout).map((n) => n.path)).toEqual(["a", "a/b", "c"]);
  });

  it("collects distinct placed components and finds a node by path", () => {
    const layout = foreverProjectLayout();
    const components = projectLayoutComponents(layout);
    expect(components).toContain("identity");
    expect(new Set(components).size).toBe(components.length);
    expect(findProjectLayoutNode(layout, "identity.ts")?.component).toBe("identity");
    expect(findProjectLayoutNode(layout, "does/not/exist")).toBeUndefined();
  });

  it("renders the root for a concrete slug", () => {
    expect(renderProjectLayoutRoot(foreverProjectLayout(), "coralina")).toBe(
      "src/features/coralina-integration",
    );
  });

  it("tolerates a malformed node list without throwing", () => {
    const broken = { root: "r", nodes: null } as never;
    expect(() => flattenProjectLayout(broken)).not.toThrow();
    expect(flattenProjectLayout(broken)).toEqual([]);
  });
});
