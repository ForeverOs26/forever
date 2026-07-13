import { describe, expect, it } from "vitest";

import {
  buildCoralinaImportPayload,
  validateCoralinaImportPayload,
} from "../adapters/coralina-import-payload";
import { CORALINA_PROJECT_ID } from "../identity";

describe("Coralina import payload (RC3.1)", () => {
  it("builds a deterministic payload with the RC3.1 batch shape", () => {
    const a = buildCoralinaImportPayload();
    const b = buildCoralinaImportPayload();
    expect(a.batch).toEqual(b.batch);
    expect(a.batch.projects).toHaveLength(1);
    expect(a.batch.units).toHaveLength(198);
    expect(a.batch.media?.length).toBeGreaterThan(0);
    expect(a.batch.documents?.length).toBeGreaterThan(0);
    expect(a.batch.developers).toHaveLength(1);
    expect(a.batch.developers?.[0]?.verificationStatus).toBe("verified");
  });

  it("carries the canonical inferred currency without an import-context fallback", () => {
    const payload = buildCoralinaImportPayload();
    expect(payload.context.defaultCurrency).toBeUndefined();
    expect(payload.batch.units?.every((unit) => unit.basePrice?.currency === "THB")).toBe(true);
    expect(
      payload.batch.units?.every(
        (unit) =>
          (unit.source?.raw?.currencyDecision as { status?: string } | undefined)?.status ===
          "inferred_default",
      ),
    ).toBe(true);
    expect(payload.source.format).toBe("manual");
  });

  it("passes RC3.1 validation (ids, duplicates, references) with the location scope", () => {
    const validation = validateCoralinaImportPayload();
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
  });

  it("fails RC3.1 reference validation when the location scope is dropped", () => {
    // project.locationId only resolves via the supplied ReferenceScope; without it
    // the RC3.1 pipeline must flag the unresolved reference — proving the check runs.
    const payload = buildCoralinaImportPayload();
    const validation = validateCoralinaImportPayload({ ...payload, scope: {} });
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.code === "unresolved_reference")).toBe(true);
  });

  it("keeps every unit and media pointed at the Coralina project", () => {
    const { batch } = buildCoralinaImportPayload();
    expect(batch.units?.every((u) => u.projectId === CORALINA_PROJECT_ID)).toBe(true);
    expect(batch.media?.every((m) => m.projectId === CORALINA_PROJECT_ID)).toBe(true);
    expect(batch.documents?.every((d) => d.projectId === CORALINA_PROJECT_ID)).toBe(true);
  });
});
