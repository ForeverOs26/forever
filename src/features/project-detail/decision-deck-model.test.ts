import { describe, expect, it } from "vitest";

import {
  makeAmenity,
  makeMediaItem,
  makeProjectDetail,
  makeUnit,
} from "@/features/forever-database/tests/fixtures";

import {
  buildDecisionDeckModel,
  DECISION_DECK_COMPOSITION_ORDER,
  DECISION_DECK_SECTION_ORDER,
  isDirectPlayableProjectFilmUrl,
} from "./decision-deck-model";
import type { ProjectDetailDocument, ProjectDetailMediaItem } from "./project-detail-types";

function document(type: string, id: string, url: string): ProjectDetailDocument {
  return {
    ...makeMediaItem({ id, type, title: `Private-looking ${type} title`, url }),
    label: `Private-looking ${type} label`,
    note: "Available",
  };
}

describe("Decision Deck composition", () => {
  it("pins the approved 16-part composition and derives nav from the 13 optional body sections", () => {
    expect(DECISION_DECK_COMPOSITION_ORDER).toEqual([
      "media",
      "decision-rail",
      "compact-passport",
      "overview",
      "featured-amenities",
      "units",
      "film",
      "plans",
      "passport",
      "intelligence",
      "amenities",
      "location",
      "developer",
      "updates",
      "documents",
      "related",
    ]);
    expect(DECISION_DECK_SECTION_ORDER).toEqual(DECISION_DECK_COMPOSITION_ORDER.slice(3));

    const project = makeProjectDetail({
      pricing: { lastPriceUpdate: "2026-07-30" },
      trust: { verdict: "Selective fit" },
      amenities: [makeAmenity({ isFeatured: true })],
      units: [makeUnit()],
      media: {
        videos: [
          makeMediaItem({
            id: "film",
            type: "video",
            url: "/media/project-film.mp4",
          }),
        ],
        masterPlan: makeMediaItem({
          id: "master",
          type: "master_plan",
          url: "/media/master.webp",
        }),
        floorPlans: [
          makeMediaItem({
            id: "floor",
            type: "floor_plan",
            url: "/media/floor.webp",
          }),
        ],
        unitPlans: [
          makeMediaItem({
            id: "unit-plan",
            type: "unit_plan",
            url: "/media/unit.webp",
          }),
        ],
        documents: [document("document", "document", "/documents/facts.pdf")],
      },
    });
    const model = buildDecisionDeckModel(project, {
      relatedProjects: [
        {
          slug: "published-neighbour",
          name: "Published neighbour",
          isPublished: true,
          isActive: true,
        },
      ],
    });

    expect(model.sections.map((section) => section.id)).toEqual(
      DECISION_DECK_SECTION_ORDER.filter((id) => id !== "passport" && id !== "intelligence"),
    );
    expect(model.navigation).toBe(model.sections);
    expect(model.navigation.map((section) => section.id)).not.toContain("media");
    expect(model.navigation.map((section) => section.id)).not.toContain("decision-rail");
    expect(model.navigation.map((section) => section.id)).not.toContain("compact-passport");
  });

  it("hides both amenity sections at zero and caps featured canonical amenities at eight", () => {
    const emptyModel = buildDecisionDeckModel(makeProjectDetail({ amenities: [] }));
    expect(emptyModel.amenities.featured.state).toBe("empty");
    expect(emptyModel.amenities.all.state).toBe("empty");
    expect(emptyModel.sections.map((section) => section.id)).not.toContain("featured-amenities");
    expect(emptyModel.sections.map((section) => section.id)).not.toContain("amenities");

    const amenities = [
      makeAmenity({
        id: "ordinary",
        name: "Ordinary",
        isFeatured: false,
        sortOrder: 0,
      }),
      ...Array.from({ length: 10 }, (_, index) =>
        makeAmenity({
          id: `featured-${index}`,
          slug: `featured-${index}`,
          name: `Featured ${index}`,
          category: index % 2 ? "Wellness" : "Leisure",
          isFeatured: true,
          sortOrder: 9 - index,
        }),
      ),
    ];
    const model = buildDecisionDeckModel(makeProjectDetail({ amenities }));

    expect(model.amenities.featured.state).toBe("supported");
    expect(model.amenities.all.state).toBe("supported");
    if (
      model.amenities.featured.state !== "supported" ||
      model.amenities.all.state !== "supported"
    ) {
      throw new Error("expected canonical amenities");
    }
    expect(model.amenities.featured.value).toHaveLength(8);
    expect(model.amenities.featured.value.map((amenity) => amenity.sortOrder)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(model.amenities.featured.value.every((amenity) => amenity.isFeatured)).toBe(true);
    expect(model.amenities.all.value).toHaveLength(11);
    expect(model.amenities.all.value.at(-1)?.id).toBe("ordinary");
  });
});

describe("Decision Deck truth states", () => {
  it("counts only explicit availability while preserving the listed row order", () => {
    const units = [
      makeUnit({ id: "c", code: "C-301", availabilityStatus: "SOLD" }),
      makeUnit({ id: "a", code: "A-101", availabilityStatus: "Available" }),
      makeUnit({ id: "b", code: "B-201", availabilityStatus: "Launching soon" }),
    ];
    const model = buildDecisionDeckModel(makeProjectDetail({ units }));

    expect(model.units.rows).toBe(units);
    expect(model.units.rows.map((unit) => unit.code)).toEqual(["C-301", "A-101", "B-201"]);
    expect(model.units.summary).toEqual({
      state: "supported",
      value: {
        listedCount: 3,
        availableCount: 1,
        listedLabel: "3 listed residences",
      },
    });
    expect(model.decisionRail.currentInventory).toBe(model.units.summary);
  });

  it("withholds conflicting developer identity without retaining either name", () => {
    const model = buildDecisionDeckModel(
      makeProjectDetail({
        core: { developerNameRaw: "Beta Development" },
        developer: {
          id: "developer",
          name: "Alpha Development",
          description: "Alpha Development profile",
          website: "https://alpha.example",
          contactName: "",
          contactPhone: "",
          contactEmail: "",
          logoUrl: "",
        },
      }),
    );

    expect(model.developer).toEqual({
      state: "conflicting",
      reason: "developer-sources-disagree",
    });
    expect(model.sectionStates.developer).toBe(false);
    expect(model.navigation.map((section) => section.id)).not.toContain("developer");
    expect(JSON.stringify(model)).not.toContain("Alpha Development");
    expect(JSON.stringify(model)).not.toContain("Beta Development");
  });

  it("keeps plan media in Plans and payment plans in truthful general Documents", () => {
    const master = makeMediaItem({
      id: "master",
      type: "master_plan",
      url: "/plans/master.jpg",
    });
    const unitPlan = makeMediaItem({
      id: "unit-plan",
      type: "unit_plan",
      url: "/plans/unit.jpg",
    });
    const project = makeProjectDetail({
      media: {
        masterPlan: master,
        unitPlans: [unitPlan],
        documents: [
          { ...document("master_plan", "master", "/plans/master.jpg") },
          { ...document("unit_plan", "unit-plan", "/plans/unit.jpg") },
          document("payment_plan", "payment", "/documents/payment.pdf"),
          document("document", "facts", "/documents/facts.pdf"),
          {
            ...document("document", "map", "/documents/map.pdf"),
            semanticRole: "map",
          },
        ],
      },
    });
    const model = buildDecisionDeckModel(project);

    expect(model.plans.all.state).toBe("supported");
    expect(model.documents.state).toBe("supported");
    if (model.plans.all.state !== "supported" || model.documents.state !== "supported") {
      throw new Error("expected plans and documents");
    }
    expect(model.plans.all.value.map((item) => item.id)).toEqual(["master", "unit-plan"]);
    expect(model.documents.value.map((item) => item.id)).toEqual(["payment", "facts"]);
    expect(model.documents.value.map((item) => item.type)).toEqual(["payment_plan", "document"]);
    expect(model.documents.value.map((item) => item.label)).toEqual(["Payment plan", "Document"]);
    expect(model.location.state).toBe("supported");
  });

  it("does not turn legacy scalars or generated fallbacks into Passport or Intelligence claims", () => {
    const model = buildDecisionDeckModel(
      makeProjectDetail({
        pricing: { startingPriceTHB: 0 },
        trust: {
          foreverVerified: true,
          trustScore: 9.8,
          verdict: "Strong Buy",
          marketPosition: "Below market",
          lastInspection: "2026-06-01",
        },
        investment: {
          investmentValue: 9.5,
          rentalYield: "9%",
          rentalDemand: "Very high",
          capitalGrowthEstimate: "8%",
        },
      }),
    );

    expect(model.decisionRail.priceFromTHB.state).toBe("empty");
    expect(model.passport.compact.overallScore.state).toBe("unavailable");
    expect(model.passport.compact.verdict.state).toBe("unavailable");
    expect(model.passport.compact.coreDimensions.state).toBe("unavailable");
    expect(model.passport.compact.buyerProfile.state).toBe("unavailable");
    expect(model.passport.full.advisorySummary.state).toBe("unavailable");
    expect(model.passport.full.riskSummary.state).toBe("unavailable");
    expect(model.intelligence.state).toBe("unavailable");
    expect(model.sectionStates.intelligence).toBe(false);
    expect(JSON.stringify(model.passport)).not.toContain('"value":0');
    expect(JSON.stringify(model)).not.toContain("Strong Buy");
    expect(JSON.stringify(model)).not.toContain("Below market");
    expect(JSON.stringify(model)).not.toContain("Very high");
  });
});

describe("Decision Deck media and optional sections", () => {
  it("exposes semantic-safe photographs with factual labels only", () => {
    const blocked = makeMediaItem({
      id: "event",
      type: "cover",
      title: "Beta Development launch",
      url: "https://cdn.example.com/event.jpg",
      semanticRole: "event",
    });
    const safe = makeMediaItem({
      id: "exterior",
      type: "gallery",
      title: "Alpha Development exterior",
      url: "https://cdn.example.com/exterior.jpg",
      semanticRole: "project_exterior",
    });
    const model = buildDecisionDeckModel(
      makeProjectDetail({
        media: {
          hero: blocked,
          gallery: [blocked, safe, safe],
        },
      }),
    );

    expect(model.media.photos.state).toBe("supported");
    if (model.media.photos.state !== "supported") throw new Error("expected safe photo");
    expect(model.media.photos.value).toEqual([
      expect.objectContaining({
        id: "exterior",
        label: "Modeva photograph 1",
        source: "public-project-media",
      }),
    ]);
    expect(JSON.stringify(model.media.photos)).not.toContain("Development");
    expect(JSON.stringify(model.media.photos)).not.toContain("event.jpg");
  });

  it("accepts only direct native film files and hides unsupported embeds", () => {
    expect(isDirectPlayableProjectFilmUrl("https://cdn.example.com/film.MP4?token=1")).toBe(true);
    expect(isDirectPlayableProjectFilmUrl("/films/project.webm#chapter")).toBe(true);
    expect(isDirectPlayableProjectFilmUrl("https://youtu.be/example")).toBe(false);
    expect(isDirectPlayableProjectFilmUrl("//cdn.example.com/film.mp4")).toBe(false);
    expect(isDirectPlayableProjectFilmUrl("films/project.ogg")).toBe(false);

    const unsupported = buildDecisionDeckModel(
      makeProjectDetail({
        media: {
          videos: [
            makeMediaItem({
              id: "youtube",
              type: "video",
              url: "https://www.youtube.com/watch?v=example",
            }),
          ],
        },
      }),
    );
    expect(unsupported.media.film.state).toBe("unavailable");
    expect(unsupported.sectionStates.film).toBe(false);

    const supported = buildDecisionDeckModel(
      makeProjectDetail({
        media: {
          videos: [
            makeMediaItem({
              id: "direct-film",
              type: "video",
              title: "Untrusted free-text title",
              url: "/films/project.ogg",
            }),
          ],
        },
      }),
    );
    expect(supported.media.film).toEqual({
      state: "supported",
      value: expect.objectContaining({
        id: "direct-film",
        label: "Project film",
        url: "/films/project.ogg",
      }),
    });
    expect(supported.sectionStates.film).toBe(true);
    expect(JSON.stringify(supported.media.film)).not.toContain("Untrusted");
  });

  it("keeps navigation and rendering in parity for unusable protocol-relative files", () => {
    const model = buildDecisionDeckModel(
      makeProjectDetail({
        media: {
          masterPlan: makeMediaItem({
            id: "unusable-plan",
            type: "master_plan",
            url: "//cdn.example.com/plan.jpg",
          }),
          floorPlans: [
            makeMediaItem({
              id: "invalid-absolute-plan",
              type: "floor_plan",
              url: "https://",
            }),
          ],
          documents: [
            document("document", "unusable-document", "//cdn.example.com/facts.pdf"),
            document("document", "invalid-document", "http://["),
          ],
        },
      }),
    );

    expect(model.plans.all.state).toBe("empty");
    expect(model.documents.state).toBe("empty");
    expect(model.navigation.map((section) => section.id)).not.toContain("plans");
    expect(model.navigation.map((section) => section.id)).not.toContain("documents");
  });

  it("rejects malformed media and developer URLs before they become public links", () => {
    const model = buildDecisionDeckModel(
      makeProjectDetail({
        developer: {
          id: "developer",
          name: "Recorded Developer",
          description: "",
          website: "https://",
          contactName: "",
          contactPhone: "",
          contactEmail: "",
          logoUrl: "",
        },
        core: { developerNameRaw: "Recorded Developer" },
        media: {
          hero: makeMediaItem({
            id: "private-file",
            type: "cover",
            url: "file:///C:/owner/project.jpg",
          }),
          gallery: [
            makeMediaItem({
              id: "invalid-http",
              type: "gallery",
              url: "http://[",
            }),
          ],
        },
      }),
    );

    expect(model.media.photos.state).toBe("empty");
    expect(model.developer.state).toBe("supported");
    if (model.developer.state !== "supported") throw new Error("expected developer");
    expect(model.developer.value.website).toBe("");
  });

  it("creates only price-list updates and filters/caps published related input", () => {
    const model = buildDecisionDeckModel(
      makeProjectDetail({ pricing: { lastPriceUpdate: "2026-07-29" } }),
      {
        relatedProjects: [
          {
            slug: "the-modeva-bang-tao",
            name: "Current project",
            isPublished: true,
            isActive: true,
          },
          {
            slug: "draft",
            name: "Draft",
            isPublished: false,
            isActive: true,
          },
          {
            slug: "inactive",
            name: "Inactive",
            isPublished: true,
            isActive: false,
          },
          ...["one", "two", "three", "four"].map((slug) => ({
            slug,
            name: slug.toUpperCase(),
            isPublished: true,
            isActive: true,
          })),
        ],
      },
    );

    expect(model.updates).toEqual({
      state: "supported",
      value: [
        {
          type: "price-list",
          label: "Price list updated",
          date: "2026-07-29",
        },
      ],
    });
    expect(model.related.state).toBe("supported");
    if (model.related.state !== "supported") throw new Error("expected related projects");
    expect(model.related.value.map((project) => project.slug)).toEqual(["one", "two", "three"]);
  });
});
