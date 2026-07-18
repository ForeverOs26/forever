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
});
