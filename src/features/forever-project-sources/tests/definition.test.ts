import { describe, expect, it } from "vitest";

import { defineProjectSource, describeProjectSource, projectSourceVersion } from "..";
import { makeInput, makeSource } from "./fixtures";

describe("describeProjectSource", () => {
  it("describes a fully supplied source, deriving the version-addressed identity", () => {
    const source = describeProjectSource(makeInput());
    expect(source.identity).toEqual({
      id: "psrc_coralina-price-list-v1-0-0",
      slug: "price-list",
      name: "Coralina Price List",
      projectId: "proj_coralina",
    });
    expect(source.descriptor).toEqual({
      documentType: "price_list",
      fileFormat: "pdf",
      language: "en",
      uploadedAt: "2026-01-01T00:00:00.000Z",
      documentDate: "2025-12-15",
    });
    expect(source.version).toEqual(projectSourceVersion(1, 0, 0));
    expect(source.authority).toEqual({ kind: "developer_official", trust: "high" });
    expect(source.status).toBe("registered");
    expect(source.origin).toBe("developer_website");
    expect(source.relationships).toBeUndefined();
    expect(source.policy).toBeUndefined();
    expect(source.metadata).toBeUndefined();
  });

  it("defaults every unstated fact to the explicit safe posture, never an invented one", () => {
    const source = describeProjectSource({
      projectSlug: "coralina",
      sourceSlug: "Master Plan",
      documentType: "master_plan",
      fileFormat: "image",
    });
    expect(source.identity.id).toBe("psrc_coralina-master-plan-v1-0-0");
    expect(source.identity.name).toBe("master-plan");
    expect(source.version).toEqual(projectSourceVersion(1, 0, 0));
    expect(source.authority).toEqual({ kind: "unknown", trust: "unverified" });
    expect(source.status).toBe("registered");
    expect(source.origin).toBe("unknown");
    expect(source.descriptor).toEqual({ documentType: "master_plan", fileFormat: "image" });
  });

  it("keeps two revisions of the same document distinct by id and version", () => {
    const v1 = describeProjectSource(makeInput());
    const v2 = describeProjectSource(makeInput({ version: projectSourceVersion(2, 0, 0) }));
    expect(v1.identity.id).not.toBe(v2.identity.id);
    expect(v1.identity.slug).toBe(v2.identity.slug);
    expect(v1.identity.projectId).toBe(v2.identity.projectId);
  });
});

describe("defineProjectSource", () => {
  it("returns the definition unchanged", () => {
    const source = makeSource();
    expect(defineProjectSource(source)).toBe(source);
  });
});
