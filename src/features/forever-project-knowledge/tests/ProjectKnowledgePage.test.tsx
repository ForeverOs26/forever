import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { MODEVA_KNOWLEDGE_DEFINITION } from "@/features/modeva-knowledge";

import { ProjectKnowledgePage } from "../components/ProjectKnowledgePage";
import { describeProjectKnowledgeInspection } from "../inspection";
import { buildProjectKnowledgeSlice } from "../slice";

const slice = buildProjectKnowledgeSlice(MODEVA_KNOWLEDGE_DEFINITION);
const inspection = describeProjectKnowledgeInspection(slice, MODEVA_KNOWLEDGE_DEFINITION.copy);

// `screen.getBy*` throws when the element is absent, so `toBeTruthy()` is a
// full presence assertion without needing the jest-dom matcher types (which
// this repo's tsconfig only wires up for the excluded advisory tests).
describe("ProjectKnowledgePage", () => {
  it("renders the project name, stated kicker, and readiness standing", () => {
    render(<ProjectKnowledgePage inspection={inspection} />);
    expect(screen.getByRole("heading", { name: /Modeva — Project Knowledge/ })).toBeTruthy();
    expect(screen.getByText("Internal inspection — RC5.1 project knowledge")).toBeTruthy();
    expect(screen.getAllByText("blocked").length).toBeGreaterThan(0);
  });

  it("shows all six foundation stages", () => {
    render(<ProjectKnowledgePage inspection={inspection} />);
    for (const rc of ["RC4.4", "RC4.5", "RC4.6", "RC4.7", "RC4.8", "RC4.9"]) {
      expect(screen.getByText(rc)).toBeTruthy();
    }
  });

  it("shows every registered committed artifact", () => {
    render(<ProjectKnowledgePage inspection={inspection} />);
    for (const source of inspection.sources) {
      expect(screen.getByText(source.name)).toBeTruthy();
    }
  });

  it("shows missing information honestly instead of filling it in", () => {
    render(<ProjectKnowledgePage inspection={inspection} />);
    expect(screen.getAllByText("location.coordinates").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/no committed Modeva artifact states GPS/).length).toBeGreaterThan(
      0,
    );
  });

  it("shows the corroborated developer field — the contrast with Coralina", () => {
    render(<ProjectKnowledgePage inspection={inspection} />);
    expect(screen.getAllByText("developer.name").length).toBeGreaterThan(0);
    expect(screen.getAllByText("corroborated").length).toBeGreaterThan(0);
  });

  it("falls back to honest generic copy when a definition states none", () => {
    render(<ProjectKnowledgePage inspection={{ ...inspection, copy: undefined }} />);
    expect(screen.getByText("Internal inspection — Forever project knowledge")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Modeva — Project Knowledge/ })).toBeTruthy();
  });
});
