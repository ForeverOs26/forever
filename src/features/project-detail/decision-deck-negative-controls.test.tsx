import { render, screen, waitFor, within } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  makeMediaItem,
  makeProjectDetail,
  makeUnit,
} from "@/features/forever-database/tests/fixtures";

import { ProjectDetailEngine } from "./components/ProjectDetailEngine";
import { projectContactActionsEnabled } from "./contact-actions";
import { buildDecisionDeckModel } from "./decision-deck-model";
import { buildProjectStructuredData } from "./project-structured-data";
import { projectSocialImage } from "./project-sections";
import type { ProjectDetailDocument, ProjectDetailMediaItem } from "./project-detail-types";
import {
  applyUnitFilters,
  DEFAULT_UNIT_FILTERS,
  unitAvailabilityPresentation,
} from "./unit-presentation";

const PROJECT_URL = "https://forever.example/projects/negative-control";

async function renderInRouter(ui: ReactNode, heading: string) {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        {ui}
        <Outlet />
      </>
    ),
    notFoundComponent: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  const view = render(<RouterProvider router={router} />);
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: heading, level: 1 })).toBeInTheDocument(),
  );
  return view;
}

function makeDocument(
  overrides: Partial<ProjectDetailDocument> & Pick<ProjectDetailDocument, "id" | "url">,
): ProjectDetailDocument {
  return {
    ...makeMediaItem({
      id: overrides.id,
      type: "document",
      url: overrides.url,
    }),
    label: "Document",
    note: "",
    ...overrides,
  };
}

function structuredDataText(
  project: ReturnType<typeof makeProjectDetail>,
  image = projectSocialImage(project) ?? undefined,
): string {
  return JSON.stringify(buildProjectStructuredData(project, PROJECT_URL, image));
}

function navigationIds(project: ReturnType<typeof makeProjectDetail>): string[] {
  return buildDecisionDeckModel(project).navigation.map((section) => section.id);
}

describe("Decision Deck explicit negative controls", () => {
  it("negative control: an event hero and an unsafe JSON-LD reader are detectably wrong", () => {
    const eventUrl = "https://cdn.example.com/private-launch-event.jpg";
    const eventHero = makeMediaItem({
      id: "event-cover",
      type: "cover",
      title: "Launch event",
      url: eventUrl,
      semanticRole: "event",
    });
    const project = makeProjectDetail({
      media: {
        hero: eventHero,
        // A role-less sibling must not let the prohibited URL back in.
        gallery: [
          makeMediaItem({
            id: "event-sibling",
            type: "gallery",
            url: eventUrl,
            semanticRole: null,
          }),
        ],
      },
    });

    // Reconstruct the rejected mutation: raw hero first, with no semantic policy.
    const unsafeHero = project.media.hero?.url ?? project.media.gallery[0]?.url ?? null;
    expect(unsafeHero).toBe(eventUrl);

    const model = buildDecisionDeckModel(project);
    const safeHero = projectSocialImage(project);
    expect(safeHero).toBeNull();
    expect(model.media.photos).toEqual({
      state: "empty",
      reason: "no-safe-project-photographs",
    });
    expect(JSON.stringify(model)).not.toContain(eventUrl);

    // Reconstruct the rejected JSON-LD mutation directly. The production
    // builder now re-validates even a caller-supplied image, so both boundaries
    // refuse the event.
    const unsafeStructuredData = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      image: [unsafeHero],
    });
    expect(unsafeStructuredData).toContain(eventUrl);
    expect(structuredDataText(project, unsafeHero ?? undefined)).not.toContain(eventUrl);
    const safeStructuredData = buildProjectStructuredData(
      project,
      PROJECT_URL,
      safeHero ?? undefined,
    );
    expect(JSON.stringify(safeStructuredData)).not.toContain(eventUrl);
    for (const script of safeStructuredData) {
      expect(JSON.parse(script.children) as Record<string, unknown>).not.toHaveProperty("image");
    }
  });

  it("negative control: SOLD, unknown and promoted-order mutations disagree with inventory truth", async () => {
    const units = [
      makeUnit({ id: "available", code: "A-101", availabilityStatus: "Available" }),
      makeUnit({ id: "sold", code: "A-102", availabilityStatus: "SOLD" }),
      makeUnit({ id: "unknown", code: "A-103", availabilityStatus: "Launching soon" }),
    ];
    const project = makeProjectDetail({
      core: {
        name: "Inventory negative control",
        ownershipType: "PRIVATE-CORE-OWNERSHIP",
      },
      units: [units[0], { ...units[1], ownershipType: "PRIVATE-UNIT-OWNERSHIP" }, units[2]],
    });

    // Two deliberately loose predicates, one admitting SOLD and one admitting
    // unknown. Both produce the same false "2 available" answer.
    const unsafeSoldCount = units.filter(
      (unit) => unit.availabilityStatus.trim().toLowerCase() !== "launching soon",
    ).length;
    const unsafeUnknownCount = units.filter(
      (unit) => unit.availabilityStatus.trim().toLowerCase() !== "sold",
    ).length;
    expect(unsafeSoldCount).toBe(2);
    expect(unsafeUnknownCount).toBe(2);

    const model = buildDecisionDeckModel(project);
    expect(model.units.summary).toEqual({
      state: "supported",
      value: {
        listedCount: 3,
        availableCount: 1,
        listedLabel: "3 listed residences",
      },
    });
    expect(unitAvailabilityPresentation("SOLD").availableCountEligible).toBe(false);
    expect(unitAvailabilityPresentation("Launching soon").availableCountEligible).toBe(false);
    expect(applyUnitFilters(project.units, DEFAULT_UNIT_FILTERS).map((unit) => unit.code)).toEqual([
      "A-101",
    ]);
    expect(DEFAULT_UNIT_FILTERS.sort).toBe("listed-order");

    const { container } = await renderInRouter(
      <ProjectDetailEngine project={project} />,
      "Inventory negative control",
    );
    expect(
      screen.getByRole("heading", { name: "1 of 3 listed units available" }),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("unit-preview-card")).toHaveLength(1);

    const sort = screen.getByRole("combobox", { name: "Sort by" });
    const prohibitedOrderLabel = ["Recomm", "ended"].join("");
    expect(sort).toHaveValue("listed-order");
    expect(within(sort).getByRole("option", { name: "Listed order" })).toBeInTheDocument();
    expect(within(sort).queryByRole("option", { name: prohibitedOrderLabel })).toBeNull();

    // Both project- and unit-level ownership exist in the input, but neither is
    // an approved public claim.
    expect(model.decisionRail.ownership.state).toBe("withheld");
    expect(container).not.toHaveTextContent("PRIVATE-CORE-OWNERSHIP");
    expect(container).not.toHaveTextContent("PRIVATE-UNIT-OWNERSHIP");
    expect(structuredDataText(project)).not.toContain("PRIVATE-CORE-OWNERSHIP");
    expect(structuredDataText(project)).not.toContain("PRIVATE-UNIT-OWNERSHIP");
  });

  it("negative control: a truthy contact configuration cannot render an unverified action", async () => {
    const unsafeTruthyGate = (value: unknown) => Boolean(value);
    expect(unsafeTruthyGate("true")).toBe(true);

    for (const malformed of [undefined, null, false, true, 1, "true", "Enabled", "enabled "]) {
      expect(projectContactActionsEnabled(malformed), `${String(malformed)} must fail closed`).toBe(
        false,
      );
    }
    // This is a pure positive control; it does not change the build environment.
    expect(projectContactActionsEnabled("enabled")).toBe(true);

    await renderInRouter(
      <ProjectDetailEngine
        project={makeProjectDetail({
          core: { name: "Contact negative control" },
          units: [makeUnit()],
        })}
      />,
      "Contact negative control",
    );
    expect(
      screen.queryByRole("link", { name: /contact|enquir|request|viewing|whatsapp/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /contact|enquir|request|viewing|whatsapp/i }),
    ).toBeNull();
    expect(document.querySelector('[data-testid="project-mobile-cta"]')).toBeNull();
  });

  it("negative control: a conflicting developer cannot enter UI, navigation or JSON-LD", async () => {
    const canonicalName = "Canonical Developer Alpha";
    const rawName = "Conflicting Developer Beta";
    const project = makeProjectDetail({
      core: {
        name: "Developer negative control",
        developerNameRaw: rawName,
      },
      developer: {
        id: "developer",
        name: canonicalName,
        description: `${canonicalName} profile`,
        website: "https://developer.example",
        contactName: "",
        contactPhone: "",
        contactEmail: "",
        logoUrl: "",
      },
      media: {
        hero: makeMediaItem({
          id: "safe-cover",
          type: "cover",
          title: `${canonicalName} hero`,
          url: "https://cdn.example.com/project-exterior.jpg",
          semanticRole: "project_exterior",
        }),
      },
    });

    // Reconstruct the rejected mutation: trust the linked row without checking
    // the independent raw source name.
    const unsafeDeveloper = project.developer?.name;
    expect(unsafeDeveloper).toBe(canonicalName);

    const model = buildDecisionDeckModel(project);
    expect(model.developer).toEqual({
      state: "conflicting",
      reason: "developer-sources-disagree",
    });
    expect(model.navigation.map((section) => section.id)).not.toContain("developer");
    expect(JSON.stringify(model)).not.toContain(canonicalName);
    expect(JSON.stringify(model)).not.toContain(rawName);
    expect(structuredDataText(project)).not.toContain(canonicalName);
    expect(structuredDataText(project)).not.toContain(rawName);

    const { container } = await renderInRouter(
      <ProjectDetailEngine project={project} />,
      "Developer negative control",
    );
    expect(container).not.toHaveTextContent(canonicalName);
    expect(container).not.toHaveTextContent(rawName);
    expect(document.getElementById("developer")).toBeNull();
    expect(
      within(screen.getByRole("navigation", { name: "Project sections" })).queryByRole("link", {
        name: "Developer",
      }),
    ).toBeNull();
  });

  it("negative control: raw document count cannot create orphan navigation or expose a fake film", async () => {
    const prohibitedDocumentUrl = "https://cdn.example.com/private-event-document.pdf";
    const fakeVideoUrl = "https://video.example/watch?v=not-a-direct-film";
    const project = makeProjectDetail({
      core: { name: "Optional sections negative control" },
      amenities: [],
      media: {
        videos: [
          makeMediaItem({
            id: "fake-film",
            type: "video",
            title: "Private video title",
            url: fakeVideoUrl,
          }),
        ],
        documents: [
          makeDocument({
            id: "event-document",
            url: prohibitedDocumentUrl,
            semanticRole: "event",
          }),
        ],
      },
    });

    // Reconstruct both rejected mutations: raw presence drives navigation and
    // any recorded video URL is assumed playable.
    const unsafeNavigation = [
      ...(project.media.documents.length > 0 ? ["documents"] : []),
      ...(project.media.videos.length > 0 ? ["film"] : []),
    ];
    const unsafeFilm = project.media.videos[0]?.url;
    expect(unsafeNavigation).toEqual(["documents", "film"]);
    expect(unsafeFilm).toBe(fakeVideoUrl);

    const model = buildDecisionDeckModel(project);
    expect(model.documents.state).toBe("empty");
    expect(model.media.film.state).toBe("unavailable");
    expect(model.amenities.featured.state).toBe("empty");
    expect(model.amenities.all.state).toBe("empty");
    expect(navigationIds(project)).not.toContain("documents");
    expect(navigationIds(project)).not.toContain("film");
    expect(navigationIds(project)).not.toContain("featured-amenities");
    expect(navigationIds(project)).not.toContain("amenities");
    expect(JSON.stringify(model)).not.toContain(prohibitedDocumentUrl);
    expect(JSON.stringify(model)).not.toContain(fakeVideoUrl);

    await renderInRouter(
      <ProjectDetailEngine project={project} />,
      "Optional sections negative control",
    );
    const navigation = screen.getByRole("navigation", { name: "Project sections" });
    expect(within(navigation).queryByRole("link", { name: "Documents" })).toBeNull();
    expect(within(navigation).queryByRole("link", { name: "Project film" })).toBeNull();
    expect(within(navigation).queryByRole("link", { name: /amenities/i })).toBeNull();
    expect(screen.queryByTestId("project-documents")).toBeNull();
    expect(screen.queryByTestId("project-film")).toBeNull();
    expect(screen.queryByTestId("project-featured-amenities")).toBeNull();
    expect(screen.queryByTestId("project-amenities")).toBeNull();
    expect(document.body).not.toHaveTextContent(/this project has no amenities/i);
  });

  it("negative control: an empty media record cannot acquire a fabricated fallback hero", async () => {
    const fabricatedFallback = "https://stock.example.com/fabricated-project-hero.jpg";
    const project = makeProjectDetail({
      core: { name: "Fallback negative control" },
      media: {
        hero: null,
        gallery: [],
      },
    });

    const unsafeHero =
      project.media.hero?.url ?? project.media.gallery[0]?.url ?? fabricatedFallback;
    expect(unsafeHero).toBe(fabricatedFallback);

    const model = buildDecisionDeckModel(project);
    expect(projectSocialImage(project)).toBeNull();
    expect(model.media.photos.state).toBe("empty");
    expect(JSON.stringify(model)).not.toContain(fabricatedFallback);
    expect(structuredDataText(project)).not.toContain(fabricatedFallback);

    const { container } = await renderInRouter(
      <ProjectDetailEngine project={project} />,
      "Fallback negative control",
    );
    expect(screen.getByTestId("project-media-empty")).toHaveTextContent(
      "Official photography for this project is not recorded.",
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container).not.toHaveTextContent(fabricatedFallback);
  });

  it("negative control: raw media and developer records cannot leak private metadata", async () => {
    const sentinels = {
      mediaMetadata: "PRIVATE-MEDIA-METADATA",
      mediaTitle: "PRIVATE-MEDIA-TITLE",
      documentLabel: "PRIVATE-DOCUMENT-LABEL",
      documentNote: "PRIVATE-DOCUMENT-NOTE",
      contactName: "PRIVATE-CONTACT-NAME",
      contactPhone: "+66-PRIVATE-PHONE",
      contactEmail: "private-contact@example.invalid",
    };
    const photograph = {
      ...makeMediaItem({
        id: "public-photo",
        type: "cover",
        title: sentinels.mediaTitle,
        url: "https://cdn.example.com/public-project-photo.jpg",
        semanticRole: "project_exterior",
      }),
      metadata: { sourcePath: sentinels.mediaMetadata },
    } as ProjectDetailMediaItem;
    const project = makeProjectDetail({
      core: {
        name: "Metadata negative control",
        developerNameRaw: "Recorded Developer",
      },
      developer: {
        id: "developer",
        name: "Recorded Developer",
        description: "Public developer description",
        website: "https://developer.example",
        logoUrl: "",
        contactName: sentinels.contactName,
        contactPhone: sentinels.contactPhone,
        contactEmail: sentinels.contactEmail,
      },
      media: {
        hero: photograph,
        documents: [
          makeDocument({
            id: "public-document",
            url: "https://cdn.example.com/public-project-document.pdf",
            semanticRole: "text_promo",
            title: "PRIVATE-DOCUMENT-TITLE",
            label: sentinels.documentLabel,
            note: sentinels.documentNote,
          }),
        ],
      },
    });

    const unsafeProjection = JSON.stringify({
      photograph: project.media.hero,
      documents: project.media.documents,
      developer: project.developer,
    });
    for (const sentinel of Object.values(sentinels)) {
      expect(unsafeProjection).toContain(sentinel);
    }

    const model = buildDecisionDeckModel(project);
    const publicProjection = JSON.stringify({
      photos: model.media.photos,
      documents: model.documents,
      developer: model.developer,
    });
    for (const sentinel of Object.values(sentinels)) {
      expect(publicProjection).not.toContain(sentinel);
      expect(structuredDataText(project)).not.toContain(sentinel);
    }

    const { container } = await renderInRouter(
      <ProjectDetailEngine project={project} />,
      "Metadata negative control",
    );
    for (const sentinel of Object.values(sentinels)) {
      expect(container).not.toHaveTextContent(sentinel);
    }
    expect(screen.getByTestId("project-documents")).toHaveTextContent("Document");
    expect(screen.getByTestId("project-developer")).toHaveTextContent("Recorded Developer");
  });
});
