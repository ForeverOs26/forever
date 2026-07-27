import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { makeProjectDetail, makeUnit } from "@/features/forever-database/tests/fixtures";
import { ProjectInventory } from "./ProjectInventory";

/**
 * Since F-013 the same rows render twice — as the desktop table and as mobile
 * cards — so table-specific assertions are scoped to the table. jsdom applies
 * no media queries, so both are present in the DOM here regardless of viewport.
 */
const table = () => within(screen.getByTestId("inventory-unit-table"));

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

    expect(table().getByRole("rowheader", { name: "I109" })).not.toBeNull();
    expect(table().getByText("One Bedroom Legend")).not.toBeNull();
    expect(table().getByText("56.05 m²")).not.toBeNull();
    expect(table().getByText("฿9,011,564")).not.toBeNull();
  });

  it("prefers a discounted price over the base price", () => {
    render(
      <ProjectInventory
        project={makeProjectDetail({
          units: [makeUnit({ code: "A101", basePriceTHB: 9000000, discountedPriceTHB: 8500000 })],
        })}
      />,
    );

    expect(table().getByText("฿8,500,000")).not.toBeNull();
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

    expect(table().getByText("Sold")).not.toBeNull();
    expect(screen.getByText("1 of 2 available")).not.toBeNull();
    // Available units are listed first, so a sold unit can never head the table.
    const rowHeaders = table()
      .getAllByRole("rowheader")
      .map((cell) => cell.textContent);
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

/**
 * F-013. At 375 px the 40rem table needed 640 px inside a 343 px container, so
 * Area, Price and Status sat behind a horizontal scroll with no gradient,
 * shadow or hint that further columns existed. The two facts a buyer most
 * wants were off-screen by default.
 *
 * The rows are now also rendered as cards below the tablet breakpoint. jsdom
 * applies no media queries, so both presentations are in the DOM here; the
 * assertions cover the content of each and the breakpoint classes that decide
 * which one a given viewport sees. The rendered 375 / 768 / 1440 behaviour is
 * verified separately in the browser.
 */
describe("ProjectInventory mobile presentation (F-013)", () => {
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
      makeUnit({
        id: "u-2",
        code: "I501",
        buildingCode: "I",
        floor: 5,
        type: "Two Bedroom Legend",
        sizeSqm: 90.1,
        basePriceTHB: 14530000,
        availabilityStatus: "sold",
      }),
    ],
  });

  const cards = () => screen.getByTestId("inventory-unit-cards");

  it("shows the price on the mobile card, not only in the table", () => {
    render(<ProjectInventory project={project} />);
    expect(cards()).toHaveTextContent("฿9,011,564");
    expect(cards()).toHaveTextContent("฿14,530,000");
  });

  it("shows the availability status on the mobile card", () => {
    render(<ProjectInventory project={project} />);
    expect(cards()).toHaveTextContent("Available");
  });

  it("keeps a sold unit visibly sold on mobile", () => {
    render(<ProjectInventory project={project} />);
    expect(cards()).toHaveTextContent("Sold");
    const sold = cards().querySelector('[data-available="false"]');
    expect(sold).not.toBeNull();
    expect(sold).toHaveTextContent("I501");
  });

  it("carries the unit code, type, area, building and floor", () => {
    render(<ProjectInventory project={project} />);
    const card = cards().firstElementChild as HTMLElement;
    for (const fact of [
      "I109",
      "One Bedroom Legend",
      "56.05 m²",
      "Price",
      "Area",
      "Building",
      "Floor",
    ]) {
      expect(card).toHaveTextContent(fact);
    }
  });

  it("renders a neutral dash for a missing price", () => {
    render(
      <ProjectInventory
        project={makeProjectDetail({ units: [makeUnit({ code: "A101", basePriceTHB: null })] })}
      />,
    );
    const price = screen.getByTestId("inventory-unit-cards").querySelector("dd");
    expect(price).toHaveTextContent("—");
    expect(screen.getByTestId("inventory-unit-cards")).not.toHaveTextContent("฿0");
  });

  it("renders a neutral dash for optional building and floor", () => {
    render(
      <ProjectInventory
        project={makeProjectDetail({
          units: [makeUnit({ code: "V-01", buildingCode: undefined, floor: null })],
        })}
      />,
    );
    // A villa has no building and no floor; neither may become a zero.
    const dds = [...screen.getByTestId("inventory-unit-cards").querySelectorAll("dd")];
    expect(dds.filter((dd) => dd.textContent === "—").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId("inventory-unit-cards")).not.toHaveTextContent(">0<");
  });

  it("keeps available-first ordering in the cards", () => {
    render(<ProjectInventory project={project} />);
    const codes = [...cards().children].map(
      (li) => li.querySelector(".font-medium.text-foreground")?.textContent,
    );
    expect(codes).toEqual(["I109", "I501"]);
  });

  it("shows the cards only below the tablet breakpoint and the table only at or above it", () => {
    render(<ProjectInventory project={project} />);
    // md: is 768 px — the audit measured the table fitting from tablet upward.
    expect(cards().className).toContain("md:hidden");
    const table = screen.getByTestId("inventory-unit-table");
    expect(table.className).toContain("hidden");
    expect(table.className).toContain("md:block");
    expect(table.querySelector("table")).not.toBeNull();
  });

  it("still renders the full desktop table with every column", () => {
    render(<ProjectInventory project={project} />);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Unit", "Building", "Floor", "Type", "Area", "Price", "Status"]);
  });
});
