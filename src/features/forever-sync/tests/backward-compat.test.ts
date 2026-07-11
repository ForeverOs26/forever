import { describe, expect, it } from "vitest";

import {
  foreverDatabaseEntities,
  validateForeverDatabaseRecord,
  type ForeverDatabaseRecord,
  type ForeverProject,
} from "@/features/forever-database";
import type { ImportSourceKind } from "@/features/forever-import";

import { validateSyncPlan, type SyncEntityKind, type SyncPlan } from "..";

/**
 * RC3.2 is additive: it consumes the RC3.0 canonical models and the RC3.1
 * import contracts read-only, and validates the same records the database
 * foundation accepts. These tests pin that contract so the sync foundation can
 * never drift away from the database it moves and the import rules it reuses.
 */

const project: ForeverProject = {
  id: "p-1",
  slug: "coralina-residences",
  name: "Coralina Residences",
  projectType: "condominium",
  publicStatus: "active",
  salesStatus: "available",
  constructionStatus: "under_construction",
  ownershipType: "freehold",
  raw: {
    publicStatus: "Active",
    salesStatus: "Available",
    constructionStatus: "Under construction",
    ownershipType: "Freehold",
  },
  highlights: [],
  pricing: {},
  trust: { foreverVerified: false },
  isFeatured: false,
  isActive: true,
};

describe("backward compatibility with RC3.0 and RC3.1", () => {
  it("reuses the RC3.1 entity kinds rather than redefining a taxonomy", () => {
    // SyncEntityKind is exactly the RC3.1 ImportSourceKind — assignable both ways.
    const kind: SyncEntityKind = "project";
    const importKind: ImportSourceKind = kind;
    expect(importKind).toBe("project");
  });

  it("shares the RC3.0 entity identity used by import validation", () => {
    expect(foreverDatabaseEntities.project.tableName).toBe("forever_projects");
    expect(foreverDatabaseEntities.media.primaryKey).toBe("id");
  });

  it("validates a payload the RC3.0 database foundation also accepts", () => {
    const plan: SyncPlan = {
      job: {
        id: "job-1",
        name: "Publish project",
        direction: "push",
        entityKind: "project",
        source: {
          id: "fdb",
          role: "source",
          system: "forever_database",
          protocol: "memory",
          label: "DB",
        },
        target: {
          id: "web",
          role: "target",
          system: "website",
          protocol: "http",
          label: "Web",
        },
        enabled: true,
      },
      payload: { projects: [project] },
    };
    expect(validateSyncPlan(plan).valid).toBe(true);

    const record: ForeverDatabaseRecord = {
      project,
      developer: null,
      location: null,
      units: [],
      media: [],
      documents: [],
      paymentPlans: [],
      constructionProgress: [],
      rentalInformation: [],
      investmentInformation: [],
    };
    expect(validateForeverDatabaseRecord(record).valid).toBe(true);
  });
});
