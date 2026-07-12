import { describe, expect, it } from "vitest";

import { FACTORY_STAGE_KINDS, factoryStage, factoryStep, isKnownFactoryStageKind } from "..";

describe("factory stages", () => {
  it("guards the closed stage-kind vocabulary in generation order", () => {
    expect(FACTORY_STAGE_KINDS).toEqual(["prepare", "generate", "assemble", "verify"]);
    for (const kind of FACTORY_STAGE_KINDS) {
      expect(isKnownFactoryStageKind(kind)).toBe(true);
    }
    expect(isKnownFactoryStageKind("deploy")).toBe(false);
  });

  it("builds a stage that attaches continueOnError only when supplied", () => {
    const steps = [factoryStep("a", "A", "identity")];
    const stage = factoryStage("prepare", "Prepare", "prepare", steps);
    expect(stage).toEqual({ id: "prepare", name: "Prepare", kind: "prepare", steps });
    expect("continueOnError" in stage).toBe(false);

    const gated = factoryStage("verify", "Verify", "verify", [], { continueOnError: false });
    expect(gated.continueOnError).toBe(false);
  });
});
