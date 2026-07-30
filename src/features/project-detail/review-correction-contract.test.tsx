import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  makeMediaItem,
  makeProjectDetail,
  makeUnit,
} from "@/features/forever-database/tests/fixtures";
import { createIntelligenceInput } from "@/features/intelligence/intelligence-input";

import { ProjectDocuments } from "./components/ProjectDocuments";
import { ProjectInventory } from "./components/ProjectInventory";
import { ProjectPaymentPlan } from "./components/ProjectPaymentPlan";
import { ProjectUnitPreview } from "./components/ProjectUnitPreview";
import {
  developerIdentity,
  developersMateriallyDisagree,
  normaliseDeveloperName,
} from "./developer-identity";
import { mapProjectDetailToProperty } from "./demo-preview";
import { buildModevaPartnerDemoCore } from "./partner-demo-truth";
import { buildDecisionDeckModel as buildPublicDecisionDeckModel } from "./decision-deck-model";
import { buildProjectStructuredData as buildPublicProjectStructuredData } from "./project-structured-data";
import { publicProjectDetail } from "./public-project-detail";
import type {
  ProjectDetail,
  ProjectDetailDocument,
  ProjectDetailMediaItem,
} from "./project-detail-types";
import {
  hasDocumentsSection,
  projectDocuments,
  projectFloorPlans,
  projectPhotographs,
  projectSections,
  projectSocialImage,
} from "./project-sections";
import {
  DEFAULT_UNIT_FILTERS,
  applyUnitFilters,
  isAvailable,
  unitAvailabilityPresentation,
} from "./unit-presentation";

function developer(name: string): NonNullable<ProjectDetail["developer"]> {
  return {
    id: `developer-${name}`,
    name,
    description: "Recorded developer description",
    website: "",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    logoUrl: "",
  };
}

function document(
  type: string,
  overrides: Partial<ProjectDetailDocument> = {},
): ProjectDetailDocument {
  return {
    id: `document-${type}`,
    type,
    title: `${type} document`,
    label: type,
    note: "Available",
    url: `https://cdn.example/${type}.pdf`,
    sortOrder: 1,
    semanticRole: null,
    ...overrides,
  };
}

function structuredJson(project: ProjectDetail): string {
  return buildPublicProjectStructuredData(
    publicProjectDetail(project),
    `https://example.com/projects/${project.core.slug}`,
    projectSocialImage(project) ?? undefined,
  )
    .map((script) => script.children)
    .join("\n");
}

function buildDecisionDeckModel(project: ProjectDetail) {
  return buildPublicDecisionDeckModel(publicProjectDetail(project));
}

describe("F2-NEAR-MATCH and F2-CONSUMER-BYPASS", () => {
  it("matches only equal safely normalized cores", () => {
    for (const [canonical, raw] of [
      ["Rhom Bho Property", "Rhom Phuket Bho Property"],
      ["Sunrise Development", "Sunrise Developments"],
      ["Long Prefix Property One", "Long Prefix Property Two"],
      ["Rhom Bho Property", "Bho Rhom Property"],
      ["Origin Property", "Origin"],
    ] as const) {
      expect(
        developersMateriallyDisagree(canonical, raw),
        `${canonical} must not be reconciled with ${raw}`,
      ).toBe(true);
    }
  });

  it("accepts only safe case, punctuation, whitespace and legal-form variants", () => {
    for (const [canonical, raw] of [
      ["Rhom Bho Property", "  RHOM   BHO PROPERTY  "],
      ["Rhom Bho Property", "Rhom Bho Property Public Company Limited"],
      ["Rhom Bho Property Co., Ltd.", "Rhom Bho Property"],
      ["Sansiri PCL", "Sansiri Public Company Limited"],
      ["Ôrigin Co., Ltd.", "ORIGIN"],
    ] as const) {
      expect(developersMateriallyDisagree(canonical, raw)).toBe(false);
    }

    expect(normaliseDeveloperName("Sunrise Property Group")).toEqual([
      "sunrise",
      "property",
      "group",
    ]);
  });

  it("withholds a conflict from identity, intelligence, property adapters and JSON-LD", () => {
    const project = makeProjectDetail({
      core: { developerNameRaw: "Rhom Phuket Bho Property" },
      developer: developer("Rhom Bho Property"),
    });

    expect(developerIdentity(project).state).toBe("withheld");
    expect(createIntelligenceInput(project).fields.developerName).toBe("");
    expect(createIntelligenceInput(project).fields.developerDescription).toBe("");
    expect(mapProjectDetailToProperty(project).developer).toBe("");
    expect(structuredJson(project)).not.toContain('"brand"');
    expect(structuredJson(project)).not.toContain("Rhom Bho Property");
  });

  it("keeps a single source and an equivalent two-source identity", () => {
    const rawOnly = makeProjectDetail({
      core: { developerNameRaw: "Rhom Bho Property" },
      developer: null,
    });
    expect(developerIdentity(rawOnly)).toMatchObject({
      state: "named",
      name: "Rhom Bho Property",
    });

    const equivalent = makeProjectDetail({
      core: { developerNameRaw: "Rhom Bho Property Public Company Limited" },
      developer: developer("Rhom Bho Property"),
    });
    expect(createIntelligenceInput(equivalent).fields.developerName).toBe("Rhom Bho Property");
    expect(mapProjectDetailToProperty(equivalent).developer).toBe("Rhom Bho Property");
    expect(structuredJson(equivalent)).toContain('"brand"');
  });
});

describe("F1-AVAILABILITY-FAIL-OPEN", () => {
  it("uses an explicit, fail-closed status vocabulary", () => {
    for (const status of ["available", "Available", "selling"]) {
      expect(unitAvailabilityPresentation(status)).toMatchObject({
        normalizedStatus: "available",
        availableCountEligible: true,
        defaultFilterIncluded: true,
      });
    }

    for (const status of [
      "SOLD",
      "sold_out",
      "reserved",
      "held",
      "booked",
      "blocked",
      "unavailable",
      "unknown",
      "",
      "   ",
      "available-ish",
      null,
      undefined,
    ]) {
      expect(unitAvailabilityPresentation(status).availableCountEligible, String(status)).toBe(
        false,
      );
      expect(unitAvailabilityPresentation(status).defaultFilterIncluded).toBe(false);
    }

    for (const status of ["unknown", "", " ", "available-ish", null, undefined]) {
      expect(unitAvailabilityPresentation(status).label).toBe("Status not recorded");
    }
  });

  it("keeps counts, badges and available-only filtering consistent for mixed rows", () => {
    const units = [
      makeUnit({ id: "available", code: "A1", availabilityStatus: "available" }),
      makeUnit({ id: "sold", code: "A2", availabilityStatus: "SOLD" }),
      makeUnit({ id: "reserved", code: "A3", availabilityStatus: "reserved" }),
      makeUnit({ id: "unknown", code: "A4", availabilityStatus: "" }),
    ];
    const project = makeProjectDetail({ units });

    expect(units.filter(isAvailable).map((unit) => unit.code)).toEqual(["A1"]);
    expect(applyUnitFilters(units, DEFAULT_UNIT_FILTERS).map((unit) => unit.code)).toEqual(["A1"]);

    render(<ProjectInventory project={project} />);
    expect(screen.getByText("1 of 4 listed units available")).not.toBeNull();
    const unknownRows = screen.getAllByText("Status not recorded");
    expect(unknownRows.length).toBeGreaterThan(0);
    expect(
      unknownRows.every(
        (label) => label.closest("[data-available]")?.getAttribute("data-available") !== "true",
      ),
    ).toBe(true);
  });

  it("states a truthful zero-available empty state and can reveal excluded rows", () => {
    const project = makeProjectDetail({
      units: [
        makeUnit({ id: "sold", code: "A1", availabilityStatus: "sold" }),
        makeUnit({ id: "unknown", code: "A2", availabilityStatus: "" }),
      ],
    });

    const model = buildDecisionDeckModel(project);
    render(
      <ProjectUnitPreview
        units={model.units}
        lastPriceUpdate={model.passport.compact.lastPriceUpdate}
      />,
    );
    expect(screen.getByText("0 of 2 listed units available")).not.toBeNull();
    expect(
      screen.getByText(
        "No listed unit is explicitly recorded as available. Use Include unavailable to review all listed units.",
      ),
    ).not.toBeNull();
    expect(screen.queryByTestId("unit-preview-card")).toBeNull();

    fireEvent.click(screen.getByLabelText(/Include unavailable/i, { selector: "input" }));
    expect(screen.getAllByTestId("unit-preview-card")).toHaveLength(2);
    expect(screen.getByText("Status not recorded")).not.toBeNull();
  });
});

describe("NAV-DOCUMENTS", () => {
  it.each([
    ["brochure", document("brochure")],
    ["public price list", document("price_list")],
    ["master plan document", document("master_plan")],
    ["role-less legacy document", document("document", { semanticRole: null })],
  ])("renders one reachable Documents section for %s", (_label, item) => {
    const project = makeProjectDetail({ media: { documents: [item] } });
    expect(hasDocumentsSection(project)).toBe(true);
    expect(projectSections(project).filter((section) => section.id === "documents")).toHaveLength(
      1,
    );
    const { container } = render(<ProjectDocuments project={project} />);
    expect(container.querySelector("#documents")).not.toBeNull();
  });

  it("keeps payment-plan-only content in its genuinely separate section", () => {
    const project = makeProjectDetail({
      media: { documents: [document("payment_plan")] },
    });
    expect(projectDocuments(project)).toEqual([]);
    expect(projectSections(project).map((section) => section.id)).toContain("payment-plan");
    expect(projectSections(project).map((section) => section.id)).not.toContain("documents");

    const { container } = render(<ProjectDocuments project={project} />);
    expect(container.innerHTML).toBe("");
    render(<ProjectPaymentPlan project={project} />);
    expect(screen.getByRole("link", { name: "View payment plan" })).not.toBeNull();
  });

  it("rejects unknown/private and prohibited documents without a dangling link", () => {
    const unsafeUrl = "https://cdn.example/private.pdf";
    const project = makeProjectDetail({
      media: {
        documents: [
          document("internal_proof", { url: "https://cdn.example/internal.pdf" }),
          document("document", {
            id: "event-document",
            url: unsafeUrl,
            semanticRole: "event",
          }),
          document("document", {
            id: "safe-sibling",
            url: unsafeUrl,
            semanticRole: null,
          }),
        ],
      },
    });

    expect(projectDocuments(project)).toEqual([]);
    expect(projectSections(project).map((section) => section.id)).not.toContain("documents");
    const { container } = render(<ProjectDocuments project={project} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("MEDIA-ALTERNATE-CONSTRUCTOR", () => {
  it("bars prohibited direct media and its safe-looking duplicate sibling everywhere", () => {
    const url = "https://cdn.example/event.jpg";
    const project = makeProjectDetail({
      media: {
        hero: makeMediaItem({
          id: "safe-looking-cover",
          type: "cover",
          url,
          semanticRole: null,
        }),
        gallery: [
          makeMediaItem({
            id: "prohibited-sibling",
            type: "gallery",
            url,
            semanticRole: "event",
          }),
        ],
      },
    });

    expect(projectPhotographs(project)).toEqual([]);
    expect(projectSocialImage(project)).toBeNull();
    expect(mapProjectDetailToProperty(project).image).toBe("");
    expect(mapProjectDetailToProperty(project).gallery).toEqual([]);
    expect(structuredJson(project)).not.toContain(url);
  });

  it("withholds every prohibited role but preserves safe role-less photographs", () => {
    for (const role of ["event", "group_photo", "portrait", "lifestyle"]) {
      const project = makeProjectDetail({
        media: {
          hero: null,
          gallery: [makeMediaItem({ semanticRole: role, url: `https://cdn.example/${role}.jpg` })],
        },
      });
      expect(projectPhotographs(project), role).toEqual([]);
      expect(projectSocialImage(project), role).toBeNull();
    }

    const safe = makeProjectDetail({
      media: {
        hero: null,
        gallery: [makeMediaItem({ semanticRole: null, url: "https://cdn.example/legacy.jpg" })],
      },
    });
    expect(projectSocialImage(safe)).toBe("https://cdn.example/legacy.jpg");
  });

  it("allows safe plans without inventing a photographic hero", () => {
    const plan: ProjectDetailMediaItem = makeMediaItem({
      id: "floor-plan",
      type: "floor_plan",
      semanticRole: "plan",
      url: "https://cdn.example/floor-plan.pdf",
    });
    const project = makeProjectDetail({
      media: { hero: null, gallery: [], floorPlans: [plan] },
    });

    expect(projectFloorPlans(project)).toEqual([plan]);
    expect(projectPhotographs(project)).toEqual([]);
    expect(projectSocialImage(project)).toBeNull();
  });
});

describe("F4-PARTNER-DEMO", () => {
  it("constructs the Modeva demo core without an unsupported ownership claim", () => {
    const core = buildModevaPartnerDemoCore();
    expect(core.ownershipType).toBe("");
    expect(core.highlights.join(" ")).not.toMatch(/freehold|ownership/i);
    expect(core.developerNameRaw).toBe("Rhom Bho Property");
  });

  it("makes the known Modeva source conflict visible to the shared decision only as withheld", () => {
    const project = makeProjectDetail({
      core: buildModevaPartnerDemoCore(),
      developer: developer("Title"),
    });
    expect(developerIdentity(project).state).toBe("withheld");
    expect(mapProjectDetailToProperty(project).developer).toBe("");
    expect(createIntelligenceInput(project).fields.developerName).toBe("");
    expect(structuredJson(project)).not.toContain('"brand"');
  });
});
