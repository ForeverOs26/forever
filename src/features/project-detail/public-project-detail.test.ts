import { QueryClient, dehydrate, hydrate } from "@tanstack/react-query";
import { defaultSerovalPlugins } from "@tanstack/router-core";
import { crossSerialize } from "seroval";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  makeAmenity,
  makeMediaItem,
  makeProjectDetail,
  makeUnit,
} from "@/features/forever-database/tests/fixtures";

import { buildDecisionDeckModel } from "./decision-deck-model";
import { loadProjectDetailRouteData } from "./project-detail-route-loader";
import { ProjectDetailService } from "./project-detail-service";
import { publicProjectDetail, type PublicProjectDetailDTO } from "./public-project-detail";

const FORBIDDEN_PROJECT_KEYS = [
  "core",
  "trust",
  "investment",
  "ownershipType",
  "metadata",
] as const;

const FORBIDDEN_UNIT_KEYS = [
  "ownershipType",
  "paymentPlan",
  "furniturePackage",
  "rentalGuarantee",
  "roiEstimate",
  "notes",
] as const;

const FORBIDDEN_RECURSIVE_KEYS = [
  ...FORBIDDEN_PROJECT_KEYS,
  ...FORBIDDEN_UNIT_KEYS,
  "contactName",
  "contactPhone",
  "contactEmail",
  "title",
  "label",
  "bathrooms",
  "viewType",
  "pricePerSqm",
  "sourcePath",
  "foreverVerified",
  "trustScore",
  "trustNote",
  "marketPosition",
  "verdict",
  "lastInspection",
  "investmentValue",
  "rentalYield",
  "rentalDemand",
  "capitalGrowthEstimate",
  "rows",
  "managementCompany",
] as const;

function recursiveOwnKeyHits(
  value: unknown,
  forbiddenKeys: readonly string[],
  path = "$",
): string[] {
  if (!value || typeof value !== "object") return [];
  const result: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (forbiddenKeys.includes(key)) result.push(childPath);
    result.push(...recursiveOwnKeyHits(child, forbiddenKeys, childPath));
  }
  return result;
}

function hydrateSeroval<T>(value: T): { serialized: string; hydrated: T } {
  const serialized = crossSerialize(value, { plugins: defaultSerovalPlugins });
  const hydrated = Function(`"use strict"; const $R = []; return (${serialized})`)() as T;
  return { serialized, hydrated };
}

describe("public Project Detail loader boundary", () => {
  it("types the public service as the narrow DTO rather than ProjectDetail", () => {
    expectTypeOf(ProjectDetailService.getBySlug).returns.toEqualTypeOf<
      Promise<PublicProjectDetailDTO | null>
    >();
  });

  it("constructs exact allowlisted DTOs and omits forbidden properties regardless of value", () => {
    const project = makeProjectDetail({
      core: {
        ownershipType: "",
        developerNameRaw: "Conflicting Holdings",
        tagline: "synthetic-private-sentinel",
        description: "synthetic-private-sentinel",
        highlights: ["synthetic-private-sentinel"],
      },
      pricing: {
        startingPriceTHB: 5_000_000,
        lastPriceUpdate: "2026-07-30",
      },
      developer: {
        id: "developer",
        name: "Canonical Development",
        description: "synthetic-private-sentinel",
        website: "https://canonical.example",
        contactName: "synthetic-private-sentinel",
        contactPhone: "synthetic-private-sentinel",
        contactEmail: "synthetic-private-sentinel",
        logoUrl: "",
      },
      media: {
        hero: makeMediaItem({
          id: "hero",
          title: "synthetic-private-sentinel",
          url: "https://cdn.example.com/public-project-photo.jpg",
        }),
        documents: [
          {
            ...makeMediaItem({
              id: "document",
              type: "document",
              url: "https://cdn.example.com/public-project-map.pdf",
              semanticRole: "map",
            }),
            label: "synthetic-private-sentinel",
            note: "synthetic-private-sentinel",
          },
        ],
      },
      units: [
        makeUnit({
          buildingCode: "A",
          type: "Condominium",
          bedrooms: 1,
          sizeSqm: 42,
          floor: 4,
          basePriceTHB: 5_000_000,
          discountedPriceTHB: 4_900_000,
          ownershipType: undefined as unknown as string,
          paymentPlan: null as unknown as string,
          furniturePackage: false as unknown as string,
          rentalGuarantee: 0 as unknown as string,
          roiEstimate: [] as unknown as string,
          notes: {} as unknown as string,
        }),
      ],
      amenities: [
        makeAmenity({
          id: "pool",
          slug: "pool",
          name: "Pool",
          category: "Wellness",
          icon: "waves",
          note: "Recorded amenity",
          isFeatured: true,
          sortOrder: 2,
        }),
      ],
      investment: {
        investmentValue: 9.7,
        rentalYield: "synthetic-private-sentinel",
        rentalDemand: "synthetic-private-sentinel",
        capitalGrowthEstimate: "synthetic-private-sentinel",
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
            managementCompany: "synthetic-private-sentinel",
            notes: "synthetic-private-sentinel",
          },
        ],
      },
    });
    (project as unknown as Record<string, unknown>).metadata = {
      sourcePath: "synthetic-private-sentinel",
    };
    (project.media.hero as unknown as Record<string, unknown>).metadata = {
      sourcePath: "synthetic-private-sentinel",
    };
    (project.units[0] as unknown as Record<string, unknown>).unknownExtra = {
      sourcePath: "synthetic-private-sentinel",
    };

    const result = publicProjectDetail(project);
    const unit = result.units?.[0];
    const media = result.media?.photographs?.[0];
    const document = result.media?.documents?.[0];
    const amenity = result.amenities?.[0];

    expect(Object.keys(result).sort()).toEqual(
      [
        "constructionStatus",
        "developer",
        "amenities",
        "id",
        "location",
        "media",
        "name",
        "pricing",
        "projectType",
        "slug",
        "status",
        "units",
      ].sort(),
    );
    expect(Object.keys(unit ?? {}).sort()).toEqual(
      [
        "availabilityStatus",
        "basePriceTHB",
        "bedrooms",
        "buildingCode",
        "code",
        "discountedPriceTHB",
        "floor",
        "id",
        "sizeSqm",
        "type",
      ].sort(),
    );
    expect(Object.keys(media ?? {}).sort()).toEqual(["id", "sortOrder", "type", "url"].sort());
    expect(Object.keys(document ?? {}).sort()).toEqual(
      ["id", "isMap", "sortOrder", "type", "url"].sort(),
    );
    expect(Object.keys(result.media ?? {}).sort()).toEqual(["documents", "photographs"]);
    expect(Object.keys(result.location ?? {}).sort()).toEqual(["address", "area"]);
    expect(Object.keys(result.pricing ?? {}).sort()).toEqual([
      "lastPriceUpdate",
      "startingPriceTHB",
    ]);
    expect(Object.keys(result.developer ?? {}).sort()).toEqual(["state"]);
    expect(Object.keys(amenity ?? {}).sort()).toEqual(
      ["category", "icon", "id", "isFeatured", "name", "note", "slug", "sortOrder"].sort(),
    );

    for (const key of FORBIDDEN_PROJECT_KEYS) {
      expect(result).not.toHaveProperty(key);
      expect(Object.hasOwn(result, key)).toBe(false);
    }
    for (const key of FORBIDDEN_UNIT_KEYS) {
      expect(unit).not.toHaveProperty(key);
      expect(Object.hasOwn(unit ?? {}, key)).toBe(false);
    }
    expect(result.developer).toEqual({ state: "withheld" });
    expect(recursiveOwnKeyHits(result, FORBIDDEN_RECURSIVE_KEYS)).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("synthetic-private-sentinel");

    const model = buildDecisionDeckModel(result);
    expect(model.developer.state).toBe("conflicting");
    expect(model.decisionRail.ownership.state).toBe("withheld");
  });

  it("publishes only a resolved developer identity and never contact properties", () => {
    const result = publicProjectDetail(
      makeProjectDetail({
        core: { developerNameRaw: "Canonical Development Co., Ltd." },
        developer: {
          id: "developer",
          name: "Canonical Development",
          description: "Recorded public profile",
          website: "https://canonical.example",
          contactName: "synthetic-private-sentinel",
          contactPhone: "synthetic-private-sentinel",
          contactEmail: "synthetic-private-sentinel",
          logoUrl: "https://canonical.example/logo.png",
        },
      }),
    );

    expect(result.developer).toEqual({
      state: "resolved",
      id: "developer",
      name: "Canonical Development",
      verified: true,
      description: "Recorded public profile",
      website: "https://canonical.example",
      logoUrl: "https://canonical.example/logo.png",
    });
    expect(recursiveOwnKeyHits(result, ["contactName", "contactPhone", "contactEmail"])).toEqual(
      [],
    );
  });

  it("keeps forbidden keys absent through route loading, TanStack Query hydration, and TanStack Router Seroval", async () => {
    const project = publicProjectDetail(
      makeProjectDetail({
        core: {
          isDemoPreview: true,
          ownershipType: "synthetic-private-sentinel",
        },
        units: [
          makeUnit({
            ownershipType: "synthetic-private-sentinel",
            paymentPlan: "synthetic-private-sentinel",
            furniturePackage: "synthetic-private-sentinel",
            rentalGuarantee: "synthetic-private-sentinel",
            roiEstimate: "synthetic-private-sentinel",
            notes: "synthetic-private-sentinel",
          }),
        ],
      }),
    );
    const routeQueryClient = {
      ensureQueryData: async () => project,
    } as unknown as QueryClient;
    const routeResult = await loadProjectDetailRouteData(routeQueryClient, project.slug);

    const sourceClient = new QueryClient();
    sourceClient.setQueryData(["project-detail", project.slug], project);
    const dehydrated = dehydrate(sourceClient);
    const hydratedClient = new QueryClient();
    hydrate(hydratedClient, dehydrated);
    const queryHydrated = hydratedClient.getQueryData<PublicProjectDetailDTO>([
      "project-detail",
      project.slug,
    ]);

    const routerPayload = {
      matches: [{ i: "/projects/$slug", l: routeResult }],
    };
    const { serialized, hydrated: routerHydrated } = hydrateSeroval(routerPayload);

    for (const value of [routeResult.project, queryHydrated, routerHydrated]) {
      expect(recursiveOwnKeyHits(value, FORBIDDEN_RECURSIVE_KEYS)).toEqual([]);
    }
    for (const key of FORBIDDEN_UNIT_KEYS) {
      expect(serialized).not.toContain(key);
      expect(JSON.stringify(routeResult)).not.toContain(`"${key}"`);
    }
    expect(serialized).not.toContain("synthetic-private-sentinel");
  });
});
