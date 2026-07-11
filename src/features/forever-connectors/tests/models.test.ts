import { describe, expect, it } from "vitest";

import {
  CONNECTOR_CAPABILITY_KINDS,
  CONNECTOR_CONFIG_FIELD_KINDS,
  CONNECTOR_HEALTH_LEVELS,
  CONNECTOR_STATUSES,
  compareConnectorVersion,
  configFieldKeys,
  connectorCapability,
  connectorConfigField,
  connectorVersion,
  deriveConnectorHealthLevel,
  emptyConnectorConfiguration,
  formatConnectorVersion,
  hasConfigField,
  hasConnectorCapability,
  isFaultedConnectorStatus,
  isHealthyLevel,
  isKnownConnectorCapabilityKind,
  isKnownConnectorHealthLevel,
  isKnownConnectorStatus,
  isKnownConfigFieldKind,
  isUnhealthyLevel,
  isUsableConnectorStatus,
  requiredConfigFields,
  secretConfigFields,
  supportedConnectorCapabilityKinds,
  unknownConnectorHealth,
} from "..";

describe("capability model", () => {
  it("defaults to supported and detects declared capabilities", () => {
    const caps = [connectorCapability("read"), connectorCapability("write", false)];
    expect(caps[0]).toEqual({ kind: "read", supported: true });
    expect(hasConnectorCapability(caps, "read")).toBe(true);
    expect(hasConnectorCapability(caps, "write")).toBe(false);
    expect(supportedConnectorCapabilityKinds(caps)).toEqual(["read"]);
  });

  it("carries an optional note only when supplied", () => {
    expect(connectorCapability("stream", true, "SSE")).toEqual({
      kind: "stream",
      supported: true,
      note: "SSE",
    });
  });

  it("guards known capability kinds", () => {
    expect(CONNECTOR_CAPABILITY_KINDS.every(isKnownConnectorCapabilityKind)).toBe(true);
    expect(isKnownConnectorCapabilityKind("teleport")).toBe(false);
  });
});

describe("status model", () => {
  it("classifies usable and faulted statuses", () => {
    expect(isUsableConnectorStatus("ready")).toBe(true);
    expect(isUsableConnectorStatus("degraded")).toBe(true);
    expect(isUsableConnectorStatus("disabled")).toBe(false);
    expect(isFaultedConnectorStatus("error")).toBe(true);
    expect(isFaultedConnectorStatus("ready")).toBe(false);
  });

  it("guards known statuses", () => {
    expect(CONNECTOR_STATUSES.every(isKnownConnectorStatus)).toBe(true);
    expect(isKnownConnectorStatus("paused")).toBe(false);
  });
});

describe("health model", () => {
  it("defaults an unchecked connector to unknown, never healthy", () => {
    expect(unknownConnectorHealth()).toEqual({ level: "unknown" });
  });

  it("derives health from status without fabricating healthy", () => {
    expect(deriveConnectorHealthLevel("error")).toBe("unhealthy");
    expect(deriveConnectorHealthLevel("degraded")).toBe("degraded");
    expect(deriveConnectorHealthLevel("ready")).toBe("unknown");
    expect(deriveConnectorHealthLevel("configured")).toBe("unknown");
  });

  it("classifies health levels", () => {
    expect(isHealthyLevel("healthy")).toBe(true);
    expect(isHealthyLevel("unknown")).toBe(false);
    expect(isUnhealthyLevel("unhealthy")).toBe(true);
    expect(CONNECTOR_HEALTH_LEVELS.every(isKnownConnectorHealthLevel)).toBe(true);
    expect(isKnownConnectorHealthLevel("ok")).toBe(false);
  });
});

describe("version model", () => {
  it("formats and compares deterministically, ignoring the label in ordering", () => {
    expect(formatConnectorVersion(connectorVersion(1, 2, 3))).toBe("1.2.3");
    expect(formatConnectorVersion(connectorVersion(1, 2, 3, "draft"))).toBe("1.2.3-draft");
    expect(Math.sign(compareConnectorVersion(connectorVersion(1, 0, 0), connectorVersion(1, 1, 0)))).toBe(
      -1,
    );
    expect(compareConnectorVersion(connectorVersion(1, 0, 0, "a"), connectorVersion(1, 0, 0, "b"))).toBe(
      0,
    );
  });
});

describe("configuration model", () => {
  it("describes a schema of fields, never values", () => {
    const config = {
      fields: [
        connectorConfigField("base_url", "url", { required: true }),
        connectorConfigField("api_key", "secret", { required: true }),
        connectorConfigField("mode", "enum", { enumValues: ["live", "sandbox"] }),
      ],
    };
    expect(configFieldKeys(config)).toEqual(["base_url", "api_key", "mode"]);
    expect(requiredConfigFields(config).map((f) => f.key)).toEqual(["base_url", "api_key"]);
    expect(secretConfigFields(config).map((f) => f.key)).toEqual(["api_key"]);
    expect(hasConfigField(config, "mode")).toBe(true);
    expect(hasConfigField(config, "missing")).toBe(false);
  });

  it("marks secret kind as secret by default", () => {
    expect(connectorConfigField("token", "secret").secret).toBe(true);
    expect(connectorConfigField("name", "string").secret).toBe(false);
  });

  it("provides an empty configuration and guards field kinds", () => {
    expect(emptyConnectorConfiguration()).toEqual({ fields: [] });
    expect(CONNECTOR_CONFIG_FIELD_KINDS.every(isKnownConfigFieldKind)).toBe(true);
    expect(isKnownConfigFieldKind("xml")).toBe(false);
  });
});
