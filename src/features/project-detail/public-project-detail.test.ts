import { describe, expect, it } from "vitest";

import {
  makeMediaItem,
  makeProjectDetail,
  makeUnit,
} from "@/features/forever-database/tests/fixtures";

import { publicProjectDetail } from "./public-project-detail";
import { buildDecisionDeckModel } from "./decision-deck-model";

describe("public Project Detail loader boundary", () => {
  it("removes conflicting speakers, unsupported ownership and source-facing metadata", () => {
    const project = makeProjectDetail({
      core: {
        ownershipType: "Freehold",
        developerNameRaw: "Conflicting Holdings",
        tagline: "Conflicting Holdings launch",
        description: "Internal owner prose",
        highlights: ["Unpublished highlight"],
      },
      developer: {
        id: "developer",
        name: "Canonical Development",
        description: "Canonical Development profile",
        website: "https://canonical.example",
        contactName: "Private contact",
        contactPhone: "+66 00 000 0000",
        contactEmail: "private@example.com",
        logoUrl: "",
      },
      media: {
        hero: makeMediaItem({
          id: "hero",
          title: "C:\\owner\\source\\Canonical Development.jpg",
        }),
        documents: [
          {
            ...makeMediaItem({ id: "document", type: "document" }),
            label: "Owner-only proof",
            note: "source_file_url=C:\\owner\\proof.pdf",
          },
        ],
      },
      units: [
        makeUnit({
          ownershipType: "Leasehold",
          paymentPlan: "Private payment terms",
          notes: "Internal unit note",
        }),
      ],
      investment: {
        investmentValue: 9.7,
        rentalYield: "9%",
        rentalDemand: "Very high",
        capitalGrowthEstimate: "8%",
        rows: [
          {
            id: "private-row",
            projectId: "project",
            unitId: null,
            expectedDailyRate: 1,
            expectedMonthlyRent: 1,
            expectedYearlyRent: 1,
            occupancyRate: 1,
            annualRoiPercent: 1,
            guaranteedRentalPercent: 1,
            guaranteeYears: 1,
            managementCompany: "Private manager",
            notes: "Private analysis",
          },
        ],
      },
    });
    (project as unknown as Record<string, unknown>).metadata = {
      sourcePath: "C:\\owner\\project.json",
    };
    (project.media.hero as unknown as Record<string, unknown>).metadata = {
      privateLabel: "Owner source metadata",
    };
    (project.units[0] as unknown as Record<string, unknown>).metadata = {
      privateLabel: "Owner unit metadata",
    };

    const safe = publicProjectDetail(project);
    const serialized = JSON.stringify(safe);

    for (const prohibited of [
      "Freehold",
      "Leasehold",
      "Conflicting Holdings",
      "Canonical Development",
      "Private contact",
      "private@example.com",
      "Owner-only proof",
      "source_file_url",
      "Private payment terms",
      "Internal unit note",
      "Private manager",
      "Private analysis",
      "Very high",
      "sourcePath",
      "Owner source metadata",
      "Owner unit metadata",
    ]) {
      expect(serialized).not.toContain(prohibited);
    }
    expect(safe.developer).toBeNull();
    const model = buildDecisionDeckModel(safe);
    expect(model.developer.state).toBe("conflicting");
    expect(model.decisionRail.ownership.state).toBe("withheld");
    expect(safe.investment.rows).toEqual([]);
    expect(safe.media.hero?.url).toBe(project.media.hero?.url);
  });

  it("preserves a supported canonical developer while discarding the redundant raw speaker", () => {
    const project = makeProjectDetail({
      core: { developerNameRaw: "Canonical Development Co., Ltd." },
      developer: {
        id: "developer",
        name: "Canonical Development",
        description: "Recorded public profile",
        website: "https://canonical.example",
        contactName: "Private contact",
        contactPhone: "123",
        contactEmail: "private@example.com",
        logoUrl: "",
      },
    });

    const safe = publicProjectDetail(project);

    expect(safe.core.developerNameRaw).toBe("");
    expect(safe.developer).toMatchObject({
      name: "Canonical Development",
      description: "Recorded public profile",
      website: "https://canonical.example",
      contactName: "",
      contactPhone: "",
      contactEmail: "",
    });
  });
});
