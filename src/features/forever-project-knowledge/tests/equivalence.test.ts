import { describe, expect, it } from "vitest";

import {
  buildCoralinaKnowledgeSlice,
  describeCoralinaKnowledgeInspection,
  CORALINA_KNOWLEDGE_DEFINITION,
} from "@/features/coralina-knowledge";

import { validateProjectKnowledgeDefinition } from "../definition";
import { describeProjectKnowledgeInspection } from "../inspection";
import { buildProjectKnowledgeSlice } from "../slice";

// buildCoralinaKnowledgeSlice() IS buildProjectKnowledgeSlice(CORALINA_…) by
// delegation, so comparing the two would be a tautology. What this suite
// pins instead are GOLDEN RC5.0 facts — concrete artifact values the RC5.0
// orchestration produced, re-asserted against the engine — so an engine
// regression (changed strings, dropped artifacts, reordered routing) fails
// here even though the old orchestration no longer exists to compare with.
const slice = buildProjectKnowledgeSlice(CORALINA_KNOWLEDGE_DEFINITION);
const inspection = describeProjectKnowledgeInspection(slice, CORALINA_KNOWLEDGE_DEFINITION.copy);

describe("RC5.0 behaviour pinned through the RC5.1 engine", () => {
  it("states a structurally valid Coralina definition", () => {
    expect(validateProjectKnowledgeDefinition(CORALINA_KNOWLEDGE_DEFINITION)).toEqual([]);
  });

  it("keeps the RC5.0 judgements intact", () => {
    expect(slice.readiness.report.standing).toBe("blocked");
    const contested = slice.crossValidation.report.subjects.filter(
      (subject) => subject.consensus === "contested",
    );
    expect(contested).toHaveLength(1);
    expect(contested[0]!.subject.fieldPath).toBe("units.unitTypes");
    expect(slice.canonical.withheld).toHaveLength(2);
    expect(slice.canonical.admittedFactIds).toHaveLength(15);
  });

  it("keeps the RC5.0 canonical-record artifacts intact", () => {
    expect(slice.canonical.record.identity.name).toBe("CORALINA KAMALA");
    expect(slice.canonical.record.status).toBe("draft");
    expect(slice.canonical.merge.revision.author).toBe("coralina-knowledge (RC5.0)");
    expect(slice.canonical.merge.revision.reason).toBe(
      "Settle the Coralina extraction facts that passed RC4.7 cross-source validation.",
    );
    const created = slice.canonical.record.timeline.events.find(
      (event) => event.kind === "created",
    );
    expect(created?.description).toBe(
      "Coralina canonical record described from RC4.7-admitted extraction facts.",
    );
  });

  it("keeps the RC5.0 inspection shape, with one deliberate wording change", () => {
    expect(inspection.chain.map((stage) => stage.rc)).toEqual([
      "RC4.4",
      "RC4.5",
      "RC4.7",
      "RC4.6",
      "RC4.8",
      "RC4.9",
    ]);
    // Deliberate RC5.1 drift, pinned so it stays deliberate: RC5.0 said
    // "…from the classified Coralina package"; the engine's summary is
    // project-agnostic. Recorded in docs/RC5_1_PROJECT_KNOWLEDGE_PLATFORM.md.
    expect(inspection.chain[0]!.summary).toBe(
      "6 source artifacts registered from the project's committed package; 0 validation issues.",
    );
    expect(inspection.projectName).toBe("CORALINA KAMALA");
    expect(inspection.copy?.kicker).toBe("Internal inspection — RC5.0 vertical slice");
    expect(inspection.copy?.footer).toContain("forever-data/projects/coralina");
  });

  it("delegates the RC5.0 API to the engine deterministically", () => {
    // Delegation + determinism (not an equivalence proof — see header note).
    expect(buildCoralinaKnowledgeSlice()).toEqual(slice);
    expect(describeCoralinaKnowledgeInspection(slice)).toEqual(inspection);
  });
});
