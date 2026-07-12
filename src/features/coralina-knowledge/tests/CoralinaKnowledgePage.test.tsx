import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { CoralinaKnowledgePage } from "../components/CoralinaKnowledgePage";
import { describeCoralinaKnowledgeInspection } from "../inspection";
import { buildCoralinaKnowledgeSlice } from "../slice";

const inspection = describeCoralinaKnowledgeInspection(buildCoralinaKnowledgeSlice());

// `screen.getBy*` throws when the element is absent, so `toBeTruthy()` is a
// full presence assertion without needing the jest-dom matcher types (which
// this repo's tsconfig only wires up for the excluded advisory tests).
describe("CoralinaKnowledgePage", () => {
  it("renders the verified project name and readiness standing", () => {
    render(<CoralinaKnowledgePage inspection={inspection} />);
    expect(
      screen.getByRole("heading", { name: /CORALINA KAMALA — Project Knowledge/ }),
    ).toBeTruthy();
    expect(screen.getAllByText("blocked").length).toBeGreaterThan(0);
  });

  it("shows all six foundation stages", () => {
    render(<CoralinaKnowledgePage inspection={inspection} />);
    for (const rc of ["RC4.4", "RC4.5", "RC4.6", "RC4.7", "RC4.8", "RC4.9"]) {
      expect(screen.getByText(rc)).toBeTruthy();
    }
  });

  it("shows missing information honestly instead of filling it in", () => {
    render(<CoralinaKnowledgePage inspection={inspection} />);
    expect(screen.getAllByText("developer.name").length).toBeGreaterThan(0);
    expect(screen.getAllByText("location.country").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/developer is SOURCE_PENDING/).length).toBeGreaterThan(0);
  });

  it("shows the unresolved unit-type dispute with both claims", () => {
    render(<CoralinaKnowledgePage inspection={inspection} />);
    expect(screen.getAllByText(/PH-3 BEDROOM/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1 Bedroom S/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("contested").length).toBeGreaterThan(0);
  });

  it("shows the corroborated buildings field", () => {
    render(<CoralinaKnowledgePage inspection={inspection} />);
    expect(screen.getAllByText("corroborated").length).toBeGreaterThan(0);
    expect(screen.getAllByText("A; B; C; D; E; F; G; H").length).toBeGreaterThan(0);
  });

  it("renders every registered source", () => {
    render(<CoralinaKnowledgePage inspection={inspection} />);
    for (const source of inspection.sources) {
      expect(screen.getByText(source.name)).toBeTruthy();
    }
  });
});
