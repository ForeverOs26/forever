import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  makeMediaItem,
  makeProjectDetail,
  makeUnit,
} from "@/features/forever-database/tests/fixtures";
import { groupProjectMedia } from "../project-detail-mappers";
import { ProjectFloorPlans } from "./ProjectFloorPlans";
import { ProjectMasterPlan } from "./ProjectMasterPlan";
import { ProjectUnitPlans } from "./ProjectUnitPlans";

/**
 * F-008. A plan heading is a claim that there are layouts to look at, so it
 * must follow the items rather than the data that happens to sit near them.
 *
 * "Available layouts" used to render whenever a project had *units*, falling
 * back to a grid of inventory cards when it had no unit plans at all — which
 * put the heading on `/projects/the-title-serenity` (162 units, zero plans)
 * and `/projects/modeva` (289 units, zero media of any kind). Those cards also
 * duplicated `ProjectInventory`, which already lists every unit with its
 * building, floor, area, price and availability.
 */

const planItem = (overrides = {}) =>
  makeMediaItem({
    id: "plan-1",
    type: "unit_plan",
    title: "",
    url: "https://cdn.example.com/unit-plan.pdf",
    ...overrides,
  });

describe("Available layouts section (F-008)", () => {
  it("is hidden when the project holds no unit plans", () => {
    render(<ProjectUnitPlans project={makeProjectDetail({ media: { unitPlans: [] } })} />);
    expect(screen.queryByText("Available layouts")).toBeNull();
  });

  it("is hidden for a project with a full inventory but no unit plans", () => {
    // The Serenity / Modeva case: many priced units, no plan asset.
    const project = makeProjectDetail({
      media: { unitPlans: [] },
      units: [makeUnit({ id: "u-1", code: "A101" }), makeUnit({ id: "u-2", code: "A102" })],
    });
    render(<ProjectUnitPlans project={project} />);
    expect(screen.queryByText("Available layouts")).toBeNull();
    expect(screen.queryByText("Unit Plans")).toBeNull();
  });

  it("is shown when a real unit plan exists", () => {
    render(
      <ProjectUnitPlans project={makeProjectDetail({ media: { unitPlans: [planItem()] } })} />,
    );
    expect(screen.getByText("Available layouts")).not.toBeNull();
    // The plan tile, plus the section's own "Unit Plans PDF" button.
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "https://cdn.example.com/unit-plan.pdf");
    }
  });

  it("does not create a visible section from a plan whose URL is missing or unusable", () => {
    for (const url of ["", "   ", "undefined", "not-a-url"]) {
      const { unmount } = render(
        <ProjectUnitPlans
          project={makeProjectDetail({ media: { unitPlans: [planItem({ url })] } })}
        />,
      );
      expect(screen.queryByText("Available layouts")).toBeNull();
      unmount();
    }
  });

  it("keeps the section when at least one plan of several is usable", () => {
    const project = makeProjectDetail({
      media: {
        unitPlans: [
          planItem({ id: "broken", url: "" }),
          planItem({ id: "good", url: "https://cdn.example.com/b.pdf" }),
        ],
      },
    });
    render(<ProjectUnitPlans project={project} />);
    expect(screen.getByText("Available layouts")).not.toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(2); // the tile plus the PDF button
  });
});

describe("Layouts by building section (F-008)", () => {
  it("is hidden when the project holds no floor plans", () => {
    render(<ProjectFloorPlans project={makeProjectDetail({ media: { floorPlans: [] } })} />);
    expect(screen.queryByText("Layouts by building")).toBeNull();
  });

  it("is hidden when every floor plan record has an unusable URL", () => {
    const project = makeProjectDetail({
      media: { floorPlans: [makeMediaItem({ type: "floor_plan", url: "" })] },
    });
    render(<ProjectFloorPlans project={project} />);
    expect(screen.queryByText("Layouts by building")).toBeNull();
  });

  it("is shown for a real floor plan", () => {
    const project = makeProjectDetail({
      media: {
        floorPlans: [
          makeMediaItem({ type: "floor_plan", title: "", url: "https://cdn.example.com/f1.jpg" }),
        ],
      },
    });
    render(<ProjectFloorPlans project={project} />);
    expect(screen.getByText("Layouts by building")).not.toBeNull();
  });
});

describe("Site plan section (F-008)", () => {
  it("is hidden when no master plan is recorded", () => {
    render(<ProjectMasterPlan project={makeProjectDetail({ media: { masterPlan: null } })} />);
    expect(screen.queryByText("Site plan")).toBeNull();
  });

  it("is hidden when the master plan record has no usable URL", () => {
    const project = makeProjectDetail({
      media: { masterPlan: makeMediaItem({ type: "master_plan", url: "" }) },
    });
    render(<ProjectMasterPlan project={project} />);
    expect(screen.queryByText("Site plan")).toBeNull();
  });

  it("is shown for a real master plan", () => {
    const project = makeProjectDetail({
      media: {
        masterPlan: makeMediaItem({
          type: "master_plan",
          title: "Master Plan",
          url: "https://cdn.example.com/master.pdf",
        }),
      },
    });
    render(<ProjectMasterPlan project={project} />);
    expect(screen.getByText("Site plan")).not.toBeNull();
  });
});

/**
 * Categorisation comes from the recorded `media_type` and nothing else. No
 * URL sniffing, no title parsing, no inference — a plan is whatever the record
 * says it is, and media the model does not recognise is never promoted into a
 * plan category to fill a section out.
 */
describe("plan categorisation is driven by the recorded media type (F-008)", () => {
  // Database row shape, so the real mapper does the categorising.
  const row = (id: string, media_type: string, url: string, sort_order: number) => ({
    id,
    media_type,
    title: "",
    url,
    sort_order,
  });
  const rows = [
    row("m-1", "master_plan", "https://cdn.example.com/master.pdf", 1),
    row("m-2", "site_plan", "https://cdn.example.com/site.pdf", 2),
    row("m-3", "unit_plan", "https://cdn.example.com/unit.pdf", 3),
    row("m-4", "floor_plan", "https://cdn.example.com/floor.jpg", 4),
    row("m-5", "gallery", "https://cdn.example.com/g.jpg", 5),
    row("m-6", "mystery_type", "https://cdn.example.com/x.bin", 6),
  ] as unknown as Parameters<typeof groupProjectMedia>[0];

  const media = groupProjectMedia(rows, { projectId: "p-1" });

  it("never presents a master plan as an apartment unit plan", () => {
    expect(media.unitPlans.map((i) => i.id)).not.toContain("m-1");
    expect(media.masterPlan?.id).toBe("m-1");
  });

  it("never presents a site plan as a unit layout or a floor plan", () => {
    expect(media.unitPlans.map((i) => i.id)).not.toContain("m-2");
    expect(media.floorPlans.map((i) => i.id)).not.toContain("m-2");
  });

  it("keeps floor plans and unit plans on their own explicit types", () => {
    expect(media.unitPlans.map((i) => i.id)).toEqual(["m-3"]);
    expect(media.floorPlans.map((i) => i.id)).toEqual(["m-4"]);
  });

  it("never guesses unrecognised media into a plan category", () => {
    for (const collection of [media.unitPlans, media.floorPlans]) {
      expect(collection.map((i) => i.id)).not.toContain("m-6");
    }
    expect(media.masterPlan?.id).not.toBe("m-6");
  });

  it("renders a master plan only under the site plan section", () => {
    const project = makeProjectDetail({ media });
    const { container } = render(
      <>
        <ProjectMasterPlan project={project} />
        <ProjectUnitPlans project={project} />
      </>,
    );
    expect(screen.getByText("Site plan")).not.toBeNull();
    const links = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    // The unit-plan section links the unit plan, never the master plan.
    const unitSection = screen.getByText("Available layouts").closest("section");
    const unitLinks = [...(unitSection?.querySelectorAll("a") ?? [])].map((a) =>
      a.getAttribute("href"),
    );
    expect(unitLinks.every((href) => href === "https://cdn.example.com/unit.pdf")).toBe(true);
    expect(links).toContain("https://cdn.example.com/master.pdf");
  });
});
