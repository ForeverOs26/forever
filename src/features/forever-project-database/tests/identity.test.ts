import { describe, expect, it } from "vitest";

import {
  PROJECT_DATABASE_ID_PREFIXES,
  deriveProjectRecordIdentity,
  normalizeProjectDatabaseSlug,
  projectDatabaseProjectId,
  projectFieldIdFor,
  projectMergeIdFor,
  projectRecordIdFor,
  projectRevisionIdFor,
  projectSnapshotIdFor,
} from "..";

describe("identity derivation", () => {
  it("derives the record id from the project slug alone — one record per project", () => {
    expect(projectRecordIdFor("coralina")).toBe("prec_coralina");
    expect(projectRecordIdFor("Coralina Beach!")).toBe("prec_coralina-beach");
  });

  it("derives field ids from the project slug and canonical path", () => {
    expect(projectFieldIdFor("coralina", "pricing.basePrice")).toBe(
      "pfld_coralina-pricing-baseprice",
    );
    expect(projectFieldIdFor("coralina", "general.name")).toBe("pfld_coralina-general-name");
  });

  it("derives revision, snapshot, and merge ids that carry the sequence number", () => {
    expect(projectRevisionIdFor("coralina", 1)).toBe("prev_coralina-r1");
    expect(projectRevisionIdFor("coralina", 2)).toBe("prev_coralina-r2");
    expect(projectSnapshotIdFor("coralina", 2)).toBe("psnap_coralina-r2");
    expect(projectMergeIdFor("coralina", 2)).toBe("pmrg_coralina-r2");
  });

  it("repeated revisions never collide: distinct numbers derive distinct ids", () => {
    const ids = [1, 2, 3, 10].map((n) => projectRevisionIdFor("coralina", n));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps every prefix distinct across the id conventions", () => {
    const prefixes = Object.values(PROJECT_DATABASE_ID_PREFIXES);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("derives a full identity deterministically, defaulting the name to the slug", () => {
    const identity = deriveProjectRecordIdentity("Coralina Beach");
    expect(identity).toEqual({
      id: "prec_coralina-beach",
      slug: "coralina-beach",
      name: "coralina-beach",
      projectId: "proj_coralina-beach",
    });
    expect(deriveProjectRecordIdentity("Coralina Beach")).toEqual(identity);
    expect(deriveProjectRecordIdentity("coralina", { name: "Coralina" }).name).toBe("Coralina");
  });

  it("addresses the project through the reused RC4.2 `proj_` convention", () => {
    expect(projectDatabaseProjectId("coralina")).toBe("proj_coralina");
    expect(deriveProjectRecordIdentity("coralina").projectId).toBe(
      projectDatabaseProjectId(normalizeProjectDatabaseSlug("coralina")),
    );
  });
});
