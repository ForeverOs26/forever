import { describe, expect, it } from "vitest";

import {
  validateConnectorConfiguration,
  validateConnectorDefinition,
  validateConnectorIdentity,
  validateConnectorRegistry,
  validateConnectorVersion,
  type ConnectorConfiguration,
  type ConnectorIdentity,
} from "..";
import { makeDefinition, makeEntry, makeIdentity, makeRegistry } from "./fixtures";

describe("identity validation", () => {
  it("accepts a well-formed identity", () => {
    expect(validateConnectorIdentity(makeIdentity())).toEqual([]);
  });

  it("flags missing fields and unknown protocol/system", () => {
    const identity = makeIdentity({
      id: "",
      slug: "",
      name: "",
      protocol: "smoke_signal" as ConnectorIdentity["protocol"],
      targetSystem: "carrier_pigeon" as ConnectorIdentity["targetSystem"],
    });
    const codes = validateConnectorIdentity(identity).map((i) => i.code);
    expect(codes).toContain("missing_connector_id");
    expect(codes).toContain("missing_connector_slug");
    expect(codes).toContain("missing_connector_name");
    expect(codes).toContain("unknown_protocol");
    expect(codes).toContain("unknown_target_system");
  });
});

describe("version validation", () => {
  it("rejects negative and non-integer parts", () => {
    const codes = validateConnectorVersion({ major: -1, minor: 1.5, patch: 0 }).map((i) => i.code);
    expect(codes).toEqual(["invalid_version_part", "invalid_version_part"]);
  });
});

describe("configuration validation", () => {
  it("accepts a well-formed schema", () => {
    expect(validateConnectorConfiguration(makeDefinition().configuration)).toEqual([]);
  });

  it("flags missing keys, duplicates, and enum coherence", () => {
    const configuration: ConnectorConfiguration = {
      fields: [
        { key: "", kind: "string", required: false, secret: false },
        { key: "dup", kind: "string", required: false, secret: false },
        { key: "dup", kind: "string", required: false, secret: false },
        { key: "mode", kind: "enum", required: false, secret: false },
        { key: "count", kind: "number", required: false, secret: false, enumValues: ["x"] },
      ],
    };
    const codes = validateConnectorConfiguration(configuration).map((i) => i.code);
    expect(codes).toContain("missing_config_key");
    expect(codes).toContain("duplicate_config_key");
    expect(codes).toContain("missing_enum_values");
    expect(codes).toContain("unexpected_enum_values");
  });
});

describe("definition validation", () => {
  it("accepts a complete definition", () => {
    expect(validateConnectorDefinition(makeDefinition())).toEqual([]);
  });

  it("requires supported entities and at least one direction", () => {
    const codes = validateConnectorDefinition(
      makeDefinition({ supportedEntities: [], directions: [] }),
    ).map((i) => i.code);
    expect(codes).toContain("no_supported_entities");
    expect(codes).toContain("no_directions");
  });

  it("flags a duplicate direction", () => {
    const codes = validateConnectorDefinition(
      makeDefinition({ directions: ["pull", "pull"] }),
    ).map((i) => i.code);
    expect(codes).toContain("duplicate_direction");
  });

  it("flags a duplicate capability", () => {
    const codes = validateConnectorDefinition(
      makeDefinition({
        capabilities: [
          { kind: "read", supported: true },
          { kind: "read", supported: false },
        ],
      }),
    ).map((i) => i.code);
    expect(codes).toContain("duplicate_capability");
  });
});

describe("registry validation", () => {
  it("accepts a coherent registry", () => {
    const result = validateConnectorRegistry(makeRegistry());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a missing registry id", () => {
    const result = validateConnectorRegistry(makeRegistry({ id: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("missing_registry_id");
  });

  it("rejects duplicate connector ids and natural keys", () => {
    const result = validateConnectorRegistry(makeRegistry({ entries: [makeEntry(), makeEntry()] }));
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("duplicate_connector_id");
    expect(codes).toContain("duplicate_connector_key");
    expect(result.valid).toBe(false);
  });

  it("surfaces an unknown status and health level as errors", () => {
    const entry = makeEntry({
      status: "paused" as never,
      health: { level: "great" as never },
    });
    const result = validateConnectorRegistry(makeRegistry({ entries: [entry] }));
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("unknown_status");
    expect(codes).toContain("unknown_health_level");
  });

  it("partitions warnings without invalidating the registry", () => {
    const entry = makeEntry({
      definition: makeDefinition({
        configuration: {
          fields: [{ key: "name", kind: "string", required: false, secret: false, enumValues: ["a"] }],
        },
      }),
    });
    const result = validateConnectorRegistry(makeRegistry({ entries: [entry] }));
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain("unexpected_enum_values");
  });
});
