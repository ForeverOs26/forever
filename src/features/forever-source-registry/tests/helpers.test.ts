import { describe, expect, it } from "vitest";

import {
  isNonEmptyString,
  sourceDefinitionKey,
  sourceIdentityKey,
  sourceTypeToImportFormat,
  sourceTypeToSyncSystem,
} from "..";
import { makeDefinition, makeIdentity } from "./fixtures";

describe("deterministic helpers", () => {
  it("guards non-empty strings", () => {
    expect(isNonEmptyString("x")).toBe(true);
    expect(isNonEmptyString("  ")).toBe(false);
    expect(isNonEmptyString(undefined)).toBe(false);
    expect(isNonEmptyString(3)).toBe(false);
  });

  it("builds a stable identity key independent of the surrogate id", () => {
    const key = sourceIdentityKey(makeIdentity());
    expect(key).toBe("developer_website:developer-website");
    expect(sourceIdentityKey(makeIdentity({ id: "other" }))).toBe(key);
    expect(sourceDefinitionKey(makeDefinition())).toBe(key);
  });

  it("bridges a source type to the RC3.1 import format", () => {
    expect(sourceTypeToImportFormat("pdf")).toBe("pdf");
    expect(sourceTypeToImportFormat("developer_website")).toBe("website");
    expect(sourceTypeToImportFormat("manual_entry")).toBe("manual");
    expect(sourceTypeToImportFormat("marketplace")).toBeUndefined();
  });

  it("bridges a source type to the RC3.2 sync system", () => {
    expect(sourceTypeToSyncSystem("developer_website")).toBe("website");
    expect(sourceTypeToSyncSystem("ai_agent")).toBe("ai_agents");
    expect(sourceTypeToSyncSystem("forever_database")).toBe("forever_database");
    expect(sourceTypeToSyncSystem("pdf")).toBeUndefined();
  });
});
