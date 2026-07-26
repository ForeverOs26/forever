import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { makeProjectDetail, makeUnit } from "@/features/forever-database/tests/fixtures";
import { ProjectInventory } from "./ProjectInventory";

describe("ProjectInventory", () => {
  it("groups arbitrary explicit building codes without parsing unit codes", () => {
    const project = makeProjectDetail({
      units: [
        makeUnit({ code: "unit-001", buildingCode: "North Tower" }),
        makeUnit({ code: "suite-two", buildingCode: "North Tower" }),
        makeUnit({ code: "x9", buildingCode: "Garden Annex" }),
      ],
    });

    render(<ProjectInventory project={project} />);

    expect(screen.getByRole("heading", { name: /2 buildings.*3 residences/ })).not.toBeNull();
    expect(screen.getByText("Building North Tower")).not.toBeNull();
    expect(screen.getByText("Building Garden Annex")).not.toBeNull();
  });

  it("shows only the residence total when structured building data is absent", () => {
    render(<ProjectInventory project={makeProjectDetail({ units: [makeUnit()] })} />);

    expect(screen.getByText("1 residences")).not.toBeNull();
    expect(screen.queryByText(/^Building /)).toBeNull();
  });

  it("renders each unit's building, floor, type, area and recorded price", () => {
    const project = makeProjectDetail({
      units: [
        makeUnit({
          id: "u-1",
          code: "I109",
          buildingCode: "I",
          floor: 1,
          type: "One Bedroom Legend",
          sizeSqm: 56.05,
          basePriceTHB: 9011564,
          availabilityStatus: "available",
        }),
      ],
    });

    render(<ProjectInventory project={project} />);

    expect(screen.getByRole("rowheader", { name: "I109" })).not.toBeNull();
    expect(screen.getByText("One Bedroom Legend")).not.toBeNull();
    expect(screen.getByText("56.05 m²")).not.toBeNull();
    expect(screen.getByText("฿9,011,564")).not.toBeNull();
  });

  it("prefers a discounted price over the base price", () => {
    render(
      <ProjectInventory
        project={makeProjectDetail({
          units: [makeUnit({ code: "A101", basePriceTHB: 9000000, discountedPriceTHB: 8500000 })],
        })}
      />,
    );

    expect(screen.getByText("฿8,500,000")).not.toBeNull();
    expect(screen.queryByText("฿9,000,000")).toBeNull();
  });

  it("shows a sold unit as sold and excludes it from the available count", () => {
    const project = makeProjectDetail({
      units: [
        makeUnit({ id: "u-1", code: "I501", availabilityStatus: "sold", basePriceTHB: 9045000 }),
        makeUnit({ id: "u-2", code: "I509", availabilityStatus: "available" }),
      ],
    });

    render(<ProjectInventory project={project} />);

    expect(screen.getByText("Sold")).not.toBeNull();
    expect(screen.getByText("1 of 2 available")).not.toBeNull();
    // Available units are listed first, so a sold unit can never head the table.
    const rowHeaders = screen.getAllByRole("rowheader").map((cell) => cell.textContent);
    expect(rowHeaders).toEqual(["I509", "I501"]);
  });

  it("shows a dash rather than inventing a price when none is recorded", () => {
    render(
      <ProjectInventory
        project={makeProjectDetail({ units: [makeUnit({ code: "A101", basePriceTHB: null })] })}
      />,
    );

    expect(screen.queryByText(/price on request/i)).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
