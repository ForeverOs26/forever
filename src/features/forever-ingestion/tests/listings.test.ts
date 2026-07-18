/** Minimal resale listings — pure in-memory tests. */

import { describe, expect, it } from "vitest";

import { buildListingDraft, listingLinkPatch } from "../listings";
import type { DependencyReader } from "../dependency-resolution";

const emptyReader: DependencyReader = {
  findDevelopers: async () => [],
  findLocations: async () => [],
};

const noProjects = { findProjectBySlug: async () => null };

describe("resale listings", () => {
  it("creates a draft listing without a canonical project or location", async () => {
    const draft = await buildListingDraft(
      { reader: emptyReader, projects: noProjects },
      {
        title: "Sea-view 2BR at Coralina",
        projectNameRaw: "Coralina",
        locationNameRaw: "Kamala, Phuket",
        price: 6_900_000,
        photos: ["https://example.test/1.jpg"],
      },
    );
    expect(draft.row).toMatchObject({
      kind: "resale",
      title: "Sea-view 2BR at Coralina",
      project_id: null,
      project_name_raw: "Coralina",
      location_id: null,
      location_name_raw: "Kamala, Phuket",
      currency: null, // unknown currency stays NULL, never THB
      publication_status: "draft",
    });
    expect(draft.warnings.map((warning) => warning.code).sort()).toEqual([
      "listing_project_unresolved",
      "location_unresolved",
    ]);
  });

  it("requires only a title", async () => {
    const draft = await buildListingDraft(
      { reader: emptyReader, projects: noProjects },
      { title: "Villa near Nai Harn" },
    );
    expect(draft.row.title).toBe("Villa near Nai Harn");
    expect(draft.warnings).toEqual([]);
    await expect(
      buildListingDraft({ reader: emptyReader, projects: noProjects }, { title: "  " }),
    ).rejects.toThrow("listing_title_required");
  });

  it("links to a project found by exact slug, and later linking is a one-column patch", async () => {
    const draft = await buildListingDraft(
      {
        reader: emptyReader,
        projects: { findProjectBySlug: async (slug) => (slug === "coralina" ? { id: "p-1" } : null) },
      },
      { title: "2BR resale", projectNameRaw: "Coralina" },
    );
    expect(draft.row.project_id).toBe("p-1");
    expect(listingLinkPatch("p-2")).toEqual({ project_id: "p-2" });
  });
});
