import { describe, expect, it } from "vitest";

import {
  appendProjectFieldValue,
  currentProjectFieldValue,
  describeProjectField,
  projectFieldConfidence,
  removedProjectFieldValues,
  supersededProjectFieldValues,
} from "..";
import { makeField, makeValue } from "./fixtures";

describe("describeProjectField", () => {
  it("derives id, project, and section deterministically from the path", () => {
    const field = describeProjectField({ projectSlug: "coralina", path: "pricing.basePrice" });
    expect(field.id).toBe("pfld_coralina-pricing-baseprice");
    expect(field.projectId).toBe("proj_coralina");
    expect(field.section).toBe("pricing");
    expect(field.name).toBe("pricing.basePrice");
    expect(field.values).toEqual([]);
    expect(field.validationStatus).toBe("unvalidated");
  });

  it("classifies an unmapped path as the explicit unknown, never a guess", () => {
    expect(describeProjectField({ projectSlug: "coralina", path: "floorplan.a" }).section).toBe(
      "unknown",
    );
    expect(
      describeProjectField({ projectSlug: "coralina", path: "floorplan.a", section: "media" })
        .section,
    ).toBe("media");
  });

  it("is pure and never aliases its input", () => {
    const values = [makeValue()];
    const field = describeProjectField({
      projectSlug: "coralina",
      path: "pricing.basePrice",
      values,
    });
    expect(field.values).toEqual(values);
    expect(field.values).not.toBe(values);
    field.values.pop();
    expect(values).toHaveLength(1);
    expect(
      describeProjectField({ projectSlug: "coralina", path: "pricing.basePrice", values }),
    ).toEqual({ ...field, values });
  });
});

describe("field value tracking", () => {
  it("resolves the standing value: the last current entry of the history", () => {
    const superseded = makeValue({ status: "superseded", supersededBy: "xfact_x" });
    const current = makeValue({ rawValue: "THB 4,700,000" });
    const field = makeField({ values: [superseded, current] });
    expect(currentProjectFieldValue(field)).toEqual(current);
    expect(projectFieldConfidence(field)).toEqual(current.confidence);
  });

  it("reports no standing value — and no confidence — when nothing stands", () => {
    const field = makeField({ values: [makeValue({ status: "superseded" })] });
    expect(currentProjectFieldValue(field)).toBeUndefined();
    expect(projectFieldConfidence(field)).toBeUndefined();
    expect(currentProjectFieldValue(makeField({ values: [] }))).toBeUndefined();
  });

  it("filters superseded and removed history entries in order", () => {
    const a = makeValue({ status: "superseded", rawValue: "a" });
    const b = makeValue({ status: "removed", rawValue: undefined, structuredValue: undefined });
    const c = makeValue({ status: "superseded", rawValue: "c" });
    const field = makeField({ values: [a, b, c, makeValue()] });
    expect(supersededProjectFieldValues(field)).toEqual([a, c]);
    expect(removedProjectFieldValues(field)).toEqual([b]);
  });

  it("appends history immutably — the input field is never mutated", () => {
    const field = makeField();
    const snapshot = structuredClone(field);
    const grown = appendProjectFieldValue(
      field,
      makeValue({ status: "missing", rawValue: undefined, structuredValue: undefined }),
    );
    expect(field).toEqual(snapshot);
    expect(grown.values).toHaveLength(field.values.length + 1);
    expect(grown.values.slice(0, field.values.length)).toEqual(field.values);
  });
});
