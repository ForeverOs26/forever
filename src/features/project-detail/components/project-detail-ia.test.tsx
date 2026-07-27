/**
 * Project-detail information architecture
 * (FOREVER-PROJECT-DETAIL-FAZWAZ-INSPIRED-UX-001).
 *
 * The page's promise is that a visitor sees the photographs, the price, the
 * facts and the available units without scrolling, and is never shown a field
 * Forever does not hold. These tests hold both halves of that.
 *
 * jsdom applies no media queries, so the mobile and desktop branches of the
 * mosaic are both in the document here; assertions are scoped accordingly.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

import {
  projectSections,
  projectFacilities,
  paymentPlanDocument,
  projectPhotographs,
} from "../project-sections";
import { projectQuickFacts } from "./ProjectQuickFacts";
import { projectSummaryRows } from "./ProjectSummaryPanel";
import { ProjectMediaMosaic } from "./ProjectMediaMosaic";
import { ProjectLightbox } from "./ProjectLightbox";
import { ProjectUnitPreview } from "./ProjectUnitPreview";
import { ProjectFacilities } from "./ProjectFacilities";
import { ProjectPaymentPlan } from "./ProjectPaymentPlan";
import { ProjectMobileCTA } from "./ProjectMobileCTA";
import { ProjectPhotos } from "./ProjectPhotos";
import { ProjectOverview } from "./ProjectOverview";
import { ProjectDetailEngine } from "./ProjectDetailEngine";

/** Anything containing a router `Link` needs a router in the tree. */
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
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getAllByText(new RegExp(settle)).length).toBeGreaterThan(0));
}

function photos(count: number) {
  return Array.from({ length: count }, (_unused, index) =>
    makeMediaItem({
      id: `g-${index}`,
      url: `https://cdn.example.com/g${index}.jpg`,
      title: `Photograph ${index}`,
      sortOrder: index,
    }),
  );
}

// ---------------------------------------------------------------------------
// Media, first
// ---------------------------------------------------------------------------

describe("the media mosaic", () => {
  it("shows one large image and four previews when there are enough", () => {
    render(<ProjectMediaMosaic items={photos(9)} projectName="Coralina" onOpen={() => {}} />);
    const mosaic = screen.getByTestId("project-media-mosaic");
    const desktop = mosaic.querySelector(".hidden.md\\:block")!;
    // One primary tile plus four preview tiles.
    expect(within(desktop as HTMLElement).getAllByRole("button")).toHaveLength(5);
    expect(screen.getAllByText(/View all 9 photos/).length).toBeGreaterThan(0);
  });

  it("reduces cleanly for one to four images", () => {
    for (const count of [1, 2, 3, 4]) {
      const { unmount } = render(
        <ProjectMediaMosaic items={photos(count)} projectName="X" onOpen={() => {}} />,
      );
      const desktop = screen
        .getByTestId("project-media-mosaic")
        .querySelector(".hidden.md\\:block")!;
      // One tile per image inside the mosaic itself.
      const tiles = within(screen.getByTestId("mosaic-grid")).getAllByRole("button");
      expect(tiles).toHaveLength(count);
      void desktop;
      unmount();
    }
  });

  it("puts the corrected cover first and never mixes plans into the sequence", () => {
    const project = makeProjectDetail({
      media: {
        hero: makeMediaItem({ id: "cover", type: "cover", url: "https://cdn/cover.jpg" }),
        gallery: photos(3),
        floorPlans: [makeMediaItem({ id: "fp", type: "floor_plan", url: "https://cdn/fp.jpg" })],
        masterPlan: makeMediaItem({ id: "mp", type: "master_plan", url: "https://cdn/mp.jpg" }),
        unitPlans: [makeMediaItem({ id: "up", type: "unit_plan", url: "https://cdn/up.jpg" })],
        brochures: [],
        videos: [],
        documents: [],
      },
    });
    const sequence = projectPhotographs(project);
    expect(sequence[0].url).toBe("https://cdn/cover.jpg");
    expect(sequence).toHaveLength(4);
    expect(sequence.map((item) => item.type)).not.toContain("floor_plan");
    expect(sequence.map((item) => item.type)).not.toContain("master_plan");
    expect(sequence.map((item) => item.type)).not.toContain("unit_plan");
  });

  it("gives the primary image priority and lazy-loads every preview", () => {
    render(<ProjectMediaMosaic items={photos(9)} projectName="X" onOpen={() => {}} />);
    const desktop = screen.getByTestId("project-media-mosaic").querySelector(".hidden.md\\:block")!;
    const images = within(desktop as HTMLElement).getAllByRole("img", { hidden: true });
    expect(images[0].getAttribute("loading")).toBe("eager");
    expect(images[0].getAttribute("fetchpriority")).toBe("high");
    for (const image of images.slice(1)) {
      expect(image.getAttribute("loading")).toBe("lazy");
    }
    // Explicit geometry on every tile: the layout cannot shift as they arrive.
    for (const image of images) {
      expect(image.getAttribute("width")).toBeTruthy();
      expect(image.getAttribute("height")).toBeTruthy();
    }
  });

  it("says so plainly when a project has no photographs yet", () => {
    render(<ProjectMediaMosaic items={[]} projectName="X" onOpen={() => {}} />);
    expect(screen.getByTestId("project-media-empty")).not.toBeNull();
  });

  it("opens the viewer from a tile", () => {
    const opened: number[] = [];
    render(<ProjectMediaMosaic items={photos(9)} projectName="X" onOpen={(i) => opened.push(i)} />);
    const desktop = screen.getByTestId("project-media-mosaic").querySelector(".hidden.md\\:block")!;
    fireEvent.click(within(desktop as HTMLElement).getAllByRole("button")[0]);
    expect(opened).toEqual([0]);
  });
});

describe("the lightbox", () => {
  function Harness({ start = 0 }: { start?: number }) {
    const items = photos(4);
    return (
      <ProjectLightbox
        items={items}
        index={start}
        onIndexChange={() => {}}
        onClose={() => {}}
        label="X photographs"
      />
    );
  }

  it("announces the position and offers previous, next and close", () => {
    render(<Harness />);
    expect(screen.getByText("Image 1 of 4")).not.toBeNull();
    expect(screen.getByLabelText("Previous image")).not.toBeNull();
    expect(screen.getByLabelText("Next image")).not.toBeNull();
    expect(screen.getByLabelText("Close image viewer")).not.toBeNull();
    expect(screen.getByTestId("project-lightbox").getAttribute("aria-modal")).toBe("true");
  });

  it("closes on Escape and moves on the arrow keys", () => {
    let index = 1;
    let closed = false;
    render(
      <ProjectLightbox
        items={photos(4)}
        index={index}
        onIndexChange={(next) => {
          index = next;
        }}
        onClose={() => {
          closed = true;
        }}
        label="X"
      />,
    );
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(index).toBe(2);
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(index).toBe(0);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(closed).toBe(true);
  });

  it("renders nothing at all when closed, so no image is fetched", () => {
    const { container } = render(
      <ProjectLightbox
        items={photos(4)}
        index={null}
        onIndexChange={() => {}}
        onClose={() => {}}
        label="X"
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("does not autoplay", () => {
    render(<Harness />);
    expect(screen.getByText("Image 1 of 4")).not.toBeNull();
    // No timer advances the viewer; the position is unchanged after a tick.
    return new Promise((resolve) => setTimeout(resolve, 30)).then(() => {
      expect(screen.getByText("Image 1 of 4")).not.toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Facts and sections
// ---------------------------------------------------------------------------

describe("quick facts and the summary panel", () => {
  it("hide every field the record does not support", () => {
    const bare = makeProjectDetail({
      core: { constructionStatus: "", ownershipType: "", type: "" },
      units: [],
    });
    const facts = projectQuickFacts(bare).map((fact) => fact.label);
    expect(facts).not.toContain("Construction");
    expect(facts).not.toContain("Ownership");
    expect(facts).not.toContain("Listed units");
    // Nothing invented: no bathrooms, furniture, yield, pets or CAM fee.
    for (const forbidden of ["Bathrooms", "Furniture", "Rental yield", "Pets", "CAM fee"]) {
      expect(facts).not.toContain(forbidden);
    }
  });

  it("show the fields the record does support", () => {
    const project = makeProjectDetail({
      pricing: { displayPrice: "From THB 5.9M" },
      units: [
        makeUnit({ code: "A1", buildingCode: "A", sizeSqm: 30 }),
        makeUnit({ code: "B1", buildingCode: "B", sizeSqm: 64 }),
      ],
    });
    const facts = projectQuickFacts(project);
    expect(facts.find((fact) => fact.label === "Starting price")?.value).toBe("From THB 5.9M");
    expect(facts.find((fact) => fact.label === "Buildings")?.value).toBe("2");
    expect(facts.find((fact) => fact.label === "Unit sizes")?.value).toBe("30 – 64 m²");
    expect(projectSummaryRows(project).find((row) => row.label === "Listed units")?.value).toBe(
      "2",
    );
  });
});

describe("section navigation", () => {
  it("lists only sections that have content", () => {
    const sparse = makeProjectDetail({
      core: { description: "", tagline: "", highlights: [] },
      units: [],
      media: {
        hero: null,
        gallery: [],
        floorPlans: [],
        masterPlan: null,
        unitPlans: [],
        brochures: [],
        videos: [],
        documents: [],
      },
    });
    const ids = projectSections(sparse).map((section) => section.id);
    expect(ids).not.toContain("photos");
    expect(ids).not.toContain("units");
    expect(ids).not.toContain("floor-plans");
    expect(ids).not.toContain("payment-plan");
    expect(ids).not.toContain("facilities");
  });

  it("lists a section once its content exists, and anchors match the rendered ids", () => {
    const project = makeProjectDetail({
      core: { description: "A project.", highlights: [] },
      facilities: ["Communal pool"],
      units: [makeUnit()],
      media: {
        hero: makeMediaItem({ type: "cover" }),
        // The gallery renders from six photographs upward, so the fixture has
        // to clear that bar for the "photos" entry to be legitimate.
        gallery: photos(6),
        floorPlans: [],
        masterPlan: null,
        unitPlans: [],
        brochures: [],
        videos: [],
        documents: [],
      },
    });
    const ids = projectSections(project).map((section) => section.id);
    expect(ids).toEqual(expect.arrayContaining(["overview", "photos", "units", "facilities"]));
    render(<ProjectFacilities project={project} />);
    expect(screen.getByTestId("project-facilities").getAttribute("id")).toBe("facilities");
  });

  /**
   * X1. `projectSections()` promised that "a link can never scroll to an empty
   * destination" while gating six of its ten entries on looser conditions than
   * the components applied. The worst case was the commonest: a project with
   * one to five photographs got a "Photos" pill pointing at an element
   * `ProjectPhotos` never renders. `ProjectSectionNav`'s observer skips a
   * missing target silently, so the pill simply did nothing when clicked.
   */
  it("offers no Photos entry for a project whose gallery is below the render threshold", () => {
    const project = makeProjectDetail({
      media: {
        hero: makeMediaItem({ type: "cover" }),
        gallery: photos(3),
        floorPlans: [],
        masterPlan: null,
        unitPlans: [],
        brochures: [],
        videos: [],
        documents: [],
      },
    });

    expect(projectSections(project).map((section) => section.id)).not.toContain("photos");
    const { container } = render(<ProjectPhotos project={project} />);
    expect(container.innerHTML).toBe("");
  });

  /**
   * The page keeps exactly one `<main>`, and it belongs to `SiteShell`. The
   * detail engine is a fragment and the section navigation is a `<nav>`; a
   * second landmark here would give assistive technology two "main" regions on
   * one page. jsdom cannot verify the rendered width behaviour, but it can
   * verify this.
   */
  it("adds no second <main> landmark", async () => {
    const project = makeProjectDetail({
      core: { description: "A project." },
      units: [makeUnit()],
    });
    await renderInRouter(<ProjectDetailEngine project={project} />, "About this project");
    expect(document.querySelectorAll("main")).toHaveLength(0);
  });

  it("every navigation entry corresponds to a section the page actually renders", async () => {
    const project = makeProjectDetail({
      core: { description: "A project.", highlights: [] },
      facilities: ["Communal pool"],
      units: [makeUnit()],
      media: {
        hero: makeMediaItem({ type: "cover" }),
        gallery: photos(6),
        floorPlans: [],
        masterPlan: null,
        unitPlans: [],
        brochures: [],
        videos: [],
        documents: [],
      },
    });

    const ids = projectSections(project).map((section) => section.id);
    await renderInRouter(<ProjectDetailEngine project={project} />, "About this project");

    for (const id of ids) {
      expect(document.querySelector(`#${id}`), `no rendered element for #${id}`).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

describe("the unit preview", () => {
  const project = makeProjectDetail({
    core: { name: "Coralina" },
    units: [
      makeUnit({
        id: "1",
        code: "A101",
        buildingCode: "A",
        bedrooms: 1,
        sizeSqm: 30,
        basePriceTHB: 5_000_000,
      }),
      makeUnit({
        id: "2",
        code: "A102",
        buildingCode: "A",
        bedrooms: 2,
        sizeSqm: 64,
        basePriceTHB: 9_000_000,
      }),
      makeUnit({
        id: "3",
        code: "B201",
        buildingCode: "B",
        bedrooms: 1,
        sizeSqm: 34,
        basePriceTHB: 6_000_000,
      }),
      makeUnit({
        id: "4",
        code: "B202",
        buildingCode: "B",
        bedrooms: 2,
        sizeSqm: 70,
        availabilityStatus: "sold",
      }),
    ],
  });

  it("excludes sold units by default and offers to include them", async () => {
    await renderInRouter(<ProjectUnitPreview project={project} />, "Availability");
    expect(screen.getAllByTestId("unit-preview-card")).toHaveLength(3);
    fireEvent.click(screen.getByLabelText(/Include sold/i, { selector: "input" }));
    expect(screen.getAllByTestId("unit-preview-card")).toHaveLength(4);
    expect(screen.getByText("Sold")).not.toBeNull();
  });

  it("shows the price and the status on every card", async () => {
    await renderInRouter(<ProjectUnitPreview project={project} />, "Availability");
    const first = screen.getAllByTestId("unit-preview-card")[0];
    expect(within(first).getByText("฿5,000,000")).not.toBeNull();
    expect(within(first).getByText("Available")).not.toBeNull();
  });

  it("derives its filter options from the loaded inventory only", async () => {
    await renderInRouter(<ProjectUnitPreview project={project} />, "Availability");
    const bedrooms = screen.getByRole("combobox", { name: "Bedrooms" });
    const values = within(bedrooms)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(values).toEqual(["All bedrooms", "1 bedroom (2)", "2 bedrooms (2)"]);
    // Nothing offered that no unit has.
    expect(values.some((value) => value?.startsWith("4 bedrooms"))).toBe(false);
  });

  it("filters in memory and can be cleared", async () => {
    await renderInRouter(<ProjectUnitPreview project={project} />, "Availability");
    fireEvent.change(screen.getByRole("combobox", { name: "Building" }), {
      target: { value: "B" },
    });
    expect(screen.getAllByTestId("unit-preview-card")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(screen.getAllByTestId("unit-preview-card")).toHaveLength(3);
  });

  it("sorts by price without dropping a unit", async () => {
    await renderInRouter(<ProjectUnitPreview project={project} />, "Availability");
    fireEvent.change(screen.getByRole("combobox", { name: "Sort by" }), {
      target: { value: "price-desc" },
    });
    const codes = screen
      .getAllByTestId("unit-preview-card")
      .map((card) => card.querySelector("p")?.textContent);
    expect(codes).toEqual(["A102", "B201", "A101"]);
  });

  /**
   * F5. The per-unit button is the highest-volume contact surface on the page —
   * one per card, up to 24 at once — and gate G0 is open, so it is absent by
   * default. Absent, not disabled: a greyed-out control still advertises a
   * capability and still invites a click that goes nowhere.
   */
  it("offers no per-unit contact action while gate G0 is open", async () => {
    await renderInRouter(<ProjectUnitPreview project={project} />, "Availability");
    expect(screen.queryByRole("link", { name: "Request this unit" })).toBeNull();
    expect(screen.queryByRole("button", { name: /request/i })).toBeNull();
    // Nothing disabled is left behind in place of the action.
    expect(document.querySelector("[disabled]")).toBeNull();
  });

  it("links to the complete inventory", async () => {
    await renderInRouter(<ProjectUnitPreview project={project} />, "Availability");
    expect(screen.getByRole("link", { name: /View all 4 units/ }).getAttribute("href")).toBe(
      "#inventory",
    );
  });

  it("renders nothing when the project has no units", () => {
    const { container } = render(<ProjectUnitPreview project={makeProjectDetail({ units: [] })} />);
    expect(container.innerHTML).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Sections that must stay absent rather than be invented
// ---------------------------------------------------------------------------

describe("sections Forever cannot support stay hidden", () => {
  it("hides the payment plan when no official document exists", () => {
    const project = makeProjectDetail();
    expect(paymentPlanDocument(project)).toBeNull();
    const { container } = render(<ProjectPaymentPlan project={project} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the payment-plan document, and no fabricated instalment rows", () => {
    const project = makeProjectDetail({
      media: {
        hero: null,
        gallery: [],
        floorPlans: [],
        masterPlan: null,
        unitPlans: [],
        brochures: [],
        videos: [],
        documents: [
          {
            ...makeMediaItem({ id: "pp", type: "payment_plan", url: "https://cdn/pp.pdf" }),
            label: "Payment Plan",
            note: "Available",
          },
        ],
      },
    });
    render(<ProjectPaymentPlan project={project} />);
    expect(screen.getByRole("link", { name: "View payment plan" })).not.toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(/Installment/i)).toBeNull();
  });

  it("hides facilities when the record states none", () => {
    const project = makeProjectDetail({ facilities: [] });
    expect(projectFacilities(project)).toEqual([]);
    const { container } = render(<ProjectFacilities project={project} />);
    expect(container.innerHTML).toBe("");
  });

  it("lists only the facilities the structured collection states", () => {
    const project = makeProjectDetail({
      facilities: ["Communal pool", "Communal pool", "24h security"],
    });
    expect(projectFacilities(project)).toEqual(["Communal pool", "24h security"]);
  });

  /**
   * F3. Highlights are editorial one-liners. Modeva's three are "Forever
   * Verified project record", "Bang Tao location" and "Structured project
   * foundation" — printed under "Facilities — What the project includes", they
   * assert three things the developer never said.
   */
  it("never builds a facility out of an editorial highlight", () => {
    const project = makeProjectDetail({
      core: {
        highlights: [
          "Forever Verified project record",
          "Bang Tao location",
          "Structured project foundation",
        ],
      },
      facilities: [],
    });

    expect(projectFacilities(project)).toEqual([]);
    expect(projectSections(project).map((section) => section.id)).not.toContain("facilities");
    const { container } = render(<ProjectFacilities project={project} />);
    expect(container.innerHTML).toBe("");
  });

  /**
   * F4. `projects.ownership_type` is populated on one legacy row out of nine and
   * no official source for any of them states freehold, leasehold or foreign
   * quota. Tenure is a legal claim about a purchase.
   */
  it("states no ownership type on any surface, even when the column carries one", () => {
    const project = makeProjectDetail({ core: { ownershipType: "Freehold" } });

    expect(projectSummaryRows(project).map((row) => row.label)).not.toContain("Ownership");
    expect(projectQuickFacts(project).map((fact) => fact.label)).not.toContain("Ownership");

    render(<ProjectOverview project={project} />);
    expect(screen.queryByText("Ownership")).toBeNull();
    expect(screen.queryByText("Freehold")).toBeNull();
  });
});

describe("the mobile contact bar", () => {
  /**
   * F5. Gate G0 is open — the contact form's delivery has never been observed
   * end to end — so the sticky bar is absent, not disabled.
   */
  it("is absent while gate G0 is open", () => {
    const { container } = render(
      <ProjectMobileCTA project={makeProjectDetail({ core: { name: "Coralina" } })} />,
    );
    expect(container.innerHTML).toBe("");
    expect(screen.queryByTestId("project-mobile-cta")).toBeNull();
  });
});
