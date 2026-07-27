import { describe, expect, it } from "vitest";

import {
  connectorCarries,
  connectorNeedsConfiguration,
  connectorSupports,
  defineConnector,
  defineConnectorProvider,
  emptyConnectorConfiguration,
  type ConnectorProvider,
} from "..";
import { makeDefinition } from "./fixtures";

describe("connector provider contract", () => {
  const provider: ConnectorProvider = defineConnectorProvider({
    definition: makeDefinition(),
  });

  it("reports carried entity kinds", () => {
    expect(connectorCarries(provider, "project")).toBe(true);
    expect(connectorCarries(provider, "developer")).toBe(false);
  });

  it("reports supported capabilities", () => {
    expect(connectorSupports(provider, "read")).toBe(true);
    expect(connectorSupports(provider, "write")).toBe(false);
  });

  it("reports whether configuration is required", () => {
    expect(connectorNeedsConfiguration(provider)).toBe(true);
    const configless = defineConnectorProvider({
      definition: defineConnector(
        makeDefinition({ configuration: emptyConnectorConfiguration() }),
      ),
    });
    expect(connectorNeedsConfiguration(configless)).toBe(false);
  });

  it("returns the provider unchanged", () => {
    expect(provider.definition).toEqual(makeDefinition());
  });
});
