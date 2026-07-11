import { describe, expect, it } from "vitest";

import {
  connectorDefinitionKey,
  connectorIdentityKey,
  connectorSupportsDirection,
  connectorSyncSystem,
  isNonEmptyString,
} from "..";
import { makeDefinition, makeIdentity } from "./fixtures";

describe("deterministic helpers", () => {
  it("guards non-empty strings", () => {
    expect(isNonEmptyString("x")).toBe(true);
    expect(isNonEmptyString("   ")).toBe(false);
    expect(isNonEmptyString(undefined)).toBe(false);
    expect(isNonEmptyString(0)).toBe(false);
  });

  it("builds a natural key independent of the surrogate id", () => {
    const key = connectorIdentityKey(makeIdentity());
    expect(key).toBe("http:website:developer-website");
    expect(connectorIdentityKey(makeIdentity({ id: "conn_other" }))).toBe(key);
    expect(connectorDefinitionKey(makeDefinition())).toBe(key);
  });

  it("reads the bound sync system and direction support", () => {
    const definition = makeDefinition();
    expect(connectorSyncSystem(definition)).toBe("website");
    expect(connectorSupportsDirection(definition, "pull")).toBe(true);
    expect(connectorSupportsDirection(definition, "push")).toBe(false);
  });
});
