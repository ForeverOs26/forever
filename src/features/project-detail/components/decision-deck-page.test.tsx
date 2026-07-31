import { render, screen, waitFor, within } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  makeAmenity,
  makeMediaItem,
  makeProjectDetail,
  makeUnit,
} from "@/features/forever-database/tests/fixtures";

import { publicProjectDetail } from "../public-project-detail";
import type { ProjectDetail } from "../project-detail-types";
import { ProjectDetailEngine as PublicProjectDetailEngine } from "./ProjectDetailEngine";

function ProjectDetailEngine({ project }: { project: ProjectDetail }) {
  return <PublicProjectDetailEngine project={publicProjectDetail(project)} />;
}

async function renderInRouter(ui: ReactNode, settle: string) {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        {ui}
        <Outlet />
      </>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const view = render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getAllByText(new RegExp(settle)).length).toBeGreaterThan(0));
  return view;
}

function decisionDeckProject() {
  return makeProjectDetail({
    core: {
      slug: "decision-deck",
      name: "Decision Deck",
      description: "A recorded project description.",
      constructionStatus: "Under construction",
      ownershipType: "Freehold",
      developerNameRaw: "Recorded Developer",
    },
    pricing: {
      startingPriceTHB: 7_500_000,
      displayPrice: "From ฿7.5M",
      lastPriceUpdate: "2026-07-28",
    },
    developer: {
      id: "dev-1",
      name: "Recorded Developer",
      description: "Recorded developer description.",
      website: "https://developer.example",
      contactName: "",
      contactPhone: "",
      contactEmail: "",
      logoUrl: "",
    },
    amenities: [
      ...Array.from({ length: 10 }, (_unused, index) =>
        makeAmenity({
          id: `featured-${index}`,
          name: `Featured ${index}`,
          slug: `featured-${index}`,
          isFeatured: true,
          sortOrder: index,
        }),
      ),
      makeAmenity({
        id: "ordinary",
        name: "Ordinary amenity",
        slug: "ordinary",
        isFeatured: false,
        sortOrder: 50,
      }),
    ],
    units: [
      makeUnit({ id: "available", code: "A-101", availabilityStatus: "Available" }),
      makeUnit({ id: "selling", code: "A-102", availabilityStatus: "Selling" }),
      makeUnit({ id: "sold", code: "A-103", availabilityStatus: "SOLD" }),
      makeUnit({ id: "unknown", code: "A-104", availabilityStatus: "mystery" }),
    ],
    media: {
      hero: makeMediaItem({
        id: "cover",
        type: "cover",
        url: "https://cdn.example.com/cover.jpg",
      }),
      gallery: [
        makeMediaItem({
          id: "gallery",
          type: "gallery",
          url: "https://cdn.example.com/gallery.jpg",
        }),
      ],
      videos: [
        makeMediaItem({
          id: "film",
          type: "video",
          url: "https://cdn.example.com/project.webm",
        }),
      ],
      masterPlan: makeMediaItem({
        id: "master",
        type: "master_plan",
        url: "https://cdn.example.com/master.jpg",
      }),
      floorPlans: [
        makeMediaItem({
          id: "floor",
          type: "floor_plan",
          url: "https://cdn.example.com/floor.jpg",
        }),
      ],
      unitPlans: [
        makeMediaItem({
          id: "unit-plan",
          type: "unit_plan",
          url: "https://cdn.example.com/unit-plan.jpg",
        }),
      ],
      brochures: [],
      documents: [
        {
          ...makeMediaItem({
            id: "document",
            type: "document",
            url: "https://cdn.example.com/project.pdf",
          }),
          label: "Private-looking source title",
          note: "source_file_url=C:\\private\\owner.pdf",
        },
      ],
    },
  });
}

describe("Forever Decision Deck page contract", () => {
  it("keeps legacy Project Detail engines outside the production composition boundary", () => {
    const engine = readFileSync(
      join(
        process.cwd(),
        "src",
        "features",
        "project-detail",
        "components",
        "ProjectDetailEngine.tsx",
      ),
      "utf8",
    );
    const retiredImports = [
      "ForeverIntelligenceSection",
      "ForeverPassportCard",
      "ProjectContact",
      "ProjectDeveloper",
      "ProjectInventory",
      "ProjectMobileCTA",
      "ProjectSummaryPanel",
    ];

    for (const retiredImport of retiredImports) {
      expect(engine, `${retiredImport} must remain outside ProjectDetailEngine`).not.toContain(
        `from "./${retiredImport}"`,
      );
    }
  });

  it("renders the approved body sections in canonical order", async () => {
    await renderInRouter(<ProjectDetailEngine project={decisionDeckProject()} />, "Decision Deck");

    const ids = [...document.querySelectorAll<HTMLElement>("[data-decision-deck-section]")].map(
      (section) => section.id,
    );
    expect(ids).toEqual([
      "overview",
      "featured-amenities",
      "units",
      "film",
      "plans",
      "amenities",
      "location",
      "developer",
      "updates",
      "documents",
    ]);
  });

  it("keeps the Decision Rail early, inline-capable, and free of conversion actions", async () => {
    await renderInRouter(<ProjectDetailEngine project={decisionDeckProject()} />, "Decision Deck");

    const rail = screen.getByTestId("decision-rail");
    expect(rail).toHaveAttribute("data-desktop-behavior", "sticky");
    expect(rail).toHaveAttribute("data-mobile-behavior", "inline");
    expect(within(rail).getByText("2 of 4 listed units available")).toBeInTheDocument();
    expect(
      within(rail).queryByRole("link", { name: /contact|enquir|whatsapp|request/i }),
    ).toBeNull();
    expect(
      within(rail).queryByRole("button", { name: /contact|enquir|whatsapp|request/i }),
    ).toBeNull();
  });

  it("keeps the compact Passport and hides an unsupported detailed Passport", async () => {
    await renderInRouter(<ProjectDetailEngine project={decisionDeckProject()} />, "Decision Deck");

    const compact = screen.getByTestId("compact-passport");
    expect(compact).toHaveTextContent("FOREVER-DECISION-DECK");
    expect(screen.queryByTestId("full-passport")).toBeNull();
    expect(compact).not.toHaveTextContent(/(?:^|\s)0(?:\s|$)/);
  });

  it("caps featured amenities at eight while retaining all canonical amenities later", async () => {
    await renderInRouter(<ProjectDetailEngine project={decisionDeckProject()} />, "Decision Deck");

    expect(within(screen.getByTestId("featured-amenities")).getAllByRole("listitem")).toHaveLength(
      8,
    );
    expect(within(screen.getByTestId("full-amenities")).getAllByRole("listitem")).toHaveLength(11);
  });

  it("places direct recorded film after inventory and hides unsupported embeds", async () => {
    const project = decisionDeckProject();
    const view = await renderInRouter(<ProjectDetailEngine project={project} />, "Decision Deck");
    expect(screen.getByTestId("project-film").querySelector("video")).toHaveAttribute(
      "preload",
      "none",
    );
    expect(screen.getByTestId("project-film").querySelector("video")).not.toHaveAttribute(
      "autoplay",
    );

    view.unmount();
    project.media.videos[0].url = "https://youtube.example/watch?v=unsupported";
    await renderInRouter(<ProjectDetailEngine project={project} />, "Decision Deck");
    expect(screen.queryByTestId("project-film")).toBeNull();
  });

  it("keeps plans out of lifestyle media and general documents", async () => {
    await renderInRouter(<ProjectDetailEngine project={decisionDeckProject()} />, "Decision Deck");

    const mosaic = screen.getByTestId("project-media-mosaic");
    expect(within(mosaic).queryByText(/master plan|floor plan|unit plan/i)).toBeNull();
    const plans = screen.getByTestId("project-plans");
    expect(plans).toHaveTextContent("Master plan");
    expect(plans).toHaveTextContent("Floor plan");
    expect(plans).toHaveTextContent("Unit plan");
    expect(screen.getByTestId("project-documents")).not.toHaveTextContent(/master plan|unit plan/i);
  });

  it("withholds conflicting developer and unsupported ownership from all rendered DOM", async () => {
    const project = decisionDeckProject();
    project.core.developerNameRaw = "Conflicting Holdings";
    await renderInRouter(<ProjectDetailEngine project={project} />, "Decision Deck");

    expect(document.getElementById("developer")).toBeNull();
    expect(document.body).not.toHaveTextContent("Recorded Developer");
    expect(document.body).not.toHaveTextContent("Conflicting Holdings");
    expect(document.body).not.toHaveTextContent("Freehold");
  });

  it("derives navigation from exactly the rendered optional sections", async () => {
    const project = decisionDeckProject();
    project.amenities = [];
    project.media.videos = [];
    project.media.documents = [];
    await renderInRouter(<ProjectDetailEngine project={project} />, "Decision Deck");

    const nav = screen.getByRole("navigation", { name: "Project sections" });
    expect(within(nav).queryByRole("link", { name: /amenities/i })).toBeNull();
    expect(within(nav).queryByRole("link", { name: /film/i })).toBeNull();
    expect(within(nav).queryByRole("link", { name: /documents/i })).toBeNull();
    for (const link of within(nav).getAllByRole("link")) {
      expect(document.querySelector(link.getAttribute("href")!)).not.toBeNull();
    }
  });

  it("does not expose private-looking media labels or notes", async () => {
    await renderInRouter(<ProjectDetailEngine project={decisionDeckProject()} />, "Decision Deck");

    expect(document.body).not.toHaveTextContent("Private-looking source title");
    expect(document.body).not.toHaveTextContent("source_file_url");
    expect(document.body).not.toHaveTextContent("C:\\private");
  });

  it("renders no contact action anywhere on the project page by default", async () => {
    await renderInRouter(<ProjectDetailEngine project={decisionDeckProject()} />, "Decision Deck");

    expect(screen.queryByRole("link", { name: /request this unit|enquir|whatsapp/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /request this unit|enquir|whatsapp/i })).toBeNull();
    expect(document.querySelector('[data-testid="project-mobile-cta"]')).toBeNull();
  });
});
