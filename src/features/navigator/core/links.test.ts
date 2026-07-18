import { describe, expect, it } from "vitest";

import { buildGuestLink, buildProjectPath, projectPathFor } from "./links";

describe("project links use the runtime record slug", () => {
  it("routes through the universal /projects/<slug> path, never /booth/projects", () => {
    expect(buildProjectPath("anything")).toBe("/projects/anything");
    expect(buildProjectPath("anything")).not.toContain("/booth/");
  });

  it("handles the Modeva slug duality by echoing the published record slug", () => {
    // The published projects-table slug — NOT the import-engine identity "modeva".
    const runtimeSlug = "the-modeva-bang-tao";
    expect(projectPathFor({ slug: runtimeSlug })).toBe("/projects/the-modeva-bang-tao");
    expect(buildGuestLink("https://forever.example", runtimeSlug)).toBe(
      "https://forever.example/projects/the-modeva-bang-tao",
    );
    // Guard: the helper never substitutes the import-engine slug.
    expect(buildProjectPath(runtimeSlug)).not.toContain("modeva/");
    expect(buildProjectPath("modeva")).toBe("/projects/modeva"); // echoes whatever it is given
  });

  it("normalises a trailing slash on the origin", () => {
    expect(buildGuestLink("https://forever.example/", "coralina")).toBe(
      "https://forever.example/projects/coralina",
    );
  });
});
