import { describe, expect, it } from "vitest";

import { defineSourceProvider, sourceProvides, sourceSupports } from "..";
import { makeDefinition } from "./fixtures";

describe("SourceProvider contract", () => {
  const provider = defineSourceProvider({ definition: makeDefinition() });

  it("returns the provider unchanged from the identity helper", () => {
    const definition = makeDefinition();
    expect(defineSourceProvider({ definition }).definition).toBe(definition);
  });

  it("reports the entity kinds its source supplies", () => {
    expect(sourceProvides(provider, "project")).toBe(true);
    expect(sourceProvides(provider, "media")).toBe(true);
    expect(sourceProvides(provider, "developer")).toBe(false);
  });

  it("reports the capabilities its source declares", () => {
    expect(sourceSupports(provider, "read")).toBe(true);
    expect(sourceSupports(provider, "media")).toBe(true);
    expect(sourceSupports(provider, "write")).toBe(false);
  });
});
